export const ADDON_ID = "deepread@zotero.local";
export const ADDON_NAME = "ReadNow";
export const PREF_BRANCH = "extensions.zotero.deepread.";
export const PANE_ID = "deepread-preferences";
export const DATA_DIR_NAME = "deepread";
export const STORE_VERSION = 1;

export const PROVIDERS = {
  openai: {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    translationModel: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "OpenAI API Key",
    docs: "https://platform.openai.com/docs/api-reference/chat",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    translationModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyLabel: "DeepSeek API Key",
    docs: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    short: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    translationModel: "claude-3-5-haiku-latest",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "Anthropic API Key",
    docs: "https://docs.anthropic.com/en/api/messages",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    short: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
    translationModel: "gemini-2.0-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyLabel: "Google AI Studio API Key",
    docs: "https://ai.google.dev/gemini-api/docs",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    translationModel: "openai/gpt-4o-mini",
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "OpenRouter API Key",
    docs: "https://openrouter.ai/docs",
  },
  siliconflow: {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    short: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-72B-Instruct",
    translationModel: "Qwen/Qwen2.5-7B-Instruct",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    keyLabel: "SiliconFlow API Key",
    docs: "https://docs.siliconflow.cn/",
  },
  ollama: {
    id: "ollama",
    label: "Ollama / 本地模型",
    short: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
    translationModel: "qwen2.5:7b",
    keyUrl: "",
    keyLabel: "API Key（本地通常留空）",
    docs: "https://ollama.com/",
  },
  custom: {
    id: "custom",
    label: "自定义 OpenAI 兼容接口",
    short: "自定义",
    baseUrl: "https://your-endpoint.example.com/v1",
    model: "your-model",
    translationModel: "your-model",
    keyUrl: "",
    keyLabel: "API Key",
    docs: "",
  },
};

export const PROVIDER_ORDER = [
  "openai",
  "deepseek",
  "anthropic",
  "gemini",
  "openrouter",
  "siliconflow",
  "ollama",
  "custom",
];

export const TARGET_LANGUAGES = [
  { id: "zh-CN", label: "简体中文" },
  { id: "zh-TW", label: "繁體中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "ru", label: "Русский" },
];

export const DEFAULT_SYSTEM_PROMPT = [
  "你是 ReadNow，一名严谨、耐心的论文阅读助手。",
  "你的回答应帮助读者真正理解论文，而不是泛泛复述。",
  "优先依据用户提供的原文选区与页面上下文作答；材料不足时明确说明，不要编造公式、数据、引用或实验结论。",
  "解释概念时先给结论，再给依据；必要时用短列表、公式或类比。",
  "默认使用简体中文回答，但保留必要的英文术语、符号、变量名与引用编号。",
].join("\n");

export const DEFAULT_TRANSLATION_PROMPT = [
  "你是学术论文翻译引擎。将用户提供的论文文本翻译成目标语言。",
  "要求：",
  "1. 忠实、准确、通顺，保留原意与论证关系；",
  "2. 保留术语、变量名、公式、引用编号、图表编号与专有名词；",
  "3. 不总结、不解释、不添加原文没有的内容；",
  "4. 保留原文的标题层级、段落、列表与公式结构；",
  "5. 用 Markdown 标记结构：一级标题用 #，次级标题用 ## 或 ###；",
  "6. 正文每个段落之间必须空一行，不要把整页挤成一段；",
  "7. 脚注、注释与参考文献保留原编号，单独成段；",
  "8. 图注前加 [图注]，表注前加 [表注]；每个表格先单独写 [表格]，下一行开始使用带表头和 --- 分隔行的 GitHub Markdown 管道表格，绝不能把表格按普通文字逐行输出；",
  "9. 公式、变量、符号和编号原样保留，可用 $...$ 或 LaTeX，不要翻译公式内容；",
  "10. 图片、流程图、图表内部的坐标轴、图例、流程框文字不要翻译，也不要输出；只翻译正文、标题和图注/表注；",
  "11. 只输出译文本身，不要加“以下是译文”之类的前缀。",
].join("\n");

export const DEFAULT_PREFS = {
  provider: "deepseek",
  baseUrl: "",
  model: "",
  translationModel: "",
  keyOpenai: "",
  keyDeepseek: "",
  keyAnthropic: "",
  keyGemini: "",
  keyOpenrouter: "",
  keySiliconflow: "",
  keyOllama: "",
  keyCustom: "",
  targetLang: "zh-CN",
  autoTranslate: true,
  autoTranslatePage: true,
  autoRestore: true,
  stream: true,
  deepseekThinking: false,
  temperature: 0.2,
  maxTokens: 2048,
  contextPages: 1,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  pdfFontSize: 11,
  saveChats: true,
};

export const CARD_MIN_WIDTH = 320;
export const CARD_MIN_HEIGHT = 250;
export const CARD_DEFAULT_WIDTH = 392;
export const CARD_DEFAULT_HEIGHT = 520;
export const DOCK_WIDTH = 440;
export const MAX_SELECTION_CHARS = 12000;
export const MAX_CONTEXT_CHARS = 9000;
