import {
  ADDON_ID,
  DATA_DIR_NAME,
  PANE_ID,
  PROVIDER_ORDER,
  PROVIDERS,
  TARGET_LANGUAGES,
} from "./constants.js";
import { listModels, requestChat, validateApiConfig } from "./llm.js";
import { mountPreferences } from "./preferences-pane.js";
import {
  getApiKey,
  getSettings,
  resetSettings,
  saveSettings,
} from "./prefs.js";
import { ReaderIntegration } from "./reader/integration.js";
import { getAttachmentKey } from "./reader/pdf-access.js";
import { DataStore } from "./storage.js";
import { formatError } from "./util.js";

function log(message) {
  try {
    Zotero.debug(`ReadNow: ${message}`);
  } catch {
    // Ignore logging failures.
  }
}

function makeIO() {
  return {
    async mkdir(path) {
      await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
    },
    async readText(path) {
      return new TextDecoder().decode(await IOUtils.read(path));
    },
    async writeText(path, text) {
      await IOUtils.write(path, new TextEncoder().encode(text));
    },
  };
}

export class DeepReadPlugin {
  constructor() {
    this.id = ADDON_ID;
    this.version = "0.1.0";
    this.rootURI = "";
    this.store = null;
    this.integration = null;
    this.paneID = null;
    this.fontCache = null;
    this.menuItems = [];
    this.initialized = false;
  }

  async init({ id, version, rootURI }) {
    this.id = id || ADDON_ID;
    this.version = version || "0.1.0";
    this.rootURI = String(rootURI || "").replace(/\/?$/, "/");

    const dataDir = Zotero.DataDirectory.getSubdirectory(DATA_DIR_NAME, true);
    this.store = new DataStore({
      dir: dataDir,
      io: makeIO(),
      logger: log,
    });
    await this.store.init();

    this.integration = new ReaderIntegration(this);
    this.integration.register();
    this.addToolsMenu();

    try {
      this.paneID = await Zotero.PreferencePanes.register({
        pluginID: this.id,
        id: PANE_ID,
        label: "ReadNow",
        image: `${this.rootURI}content/icons/deepread-32.png`,
        src: `${this.rootURI}content/preferences.xhtml`,
        scripts: [`${this.rootURI}content/preferences.js`],
        stylesheets: [`${this.rootURI}content/preferences.css`],
        helpURL: "https://github.com/chenxin1209/ReadNow",
      });
    } catch (error) {
      log(`Could not register preferences pane: ${error}`);
      Zotero.logError(error);
      this.paneID = null;
    }

    this.initialized = true;
    log(`initialized v${this.version}`);
  }

  addToolsMenu() {
    const windows = Zotero.getMainWindows
      ? Zotero.getMainWindows()
      : [Zotero.getMainWindow()].filter(Boolean);
    for (const win of windows) {
      if (!win || win.closed) continue;
      try {
        const popup = win.document.getElementById("menu_ToolsPopup");
        if (!popup || popup.querySelector("#deepread-settings-menuitem")) continue;
        const separator = win.document.createXULElement("menuseparator");
        separator.id = "deepread-settings-separator";
        const item = win.document.createXULElement("menuitem");
        item.id = "deepread-settings-menuitem";
        item.setAttribute("label", "ReadNow 设置…");
        item.addEventListener("command", () => this.openPreferences());
        popup.append(separator, item);
        this.menuItems.push({ win, separator, item });
      } catch (error) {
        log(`Could not add Tools menu item: ${error}`);
      }
    }
  }

  removeToolsMenu() {
    for (const { win, separator, item } of this.menuItems) {
      try {
        item.remove();
        separator.remove();
      } catch {
        // Window may be closed.
      }
    }
    this.menuItems = [];
  }

  removeToolsMenuForWindow(win) {
    for (const entry of this.menuItems.filter((item) => item.win === win)) {
      try {
        entry.item.remove();
        entry.separator.remove();
      } catch {
        // Window may already be closing.
      }
    }
    this.menuItems = this.menuItems.filter((item) => item.win !== win);
  }

  getSettings() {
    return getSettings();
  }

  saveSettings(patch) {
    return saveSettings(patch);
  }

  getApiKeyForProvider(provider) {
    return getApiKey(provider);
  }

  resetSettings() {
    return resetSettings();
  }

  isConfigured(settings = this.getSettings()) {
    if (!settings.baseUrl || !settings.model) return false;
    if (settings.apiKey) return true;
    return (
      settings.provider === "ollama" ||
      /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(settings.baseUrl)
    );
  }

  getLLMConfig(settings, { translation = false } = {}) {
    const error = validateApiConfig({
      ...settings,
      model: translation ? settings.translationModel || settings.model : settings.model,
    });
    if (error) {
      const err = new Error(error);
      err.code = "NOT_CONFIGURED";
      throw err;
    }
    const deepseekThinking =
      settings.provider === "deepseek"
        ? { type: settings.deepseekThinking && !translation ? "enabled" : "disabled" }
        : undefined;
    return {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: translation ? settings.translationModel || settings.model : settings.model,
      temperature: translation ? 0.1 : settings.temperature,
      maxTokens: translation
        ? Math.max(settings.maxTokens, 4096)
        : settings.deepseekThinking && settings.provider === "deepseek"
          ? Math.max(settings.maxTokens, 4096)
          : settings.maxTokens,
      stream: translation ? false : settings.stream,
      thinking: deepseekThinking,
    };
  }

