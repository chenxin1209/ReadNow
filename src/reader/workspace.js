import {
  CARD_DEFAULT_HEIGHT,
  CARD_DEFAULT_WIDTH,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
} from "../constants.js";
import {
  clampRect,
  findBestCardPosition,
  intersectionArea,
  mapPdfRectToScreen,
  normalizeRect,
  unionRects,
} from "../layout.js";
import { buildTranslatedPdf } from "../pdf-export.js";
import {
  buildPageMessages,
  chunkText,
  cleanModelText,
  pageTranslationCacheKey,
  protectMath,
  restoreMath,
  selectionExcerpt,
} from "../translation.js";
import { renderTranslatedDocument } from "../translation-format.js";
import {
  formatError,
  hashString,
  sleep,
  throttle,
  truncate,
  uniqueId,
} from "../util.js";
import { QuestionCard } from "./card.js";
import { brandMark, icon } from "./icons.js";
import {
  capturePageRegion,
  extractPageText,
  getAttachmentKey,
  getCurrentPageIndex,
  getCurrentPageLabel,
  getPageCount,
  getPageFigures,
  getPageLabel,
  getPageScreenRect,
  getPageViewport,
  getPaperInfo,
  getReaderArea,
  getVisibleTextRects,
} from "./pdf-access.js";

const MODES = ["original", "compare", "translate"];

function sanitizeFileName(name) {
  return String(name || "paper")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "paper";
}

function figureCaptionId(text) {
  const match = String(text || "").match(
    /(?:fig(?:ure)?\.?|图)\s*(s?\d+[a-z]?|[ivxlcdm]+|[一二三四五六七八九十百]+)/i,
  );
  return match?.[1]?.toLowerCase() || "";
}

export class ReaderWorkspace {
  constructor({ app, reader }) {
    this.app = app;
    this.reader = reader;
    this.doc = reader?._iframeWindow?.document || app.getMainWindow()?.document;
    if (!this.doc) throw new Error("无法获取阅读器界面");
    this.win = this.doc.defaultView;
    this.attachmentKey = getAttachmentKey(reader);
    this.paper = getPaperInfo(reader);
    this.mode = "compare";
    this.opened = false;
    this.destroyed = false;
    this.cards = new Map();
    this.cardOrder = [];
    this.pageTextCache = new Map();
    this.translationState = new Map();
    this.currentPage = 0;
    this.pageCount = 0;
    this.translatingAll = false;
    this.translateAllAbort = false;
    this.tickTimer = null;
    this.autoTranslateTimer = null;
    this.historyOpen = false;
    this.paperInfoOpen = false;
    this.paperInfoPanel = null;
    this.toastTimer = null;
    this.connectorFrame = null;
    this.root = null;
    this.dock = null;
    this.historyPanel = null;
    this.positionSaveTimer = null;
    this.buildUi();
  }

  get settings() {
    return this.app.getSettings();
  }

  buildUi() {
    const doc = this.doc;
    const existing = doc.getElementById("deepread-root");
    if (existing) existing.remove();

    const root = doc.createElement("div");
    root.id = "deepread-root";
    root.className = "dr-root";
    root.dataset.mode = this.mode;
    root.hidden = true;

    const links = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    links.classList.add("dr-connectors");
    links.setAttribute("aria-hidden", "true");
    this.connectors = links;

    const pins = doc.createElement("div");
    pins.className = "dr-pins-layer";
    pins.setAttribute("aria-hidden", "true");

    const cards = doc.createElement("div");
    cards.className = "dr-cards-layer";
    cards.setAttribute("aria-label", "ReadNow 问答卡片");

    const rail = doc.createElement("button");
    rail.type = "button";
    rail.className = "dr-rail";
    rail.title = "打开 ReadNow 对照阅读";
    rail.appendChild(icon(doc, "panel", 16));
    const railLabel = doc.createElement("span");
    railLabel.textContent = "对照";
    rail.appendChild(railLabel);
    rail.addEventListener("click", () => this.setMode("compare"));

    const dock = this.buildDock();
    root.append(links, pins, cards, rail, dock);
    doc.body.appendChild(root);

    this.root = root;
    this.dock = dock;
    this.rail = rail;
    this.pinsLayer = pins;
    this.cardsLayer = cards;
    this.doc.addEventListener("scroll", this.handleViewportChange, true);
    this.win.addEventListener("resize", this.handleViewportChange);
    this.doc.addEventListener("keydown", this.handleKeyDown, true);
    this.attachInnerScrollWatcher();
  }

  attachInnerScrollWatcher() {
    try {
      const view = this.reader?._internalReader?._primaryView;
      const innerWin = view?._iframeWindow;
      const innerDoc = innerWin?.document;
      if (!innerDoc) return;
      innerDoc.addEventListener("scroll", this.handleViewportChange, true);
      innerWin.addEventListener("resize", this.handleViewportChange);
      this.innerDoc = innerDoc;
      this.innerWin = innerWin;
    } catch {
      // The inner PDF iframe may not be ready yet; polling still updates pins.
    }
  }

  buildDock() {
    const doc = this.doc;
    const dock = doc.createElement("aside");
    dock.className = "dr-dock";
    dock.setAttribute("aria-label", "ReadNow 阅读工作台");

    const head = doc.createElement("header");
    head.className = "dr-dock-head";
    const brand = doc.createElement("div");
    brand.className = "dr-brand";
    brand.append(brandMark(doc, 26));
    const brandText = doc.createElement("div");
    brandText.className = "dr-brand-text";
    const name = doc.createElement("strong");
    name.textContent = "ReadNow";
    const sub = doc.createElement("span");
    sub.textContent = "论文精读";
    brandText.append(name, sub);
    brand.appendChild(brandText);
    head.appendChild(brand);

    const actions = doc.createElement("div");
    actions.className = "dr-dock-actions";
    this.paperInfoButton = this.dockIconButton("info", "论文信息", () => this.togglePaperInfo());
    this.historyButton = this.dockIconButton("history", "问答记录", () => this.toggleHistory());
    this.settingsButton = this.dockIconButton("settings", "设置 API 与偏好", () => this.openSettings());
    this.closeButton = this.dockIconButton("close", "关闭工作台", () => this.close());
    actions.append(
      this.paperInfoButton,
      this.historyButton,
      this.settingsButton,
      this.closeButton,
    );
    head.appendChild(actions);

    const modeSwitch = doc.createElement("div");
    modeSwitch.className = "dr-mode-switch";
    modeSwitch.setAttribute("role", "tablist");
    this.modeButtons = new Map();
    for (const [mode, label] of [
      ["original", "原文"],
      ["compare", "对照"],
      ["translate", "译文"],
    ]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "dr-mode-button";
      button.textContent = label;
      button.dataset.mode = mode;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => this.setMode(mode));
      this.modeButtons.set(mode, button);
      modeSwitch.appendChild(button);
    }

