import { TARGET_LANGUAGES, MAX_CONTEXT_CHARS } from "./constants.js";
import {
  hashString,
  normalizeWhitespace,
  stripCodeFence,
  truncate,
} from "./util.js";

export const PROMPT_VERSION = 8;

export function languageLabel(id) {
  return TARGET_LANGUAGES.find((item) => item.id === id)?.label || id || "简体中文";
}

const MATH_PATTERN =
  /(\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|array|split|multline\*?)\}[\s\S]*?\\end\{\2\}|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

/**
 * Protect source formulas from being rewritten by the model. Placeholders are
 * restored after translation, so even a weak model cannot alter the LaTeX.
 */
export function protectMath(text) {
  const formulas = [];
  const source = String(text ?? "").replace(MATH_PATTERN, (match) => {
    formulas.push(match);
    return `[[DRMATH_${formulas.length}]]`;
  });
  return { text: source, formulas };
}

export function restoreMath(text, formulas = []) {
  let value = String(text ?? "");
  formulas.forEach((formula, index) => {
    const token = new RegExp(
      `\\[\\[\\s*DRMATH[_-]?\\s*${index + 1}\\s*\\]\\]`,
      "gi",
    );
    value = value.replace(token, () => formula);
  });
  // Tolerate models that add/remove underscores while copying the token.
  return value.replace(
    /\[\[\s*DRMATH[_-]?\s*(\d+)\s*\]\]/gi,
    (match, number) => formulas[Number(number) - 1] || match,
  );
}

export function buildPaperInfo(paper = {}) {
  const lines = [];
  if (paper.title) lines.push(`标题：${paper.title}`);
  if (paper.authors?.length) lines.push(`作者：${paper.authors.join(", ")}`);
  if (paper.year) lines.push(`年份：${paper.year}`);
  if (paper.publication) lines.push(`来源：${paper.publication}`);
  if (paper.abstract) lines.push(`摘要：${truncate(paper.abstract, 2200)}`);
  return lines.join("\n");
}

export function buildSelectionMessages({
  text,
  targetLang,
  systemPrompt,
  paper,
  context,
  glossary,
}) {
  const language = languageLabel(targetLang);
  const parts = [];
  // Selection translation must only translate the selected excerpt. Paper
  // metadata is intentionally excluded, otherwise the model tends to output
  // title/authors/year/abstract instead of the selection.
  if (glossary) parts.push(`【术语表】\n${glossary}`);
  if (context) {
    parts.push(`【上下文，仅用于理解，不要翻译】\n${truncate(context, 2500)}`);
  }
  parts.push(
    `【任务】只把【原文】中的划线片段翻译成${language}。不要输出论文标题、作者、年份、摘要、单位或任何论文元数据；不要翻译【上下文】。形如 [[DRMATH_1]] 的公式占位符必须原样保留，不要改写。只输出划线片段的译文。`,
  );
  parts.push(`【原文】\n${text}`);
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: parts.join("\n\n") },
  ];
}

export function buildPageMessages({
  pageText,
  pageIndex,
  pageLabel,
  totalPages,
  targetLang,
  systemPrompt,
  paper,
  previousText,
  nextText,
}) {
  const language = languageLabel(targetLang);
  const parts = [];
  // Do not repeat title/authors/abstract in every page translation request.
  // The reader exposes that metadata through the paper-info button instead.
  if (previousText) parts.push(`【上一页末尾，仅用于衔接】\n${truncate(previousText, 1200)}`);
  if (nextText) parts.push(`【下一页开头，仅用于衔接】\n${truncate(nextText, 1200)}`);
  parts.push(
    `【任务】把本页论文文本翻译成${language}。用 Markdown 标题保留原有标题层级，正文段落之间空一行；图注加 [图注]，表注加 [表注]；每个表格必须先输出单独一行 [表格]，随后输出带表头和 --- 分隔行的 GitHub Markdown 管道表格，不能把表格压成普通段落，单元格缺失时留空；公式、变量和编号原样保留；形如 [[DRMATH_1]] 的公式占位符必须原样保留，不要改写；图片/流程图/图表内部的坐标轴、图例、流程框文字不要翻译也不要输出；脚注和参考文献单独成段；只输出译文。`,
  );
  parts.push(`【本页原文】\n${pageText}`);
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: parts.join("\n\n") },
  ];
}

export function buildQaSystemMessage({
  systemPrompt,
  paper,
  selection,
  pageText,
  contextPages,
}) {
  const info = buildPaperInfo(paper);
  const parts = [systemPrompt];
  if (info) parts.push(`【论文信息】\n${info}`);
  if (selection?.text) {
    const page = selection.pageLabel || (selection.pageIndex != null ? selection.pageIndex + 1 : "");
    parts.push(`【用户当前锚定的原文${page ? `，第 ${page} 页` : ""}】\n${selection.text}`);
  }
  if (pageText) {
    parts.push(
      `【当前页上下文${contextPages > 1 ? `（含相邻页）` : ""}，可能包含 OCR 错误】\n${truncate(
        pageText,
        MAX_CONTEXT_CHARS,
      )}`,
    );
  }
  parts.push(
    "回答时请优先解释选区在论文论证中的作用；引用原文时使用简短引文。不要声称读过你没有拿到的页面。",
  );
  return { role: "system", content: parts.join("\n\n") };
}

/**
 * Split page text into API-sized chunks without cutting sentences in half
 * when possible. PDF extraction often produces short visual lines.
 */
export function chunkText(text, maxChars = 6000) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const pushLongParagraph = (paragraph) => {
    const sentences = paragraph.split(/(?<=[.!?。！？；;])\s+/);
    let buffer = "";
    for (const sentence of sentences) {
      if ((buffer + " " + sentence).trim().length <= maxChars) {
        buffer = `${buffer} ${sentence}`.trim();
      } else {
        if (buffer) chunks.push(buffer.trim());
        if (sentence.length <= maxChars) {
          buffer = sentence;
        } else {
          let rest = sentence;
          while (rest.length > maxChars) {
            chunks.push(rest.slice(0, maxChars));
            rest = rest.slice(maxChars);
          }
          buffer = rest;
        }
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      pushLongParagraph(paragraph);
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      flush();
      current = paragraph;
    } else {
      current = next;
    }
  }
  flush();
  return chunks;
}

export function cleanModelText(text) {
  let value = stripCodeFence(String(text ?? "")).replace(/\r\n?/g, "\n").trim();
  value = value.replace(/^(?:以下是|下面是)?(?:中文|英文|日文|译文|翻译)(?:结果)?[:：]\s*/i, "");
  value = value.replace(/^【译文】\s*/i, "");
  value = value.replace(/\n{3,}/g, "\n\n").trim();
  return value;
}

export function translationCacheKey({ text, targetLang, model }) {
  return hashString(`${PROMPT_VERSION}|${targetLang}|${model}|${text}`);
}

export function pageTranslationCacheKey({
  attachmentKey,
  pageIndex,
  textHash,
  targetLang,
  model,
}) {
  return hashString(
    `${PROMPT_VERSION}|page|${attachmentKey}|${pageIndex}|${targetLang}|${model}|${textHash}`,
  );
}

export function questionTitle(question) {
  const cleaned = String(question ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "新的提问";
  return truncate(cleaned, 42);
}

export function selectionExcerpt(text, maxChars = 240) {
  return truncate(String(text ?? "").replace(/\s+/g, " ").trim(), maxChars);
}
