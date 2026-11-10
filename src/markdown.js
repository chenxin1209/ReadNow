import { isHttpUrl } from "./util.js";

const BLOCK_START = /^(?:```|#{1,4}\s|>\s?|[-*+]\s+|\d+[.)]\s+|---+\s*$)/;

function isBlank(line) {
  return /^\s*$/.test(line);
}

export function parseInline(text) {
  const source = String(text ?? "");
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\$[^$\n]+\$)/g;
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: source.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const intrawordUnderscore =
      (raw.startsWith("_") || raw.startsWith("__")) &&
      (/[\w]/.test(source[match.index - 1] || "") ||
        /[\w]/.test(source[match.index + raw.length] || ""));
    if (intrawordUnderscore) {
      // Keep snake_case identifiers and file_paths intact.
      tokens.push({ type: "text", value: raw });
      lastIndex = match.index + raw.length;
      continue;
    }
    if (raw.startsWith("`")) {
      tokens.push({ type: "code", value: raw.slice(1, -1) });
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ type: "strong", value: raw.slice(2, -2) });
    } else if (raw.startsWith("~~")) {
      tokens.push({ type: "del", value: raw.slice(2, -2) });
    } else if (raw.startsWith("$") && raw.endsWith("$") && raw.length > 2) {
      tokens.push({ type: "math", value: raw.slice(1, -1) });
    } else if (raw.startsWith("[")) {
      const link = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link && isHttpUrl(link[2])) {
        tokens.push({ type: "link", value: link[1], href: link[2] });
      } else {
        tokens.push({ type: "text", value: raw });
      }
    } else if (raw.startsWith("*") || raw.startsWith("_")) {
      tokens.push({ type: "em", value: raw.slice(1, -1) });
    } else {
      tokens.push({ type: "text", value: raw });
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < source.length) {
    tokens.push({ type: "text", value: source.slice(lastIndex) });
  }
  return tokens;
}

export function parseMarkdown(markdown) {
  const text = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, value: code.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const next = lines[index];
        const item = next.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!item) break;
        if (/^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or a new block marker.
    const paragraph = [line];
    index += 1;
    while (index < lines.length && !isBlank(lines[index]) && !BLOCK_START.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

function appendInline(doc, parent, text, options) {
  for (const token of parseInline(text)) {
    if (token.type === "text") {
      parent.appendChild(doc.createTextNode(token.value));
    } else if (token.type === "code") {
      const code = doc.createElement("code");
      code.className = "dr-inline-code";
      code.textContent = token.value;
      parent.appendChild(code);
    } else if (token.type === "strong") {
      const strong = doc.createElement("strong");
      appendInline(doc, strong, token.value, options);
      parent.appendChild(strong);
    } else if (token.type === "em") {
      const em = doc.createElement("em");
      appendInline(doc, em, token.value, options);
      parent.appendChild(em);
    } else if (token.type === "del") {
      const del = doc.createElement("del");
      appendInline(doc, del, token.value, options);
      parent.appendChild(del);
    } else if (token.type === "math") {
      const math = doc.createElement("span");
      math.className = "dr-math";
      math.textContent = token.value;
      parent.appendChild(math);
    } else if (token.type === "link") {
      const link = doc.createElement("a");
      link.className = "dr-link";
      link.href = token.href;
      link.textContent = token.value;
      link.title = token.href;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (typeof options?.onLink === "function") {
          options.onLink(token.href);
        }
      });
      parent.appendChild(link);
    }
  }
}

function appendParagraph(doc, parent, text, options) {
  const paragraph = doc.createElement("p");
  const parts = String(text).split("\n");
  parts.forEach((line, idx) => {
    if (idx > 0) paragraph.appendChild(doc.createElement("br"));
    appendInline(doc, paragraph, line, options);
  });
  parent.appendChild(paragraph);
}

/**
 * Render a safe subset of Markdown using DOM APIs. Model output is never
 * inserted as raw HTML.
 */
export function renderMarkdown(container, markdown, doc = globalThis.document, options = {}) {
  container.replaceChildren();
  const blocks = parseMarkdown(markdown);
  for (const block of blocks) {
    if (block.type === "code") {
      const pre = doc.createElement("pre");
      pre.className = "dr-code-block";
      if (block.language) pre.dataset.language = block.language;
      const code = doc.createElement("code");
      code.textContent = block.value;
      pre.appendChild(code);
      container.appendChild(pre);
    } else if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.level + 1));
      const heading = doc.createElement(`h${level}`);
      heading.className = "dr-md-heading";
      appendInline(doc, heading, block.text, options);
      container.appendChild(heading);
    } else if (block.type === "hr") {
      const hr = doc.createElement("hr");
      hr.className = "dr-md-hr";
      container.appendChild(hr);
    } else if (block.type === "quote") {
      const quote = doc.createElement("blockquote");
      quote.className = "dr-md-quote";
      String(block.text)
        .split(/\n{2,}/)
        .forEach((part) => appendParagraph(doc, quote, part, options));
      container.appendChild(quote);
    } else if (block.type === "list") {
      const list = doc.createElement(block.ordered ? "ol" : "ul");
      list.className = "dr-md-list";
      for (const item of block.items) {
        const li = doc.createElement("li");
        appendInline(doc, li, item, options);
        list.appendChild(li);
      }
      container.appendChild(list);
    } else {
      appendParagraph(doc, container, block.text, options);
    }
  }
  return container;
}