    const toolbar = doc.createElement("div");
    toolbar.className = "dr-dock-toolbar";
    const pageNav = doc.createElement("div");
    pageNav.className = "dr-page-nav";
    this.prevButton = this.smallIconButton("chevronLeft", "上一页", () => this.goToPage(this.currentPage - 1));
    this.nextButton = this.smallIconButton("chevronRight", "下一页", () => this.goToPage(this.currentPage + 1));
    this.pageLabelEl = doc.createElement("span");
    this.pageLabelEl.className = "dr-page-label";
    this.pageLabelEl.textContent = "第 1 页";
    pageNav.append(this.prevButton, this.pageLabelEl, this.nextButton);

    const jobButtons = doc.createElement("div");
    jobButtons.className = "dr-job-buttons";
    this.translatePageButton = doc.createElement("button");
    this.translatePageButton.type = "button";
    this.translatePageButton.className = "dr-mini-btn";
    this.translatePageButton.textContent = "翻译本页";
    this.translatePageButton.addEventListener("click", () => this.translateCurrentPage({ force: true }));
    this.translateAllButton = doc.createElement("button");
    this.translateAllButton.type = "button";
    this.translateAllButton.className = "dr-mini-btn dr-mini-btn-accent";
    this.translateAllButton.textContent = "翻译全文（导出）";
    this.translateAllButton.title = "预翻译全文，仅用于导出 PDF；视图始终只显示当前页";
    this.translateAllButton.addEventListener("click", () => this.translateAll());
    jobButtons.append(this.translatePageButton, this.translateAllButton);
    toolbar.append(pageNav, jobButtons);

    const progress = doc.createElement("div");
    progress.className = "dr-progress";
    progress.hidden = true;
    const track = doc.createElement("div");
    track.className = "dr-progress-track";
    this.progressBar = doc.createElement("div");
    this.progressBar.className = "dr-progress-bar";
    track.appendChild(this.progressBar);
    this.progressText = doc.createElement("span");
    this.progressText.className = "dr-progress-text";
    this.progressStop = doc.createElement("button");
    this.progressStop.type = "button";
    this.progressStop.className = "dr-text-btn";
    this.progressStop.textContent = "停止";
    this.progressStop.hidden = true;
    this.progressStop.addEventListener("click", () => {
      this.translateAllAbort = true;
      this.progressStop.hidden = true;
      this.progressText.textContent = "正在停止…";
    });
    progress.append(track, this.progressText, this.progressStop);

    const body = doc.createElement("main");
    body.className = "dr-dock-body";

    const footer = doc.createElement("footer");
    footer.className = "dr-dock-foot";
    this.exportButton = doc.createElement("button");
    this.exportButton.type = "button";
    this.exportButton.className = "dr-export-btn";
    this.exportButton.appendChild(icon(doc, "download", 15));
    const exportLabel = doc.createElement("span");
    exportLabel.textContent = "导出译文 PDF";
    this.exportButton.appendChild(exportLabel);
    this.exportButton.disabled = true;
    this.exportButton.addEventListener("click", () => this.exportPdf());
    this.footerInfo = doc.createElement("span");
    this.footerInfo.className = "dr-footer-info";
    this.footerInfo.textContent = "译文与对话仅保存在本机";
    footer.append(this.exportButton, this.footerInfo);

    dock.append(head, modeSwitch, toolbar, progress, body, footer);

