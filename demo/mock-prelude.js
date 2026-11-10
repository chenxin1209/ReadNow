/* Minimal Zotero/IO stubs so the real plugin bundle can run in a plain page. */
(function () {
  "use strict";

  const files = new Map();
  window.IOUtils = {
    async makeDirectory() {},
    async read(path) {
      if (!files.has(path)) {
        const error = new Error("Not found");
        error.name = "NotFoundError";
        throw error;
      }
      return new TextEncoder().encode(files.get(path));
    },
    async write(path, bytes) {
      files.set(path, new TextDecoder().decode(bytes));
    },
    async readUTF8(path) {
      return files.get(path) || "";
    },
  };

  const setupMode = new URLSearchParams(window.location.search).has("setup");
  const prefs = {
    "extensions.zotero.deepread.provider": "openai",
    "extensions.zotero.deepread.baseUrl": "https://mock.local/v1",
    "extensions.zotero.deepread.model": "mock-chat",
    "extensions.zotero.deepread.translationModel": "mock-translate",
    "extensions.zotero.deepread.keyOpenai": setupMode ? "" : "sk-mock-key",
    "extensions.zotero.deepread.targetLang": "zh-CN",
    "extensions.zotero.deepread.autoTranslate": true,
    "extensions.zotero.deepread.autoTranslatePage": true,
    "extensions.zotero.deepread.autoRestore": true,
    "extensions.zotero.deepread.stream": false,
    "extensions.zotero.deepread.temperature": 0.2,
    "extensions.zotero.deepread.maxTokens": 2048,
    "extensions.zotero.deepread.contextPages": 1,
    "extensions.zotero.deepread.saveChats": true,
    "extensions.zotero.deepread.systemPrompt":
      "你是 ReadNow，一名严谨、耐心的论文阅读助手。\n优先依据用户提供的原文选区与页面上下文作答。",
    "extensions.zotero.deepread.translationPrompt":
      "你是学术论文翻译引擎。只输出译文，保留术语与公式。",
  };

  const paper = {
    key: "PAPERKEY",
    getField(name) {
      return {
        title: "Attention Is All You Need",
        date: "2017-06-12",
        publicationTitle: "NeurIPS",
        abstractNote:
          "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
      }[name] || "";
    },
    getCreators() {
      return [
        { firstName: "Ashish", lastName: "Vaswani" },
        { firstName: "Noam", lastName: "Shazeer" },
        { firstName: "Niki", lastName: "Parmar" },
      ];
    },
  };

  const attachment = {
    key: "ATTACHMENT01",
    parentItem: paper,
    getField(name) {
      return name === "title" ? "Attention Is All You Need.pdf" : "";
    },
  };

  const state = {
    primaryViewStats: {
      pageIndex: 0,
      pageLabel: "1",
      pagesCount: 1,
      canNavigateToPreviousPage: false,
      canNavigateToNextPage: false,
    },
  };

  const pageTextLines = Array.from(document.querySelectorAll(".textLayer span")).map(
    (span) => span.textContent,
  );

  const pdfPage = {
    async getTextContent() {
      return {
        items: pageTextLines.map((text, index) => ({
          str: text,
          transform: [1, 0, 0, 10, 64, 760 - index * 17],
          width: Math.max(100, text.length * 6),
          height: 10,
          hasEOL: true,
        })),
      };
    },
  };

  const pageView = {
    div: document.querySelector(".page"),
    viewport: { width: 610, height: 820, scale: 1, rotation: 0 },
    pageLabel: "1",
  };

  window.PDFViewerApplication = {
    pdfDocument: {
      numPages: 1,
      async getPage() {
        return pdfPage;
      },
    },
    pdfViewer: {
      _pages: [pageView],
      getPageView() {
        return pageView;
      },
    },
  };

  const listeners = {};
  window.__readerListeners = listeners;

  const reader = {
    type: "pdf",
    itemID: 101,
    _item: attachment,
    _iframeWindow: window,
    _internalReader: {
      _state: state,
      _primaryView: { _iframeWindow: window },
    },
    navigate(location) {
      if (Number.isFinite(location?.pageIndex)) {
        state.primaryViewStats.pageIndex = location.pageIndex;
        state.primaryViewStats.pageLabel = String(location.pageIndex + 1);
      }
    },
  };
  window.__mockReader = reader;

  window.Zotero = {
    initializationPromise: Promise.resolve(),
    debug() {},
    logError(error) {
      console.error(error);
    },
    DataDirectory: {
      getSubdirectory() {
        return "deepread-mock";
      },
    },
    Prefs: {
      get(key) {
        return prefs[key];
      },
      set(key, value) {
        prefs[key] = value;
      },
      clear(key) {
        delete prefs[key];
      },
      registerObserver() {
        return "observer";
      },
      unregisterObserver() {},
    },
    Reader: {
      registerEventListener(type, handler, id) {
        listeners[type] = handler;
      },
      unregisterEventListener(type) {
        delete listeners[type];
      },
      async open() {},
    },
    PreferencePanes: {
      async register() {
        return "deepread-preferences";
      },
      unregister() {},
    },
    Items: {
      get() {
        return attachment;
      },
    },
    Utilities: {
      Internal: {
        openPreferences() {},
        copyTextToClipboard() {},
      },
    },
    Attachments: {
      async importFromFile() {
        return { id: 999 };
      },
    },
    getMainWindow() {
      return window;
    },
    getMainWindows() {
      return [window];
    },
    getTempDirectory() {
      return { path: "deepread-mock/tmp" };
    },
    launchURL(url) {
      console.log("launch", url);
    },
  };

  window.fetch = async (url, init) => {
    let body = {};
    try {
      body = JSON.parse(init?.body || "{}");
    } catch {
      body = {};
    }
    const messages = body.messages || [];
    const user = messages[messages.length - 1]?.content || "";
    const isTranslation = /翻译/.test(user) && /【原文】|【本页原文】/.test(user);
    const isPageTranslation = /【本页原文】/.test(user);
    const content = isTranslation
      ? isPageTranslation
        ? [
            "# DEFORMABLE DETR: 用于端到端目标检测的可变形 Transformer",
            "",
            "发表于 ICLR 2021 会议论文",
            "",
            "1* 2* Xizhou Zhu, Weijie Su, Lewei Lu, Bin Li",
            "",
            "1 商汤科技研究院",
            "",
            "2 中国科学技术大学",
            "",
            "3 香港中文大学",
            "",
            "{zhuwalter,luotto,sensetime}@sensetime.com",
            "",
            "jackroos@mail.ustc.edu.cn",
            "",
            "# 摘要",
            "循环模型通常沿着输入与输出序列的符号位置逐步计算。由于每一步都依赖上一步的隐藏状态，训练样本内部难以并行化；当序列变长时，内存约束又会限制批处理规模。",
            "",
            "## 1 引言",
            "作者指出，顺序依赖不仅限制了并行计算，也让长序列训练更容易受到显存约束。**迭代边界框细化。** Transformer 通过自注意力直接建模全局依赖，从而绕开逐时间步递推。",
            "",
            "$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^T/\\sqrt{d_k})V$$",
            "",
            "## 2 背景",
            "已有工作尝试用卷积或稀疏注意力降低计算量，但仍保留局部窗口。本文的核心变化是让每一层都能直接访问序列中的所有位置。",
            "",
            "[图注] 图 1：不同注意力头在长序列上的权重分布。",
            "",
            "[表注] 表 1：在 WMT 2014 英德翻译任务上的结果。",
            "",
            "| 模型 | BLEU |",
            "| --- | --- |",
            "| Transformer | 28.4 |",
            "",
            "$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^T/\\sqrt{d_k})V$$",
            "",
            "参考文献",
            "[1] Vaswani A. Attention Is All You Need. 2017.",
            "[2] He K. Deep Residual Learning. 2016.",
          ].join("\n")
        : "循环模型通常沿着输入与输出序列的符号位置逐步计算。由于每一步都依赖上一步的隐藏状态，训练样本内部难以并行化；当序列变长时，内存约束又会限制批处理规模。"
      : [
          "**核心判断**：这段话指出循环结构的“顺序依赖”是并行化的根本瓶颈。",
          "",
          "作者把问题拆成两层：",
          "",
          "1. **计算依赖**：`h_t` 必须等 `h_{t-1}` 算完，时间步无法同时展开。",
          "2. **内存约束**：序列越长，保存中间状态越占内存，能同时训练的样本就越少。",
          "",
          "> 这也是 Transformer 直接用注意力建模全局依赖的动机：把顺序计算换成可并行的矩阵运算。",
          "",
          "如果你想继续，我可以把这段与第 3 节的 scaled dot-product attention 对照起来讲。",
        ].join("\n");
    return new Response(
      JSON.stringify({
        id: "mock",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
})();
