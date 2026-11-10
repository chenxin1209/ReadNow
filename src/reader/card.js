import { CARD_MIN_HEIGHT, CARD_MIN_WIDTH } from "../constants.js";
import { renderMarkdown } from "../markdown.js";
import { buildQaSystemMessage, questionTitle, selectionExcerpt } from "../translation.js";
import { formatError, formatRelativeTime, throttle, truncate, uniqueId } from "../util.js";
import { icon } from "./icons.js";

function now() {
  return Date.now();
}

function createMessage(role, content = "") {
  return {
    id: uniqueId("msg"),
    role,
    content,
    createdAt: now(),
  };
}

export class QuestionCard {
  constructor({ workspace, data }) {
    this.workspace = workspace;
    this.doc = workspace.doc;
    this.win = this.doc.defaultView;
    this.data = this.normalizeData(data);
    this.abortController = null;
    this.pending = false;
    this.streamingMessage = null;
    this.destroyed = false;
    this.geometry = this.data.geometry || null;
    this.element = this.build();
    this.render();
  }

  normalizeData(data) {
    return {
      id: data.id || uniqueId("card"),
      attachmentKey: data.attachmentKey,
      selection: data.selection || { text: "", pageIndex: 0, pageLabel: "" },
      messages: Array.isArray(data.messages) ? data.messages : [],
      title: data.title || "",
      geometry: data.geometry || null,
      createdAt: data.createdAt || now(),
      updatedAt: data.updatedAt || now(),
      collapsed: Boolean(data.collapsed),
    };
  }

  get pageLabel() {
    return this.data.selection.pageLabel || String((this.data.selection.pageIndex || 0) + 1);
  }

  get anchorRect() {
    return this.workspace.getAnchorRect(this.data.selection);
  }

  build() {
    const doc = this.doc;
    const card = doc.createElement("section");
    card.className = "dr-card";
    card.dataset.cardId = this.data.id;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "ReadNow AI 提问卡片");

    const head = doc.createElement("header");
    head.className = "dr-card-head";

    const grip = doc.createElement("span");
    grip.className = "dr-card-grip";
    grip.title = "拖动卡片";
    grip.appendChild(icon(doc, "drag", 16));
    head.appendChild(grip);

    const heading = doc.createElement("div");
    heading.className = "dr-card-heading";
    const kicker = doc.createElement("span");
    kicker.className = "dr-card-kicker";
    kicker.textContent = `AI 提问 · 第 ${this.pageLabel} 页`;
    const title = doc.createElement("span");
    title.className = "dr-card-title";
    heading.append(kicker, title);
    head.appendChild(heading);

    const tools = doc.createElement("div");
    tools.className = "dr-card-tools";
    this.pinButton = this.toolButton("pin", "定位原文", () => this.locate());
    this.copyButton = this.toolButton("copy", "复制对话", () => this.copyConversation());
    this.deleteButton = this.toolButton("trash", "删除这张卡片", () => this.delete());
    tools.append(this.pinButton, this.copyButton, this.deleteButton);
    head.appendChild(tools);

    const quote = doc.createElement("button");
    quote.type = "button";
    quote.className = "dr-card-quote";
    quote.title = "回到原文选区";
    quote.addEventListener("click", () => this.locate());
    const quoteBar = doc.createElement("span");
    quoteBar.className = "dr-quote-bar";
    const quoteText = doc.createElement("span");
    quoteText.className = "dr-quote-text";
    quoteText.textContent = truncate(this.data.selection.text || "（未记录原文）", 260);
    quote.append(quoteBar, quoteText);

    const messages = doc.createElement("div");
    messages.className = "dr-card-messages";
    messages.setAttribute("aria-live", "polite");

    const suggestions = doc.createElement("div");
    suggestions.className = "dr-card-suggestions";