    this.progressEl = progress;
    this.bodyEl = body;
    return dock;
  }

  dockIconButton(name, title, handler) {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "dr-icon-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(icon(this.doc, name, 16));
    button.addEventListener("click", handler);
    return button;
  }

  smallIconButton(name, title, handler) {
    const button = this.dockIconButton(name, title, handler);
    button.classList.add("dr-small-icon-btn");
    return button;
  }

  async open({ mode = "compare" } = {}) {
    if (this.destroyed) return;
    if (!this.opened) {
      this.opened = true;
      this.root.hidden = false;
      this.doc.documentElement.classList.add("deepread-open");
      this.startTicking();
      await this.restoreCards();
    }
    this.setMode(mode);
    this.footerInfo.textContent = "译文与对话仅保存在本机";
    this.refreshAll();
  }

  close() {
    if (!this.opened || this.destroyed) return;
    this.opened = false;
    this.translateAllAbort = true;
    if (this.autoTranslateTimer) {
      clearTimeout(this.autoTranslateTimer);
      this.autoTranslateTimer = null;
    }
    this.stopTicking();
    this.destroyCards();
    this.root.hidden = true;
    this.doc.documentElement.classList.remove(
      "deepread-open",
      "deepread-mode-original",
      "deepread-mode-compare",
      "deepread-mode-translate",
    );
    this.closeHistory();
    this.closePaperInfo();
    this.dispatchResize();
  }

  destroy() {
    if (this.destroyed) return;
    this.close();
    this.destroyed = true;
    this.doc.removeEventListener("scroll", this.handleViewportChange, true);
    this.win.removeEventListener("resize", this.handleViewportChange);
    this.doc.removeEventListener("keydown", this.handleKeyDown, true);
    try {
      this.innerDoc?.removeEventListener("scroll", this.handleViewportChange, true);
      this.innerWin?.removeEventListener("resize", this.handleViewportChange);
    } catch {
      // Ignore detached inner windows.
    }
    if (this.root) this.root.remove();
  }

  startTicking() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.onTick(), 520);
  }

  stopTicking() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  onTick() {
    if (this.destroyed) return;
    if (this.reader?._isTabClosed) {
      this.destroy();
      return;
    }
    this.syncCurrentPage();
    this.updateConnectorsThrottled();
  }

  handleViewportChange = throttle(() => {
    if (!this.opened) return;
    this.repositionAll();
    this.updateConnectorsThrottled();
  }, 90);

  handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (this.historyOpen) this.closeHistory();
    if (this.paperInfoOpen) this.closePaperInfo();
  };

  dispatchResize() {
    try {
      this.win.dispatchEvent(new this.win.Event("resize"));
    } catch {
      // Ignore.
    }
  }

  setMode(mode) {
    if (!MODES.includes(mode)) mode = "compare";
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.doc.documentElement.classList.toggle("deepread-mode-original", mode === "original");
    this.doc.documentElement.classList.toggle("deepread-mode-compare", mode === "compare");
    this.doc.documentElement.classList.toggle("deepread-mode-translate", mode === "translate");
    for (const [id, button] of this.modeButtons) {
      button.classList.toggle("is-active", id === mode);
      button.setAttribute("aria-selected", id === mode ? "true" : "false");
    }
    this.dispatchResize();
    if (mode === "compare" || mode === "translate") {
      this.syncCurrentPage({ forceRender: true });
      this.maybeAutoTranslatePage();
    }
    this.win.requestAnimationFrame(() => {
      this.dispatchResize();
      this.win.requestAnimationFrame(() => this.repositionAll());
    });
  }

  syncCurrentPage({ forceRender = false } = {}) {
    const page = getCurrentPageIndex(this.reader);
    const count = getPageCount(this.reader) || this.pageCount;
    const label = getCurrentPageLabel(this.reader);
    const changed = page !== this.currentPage || count !== this.pageCount;
    this.currentPage = page;
    this.pageCount = count || this.pageCount;
    this.pageLabelEl.textContent = `第 ${label || page + 1} 页${count ? ` / ${count}` : ""}`;
    this.prevButton.disabled = page <= 0;
    this.nextButton.disabled = count > 0 && page >= count - 1;
    if (changed || forceRender) {
      this.renderTranslation();
      this.updateConnectors();
    }
    if (changed && (this.mode === "compare" || this.mode === "translate")) {
      this.maybeAutoTranslatePage();
    }
  }

  goToPage(pageIndex) {
    if (pageIndex < 0) return;
    if (this.pageCount && pageIndex >= this.pageCount) return;
    try {
      this.reader.navigate({ pageIndex });
    } catch (error) {
      this.toast(formatError(error));
      return;
    }
    // Switch the translation pane immediately instead of waiting for the
    // reader's scroll state to settle; re-sync once navigation completes.
    this.currentPage = pageIndex;
    this.pageLabelEl.textContent = `第 ${getPageLabel(this.reader, pageIndex)} 页${
      this.pageCount ? ` / ${this.pageCount}` : ""
    }`;
    this.renderTranslation();
    this.maybeAutoTranslatePage();
    setTimeout(() => this.syncCurrentPage({ forceRender: true }), 260);
  }

  maybeAutoTranslatePage() {
    // The full-width translated view is a reading view, so it always fetches
    // the current page. Compare mode still respects the user's preference.
    if (!this.settings.autoTranslatePage && this.mode !== "translate") return;
    if (!this.app.isConfigured()) {
      this.renderTranslation();
      return;
    }
    const page = this.currentPage;
    const state = this.translationState.get(page);
    if (state?.status === "done" || state?.status === "loading") return;
    if (this.autoTranslateTimer) clearTimeout(this.autoTranslateTimer);
    this.autoTranslateTimer = setTimeout(() => {
      this.autoTranslateTimer = null;
      if (this.currentPage === page) this.translateCurrentPage({ auto: true });
    }, 480);
  }

  async translateCurrentPage({ force = false, auto = false } = {}) {
    if (this.destroyed) return;
    this.translateAllAbort = false;
    const page = this.currentPage;
    const existing = this.translationState.get(page);
    if (existing?.status === "loading") return;
    if (existing?.status === "done" && !force) return;
    try {
      this.translationState.set(page, { ...(existing || {}), status: "loading", error: "" });
      this.renderTranslation();
      await this.ensurePageTranslation(page, { force, auto });
    } catch (error) {
      const message = formatError(error, [this.settings.apiKey]);
      this.translationState.set(page, { ...(this.translationState.get(page) || {}), status: "error", error: message });
      this.renderTranslation();
      if (!auto) this.toast(message);
    }
  }

  async ensurePageTranslation(pageIndex, { force = false, auto = false, signal } = {}) {
    const existing = this.translationState.get(pageIndex);
    if (existing?.status === "done" && !force) return existing;
    if (!this.app.isConfigured()) {
      throw new Error("请先在设置中配置 API Key");
    }
    const extracted = await this.getPageText(pageIndex);
    if (!extracted.text) {
      const state = { status: "empty", pageLabel: extracted.pageLabel, text: "", source: "" };
      this.translationState.set(pageIndex, state);
      this.renderTranslation();
      return state;
    }

    const settings = this.settings;
    const key = pageTranslationCacheKey({
      attachmentKey: this.attachmentKey,
      pageIndex,
      textHash: hashString(extracted.text),
      targetLang: settings.targetLang,
      model: settings.translationModel || settings.model,
    });
    if (!force) {
      const cached = this.app.store.getPageTranslation(key);
      if (cached) {
        const state = {
          status: "done",
          text: cached,
          source: extracted.text,
          pageLabel: extracted.pageLabel,
          cached: true,
        };
        this.translationState.set(pageIndex, state);
        this.renderTranslation();
        return state;
      }
    }

    const guardedPage = protectMath(extracted.text);
    const chunks = chunkText(guardedPage.text, 5600);
    const outputs = [];
    const total = chunks.length;
    for (let index = 0; index < chunks.length; index += 1) {
      if (signal?.aborted || this.translateAllAbort) throw new Error("请求已取消");
      if (total > 1) this.showProgress(index / total, `正在翻译第 ${pageIndex + 1} 页（${index + 1}/${total} 段）`, false);
      const messages = buildPageMessages({
        pageText: chunks[index],
        pageIndex,
        pageLabel: extracted.pageLabel,
        totalPages: this.pageCount,
        targetLang: settings.targetLang,
        systemPrompt: settings.translationPrompt,
        paper: this.paper,
        previousText: index > 0 ? chunks[index - 1].slice(-1200) : "",
        nextText: index < chunks.length - 1 ? chunks[index + 1].slice(0, 1200) : "",
      });
      const translated = await this.app.translate(messages, { signal });
      outputs.push(cleanModelText(restoreMath(translated, guardedPage.formulas)));
    }

    const finalText = outputs.filter(Boolean).join("\n\n").trim();
    const state = {
      status: finalText ? "done" : "error",
      text: finalText,
      source: extracted.text,
      pageLabel: extracted.pageLabel,
      error: finalText ? "" : "模型没有返回译文",
      translatedAt: Date.now(),
    };
    this.translationState.set(pageIndex, state);
    if (finalText) {
      this.app.store.setPageTranslation(key, finalText, {
        pageIndex,
        pageLabel: extracted.pageLabel,
        model: settings.translationModel || settings.model,
        lang: settings.targetLang,
      });
    }
    this.hideProgress();
    this.renderTranslation();
    this.updateExportButton();
    return state;
  }

  async getPageText(pageIndex, { refresh = false } = {}) {
    if (!refresh && this.pageTextCache.has(pageIndex)) return this.pageTextCache.get(pageIndex);
    const extracted = await extractPageText(this.reader, pageIndex);
    this.pageTextCache.set(pageIndex, extracted);
    if (this.pageTextCache.size > 24) {
      const first = this.pageTextCache.keys().next().value;
      this.pageTextCache.delete(first);
    }
    return extracted;
  }

  async getPageContextForSelection(selection) {
    const settings = this.settings;
    const contextPages = Math.max(0, Number(settings.contextPages) || 0);
    const center = Math.max(0, Number(selection.pageIndex) || 0);
    const start = Math.max(0, center - contextPages);
    const end = this.pageCount ? Math.min(this.pageCount - 1, center + contextPages) : center + contextPages;
    const parts = [];
    for (let page = start; page <= end; page += 1) {
      try {
        const extracted = await this.getPageText(page);
        if (extracted.text) {
          parts.push(`【第 ${extracted.pageLabel || page + 1} 页】\n${extracted.text}`);
        }
      } catch {
        // Skip pages that fail to extract.
      }
    }
    return parts.join("\n\n");
  }

  async translateAll() {
    if (this.translatingAll) return;
    if (!this.app.isConfigured()) {
      this.openSettings();
      return;
    }
    const count = getPageCount(this.reader);
    if (!count) {
      this.toast("PDF 还没有准备好，请稍后再试");
      return;
    }
    this.translatingAll = true;
    this.translateAllAbort = false;
    this.translateAllButton.disabled = true;
    this.translateAllButton.textContent = "翻译中…";
    this.progressStop.hidden = false;
    try {
      for (let page = 0; page < count; page += 1) {
        if (this.translateAllAbort) break;
        const state = this.translationState.get(page);
        if (state?.status === "done") {
          this.showProgress((page + 1) / count, `已完成 ${page + 1} / ${count} 页`, true);
          continue;
        }
        this.showProgress(page / count, `正在翻译第 ${page + 1} / ${count} 页`, true);
        try {
          await this.ensurePageTranslation(page, { signal: null });
        } catch (error) {
          if (this.translateAllAbort || error?.message === "请求已取消") break;
          this.translationState.set(page, {
            status: "error",
            error: formatError(error, [this.settings.apiKey]),
            pageLabel: getPageLabel(this.reader, page),
          });
        }
        this.showProgress((page + 1) / count, `已完成 ${page + 1} / ${count} 页`, true);
      }
      if (this.translateAllAbort) this.toast("已停止全文翻译");
      else this.toast("全文翻译完成");
    } finally {
      this.translatingAll = false;
      this.translateAllButton.disabled = false;
      this.translateAllButton.textContent = "翻译全文（导出）";
      this.progressStop.hidden = true;
      this.hideProgress();
      this.renderTranslation();
      this.updateExportButton();
    }
  }

  showProgress(ratio, text, stoppable = false) {
    this.progressEl.hidden = false;
    this.progressBar.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
    this.progressText.textContent = text;
    this.progressStop.hidden = !stoppable;
  }

  hideProgress() {
    this.progressEl.hidden = true;
    this.progressStop.hidden = true;
  }

  renderTranslation() {
    if (!this.bodyEl) return;
    const body = this.bodyEl;
    body.replaceChildren();

    if (!this.app.isConfigured()) {
      body.appendChild(this.buildSetupState());
      return;
    }

    const page = this.currentPage;
    const state = this.translationState.get(page);
    const header = this.doc.createElement("div");
    header.className = "dr-translation-head";
    const title = this.doc.createElement("div");
    title.className = "dr-translation-title";
    const label = getPageLabel(this.reader, page);
    title.textContent = `第 ${label} 页 · 译文`;
    const actions = this.doc.createElement("div");
    actions.className = "dr-translation-actions";
    const retranslate = this.doc.createElement("button");
    retranslate.type = "button";
    retranslate.className = "dr-text-btn";
    retranslate.textContent = state?.status === "done" ? "重新翻译" : "翻译本页";
    retranslate.addEventListener("click", () => this.translateCurrentPage({ force: true }));
    actions.appendChild(retranslate);
    header.append(title, actions);
    body.appendChild(header);

    if (!state || state.status === "idle") {
      body.appendChild(
        this.buildEmptyState({
          iconName: "translate",
          title: "本页还没有译文",
          text: "点击“翻译本页”生成译文；也可以在设置中开启自动翻译当前页。",
          actionLabel: "翻译本页",
          onAction: () => this.translateCurrentPage({ force: true }),
        }),
      );
    } else if (state.status === "loading") {
      body.appendChild(this.buildSkeleton());
    } else if (state.status === "error") {
      body.appendChild(
        this.buildEmptyState({
          iconName: "alert",
          title: "这一页翻译失败",
          text: state.error || "请检查网络或 API 设置后重试。",
          actionLabel: "重试",
          onAction: () => this.translateCurrentPage({ force: true }),
        }),
      );
    } else if (state.status === "empty") {
      body.appendChild(
        this.buildEmptyState({
          iconName: "alert",
          title: "这一页没有可提取的文本",
          text: "它可能是扫描版或图片型 PDF，需要 OCR 后才能翻译。原文阅读和 AI 问答仍然可用。",
        }),
      );
    } else {
      const article = this.doc.createElement("article");
      article.className = "dr-translation-article";
      this.appendParagraphs(article, state.text, page);
      body.appendChild(article);
      this.appendPageFigures(article, page);
      body.appendChild(this.buildSourceDetails(state.source));
    }

    const tip = this.doc.createElement("div");
    tip.className = "dr-translation-tip";
    tip.textContent = "机器翻译可能有误差，公式、表格与引用请对照原文核对。";
    body.appendChild(tip);
  }

  appendParagraphs(container, text, pageIndex = 0) {
    return renderTranslatedDocument(container, text, this.doc, {
      frontMatter: pageIndex === 0,
    });
  }

  async appendPageFigures(article, pageIndex) {
    try {
      const pageFigures = await getPageFigures(this.reader, pageIndex);
      if (!pageFigures.length || this.currentPage !== pageIndex || !article.isConnected) return;
      const translatedCaptions = Array.from(article.querySelectorAll(".dr-doc-caption")).filter(
        (node) => node.querySelector(".dr-doc-caption-tag")?.textContent === "图注",
      );
      const unusedCaptions = new Set(translatedCaptions);
      const figures = [];
      for (const pageFigure of pageFigures.slice(0, 6)) {
        const dataUrl = await capturePageRegion(
          this.reader,
          pageIndex,
          pageFigure.rect,
          this.doc,
        );
        if (this.currentPage !== pageIndex || !article.isConnected) return;
        if (!dataUrl) continue;
        const figure = this.doc.createElement("figure");
        figure.className = "dr-page-figure";
        const image = this.doc.createElement("img");
        image.src = dataUrl;
        image.alt = pageFigure.caption || "论文页面中的插图";
        image.loading = "lazy";
        const caption = this.doc.createElement("figcaption");
        caption.className = "dr-page-figure-caption";
        const sourceId = figureCaptionId(pageFigure.caption);
        let translatedCaption = translatedCaptions.find(
          (node) => unusedCaptions.has(node) && sourceId && figureCaptionId(node.textContent) === sourceId,
        );
        if (!translatedCaption) {
          translatedCaption = translatedCaptions.find((node) => unusedCaptions.has(node));
        }
        if (translatedCaption) {
          unusedCaptions.delete(translatedCaption);
          translatedCaption.before(figure);
          caption.appendChild(translatedCaption);
        } else {
          caption.textContent = pageFigure.caption || `本页图片 ${figures.length + 1} · 原文截图`;
        }
        figure.append(image, caption);
        figures.push(figure);
      }
      const unmatched = figures.filter((figure) => !figure.isConnected);
      if (unmatched.length && this.currentPage === pageIndex && article.isConnected) {
        article.prepend(...unmatched);
      }
    } catch {
      // Figure capture is best-effort; text translation still works.
    }
  }

  buildSourceDetails(source) {
    const details = this.doc.createElement("details");
    details.className = "dr-source-details";
    const summary = this.doc.createElement("summary");
    summary.textContent = "查看这一页的原文";
    details.appendChild(summary);
    const pre = this.doc.createElement("pre");
    pre.textContent = source || "";
    details.appendChild(pre);
    return details;
  }

  buildSkeleton(paragraphs = 4) {
    const wrap = this.doc.createElement("div");
    wrap.className = "dr-skeleton";
    for (let index = 0; index < paragraphs; index += 1) {
      const line = this.doc.createElement("span");
      line.style.width = `${88 - index * 7}%`;
      wrap.appendChild(line);
    }
    return wrap;
  }

  buildEmptyState({ iconName, title, text, actionLabel, onAction }) {
    const doc = this.doc;
    const wrap = doc.createElement("div");
    wrap.className = "dr-empty-state";
    const mark = doc.createElement("span");
    mark.className = "dr-empty-icon";
    mark.appendChild(icon(doc, iconName || "spark", 20));
    const heading = doc.createElement("strong");
    heading.textContent = title || "";
    const description = doc.createElement("p");
    description.textContent = text || "";
    wrap.append(mark, heading, description);
    if (actionLabel && onAction) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "dr-btn dr-btn-primary";
      button.textContent = actionLabel;
      button.addEventListener("click", onAction);
      wrap.appendChild(button);
    }
    return wrap;
  }

  buildSetupState() {
    const wrap = this.doc.createElement("div");
    wrap.className = "dr-setup-state";
    const mark = this.doc.createElement("span");
    mark.className = "dr-setup-mark";
    mark.appendChild(icon(this.doc, "key", 22));
    const title = this.doc.createElement("strong");
    title.textContent = "先接入你的模型 API";
    const text = this.doc.createElement("p");
    text.textContent =
      "ReadNow 不内置任何账号或密钥。填入你自己的 OpenAI / DeepSeek / Claude / Gemini 兼容 API，即可翻译和提问。";
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "dr-btn dr-btn-primary";
    button.textContent = "打开设置";
    button.addEventListener("click", () => this.openSettings());
    const note = this.doc.createElement("span");
    note.className = "dr-setup-note";
    note.textContent = "密钥仅保存在本机 Zotero 配置中，不会上传到 ReadNow。";
    wrap.append(mark, title, text, button, note);
    return wrap;
  }

  updateExportButton() {
    const done = [...this.translationState.values()].filter((state) => state.status === "done").length;
    this.exportButton.disabled = done === 0;
    this.exportButton.title = done ? `导出 ${done} 页译文` : "先翻译至少一页";
    this.footerInfo.textContent = done ? `${done} 页译文已缓存` : "译文与对话仅保存在本机";
  }

  async restoreCards() {
    if (!this.settings.autoRestore) return;
    const cards = this.app.store.getCards(this.attachmentKey);
    if (!cards.length) {
      this.refreshHistory();
      return;
    }
    for (const data of cards) {
      if (this.cards.has(data.id)) continue;
      const card = new QuestionCard({ workspace: this, data });
      this.cards.set(card.data.id, card);
      this.cardOrder.push(card.data.id);
      this.cardsLayer.appendChild(card.element);
      this.positionCard(card, { initial: true });
    }
    this.refreshHistory();
    this.updateConnectors();
    this.footerInfo.textContent = `已恢复 ${cards.length} 张问答卡片`;
  }

  async ask(selection, anchorRect = null) {
    if (this.destroyed) return null;
    if (!this.opened) await this.open({ mode: "compare" });
    else if (this.mode === "translate") this.setMode("compare");
    const data = {
      id: uniqueId("card"),
      attachmentKey: this.attachmentKey,
      selection: this.normalizeSelection(selection),
      messages: [],
      title: "",
      geometry: null,
      createdAt: Date.now(),
    };
    if (anchorRect) data.selection.anchor = anchorRect;
    const card = new QuestionCard({ workspace: this, data });
    this.cards.set(card.data.id, card);
    this.cardOrder.push(card.data.id);
    this.cardsLayer.appendChild(card.element);
    this.positionCard(card, { initial: true, forcedAnchor: anchorRect });
    card.element.classList.add("is-entering");
    setTimeout(() => card.element.classList.remove("is-entering"), 220);
    this.refreshHistory();
    this.updateConnectors();
    this.onCardChanged(card);
    card.focusComposer();
    return card;
  }

  normalizeSelection(selection) {
    const position = selection?.position || {};
    const pageIndex = Number(selection?.pageIndex ?? position.pageIndex ?? 0) || 0;
    return {
      text: String(selection?.text || "").trim(),
      pageIndex,
      pageLabel: String(selection?.pageLabel || position.pageLabel || pageIndex + 1),
      position: position.rects ? position : selection?.position || null,
      rects: position.rects || selection?.rects || [],
      color: selection?.color || "#ffd400",
      anchor: selection?.anchor || null,
    };
  }

  getSelectionScreenRects(selection) {
    if (!selection) return [];
    const rects = selection.rects || selection.position?.rects || [];
    const pageRect = getPageScreenRect(this.reader, selection.pageIndex);
    const viewport = getPageViewport(this.reader, selection.pageIndex);
    if (!pageRect || !viewport || !rects.length) return [];
    return rects
      .map((rect) => mapPdfRectToScreen(rect, pageRect, viewport))
      .filter(Boolean);
  }

  getAnchorRect(selection) {
    const rects = this.getSelectionScreenRects(selection);
    if (rects.length) return unionRects(rects);
    if (selection?.anchor) return normalizeRect(selection.anchor);
    return null;
  }

  getReaderViewport() {
    return getReaderArea(this.reader) || {
      x: 0,
      y: 0,
      width: this.win.innerWidth,
      height: this.win.innerHeight,
    };
  }

  positionCard(card, { initial = false, forcedAnchor = null } = {}) {
    if (!this.opened || this.mode === "translate") return;
    const viewport = this.getReaderViewport();
    const anchor = forcedAnchor
      ? normalizeRect(forcedAnchor)
      : this.getAnchorRect(card.data.selection);
    const geometry = card.data.geometry || {};
    const width = Math.max(CARD_MIN_WIDTH, geometry.width || CARD_DEFAULT_WIDTH);
    const height = Math.max(CARD_MIN_HEIGHT, geometry.height || CARD_DEFAULT_HEIGHT);

    if (anchor) {
      if (Number.isFinite(geometry.dx) && Number.isFinite(geometry.dy)) {
        const rect = clampRect(
          {
            x: anchor.x + geometry.dx,
            y: anchor.y + geometry.dy,
            width,
            height,
          },
          { x: viewport.x + 8, y: viewport.y + 8, width: viewport.width - 16, height: viewport.height - 16 },
        );
        card.setGeometry(rect);
        return;
      }
      if (!initial) {
        // Keep an existing position while the page scrolls.
        const current = card.getRect();
        if (current.width && current.height) {
          card.setGeometry({
            x: current.x,
            y: current.y,
            width: current.width,
            height: current.height,
          });
          return;
        }
      }
      const others = this.getOtherCardRects(card.data.id);
      const contentRects = getVisibleTextRects(this.reader, card.data.selection.pageIndex);
      const pageRect = getPageScreenRect(this.reader, card.data.selection.pageIndex);
      const best = findBestCardPosition({
        anchor,
        viewport,
        size: { width, height },
        occupied: others,
        contentRects,
        pageRect,
      });
      card.setGeometry(best);
      return;
    }

    // Page is not currently rendered (or selection has no rects): park the
    // card in a tidy stack at the right edge rather than losing it.
    const index = Math.max(0, this.cardOrder.indexOf(card.data.id));
    const x = viewport.x + viewport.width - width - 14;
    const y = viewport.y + 16 + Math.min(index, 3) * 26;
    card.setGeometry({
      x,
      y: Math.min(y, viewport.y + viewport.height - height - 12),
      width,
      height,
    });
  }

  getOtherCardRects(cardId) {
    const rects = [];
    for (const [id, card] of this.cards) {
      if (id === cardId) continue;
      const rect = card.getRect();
      if (rect.width && rect.height) rects.push(rect);
    }
    return rects;
  }

  repositionAll() {
    if (!this.opened || this.mode === "translate") return;
    for (const card of this.cards.values()) this.positionCard(card);
    this.updateConnectors();
  }

  updateConnectorsThrottled() {
    if (this.connectorFrame) return;
    this.connectorFrame = this.win.requestAnimationFrame(() => {
      this.connectorFrame = null;
      this.updateConnectors();
    });
  }

  updateConnectors() {
    if (!this.connectors || !this.opened) return;
    const doc = this.doc;
    const svg = this.connectors;
    const pins = this.pinsLayer;
    svg.replaceChildren();
    pins.replaceChildren();
    if (this.mode === "translate") return;

    const viewport = this.getReaderViewport();
    svg.setAttribute("viewBox", `0 0 ${this.win.innerWidth} ${this.win.innerHeight}`);
    svg.setAttribute("width", String(this.win.innerWidth));
    svg.setAttribute("height", String(this.win.innerHeight));

    let index = 0;
    for (const [id, card] of this.cards) {
      index += 1;
      const anchorRect = this.getAnchorRect(card.data.selection);
      const cardRect = card.getRect();
      if (!anchorRect || !cardRect.width) {
        this.removeConnector(id);
        continue;
      }
      if (
        anchorRect.x + anchorRect.width < viewport.x ||
        anchorRect.x > viewport.x + viewport.width ||
        anchorRect.y + anchorRect.height < viewport.y ||
        anchorRect.y > viewport.y + viewport.height
      ) {
        this.removeConnector(id);
        continue;
      }

      const anchorRects = this.getSelectionScreenRects(card.data.selection);
      for (const rect of anchorRects) {
        const highlight = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        highlight.setAttribute("x", String(rect.x - 2));
        highlight.setAttribute("y", String(rect.y - 2));
        highlight.setAttribute("width", String(rect.width + 4));
        highlight.setAttribute("height", String(rect.height + 4));
        highlight.setAttribute("rx", "3");
        highlight.classList.add("dr-anchor-highlight");
        svg.appendChild(highlight);
      }

      const start = {
        x: anchorRect.x + anchorRect.width,
        y: anchorRect.y + anchorRect.height / 2,
      };
      let end;
      if (cardRect.x > start.x) {
        end = { x: cardRect.x, y: Math.max(cardRect.y + 28, Math.min(cardRect.y + cardRect.height - 28, start.y)) };
      } else if (cardRect.x + cardRect.width < start.x) {
        end = {
          x: cardRect.x + cardRect.width,
          y: Math.max(cardRect.y + 28, Math.min(cardRect.y + cardRect.height - 28, start.y)),
        };
      } else {
        end = { x: cardRect.x + cardRect.width / 2, y: cardRect.y };
      }
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      const curve = Math.max(24, Math.min(80, Math.abs(end.x - start.x) * 0.45));
      const direction = end.x >= start.x ? 1 : -1;
      path.setAttribute(
        "d",
        `M ${start.x} ${start.y} C ${start.x + curve * direction} ${start.y}, ${end.x - curve * direction} ${end.y}, ${end.x} ${end.y}`,
      );
      path.classList.add("dr-connector-line");
      svg.appendChild(path);

      const pin = doc.createElement("span");
      pin.className = "dr-pin";
      pin.style.left = `${anchorRect.x - 9}px`;
      pin.style.top = `${anchorRect.y - 9}px`;
      pin.textContent = String(index);
      pin.title = `第 ${card.pageLabel} 页的问答`;
      pin.addEventListener("click", () => {
        this.focusCard(card);
        this.flashCard(card);
      });
      pins.appendChild(pin);
    }
  }

  removeConnector() {
    // Connectors are rebuilt as a group; this hook exists for card lifecycle
    // symmetry and future per-card optimizations.
  }

  updateConnector() {
    this.updateConnectorsThrottled();
  }

  focusCard(card) {
    if (!card) return;
    card.element.classList.add("is-focused");
    this.win.requestAnimationFrame(() => card.element.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
    setTimeout(() => card.element.classList.remove("is-focused"), 900);
  }

  flashCard(card) {
    if (!card) return;
    card.element.classList.add("is-flashing");
    setTimeout(() => card.element.classList.remove("is-flashing"), 700);
  }

  async navigateToSelection(selection) {
    if (!selection) return;
    const pageIndex = Number(selection.pageIndex) || 0;
    if (pageIndex !== getCurrentPageIndex(this.reader)) {
      try {
        this.reader.navigate({ pageIndex });
        await sleep(420);
      } catch {
        // Ignore navigation failures.
      }
    }
    this.syncCurrentPage({ forceRender: true });
    for (const card of this.cards.values()) {
      if (card.data.selection.pageIndex === pageIndex) {
        this.positionCard(card);
      }
    }
    this.updateConnectorsThrottled();
  }

  scheduleSave(card) {
    if (this.positionSaveTimer) clearTimeout(this.positionSaveTimer);
    this.positionSaveTimer = setTimeout(() => this.onCardChanged(card), 280);
  }

  onCardChanged(card) {
    if (!card || this.destroyed) return;
    if (this.settings.saveChats) {
      this.app.store.upsertCard(this.attachmentKey, card.serialize());
    }
    this.refreshHistory();
    this.updateConnectorsThrottled();
  }

  async deleteCard(card) {
    this.cards.delete(card.data.id);
    this.cardOrder = this.cardOrder.filter((id) => id !== card.data.id);
    this.app.store.deleteCard(this.attachmentKey, card.data.id);
    this.refreshHistory();
    this.updateConnectorsThrottled();
  }

  togglePaperInfo() {
    if (this.paperInfoOpen) this.closePaperInfo();
    else this.openPaperInfo();
  }

  openPaperInfo() {
    this.closeHistory();
    this.refreshPaperInfo();
    this.paperInfoOpen = true;
    this.paperInfoPanel.hidden = false;
    this.paperInfoButton.classList.add("is-active");
    setTimeout(() => {
      this.doc.addEventListener("pointerdown", this.closePaperInfoOnOutside, true);
    }, 0);
  }

  closePaperInfo() {
    if (!this.paperInfoPanel) return;
    this.paperInfoOpen = false;
    this.paperInfoPanel.hidden = true;
    this.paperInfoButton.classList.remove("is-active");
    this.doc.removeEventListener("pointerdown", this.closePaperInfoOnOutside, true);
  }

  closePaperInfoOnOutside = (event) => {
    if (
      !this.paperInfoPanel?.contains(event.target) &&
      !this.paperInfoButton.contains(event.target)
    ) {
      this.closePaperInfo();
    }
  };

  refreshPaperInfo() {
    if (!this.dock) return;
    if (!this.paperInfoPanel) {
      this.paperInfoPanel = this.doc.createElement("div");
      this.paperInfoPanel.className = "dr-paper-info";
      this.paperInfoPanel.hidden = true;
      this.dock.appendChild(this.paperInfoPanel);
    }
    const panel = this.paperInfoPanel;
    panel.replaceChildren();
    const head = this.doc.createElement("div");
    head.className = "dr-history-head";
    const title = this.doc.createElement("strong");
    title.textContent = "论文信息";
    const hint = this.doc.createElement("span");
    hint.textContent = "来自 Zotero 条目";
    head.append(title, hint);
    panel.appendChild(head);

    const paperTitle = this.doc.createElement("h3");
    paperTitle.className = "dr-paper-info-title";
    paperTitle.textContent = this.paper.title || "未命名论文";
    panel.appendChild(paperTitle);

    if (this.paper.authors?.length) {
      const authors = this.doc.createElement("p");
      authors.className = "dr-paper-info-authors";
      authors.textContent = this.paper.authors.join(" · ");
      panel.appendChild(authors);
    }

    const metaParts = [this.paper.publication, this.paper.year].filter(Boolean);
    if (metaParts.length) {
      const meta = this.doc.createElement("p");
      meta.className = "dr-paper-info-meta";
      meta.textContent = metaParts.join(" · ");
      panel.appendChild(meta);
    }

    const abstract = this.doc.createElement("p");
    abstract.className = "dr-paper-info-abstract";
    abstract.textContent = this.paper.abstract || "条目没有摘要。";
    panel.appendChild(abstract);
  }

  toggleHistory() {
    if (this.historyOpen) this.closeHistory();
    else this.openHistory();
  }

  openHistory() {
    this.closePaperInfo();
    this.refreshHistory();
    this.historyOpen = true;
    this.historyPanel.hidden = false;
    this.historyButton.classList.add("is-active");
    setTimeout(() => {
      this.doc.addEventListener("pointerdown", this.closeHistoryOnOutside, true);
    }, 0);
  }

  closeHistory() {
    if (!this.historyPanel) return;
    this.historyOpen = false;
    this.historyPanel.hidden = true;
    this.historyButton.classList.remove("is-active");
    this.doc.removeEventListener("pointerdown", this.closeHistoryOnOutside, true);
  }

  closeHistoryOnOutside = (event) => {
    if (!this.historyPanel?.contains(event.target) && !this.historyButton.contains(event.target)) {
      this.closeHistory();
    }
  };

  refreshHistory() {
    if (!this.dock) return;
    if (!this.historyPanel) {
      this.historyPanel = this.doc.createElement("div");
      this.historyPanel.className = "dr-history";
      this.historyPanel.hidden = true;
      this.dock.appendChild(this.historyPanel);
    }
    const panel = this.historyPanel;
    panel.replaceChildren();
    const head = this.doc.createElement("div");
    head.className = "dr-history-head";
    const title = this.doc.createElement("strong");
    title.textContent = "问答记录";
    const count = this.doc.createElement("span");
    count.textContent = `${this.cards.size} 张卡片`;
    head.append(title, count);
    panel.appendChild(head);

    if (!this.cards.size) {
      const empty = this.doc.createElement("p");
      empty.className = "dr-history-empty";
      empty.textContent = "选中论文中的文字，点击“AI 提问”开始。";
      panel.appendChild(empty);
      return;
    }

    const list = this.doc.createElement("div");
    list.className = "dr-history-list";
    let index = 0;
    for (const card of this.cards.values()) {
      index += 1;
      const item = this.doc.createElement("button");
      item.type = "button";
      item.className = "dr-history-item";
      const number = this.doc.createElement("span");
      number.className = "dr-history-number";
      number.textContent = String(index);
      const content = this.doc.createElement("span");
      content.className = "dr-history-content";
      const q = this.doc.createElement("strong");
      q.textContent = card.data.title || "新的提问";
      const excerpt = this.doc.createElement("span");
      excerpt.textContent = `第 ${card.pageLabel} 页 · ${selectionExcerpt(card.data.selection.text, 90)}`;
      content.append(q, excerpt);
      item.append(number, content);
      item.addEventListener("click", () => {
        this.closeHistory();
        this.focusCard(card);
        this.navigateToSelection(card.data.selection);
      });
      list.appendChild(item);
    }
    panel.appendChild(list);
  }

  openSettings() {
    this.app.openPreferences();
  }

  confirm(title, message) {
    try {
      return Services.prompt.confirm(null, title, message);
    } catch {
      try {
        return this.win.confirm(`${title}\n\n${message}`);
      } catch {
        return false;
      }
    }
  }

  toast(message) {
    if (!this.root) return;
    let toast = this.root.querySelector(".dr-toast");
    if (!toast) {
      toast = this.doc.createElement("div");
      toast.className = "dr-toast";
      this.root.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  async exportPdf() {
    const done = [...this.translationState.entries()]
      .filter(([, state]) => state.status === "done" && state.text)
      .map(([pageIndex, state]) => ({
        pageIndex,
        translated: state.text,
        source: state.source,
        pageLabel: state.pageLabel || getPageLabel(this.reader, pageIndex),
      }))
      .sort((a, b) => a.pageIndex - b.pageIndex);
    if (!done.length) {
      this.toast("先翻译至少一页，再导出译文 PDF");
      return;
    }
    if (done.length < this.pageCount) {
      const proceed = this.confirm(
        "还有页面没有翻译",
        `当前只翻译了 ${done.length} / ${this.pageCount} 页。仍然导出这些页面的译文 PDF 吗？`,
      );
      if (!proceed) return;
    }
    this.exportButton.disabled = true;
    this.showProgress(0.05, "正在排版译文 PDF…", false);
    try {
      const fonts = await this.app.loadFonts();
      const bytes = await buildTranslatedPdf({
        sansFontBytes: fonts.sans,
        serifFontBytes: fonts.serif,
        pages: done,
        title: this.paper.title,
        author: this.paper.authors?.join(", ") || "",
        sourceUrl: this.reader?._item?.getField?.("url") || "",
      });
      const parent = this.reader?._item?.parentItem || null;
      const fileName = `${sanitizeFileName(this.paper.title)}-ReadNow-译文.pdf`;
      const tempDir = Zotero.getTempDirectory();
      const tempPath = typeof tempDir === "string" ? tempDir : tempDir.path;
      const path = PathUtils.join(tempPath, fileName);
      await IOUtils.write(path, bytes);
      const importOptions = {
        file: path,
        title: `${this.paper.title}（ReadNow 译文）`,
        contentType: "application/pdf",
      };
      if (parent?.id) importOptions.parentItemID = parent.id;
      const attachment = await Zotero.Attachments.importFromFile(importOptions);
      this.toast("译文 PDF 已添加到条目，正在打开…");
      await Zotero.Reader.open(attachment.id);
    } catch (error) {
      this.toast(`导出失败：${formatError(error, [this.settings.apiKey])}`);
    } finally {
      this.exportButton.disabled = false;
      this.hideProgress();
      this.updateExportButton();
    }
  }

  destroyCards() {
    for (const card of this.cards.values()) {
      try {
        card.destroy();
      } catch {
        // Ignore.
      }
    }
    this.cards.clear();
    this.cardOrder = [];
    if (this.cardsLayer) this.cardsLayer.replaceChildren();
    if (this.connectors) this.connectors.replaceChildren();
    if (this.pinsLayer) this.pinsLayer.replaceChildren();
    this.closeHistory();
  }

  refreshAll() {
    this.syncCurrentPage({ forceRender: true });
    this.renderTranslation();
    this.updateExportButton();
    this.refreshHistory();
    if (this.paperInfoOpen) this.refreshPaperInfo();
    this.repositionAll();
    this.updateConnectors();
  }
}

