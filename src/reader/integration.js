import readerCss from "../styles/reader.css";
import katexCss from "../styles/katex.css";
import { ADDON_ID, CARD_DEFAULT_WIDTH, CARD_DEFAULT_HEIGHT } from "../constants.js";
import { icon } from "./icons.js";
import { SelectionPopup } from "./selection-popup.js";
import { ReaderWorkspace } from "./workspace.js";

function ensureStyle(doc) {
  if (!doc) return;
  if (!doc.getElementById("deepread-reader-style")) {
    const style = doc.createElement("style");
    style.id = "deepread-reader-style";
    style.textContent = readerCss;
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (!doc.getElementById("deepread-katex-style")) {
    const katexStyle = doc.createElement("style");
    katexStyle.id = "deepread-katex-style";
    katexStyle.textContent = katexCss;
    (doc.head || doc.documentElement).appendChild(katexStyle);
  }
}

function createToolbarButton(doc, app, reader) {
  const button = doc.createElement("button");
  button.id = "deepread-toolbar-button";
  button.type = "button";
  button.className = "toolbar-button deepread-toolbar-button";
  button.title = "ReadNow：划词翻译、对照阅读与 AI 提问";
  button.setAttribute("aria-label", "打开 ReadNow");
  button.appendChild(icon(doc, "logo", 19));
  const badge = doc.createElement("span");
  badge.className = "deepread-toolbar-badge";
  badge.hidden = true;
  button.appendChild(badge);
  try {
    const count = app.store.getCards(app.getAttachmentKey(reader)).length;
    if (count) {
      badge.textContent = String(count);
      badge.hidden = false;
    }
  } catch {
    // Ignore store readiness issues.
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    app.openWorkspace(reader).catch((error) => Zotero.logError(error));
  });
  return button;
}

export class ReaderIntegration {
  constructor(app) {
    this.app = app;
    this.workspaces = new Map();
    this.handlers = [];
  }

  register() {
    const toolbarHandler = (event) => this.onToolbar(event);
    const selectionHandler = (event) => this.onSelectionPopup(event);
    Zotero.Reader.registerEventListener("renderToolbar", toolbarHandler, ADDON_ID);
    Zotero.Reader.registerEventListener("renderTextSelectionPopup", selectionHandler, ADDON_ID);
    this.handlers.push(
      ["renderToolbar", toolbarHandler],
      ["renderTextSelectionPopup", selectionHandler],
    );
  }

  unregister() {
    for (const [type, handler] of this.handlers) {
      try {
        Zotero.Reader.unregisterEventListener(type, handler);
      } catch {
        // Zotero also removes listeners by plugin ID on shutdown.
      }
    }
    this.handlers = [];
    for (const workspace of this.workspaces.values()) {
      try {
        workspace.destroy();
      } catch {
        // Ignore.
      }
    }
    this.workspaces.clear();
  }

  onToolbar({ reader, doc, append }) {
    if (!this.isSupported(reader)) return;
    ensureStyle(doc);
    append(createToolbarButton(doc, this.app, reader));
  }

  onSelectionPopup({ reader, doc, params, append }) {
    if (!this.isSupported(reader)) return;
    ensureStyle(doc);
    const workspace = this.getWorkspace(reader, { create: false });
    try {
      new SelectionPopup({
        app: this.app,
        reader,
        doc,
        params,
        workspace,
        onAsk: (selection, rect) => this.ask(reader, selection, rect),
        onCompare: (selection) => this.compare(reader, selection),
        append,
      });
    } catch (error) {
      Zotero.logError(error);
    }
  }

  isSupported(reader) {
    return Boolean(reader && reader.type === "pdf");
  }

  getWorkspace(reader, { create = true } = {}) {
    let workspace = this.workspaces.get(reader);
    if (workspace?.destroyed) {
      this.workspaces.delete(reader);
      workspace = null;
    }
    if (!workspace && create) {
      workspace = new ReaderWorkspace({ app: this.app, reader });
      this.workspaces.set(reader, workspace);
    }
    return workspace || null;
  }

  getOrCreateWorkspace(reader) {
    return this.getWorkspace(reader, { create: true });
  }

  async openWorkspace(reader, options = {}) {
    const workspace = this.getOrCreateWorkspace(reader);
    await workspace.open({ mode: options.mode || "compare" });
    if (options.selection) {
      await workspace.navigateToSelection(options.selection);
    }
    return workspace;
  }

  async ask(reader, selection, anchorRect = null) {
    const workspace = this.getOrCreateWorkspace(reader);
    if (!workspace.opened) await workspace.open({ mode: "compare" });
    return workspace.ask(selection, anchorRect);
  }

  async compare(reader, selection) {
    const workspace = this.getOrCreateWorkspace(reader);
    await workspace.open({ mode: "compare" });
    await workspace.navigateToSelection(selection);
    return workspace;
  }

  destroyWorkspace(reader) {
    const workspace = this.workspaces.get(reader);
    if (workspace) {
      workspace.destroy();
      this.workspaces.delete(reader);
    }
  }
}

export const CARD_SIZE = {
  width: CARD_DEFAULT_WIDTH,
  height: CARD_DEFAULT_HEIGHT,
};