    const composer = doc.createElement("form");
    composer.className = "dr-card-composer";
    const textarea = doc.createElement("textarea");
    textarea.className = "dr-card-input";
    textarea.placeholder = "基于这段原文继续追问…";
    textarea.rows = 2;
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        this.send();
      }
      if (event.key === "Escape") {
        event.stopPropagation();
      }
    });
    textarea.addEventListener("input", () => this.autosize());
    const composerFooter = doc.createElement("div");
    composerFooter.className = "dr-card-composer-footer";
    const hint = doc.createElement("span");
    hint.className = "dr-card-hint";
    hint.textContent = "⌘/Ctrl + Enter 发送";
    this.stopButton = doc.createElement("button");
    this.stopButton.type = "button";
    this.stopButton.className = "dr-btn dr-btn-ghost dr-stop";
    this.stopButton.textContent = "停止";
    this.stopButton.hidden = true;
    this.stopButton.addEventListener("click", () => this.stop());
    this.sendButton = doc.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "dr-btn dr-btn-primary dr-send";
    this.sendButton.appendChild(icon(doc, "send", 15));
    const sendLabel = doc.createElement("span");
    sendLabel.textContent = "发送";
    this.sendButton.appendChild(sendLabel);
    composerFooter.append(hint, this.stopButton, this.sendButton);
    composer.append(textarea, composerFooter);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send();
    });

    const resize = doc.createElement("div");
    resize.className = "dr-resize-handle";
    resize.title = "拖动调整大小";
    resize.addEventListener("pointerdown", (event) => this.startResize(event));

    card.append(head, quote, messages, suggestions, composer, resize);
    head.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.titleEl = title;
    this.kickerEl = kicker;
    this.messagesEl = messages;
    this.suggestionsEl = suggestions;
    this.textarea = textarea;
    this.form = composer;
    this.quoteTextEl = quoteText;
    return card;
  }

  toolButton(name, title, onClick) {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "dr-icon-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(icon(this.doc, name, 15));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  setGeometry({ x, y, width, height }) {
    const card = this.element;
    if (Number.isFinite(width)) card.style.width = `${Math.max(CARD_MIN_WIDTH, width)}px`;
    if (Number.isFinite(height)) card.style.height = `${Math.max(CARD_MIN_HEIGHT, height)}px`;
    if (Number.isFinite(x)) card.style.left = `${Math.round(x)}px`;
    if (Number.isFinite(y)) card.style.top = `${Math.round(y)}px`;
    this.workspace.updateConnector(this.data.id);
  }

  getRect() {
    const rect = this.element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  setBusy(busy) {
    this.pending = busy;
    this.sendButton.disabled = busy;
    this.stopButton.hidden = !busy;
    this.element.classList.toggle("is-busy", busy);
  }

  autosize() {
    const textarea = this.textarea;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(170, Math.max(52, textarea.scrollHeight))}px`;
  }

  focusComposer() {
    this.win.requestAnimationFrame(() => {
      this.textarea.focus();
      this.autosize();
    });
  }

  locate() {
    this.workspace.navigateToSelection(this.data.selection);
    this.workspace.flashCard(this);
  }

  async copyConversation() {
    const lines = [
      `原文（第 ${this.pageLabel} 页）：`,
      this.data.selection.text || "",
      "",
      ...this.data.messages
        .filter((message) => !message.pending)
        .map((message) => `${message.role === "user" ? "问" : "答"}：${message.content}`),
    ];
    const text = lines.join("\n");
    try {
      Zotero.Utilities.Internal.copyTextToClipboard(text);
      this.workspace.toast("对话已复制");
    } catch {
      this.workspace.toast("复制失败");
    }
  }

  async delete() {
    const confirmed = this.workspace.confirm(
      "删除这张问答卡片？",
      "原文选区不会受影响，但这段对话会从本机 ReadNow 记录中删除。",
    );
    if (!confirmed) return;
    this.element.classList.add("is-removing");
    setTimeout(() => this.destroy(), 160);
    await this.workspace.deleteCard(this);
  }

  startDrag(event) {
    if (event.button !== 0) return;
    if (event.target.closest("button, textarea, a, input, .dr-resize-handle")) return;
    event.preventDefault();
    const startRect = this.getRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      const x = startRect.x + moveEvent.clientX - startX;
      const y = startRect.y + moveEvent.clientY - startY;
      this.setGeometry({ x, y });
      this.element.classList.add("is-dragging");
    };
    const up = () => {
      this.doc.removeEventListener("pointermove", move);
      this.doc.removeEventListener("pointerup", up);
      this.element.classList.remove("is-dragging");
      this.rememberGeometry();
    };
    this.doc.addEventListener("pointermove", move);
    this.doc.addEventListener("pointerup", up, { once: true });
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
  }

  startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startRect = this.getRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      const maxWidth = Math.min(760, this.win.innerWidth - 24);
      const maxHeight = Math.min(this.win.innerHeight - 24, 900);
      const width = Math.max(CARD_MIN_WIDTH, Math.min(maxWidth, startRect.width + moveEvent.clientX - startX));
      const height = Math.max(
        CARD_MIN_HEIGHT,
        Math.min(maxHeight, startRect.height + moveEvent.clientY - startY),
      );
      this.setGeometry({ width, height });
      this.element.classList.add("is-resizing");
    };
    const up = () => {
      this.doc.removeEventListener("pointermove", move);
      this.doc.removeEventListener("pointerup", up);
      this.element.classList.remove("is-resizing");
      this.rememberGeometry();
    };
    this.doc.addEventListener("pointermove", move);
    this.doc.addEventListener("pointerup", up, { once: true });
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
  }

  rememberGeometry() {
    const rect = this.getRect();
    const anchor = this.anchorRect;
    this.data.geometry = {
      dx: anchor ? Math.round(rect.x - anchor.x) : 0,
      dy: anchor ? Math.round(rect.y - anchor.y) : 0,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    this.data.updatedAt = now();
    this.workspace.scheduleSave(this);
  }

  render() {
    if (this.destroyed) return;
    this.titleEl.textContent = this.data.title || "让 AI 解释这段原文";
    this.kickerEl.textContent = `AI 提问 · 第 ${this.pageLabel} 页`;
    this.messagesEl.replaceChildren();
    if (!this.data.messages.length) {
      const welcome = this.doc.createElement("div");
      welcome.className = "dr-card-welcome";
      const mark = this.doc.createElement("span");
      mark.className = "dr-card-welcome-mark";
      mark.appendChild(icon(this.doc, "spark", 17));
      const copy = this.doc.createElement("div");
      const strong = this.doc.createElement("strong");
      strong.textContent = "这段原文想怎么读？";
      const p = this.doc.createElement("p");
      p.textContent = "可以直接输入问题，也可以从下面的快捷问题开始。后续追问会保留在同一张卡片里。";
      copy.append(strong, p);
      welcome.append(mark, copy);
      this.messagesEl.appendChild(welcome);
    }

    for (const message of this.data.messages) {
      this.messagesEl.appendChild(this.renderMessage(message));
    }
    this.renderSuggestions();
    this.scrollToBottom();
  }

  renderMessage(message) {
    const wrap = this.doc.createElement("div");
    wrap.className = `dr-message dr-message-${message.role}`;
    wrap.dataset.messageId = message.id;
    const meta = this.doc.createElement("div");
    meta.className = "dr-message-meta";
    const who = this.doc.createElement("span");
    who.textContent = message.role === "user" ? "你" : "ReadNow";
    const time = this.doc.createElement("span");
    time.textContent = formatRelativeTime(message.createdAt);
    meta.append(who, time);
    const body = this.doc.createElement("div");
    body.className = "dr-message-body";
    if (message.error) {
      body.classList.add("is-error");
      body.textContent = message.content;
      const actions = this.doc.createElement("div");
      actions.className = "dr-message-actions";
      const retry = this.doc.createElement("button");
      retry.type = "button";
      retry.className = "dr-text-btn";
      retry.textContent = "重试";
      retry.addEventListener("click", () => this.retry(message));
      const settings = this.doc.createElement("button");
      settings.type = "button";
      settings.className = "dr-text-btn";
      settings.textContent = "打开设置";
      settings.addEventListener("click", () => this.workspace.openSettings());
      actions.append(retry, settings);
      body.appendChild(actions);
    } else if (message.role === "assistant") {
      if (message.pending || !message.content) {
        const typing = this.doc.createElement("span");
        typing.className = "dr-typing";
        typing.append(this.dot(), this.dot(), this.dot());
        body.appendChild(typing);
      } else {
        renderMarkdown(body, message.content, this.doc, {
          onLink: (url) => Zotero.launchURL(url),
        });
        if (message.stopped) {
          const stopped = this.doc.createElement("span");
          stopped.className = "dr-stopped-tag";
          stopped.textContent = "已停止生成";
          body.appendChild(stopped);
        }
      }
    } else {
      body.textContent = message.content;
    }
    wrap.append(meta, body);
    return wrap;
  }

  dot() {
    const dot = this.doc.createElement("span");
    dot.className = "dr-typing-dot";
    return dot;
  }

  renderSuggestions() {
    this.suggestionsEl.replaceChildren();
    if (this.data.messages.some((message) => message.role === "user")) return;
    const suggestions = [
      "解释这段在论证什么",
      "翻译并解释关键术语",
      "这段用了什么方法？",
      "和上一段有什么联系？",
    ];
    for (const suggestion of suggestions) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "dr-suggestion";
      button.textContent = suggestion;
      button.addEventListener("click", () => {
        this.textarea.value = suggestion;
        this.send();
      });
      this.suggestionsEl.appendChild(button);
    }
  }

  async ensurePageContext() {
    return this.workspace.getPageContextForSelection(this.data.selection);
  }

  async send() {
    if (this.pending) return;
    const question = this.textarea.value.trim();
    if (!question) {
      this.textarea.focus();
      return;
    }
    const userMessage = createMessage("user", question);
    this.data.messages.push(userMessage);
    if (!this.data.title) this.data.title = questionTitle(question);
    this.textarea.value = "";
    this.autosize();
    this.render();
    this.workspace.onCardChanged(this);
    try {
      await this.runTurn(userMessage);
    } catch (error) {
      this.setBusy(false);
      this.workspace.toast(`提问失败：${formatError(error, [this.workspace.app.getSettings().apiKey])}`);
    }
  }

  async runTurn(userMessage) {
    this.setBusy(true);
    const assistant = createMessage("assistant", "");
    assistant.pending = true;
    this.data.messages.push(assistant);
    this.streamingMessage = assistant;
    this.render();
    this.scrollToBottom();

    try {
      this.abortController = this.workspace.app.createAbortController?.() || null;
      const pageText = await this.ensurePageContext();
      const settings = this.workspace.app.getSettings();
      const history = this.data.messages.filter(
        (message) =>
          !message.pending &&
          !message.error &&
          message.id !== assistant.id &&
          message.id !== userMessage.id &&
          message.content &&
          (message.role === "user" || message.role === "assistant"),
      );
      const system = buildQaSystemMessage({
        systemPrompt: settings.systemPrompt,
        paper: this.workspace.paper,
        selection: this.data.selection,
        pageText,
        contextPages: settings.contextPages,
      });
      const messages = [
        system,
        ...history.slice(-14).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user", content: userMessage.content },
      ];

      let accumulated = "";
      const answer = await this.workspace.app.chat(messages, {
        signal: this.abortController?.signal,
        onDelta: (delta) => {
          accumulated += delta;
          assistant.content = accumulated;
          assistant.pending = false;
          this.updateStreamingMessage(assistant);
        },
      });
      assistant.pending = false;
      const finalText = (answer || accumulated || "").trim();
      assistant.content = finalText || "模型没有返回内容，请重试。";
      assistant.error = !finalText;
      assistant.createdAt = now();
      this.workspace.onCardChanged(this);
    } catch (error) {
      if (error?.message === "请求已取消" || error?.name === "AbortError") {
        assistant.pending = false;
        assistant.stopped = true;
        assistant.content = assistant.content || "（已停止）";
      } else {
        assistant.pending = false;
        assistant.error = true;
        assistant.content = formatError(error, [this.workspace.app.getSettings().apiKey]);
      }
    } finally {
      this.abortController = null;
      this.streamingMessage = null;
      this.setBusy(false);
      this.render();
      this.workspace.onCardChanged(this);
    }
  }

  updateStreamingMessage(message) {
    const node = this.messagesEl.querySelector(`[data-message-id="${message.id}"] .dr-message-body`);
    if (!node) {
      this.render();
      return;
    }
    const el = this.messagesEl;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    renderMarkdown(node, message.content, this.doc, {
      onLink: (url) => Zotero.launchURL(url),
    });
    if (nearBottom) this.scrollToBottom();
  }

  retry(failedMessage) {
    if (this.pending) return;
    const index = this.data.messages.findIndex((message) => message.id === failedMessage.id);
    if (index === -1) return;
    this.data.messages.splice(index);
    const lastUser = [...this.data.messages].reverse().find((message) => message.role === "user");
    this.render();
    this.workspace.onCardChanged(this);
    if (lastUser) this.runTurn(lastUser);
  }

  stop() {
    if (this.abortController) this.abortController.abort();
  }

  scrollToBottom() {
    this.win.requestAnimationFrame(() => {
      const el = this.messagesEl;
      el.scrollTop = el.scrollHeight;
    });
  }

  serialize() {
    return {
      ...this.data,
      messages: this.data.messages
        .filter((message) => !(message.pending && !message.content))
        .map((message) => ({
          ...message,
          pending: false,
        })),
      updatedAt: now(),
    };
  }

  destroy() {
    this.destroyed = true;
    if (this.abortController) this.abortController.abort();
    this.element.remove();
    this.workspace.removeConnector(this.data.id);
  }
}
