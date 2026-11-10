import {
  PROVIDER_ORDER,
  PROVIDERS,
  TARGET_LANGUAGES,
} from "./constants.js";
import { debounce, formatError } from "./util.js";

const controllers = new WeakMap();

function option(doc, value, label) {
  const item = doc.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

export function mountPreferences(doc) {
  const root = doc.getElementById("deepread-prefs-root") || doc.querySelector(".dr-prefs");
  if (!root) return null;
  const existing = controllers.get(root);
  if (existing) {
    existing.refresh();
    return existing;
  }

  const app = Zotero.DeepRead;
  const $ = (id) => doc.getElementById(id) || root.querySelector(`[id="${id}"]`);
  const elements = {
    provider: $("dr-pref-provider"),
    baseUrl: $("dr-pref-base-url"),
    apiKey: $("dr-pref-api-key"),
    keyToggle: $("dr-pref-key-toggle"),
    keyHelp: $("dr-pref-key-help"),
    model: $("dr-pref-model"),
    translationModel: $("dr-pref-translation-model"),
    modelOptions: $("dr-pref-model-options"),
    targetLang: $("dr-pref-target-lang"),
    contextPages: $("dr-pref-context-pages"),
    stream: $("dr-pref-stream"),
    temperature: $("dr-pref-temperature"),
    maxTokens: $("dr-pref-max-tokens"),
    autoTranslate: $("dr-pref-auto-translate"),
    autoPage: $("dr-pref-auto-page"),
    autoRestore: $("dr-pref-auto-restore"),
    deepseekThinking: $("dr-pref-deepseek-thinking"),
    systemPrompt: $("dr-pref-system-prompt"),
    translationPrompt: $("dr-pref-translation-prompt"),
    status: $("dr-pref-status"),
    test: $("dr-pref-test"),
    save: $("dr-pref-save"),
    reset: $("dr-pref-reset"),
    version: $("dr-pref-version"),
  };

  for (const id of PROVIDER_ORDER) {
    elements.provider.appendChild(option(doc, id, PROVIDERS[id].label));
  }
  for (const language of TARGET_LANGUAGES) {
    elements.targetLang.appendChild(option(doc, language.id, language.label));
  }
  if (elements.version) elements.version.textContent = `v${app.version || "0.1.0"}`;

  let currentProvider = "openai";
  let suppress = false;
  let lastSavedAt = 0;

  const setStatus = (text, kind = "") => {
    elements.status.textContent = text || "";
    elements.status.classList.toggle("is-ok", kind === "ok");
    elements.status.classList.toggle("is-error", kind === "error");
    elements.status.classList.toggle("is-busy", kind === "busy");
  };

  const updateKeyHelp = (providerId) => {
    const preset = PROVIDERS[providerId] || PROVIDERS.openai;
    elements.apiKey.placeholder = preset.keyLabel || "API Key";
    elements.keyHelp.replaceChildren();
    const text = doc.createElement("span");
    text.textContent = "密钥只写入本机 prefs.js，不会同步，也不会发送给 ReadNow。";
    elements.keyHelp.appendChild(text);
    if (preset.keyUrl) {
      const link = doc.createElement("a");
      link.href = preset.keyUrl;
      link.textContent = "获取 API Key ↗";
      link.className = "dr-pref-link";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(preset.keyUrl);
      });
      elements.keyHelp.appendChild(doc.createTextNode(" "));
      elements.keyHelp.appendChild(link);
    }
  };

  const updateModelOptions = (providerId) => {
    if (!elements.modelOptions) return;
    elements.modelOptions.replaceChildren();
    const preset = PROVIDERS[providerId] || {};
    const models = Array.isArray(preset.models) ? preset.models : [];
    for (const modelId of models) {
      const item = doc.createElement("option");
      item.value = modelId;
      elements.modelOptions.appendChild(item);
    }
    if (preset.model) {
      elements.model.placeholder = preset.model;
      elements.translationModel.placeholder = preset.model;
    }
  };

  const writeForm = (settings) => {
    suppress = true;
    currentProvider = settings.provider;
    elements.provider.value = settings.provider;
    elements.baseUrl.value = settings.baseUrl || "";
    elements.apiKey.value = settings.apiKey || "";
    elements.model.value = settings.model || "";
    elements.translationModel.value = settings.translationModel || "";
    elements.targetLang.value = settings.targetLang || "zh-CN";
    elements.contextPages.value = String(settings.contextPages ?? 1);
    elements.stream.checked = Boolean(settings.stream);
    elements.temperature.value = String(settings.temperature ?? 0.2);
    elements.maxTokens.value = String(settings.maxTokens ?? 2048);
    elements.autoTranslate.checked = Boolean(settings.autoTranslate);
    elements.autoPage.checked = Boolean(settings.autoTranslatePage);
    elements.autoRestore.checked = Boolean(settings.autoRestore);
    elements.deepseekThinking.checked = Boolean(settings.deepseekThinking);
    elements.systemPrompt.value = settings.systemPrompt || "";
    elements.translationPrompt.value = settings.translationPrompt || "";
    elements.apiKey.type = "password";
    elements.keyToggle.textContent = "显示";
    updateKeyHelp(settings.provider);
    updateModelOptions(settings.provider);
    suppress = false;
  };

  const readForm = () => ({
    provider: elements.provider.value,
    baseUrl: elements.baseUrl.value.trim(),
    apiKey: elements.apiKey.value,
    model: elements.model.value.trim(),
    translationModel: elements.translationModel.value.trim(),
    targetLang: elements.targetLang.value,
    contextPages: Number(elements.contextPages.value),
    stream: elements.stream.checked,
    temperature: Number(elements.temperature.value),
    maxTokens: Number(elements.maxTokens.value),
    autoTranslate: elements.autoTranslate.checked,
    autoTranslatePage: elements.autoPage.checked,
    autoRestore: elements.autoRestore.checked,
    deepseekThinking: elements.deepseekThinking.checked,
    systemPrompt: elements.systemPrompt.value,
    translationPrompt: elements.translationPrompt.value,
  });

  const saveNow = ({ quiet = false } = {}) => {
    if (suppress) return app.getSettings();
    try {
      const settings = app.saveSettings(readForm());
      lastSavedAt = Date.now();
      if (!quiet) setStatus("已保存", "ok");
      return settings;
    } catch (error) {
      setStatus(formatError(error), "error");
      return app.getSettings();
    }
  };

  const saveSoon = debounce(() => saveNow({ quiet: true }), 420);

  const refresh = () => {
    writeForm(app.getSettings());
    setStatus("设置自动保存", "");
  };

  const onProviderChange = () => {
    const previous = PROVIDERS[currentProvider] || PROVIDERS.openai;
    const next = PROVIDERS[elements.provider.value] || PROVIDERS.openai;
    if (!elements.baseUrl.value.trim() || elements.baseUrl.value.trim() === previous.baseUrl) {
      elements.baseUrl.value = next.baseUrl;
    }
    if (!elements.model.value.trim() || elements.model.value.trim() === previous.model) {
      elements.model.value = next.model;
    }
    if (
      !elements.translationModel.value.trim() ||
      elements.translationModel.value.trim() === previous.translationModel
    ) {
      elements.translationModel.value = next.translationModel;
    }
    currentProvider = next.id;
    elements.apiKey.value = app.getApiKeyForProvider?.(next.id) || "";
    updateKeyHelp(next.id);
    updateModelOptions(next.id);
    saveNow({ quiet: true });
  };

  elements.provider.addEventListener("change", onProviderChange);
  for (const element of [
    elements.baseUrl,
    elements.apiKey,
    elements.model,
    elements.translationModel,
    elements.targetLang,
    elements.contextPages,
    elements.temperature,
    elements.maxTokens,
    elements.systemPrompt,
    elements.translationPrompt,
  ]) {
    element.addEventListener("input", saveSoon);
    element.addEventListener("change", saveSoon);
  }
  for (const element of [
    elements.stream,
    elements.autoTranslate,
    elements.autoPage,
    elements.autoRestore,
    elements.deepseekThinking,
  ]) {
    element.addEventListener("change", () => saveNow({ quiet: true }));
  }

  elements.keyToggle.addEventListener("click", () => {
    const show = elements.apiKey.type === "password";
    elements.apiKey.type = show ? "text" : "password";
    elements.keyToggle.textContent = show ? "隐藏" : "显示";
  });

  elements.save.addEventListener("click", () => {
    saveNow();
    setStatus("已保存", "ok");
  });

  elements.test.addEventListener("click", async () => {
    const settings = saveNow({ quiet: true });
    elements.test.disabled = true;
    setStatus("正在连接模型服务…", "busy");
    try {
      const result = await app.testConnection(settings);
      if (result.ok) {
        setStatus(result.message || `连接成功${result.model ? ` · ${result.model}` : ""}`, "ok");
      } else {
        setStatus(result.message || "连接失败", "error");
      }
    } catch (error) {
      setStatus(formatError(error, [settings.apiKey]), "error");
    } finally {
      elements.test.disabled = false;
    }
  });

  elements.reset.addEventListener("click", () => {
    const ok = Services.prompt.confirm(
      null,
      "恢复 ReadNow 默认设置？",
      "这会清空 API Key、模型选择、提示词和翻译偏好，但不会删除问答卡片和翻译缓存。",
    );
    if (!ok) return;
    app.resetSettings();
    refresh();
    setStatus("已恢复默认设置", "ok");
  });

  const onUnload = () => {
    if (Date.now() - lastSavedAt > 300) saveNow({ quiet: true });
  };
  doc.defaultView.addEventListener("unload", onUnload, { once: true });

  const controller = {
    refresh,
    saveNow,
    destroy() {
      doc.defaultView.removeEventListener("unload", onUnload);
    },
  };
  controllers.set(root, controller);
  refresh();
  return controller;
}