  getNetworkOptions() {
    const win = Zotero.getMainWindow();
    return {
      fetchImpl: win?.fetch?.bind(win),
      AbortControllerImpl: win?.AbortController,
      TextDecoderImpl: win?.TextDecoder,
    };
  }

  createAbortController() {
    const Impl =
      Zotero.getMainWindow()?.AbortController || globalThis.AbortController || null;
    return Impl ? new Impl() : null;
  }

  async chat(messages, options = {}) {
    const settings = this.getSettings();
    const config = this.getLLMConfig(settings);
    let accumulated = "";
    const onDelta = options.onDelta
      ? (delta) => {
          accumulated += delta;
          options.onDelta(delta);
        }
      : undefined;
    const result = await requestChat(config, messages, {
      ...this.getNetworkOptions(),
      ...options,
      onDelta: config.stream ? onDelta : undefined,
    });
    return result || accumulated;
  }

  async translate(messages, options = {}) {
    const settings = this.getSettings();
    const config = this.getLLMConfig(settings, { translation: true });
    return requestChat(config, messages, {
      ...this.getNetworkOptions(),
      ...options,
      onDelta: undefined,
    });
  }

  async testConnection(settings = this.getSettings()) {
    try {
      const config = this.getLLMConfig(settings);
      let models = [];
      try {
        models = await listModels(config, this.getNetworkOptions());
      } catch {
        models = [];
      }
      if (models.length) {
        const target = config.provider === "gemini" ? config.model : config.model;
        const matched = models.some((model) => model === target || model.endsWith(`/${target}`));
        return {
          ok: true,
          model: config.model,
          message: matched
            ? `连接成功，模型 ${config.model} 可用`
            : `接口连接成功（找到 ${models.length} 个模型）。请确认模型名 ${config.model} 是否存在。`,
        };
      }
      const answer = await requestChat(
        { ...config, stream: false, maxTokens: 32, temperature: 0 },
        [
          { role: "system", content: "You are a connection test. Reply with exactly: OK" },
          { role: "user", content: "Reply with OK." },
        ],
        { ...this.getNetworkOptions(), timeoutMs: 30000 },
      );
      return {
        ok: true,
        model: config.model,
        message: `连接成功，模型返回：${String(answer).trim().slice(0, 30)}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: formatError(error, [settings.apiKey]),
      };
    }
  }

  async openWorkspace(reader, options = {}) {
    return this.integration.openWorkspace(reader, options);
  }

  async ask(reader, selection, anchorRect = null) {
    return this.integration.ask(reader, selection, anchorRect);
  }

  getAttachmentKey(reader) {
    return getAttachmentKey(reader);
  }

  getMainWindow() {
    return Zotero.getMainWindow();
  }

  openPreferences() {
    try {
      Zotero.Utilities.Internal.openPreferences(this.paneID || PANE_ID);
    } catch (error) {
      log(`Could not open preferences: ${error}`);
      Zotero.logError(error);
    }
  }

  mountPreferences(doc) {
    return mountPreferences(doc);
  }

  async loadFontAsset(filename) {
    this.fontCache ||= new Map();
    if (this.fontCache.has(filename)) return this.fontCache.get(filename);
    const url = `${this.rootURI}content/assets/${filename}`;

    // Plugins usually live inside a jar: XPI, so nsIFileURL is not available.
    // Read the packaged asset through the system-principal network channel.
    try {
      const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
      const uri = Services.io.newURI(url);
      const channel = NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true });
      const stream = channel.open();
      const binary = NetUtil.readInputStreamToString(stream, stream.available());
      stream.close();
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index) & 0xff;
      }
      if (!bytes.length) throw new Error("empty font");
      this.fontCache.set(filename, bytes);
      return bytes;
    } catch (error) {
      log(`Jar font read failed, trying file/fetch: ${error}`);
    }

    try {
      const uri = Services.io.newURI(url);
      const file = uri.QueryInterface(Components.interfaces.nsIFileURL).file;
      const bytes = new Uint8Array(await IOUtils.read(file.path));
      this.fontCache.set(filename, bytes);
      return bytes;
    } catch (error) {
      log(`Falling back to fetch for font: ${error}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error("无法加载内置中文字体，无法导出译文 PDF");
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.fontCache.set(filename, bytes);
      return bytes;
    }
  }

  async loadFontBytes() {
    return this.loadFontAsset("NotoSansSC-Regular.ttf");
  }

  async loadFonts() {
    const [sans, serif] = await Promise.all([
      this.loadFontAsset("NotoSansSC-Regular.ttf"),
      this.loadFontAsset("NotoSerifSC-Regular.ttf"),
    ]);
    return { sans, serif };
  }

  getProviderList() {
    return PROVIDER_ORDER.map((id) => ({ id, ...PROVIDERS[id] }));
  }

  getLanguageList() {
    return TARGET_LANGUAGES.slice();
  }

  async shutdown() {
    if (!this.initialized) return;
    this.initialized = false;
    try {
      this.integration?.unregister();
    } catch (error) {
      log(`integration shutdown error: ${error}`);
    }
    this.removeToolsMenu();
    if (this.paneID) {
      try {
        Zotero.PreferencePanes.unregister(this.paneID);
      } catch (error) {
        log(`preference pane shutdown error: ${error}`);
      }
      this.paneID = null;
    }
    try {
      await this.store?.destroy();
    } catch (error) {
      log(`store shutdown error: ${error}`);
    }
    this.store = null;
    this.integration = null;
  }
}

export function createPlugin() {
  return new DeepReadPlugin();
}
