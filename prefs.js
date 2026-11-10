/* ReadNow defaults. User values live under the existing branch for compatibility. */
pref("extensions.zotero.deepread.provider", "deepseek");
pref("extensions.zotero.deepread.baseUrl", "https://api.deepseek.com");
pref("extensions.zotero.deepread.model", "deepseek-flash");
pref("extensions.zotero.deepread.translationModel", "deepseek-flash");
pref("extensions.zotero.deepread.keyOpenai", "");
pref("extensions.zotero.deepread.keyDeepseek", "");
pref("extensions.zotero.deepread.keyAnthropic", "");
pref("extensions.zotero.deepread.keyGemini", "");
pref("extensions.zotero.deepread.keyOpenrouter", "");
pref("extensions.zotero.deepread.keySiliconflow", "");
pref("extensions.zotero.deepread.keyOllama", "");
pref("extensions.zotero.deepread.keyCustom", "");
pref("extensions.zotero.deepread.targetLang", "zh-CN");
pref("extensions.zotero.deepread.autoTranslate", true);
pref("extensions.zotero.deepread.autoTranslatePage", true);
pref("extensions.zotero.deepread.autoRestore", true);
pref("extensions.zotero.deepread.stream", true);
pref("extensions.zotero.deepread.deepseekThinking", false);
pref("extensions.zotero.deepread.temperature", "0.2");
pref("extensions.zotero.deepread.maxTokens", 2048);
pref("extensions.zotero.deepread.contextPages", 1);
pref("extensions.zotero.deepread.pdfFontSize", 11);
pref("extensions.zotero.deepread.saveChats", true);
pref(
  "extensions.zotero.deepread.systemPrompt",
  "你是 ReadNow，一名严谨、耐心的论文阅读助手。\n你的回答应帮助读者真正理解论文，而不是泛泛复述。\n优先依据用户提供的原文选区与页面上下文作答；材料不足时明确说明，不要编造公式、数据、引用或实验结论。\n解释概念时先给结论，再给依据；必要时用短列表、公式或类比。\n默认使用简体中文回答，但保留必要的英文术语、符号、变量名与引用编号。"
);
pref(
  "extensions.zotero.deepread.translationPrompt",
  "你是学术论文翻译引擎。将用户提供的论文文本翻译成目标语言。\n要求：\n1. 忠实、准确、通顺，保留原意与论证关系；\n2. 保留术语、变量名、公式、引用编号、图表编号与专有名词；\n3. 不总结、不解释、不添加原文没有的内容；\n4. 保留原文的标题层级、段落、列表与公式结构；\n5. 用 Markdown 标记结构：一级标题用 #，次级标题用 ## 或 ###；\n6. 正文每个段落之间必须空一行，不要把整页挤成一段；\n7. 脚注、注释与参考文献保留原编号，单独成段；\n8. 图注前加 [图注]，表注前加 [表注]，表格内容前加 [表格]；不要把它们混进正文；\n9. 公式、变量、符号和编号原样保留，可用 $...$ 或 LaTeX，不要翻译公式内容；\n10. 图片、流程图、图表内部的坐标轴、图例、流程框文字不要翻译，也不要输出；只翻译正文、标题和图注/表注；\n11. 只输出译文本身，不要加“以下是译文”之类的前缀。"
);
