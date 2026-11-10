import katex from "katex";
import { parseInline } from "./markdown.js";

const MATH_PATTERN =
  /(\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|array|split|multline\*?)\}[\s\S]*?\\end\{\2\}|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g;

const KATEX_MACROS = {
  "\\bm": "\\mathbf{#1}",
  "\\boldsymbol": "\\mathbf{#1}",
  "\\mathbbm": "\\mathbb{#1}",
  "\\argmax": "\\operatorname*{arg\\,max}",
  "\\argmin": "\\operatorname*{arg\\,min}",
};

function texFromDelimiters(raw) {
  let value = String(raw || "").trim();
  if (value.startsWith("$$") && value.endsWith("$$")) {
    return { tex: value.slice(2, -2), display: true };
  }
  if (value.startsWith("\\[") && value.endsWith("\\]")) {
    return { tex: value.slice(2, -2), display: true };
  }
  if (value.startsWith("\\(") && value.endsWith("\\)")) {
    return { tex: value.slice(2, -2), display: false };
  }
  if (value.startsWith("$") && value.endsWith("$")) {
    return { tex: value.slice(1, -1), display: false };
  }
  return { tex: value, display: false };
}

/**
 * Make common full-LaTeX/model-output constructs acceptable to KaTeX.
 * This intentionally stays conservative: a readable source fallback is
 * preferable to silently changing the meaning of a formula.
 */
export function normalizeTex(tex) {
  let value = String(tex ?? "")
    .trim()
    .replace(/\uFF04/g, "$")
    .replace(/&(?:lt|gt|amp);/g, (entity) => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&" })[entity])
    .replace(/\r?\n/g, " ")
    .replace(/\\(?:label|ref|eqref)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .replace(/\\begin\{(?:equation\*?|displaymath|align\*?|aligned|split)\}/g, "\\begin{aligned}")
    .replace(/\\end\{(?:equation\*?|displaymath|align\*?|aligned|split)\}/g, "\\end{aligned}")
    .replace(/\\begin\{(?:gather\*?|gathered|multline\*?)\}/g, "\\begin{gathered}")
    .replace(/\\end\{(?:gather\*?|gathered|multline\*?)\}/g, "\\end{gathered}")
    .replace(/\\textnormal\b/g, "\\mathrm")
    .replace(/\\mbox\b/g, "\\text")
    .replace(/\s+/g, " ")
    .trim();

  const left = (value.match(/\\left\b/g) || []).length;
  const right = (value.match(/\\right\b/g) || []).length;
  if (left !== right) value = value.replace(/\\left\b|\\right\b/g, "");

  let depth = 0;
  let balanced = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const escaped = index > 0 && value[index - 1] === "\\";
    if (char === "{" && !escaped) depth += 1;
    if (char === "}" && !escaped) {
      if (depth === 0) continue;
      depth -= 1;
    }
    balanced += char;
  }
  if (depth > 0) balanced += "}".repeat(depth);
  return balanced;
}

export function renderTexToString(tex, displayMode = false, { tolerant = false } = {}) {
  return katex.renderToString(normalizeTex(tex), {
    displayMode,
    throwOnError: !tolerant,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
    macros: KATEX_MACROS,
    maxExpand: 2000,
  });
}

function appendKatex(doc, container, tex, displayMode) {
  const wrapper = doc.createElement(displayMode ? "div" : "span");
  wrapper.className = displayMode ? "dr-math-display" : "dr-math-inline";
  try {
    let html;
    try {
      html = renderTexToString(tex, displayMode);
    } catch {
      // Unknown commands should not make the whole translated page fail.
      // KaTeX's tolerant mode keeps the unsupported fragment visible while
      // compiling the rest of the expression.
      html = renderTexToString(tex, displayMode, { tolerant: true });
      wrapper.classList.add("dr-math-recovered");
    }
    // KaTeX output is generated and escaped by KaTeX itself. innerHTML is
    // reliable in the reader's Xray document, where createContextualFragment
    // can be restricted; keep a fragment fallback for older environments.
    try {
      wrapper.innerHTML = html;
    } catch {
      const range = doc.createRange();
      range.selectNodeContents(wrapper);
      wrapper.appendChild(range.createContextualFragment(html));
    }
  } catch (error) {
    wrapper.classList.add("dr-math-fallback");
    wrapper.title = `公式渲染失败：${String(error?.message || error).slice(0, 180)}`;
    wrapper.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
  }
  container.appendChild(wrapper);
}

function appendInlineToken(doc, parent, token) {
  if (token.type === "text") {
    parent.appendChild(doc.createTextNode(token.value));
  } else if (token.type === "strong") {
    const node = doc.createElement("strong");
    appendInlineMarkdown(node, token.value, doc);
    parent.appendChild(node);
  } else if (token.type === "em") {
    const node = doc.createElement("em");
    appendInlineMarkdown(node, token.value, doc);
    parent.appendChild(node);
  } else if (token.type === "del") {
    const node = doc.createElement("del");
    appendInlineMarkdown(node, token.value, doc);
    parent.appendChild(node);
  } else if (token.type === "code") {
    const node = doc.createElement("code");
    node.className = "dr-inline-code";
    node.textContent = token.value;
    parent.appendChild(node);
  } else if (token.type === "math") {
    appendKatex(doc, parent, token.value, false);
  } else if (token.type === "link") {
    const node = doc.createElement("a");
    node.className = "dr-link";
    node.href = token.href;
    node.textContent = token.value;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      try {
        Zotero.launchURL(token.href);
      } catch {
        // Ignore unavailable link launcher.
      }
    });
    parent.appendChild(node);
  }
}

function appendMarkdownSegment(container, text, doc) {
  for (const token of parseInline(text)) {
    appendInlineToken(doc, container, token);
  }
}

function appendInlineMarkdown(container, text, doc) {
  const source = String(text ?? "");
  let lastIndex = 0;
  let match;
  MATH_PATTERN.lastIndex = 0;
  while ((match = MATH_PATTERN.exec(source))) {
    if (match.index > lastIndex) {
      appendMarkdownSegment(container, source.slice(lastIndex, match.index), doc);
    }
    // Parse math before Markdown so symbols such as *, _ and ** inside a
    // formula are never consumed as emphasis.
    const { tex, display } = texFromDelimiters(match[0]);
    appendKatex(doc, container, tex, display);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    appendMarkdownSegment(container, source.slice(lastIndex), doc);
  }
}

export function appendMathOnly(container, text, doc) {
  const source = String(text ?? "");
  let lastIndex = 0;
  let match;
  MATH_PATTERN.lastIndex = 0;
  while ((match = MATH_PATTERN.exec(source))) {
    if (match.index > lastIndex) {
      container.appendChild(doc.createTextNode(source.slice(lastIndex, match.index)));
    }
    const { tex, display } = texFromDelimiters(match[0]);
    appendKatex(doc, container, tex, display);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    container.appendChild(doc.createTextNode(source.slice(lastIndex)));
  }
}

export function appendTextWithMath(container, text, doc) {
  appendInlineMarkdown(container, text, doc);
}

export function renderMathBlock(doc, tex) {
  const wrapper = doc.createElement("div");
  wrapper.className = "dr-doc-formula";
  const parsed = texFromDelimiters(tex);
  appendKatex(doc, wrapper, parsed.tex, true);
  return wrapper;
}
