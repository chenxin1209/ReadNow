import { MAX_SELECTION_CHARS } from "../constants.js";
import {
  buildSelectionMessages,
  cleanModelText,
  protectMath,
  restoreMath,
  translationCacheKey,
} from "../translation.js";
import { formatError, truncate } from "../util.js";
import { appendTextWithMath } from "../math-render.js";
import { icon } from "./icons.js";

export class SelectionPopup {
  constructor({ app, reader, params, doc, workspace = null, onAsk, onCompare, append }) {
    this.app = app;
    this.reader = reader;
    this.params = params;
    this.doc = doc;
    this.workspace = workspace;
    this.onAsk = onAsk;
    this.onCompare = onCompare;
    this.selection = this.normalizeSelection(params);
    this.element = this.build();
    append(this.element);
    this.run();
  }

  normalizeSelection(params) {
    const annotation = params?.annotation || {};
    const position = annotation.position || {};
    const text = String(annotation.text || "").trim();
    return {
      text,
      pageIndex: Number(position.pageIndex ?? 0) || 0,
      pageLabel: String(annotation.pageLabel || position.pageLabel || ""),
      position,
      rects: position.rects || [],
      color: annotation.color || "#ffd400",
      anchor: params?.rect || null,
    };
  }

  build() {
    const doc = this.doc;
    const root = doc.createElement("div");
    root.className = "dr-selection-popup";

    const head = doc.createElement("div");
    head.className = "dr-selection-head";
    const brand = doc.createElement("span");
    brand.className = "dr-selection-brand";
    brand.appendChild(icon(doc, "logo", 16));
    const brandText = doc.createElement("strong");
    brandText.textContent = "ReadNow";
    brand.appendChild(brandText);
    const hint = doc.createElement("span");
    hint.className = "dr-selection-hint";
    hint.textContent = "划词翻译";
    head.append(brand, hint);
    root.appendChild(head);

    const body = doc.createElement("div");
    body.className = "dr-selection-body";
    body.textContent = "正在准备…";
    root.appendChild(body);

    const actions = doc.createElement("div");
    actions.className = "dr-selection-actions";
    this.askButton = doc.createElement("button");
    this.askButton.type = "button";
    this.askButton.className = "dr-btn dr-btn-primary dr-selection-ask";
    this.askButton.appendChild(icon(doc, "spark", 14));
    const askLabel = doc.createElement("span");
    askLabel.textContent = "AI 提问";
    this.askButton.appendChild(askLabel);
    this.askButton.addEventListener("click", () => {
      if (typeof this.onAsk === "function") this.onAsk(this.selection, this.params?.rect);
      else this.workspace?.ask(this.selection, this.params?.rect);
    });
    this.compareButton = doc.createElement("button");
    this.compareButton.type = "button";
    this.compareButton.className = "dr-btn dr-btn-ghost";
    this.compareButton.textContent = "对照阅读";
    this.compareButton.addEventListener("click", () => {
      if (typeof this.onCompare === "function") {
        this.onCompare(this.selection);
      } else if (this.workspace) {
        this.workspace.open({ mode: "compare" });
        this.workspace.navigateToSelection(this.selection);
      } else {
        this.app.openWorkspace(this.reader, { mode: "compare", selection: this.selection });
      }
    });
    actions.append(this.askButton, this.compareButton);
    root.appendChild(actions);

    this.body = body;
    this.actions = actions;
    return root;
  }

  setBody(text, { error = false } = {}) {
    this.body.replaceChildren();
    if (error) {
      this.body.classList.add("is-error");
      const mark = this.doc.createElement("span");
      mark.className = "dr-selection-error";
      mark.appendChild(icon(this.doc, "alert", 15));
      const message = this.doc.createElement("span");
      message.textContent = text;
      const retry = this.doc.createElement("button");
      retry.type = "button";
      retry.className = "dr-text-btn";
      retry.textContent = "重试";
      retry.addEventListener("click", () => this.translate({ force: true }));
      this.body.append(mark, message, retry);
      return;
    }
    this.body.classList.remove("is-error");
    const textNode = this.doc.createElement("div");
    textNode.className = "dr-selection-translation";
    appendTextWithMath(textNode, text, this.doc);
    this.body.appendChild(textNode);
  }

  setLoading() {
    this.body.replaceChildren();
    const skeleton = this.doc.createElement("div");
    skeleton.className = "dr-selection-skeleton";
    skeleton.append(this.doc.createElement("span"), this.doc.createElement("span"));
    this.body.appendChild(skeleton);
  }

  async run() {
    if (!this.selection.text) {
      this.setBody("没有读取到选中的文字。", { error: true });
      return;
    }
    if (this.selection.text.length < 2) {
      this.setBody("选中文字太短，暂不翻译。");
      return;
    }
    if (!this.app.isConfigured()) {
      this.body.classList.remove("is-error");
      this.body.replaceChildren();
      const message = this.doc.createElement("div");
      message.className = "dr-selection-setup";
      message.textContent = "填入你自己的 API Key 后，这里会自动显示译文。";
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "dr-text-btn";
      button.textContent = "打开设置";
      button.addEventListener("click", () => this.app.openPreferences());
      message.appendChild(button);
      this.body.appendChild(message);
      return;
    }
    if (this.app.getSettings().autoTranslate) {
      await this.translate({ force: false });
    } else {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "dr-btn dr-btn-ghost dr-selection-translate";
      button.textContent = "翻译这段文字";
      button.addEventListener("click", () => this.translate({ force: false }));
      this.body.replaceChildren(button);
    }
  }

  async translate({ force = false } = {}) {
    this.setLoading();
    this.askButton.disabled = true;
    const settings = this.app.getSettings();
    const text = truncate(this.selection.text, MAX_SELECTION_CHARS);
    const key = translationCacheKey({
      text,
      targetLang: settings.targetLang,
      model: settings.translationModel || settings.model,
    });
    try {
      let translated = !force ? this.app.store.getCachedTranslation(key) : "";
      if (!translated) {
        const guarded = protectMath(text);
        const messages = buildSelectionMessages({
          text: guarded.text,
          targetLang: settings.targetLang,
          systemPrompt: settings.translationPrompt,
        });
        translated = cleanModelText(
          restoreMath(await this.app.translate(messages), guarded.formulas),
        );
        if (translated) this.app.store.setCachedTranslation(key, translated);
      }
      this.setBody(translated || "模型没有返回译文，请重试。", { error: !translated });
      if (this.selection.text.length > MAX_SELECTION_CHARS) {
        const note = this.doc.createElement("div");
        note.className = "dr-selection-note";
        note.textContent = `选区较长，仅翻译了前 ${MAX_SELECTION_CHARS} 个字符。`;
        this.body.appendChild(note);
      }
    } catch (error) {
      this.setBody(formatError(error, [settings.apiKey]), { error: true });
    } finally {
      this.askButton.disabled = false;
    }
  }
}
