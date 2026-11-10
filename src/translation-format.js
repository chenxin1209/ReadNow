import { appendMathOnly, appendTextWithMath, renderMathBlock } from "./math-render.js";

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
const TERMINAL_PUNCT = /[。！？!?；;：:，,、]$/;
const HEADING_WORDS = new Set([
  "摘要",
  "abstract",
  "引言",
  "introduction",
  "相关工作",
  "related work",
  "方法",
  "method",
  "methods",
  "实验",
  "experiment",
  "experiments",
  "结果",
  "results",
  "讨论",
  "discussion",
  "结论",
  "conclusion",
  "参考文献",
  "references",
  "bibliography",
  "注释",
  "notes",
]);

function isCjk(text) {
  return CJK_CHAR.test(text || "");
}

function joinLines(lines) {
  let output = "";
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    if (!output) {
      output = line;
      continue;
    }
    const last = output[output.length - 1];
    const first = line[0];
    output += isCjk(last) || isCjk(first) ? line : ` ${line}`;
  }
  return output;
}

function splitSentences(text) {
  const sentences = String(text).match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [text];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Translation models sometimes return one long line per page. Split those
 * blocks into readable paragraphs without touching already-separated ones.
 */
export function splitLongParagraph(text, maxChars = 380) {
  const source = String(text || "").trim();
  if (source.length <= maxChars) return [source];
  const sentences = splitSentences(source);
  const paragraphs = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if ((current + sentence).length <= maxChars) {
      current += isCjk(current[current.length - 1]) || isCjk(sentence[0]) ? sentence : ` ${sentence}`;
    } else {
      paragraphs.push(current.trim());
      current = sentence;
    }
  }
  if (current.trim()) paragraphs.push(current.trim());
  // A single enormous sentence (common with PDF extraction) still needs to
  // wrap into visual paragraphs.
  return paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= maxChars * 1.5) return [paragraph];
    const pieces = [];
    for (let index = 0; index < paragraph.length; index += maxChars) {
      pieces.push(paragraph.slice(index, index + maxChars));
    }
    return pieces;
  });
}

function headingLevel(line) {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  const markdown = trimmed.match(/^(#{1,4})\s+(.+)$/);
  if (markdown) return Math.min(3, markdown[1].length);
  if (/^第[一二三四五六七八九十百千]+[章节部分篇]/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十百千]+[、.．]/.test(trimmed)) return 1;
  const numbered = trimmed.match(/^(\d+(?:\.\d+){0,3})[.、]?\s+(.{1,110})$/);
  if (numbered) {
    const title = numbered[2].trim();
    if (title && !TERMINAL_PUNCT.test(title) && title.length <= 90) {
      return Math.min(3, numbered[1].split(".").length);
    }
  }
  if (HEADING_WORDS.has(trimmed.toLowerCase().replace(/[：:]\s*$/, ""))) return 1;
  return 0;
}

function isReferenceHeading(line) {
  return /^(参考文献|references|bibliography|注释|notes)\s*[:：]?$/i.test(line.trim());
}

function isReferenceLine(line) {
  return /^\[\d+\]/.test(line.trim()) || /^\d+\.\s+[A-Z\u4e00-\u9fff]/.test(line.trim());
}

function splitTableRow(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  if (value.includes("\t")) return value.split(/\t+/).map((cell) => cell.trim());

  if (value.includes("|")) {
    const cells = [];
    let cell = "";
    let escaped = false;
    let inCode = false;
    let inMath = false;
    for (const char of value) {
      if (escaped) {
        cell += char === "|" ? "|" : `\\${char}`;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "`") {
        inCode = !inCode;
        cell += char;
      } else if (char === "$" && !inCode) {
        inMath = !inMath;
        cell += char;
      } else if (char === "|" && !inCode && !inMath) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += char;
      }
    }
    if (escaped) cell += "\\";
    cells.push(cell.trim());
    return cells;
  }

  // Models often preserve PDF columns with tabs or runs of spaces even when
  // they forget the Markdown pipes.
  return value.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

export function parseMarkdownTable(lines) {
  const rows = [];
  const aligns = [];
  let separatorIndex = -1;
  for (const line of lines) {
    const value = String(line || "").trim();
    if (!value || /^```/.test(value) || /^\+[+=:-]+(?:\+[+=:-]+)+\+?$/.test(value)) continue;
    const cells = splitTableRow(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      separatorIndex = rows.length;
      cells.forEach((cell, index) => {
        aligns[index] = cell.startsWith(":") && cell.endsWith(":")
          ? "center"
          : cell.endsWith(":")
            ? "right"
            : "left";
      });
      continue;
    }
    if (cells.length >= 2) rows.push(cells);
  }
  if (!rows.length) return { headers: [], rows: [], aligns: [] };
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, columnCount - row.length)).fill(""),
  ]);
  const headerIndex = separatorIndex > 0 ? separatorIndex - 1 : 0;
  return {
    headers: normalizedRows[headerIndex],
    rows: normalizedRows.filter((_, index) => index !== headerIndex),
    aligns: Array.from({ length: columnCount }, (_, index) => aligns[index] || "left"),
  };
}

function looksLikeTableRow(line) {
  const value = String(line || "").trim();
  if (!value || /^```/.test(value)) return false;
  if (/^\+[+=:-]+(?:\+[+=:-]+)+\+?$/.test(value)) return true;
  return splitTableRow(value).length >= 2;
}

const SECTION_START =
  /^(?:摘要|abstract|引言|introduction|背景|background|相关工作|related\s+work|方法|methods?|实验|experiments?|结果|results?|讨论|discussion|结论|conclusions?|参考文献|references)(?:\s|$|[：:])/i;

function isSectionStart(block) {
  if (!block?.text) return false;
  const text = block.text
    .replace(/^#{1,4}\s+/, "")
    .replace(/^\d+(?:\.\d+)*[.、]?\s*/, "")
    .trim();
  return SECTION_START.test(text);
}

const AFFILIATION_RE =
  /(大学|学院|研究院|研究所|实验室|研究中心|公司|university|institute|laboratory|research|inc\.?|corp\.?)/i;
const PUBLICATION_RE =
  /(发表于|会议|会刊|期刊|proceedings|conference|journal|arxiv|iclr|cvpr|iccv|eccv|neurips|nips|icml|aaai|acl|emnlp|ieee|acm)/i;

function classifyFrontMatter(text, index) {
  const value = String(text || "").trim();
  if (index === 0) return "title";
  if (value.includes("@")) return "email";
  if (AFFILIATION_RE.test(value)) return "affiliation";
  if (PUBLICATION_RE.test(value)) return "meta";
  if (
    (/,/.test(value) && /[A-Z][a-z]+/.test(value)) ||
    /[†‡*]/.test(value) ||
    /^[0-9,\s*†‡]+\s*[A-Z]/.test(value)
  ) {
    return "authors";
  }
  return "meta";
}

function applyFrontMatter(blocks) {
  const sectionIndex = blocks.findIndex((block, index) => index > 0 && isSectionStart(block));
  if (sectionIndex < 2) return blocks;
  const front = blocks.slice(0, sectionIndex);
  const hasMetadataClues = front.some(
    (block, index) =>
      index > 0 &&
      (block.text.includes("@") ||
        AFFILIATION_RE.test(block.text) ||
        PUBLICATION_RE.test(block.text) ||
        /,/.test(block.text)),
  );
  if (!hasMetadataClues) return blocks;
  return [
    ...front.map((block, index) => ({
      type: classifyFrontMatter(block.text, index),
      text: block.text,
    })),
    ...blocks.slice(sectionIndex),
  ];
}

function pushParagraph(blocks, lines) {
  if (!lines.length) return;
  const text = joinLines(lines);
  if (!text) return;
  for (const paragraph of splitLongParagraph(text)) {
    if (paragraph) blocks.push({ type: "paragraph", text: paragraph });
  }
}

/**
 * Convert translated Markdown/plain text into typed blocks used by both the
 * reader view and the PDF exporter.
 */
export function normalizeTranslationDocument(input, { frontMatter = false } = {}) {
  const text = String(input || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  let paragraph = [];
  let referenceMode = false;

  const flush = () => {
    pushParagraph(blocks, paragraph);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) {
      flush();
      continue;
    }

    if (isReferenceHeading(trimmed)) {
      flush();
      blocks.push({ type: "reference-heading", text: trimmed });
      referenceMode = true;
      continue;
    }

    const markdownHeading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (markdownHeading) {
      flush();
      blocks.push({
        type: "heading",
        level: Math.min(3, markdownHeading[1].length),
        text: markdownHeading[2].trim(),
      });
      continue;
    }

    if (referenceMode || isReferenceLine(trimmed)) {
      flush();
      blocks.push({ type: "note", text: trimmed });
      continue;
    }

    const environment = trimmed.match(/^\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|array|split|multline\*?)\}/);
    const opensDisplayMath =
      (trimmed.startsWith("$$") && (trimmed.match(/\$\$/g) || []).length === 1) ||
      (trimmed.startsWith("\\[") && !trimmed.includes("\\]"));
    if (environment || opensDisplayMath) {
      flush();
      const formulaLines = [trimmed];
      const closing = environment ? `\\end{${environment[1]}}` : trimmed.startsWith("$$") ? "$$" : "\\]";
      let cursor = index + 1;
      while (cursor < lines.length) {
        formulaLines.push(lines[cursor].trim());
        if (lines[cursor].includes(closing)) break;
        cursor += 1;
      }
      index = Math.min(cursor, lines.length - 1);
      blocks.push({ type: "formula", text: formulaLines.join("\n") });
      continue;
    }

    const tableMarker = trimmed.match(/^(?:\[表格\]|表格\s*[:：])\s*(.*)$/i);
    if (tableMarker) {
      flush();
      const tableLines = [];
      if (tableMarker[1]?.trim()) tableLines.push(tableMarker[1].trim());
      let cursor = index + 1;
      let skippedBlank = false;
      while (cursor < lines.length) {
        const candidate = lines[cursor].trim();
        if (!candidate && !tableLines.length && !skippedBlank) {
          skippedBlank = true;
          cursor += 1;
          continue;
        }
        if (!candidate || !looksLikeTableRow(lines[cursor])) break;
        tableLines.push(candidate);
        cursor += 1;
      }
      if (tableLines.length) index = cursor - 1;
      blocks.push({
        type: "table",
        text: tableLines.join("\n"),
        table: parseMarkdownTable(tableLines),
      });
      continue;
    }

    const captionMatch = trimmed.match(
      /^(?:\[(图注|表注|表格)\]|(图注|表注|表格)\s*[:：]|((?:图|表)\s*[\d一二三四五六七八九十]+)\s*[:：.]|(figure|table)\s*[\d一二三四五六七八九十]+\s*[:：.])\s*(.*)$/i,
    );
    if (captionMatch) {
      flush();
      const rawLabel = (
        captionMatch[1] ||
        captionMatch[2] ||
        captionMatch[3] ||
        captionMatch[4] ||
        ""
      ).toLowerCase();
      const label =
        rawLabel.startsWith("图") || rawLabel === "figure"
          ? "图注"
          : rawLabel === "表格"
            ? "表格"
            : "表注";
      let bodyText = (captionMatch[5] || "").trim();
      if (!bodyText && /^\[(?:图注|表注)\]$/i.test(trimmed)) {
        const next = lines[index + 1]?.trim() || "";
        if (next && !looksLikeTableRow(next) && !headingLevel(next)) {
          bodyText = next;
          index += 1;
        }
      }
      blocks.push({
        type: "caption",
        label: label || "图注",
        text: bodyText || trimmed,
      });
      continue;
    }

    if (looksLikeTableRow(raw)) {
      flush();
      const tableLines = [];
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      blocks.push({
        type: "table",
        text: tableLines.join("\n"),
        table: parseMarkdownTable(tableLines),
      });
      continue;
    }

    if (
      /^(?:\$\$?|\\\[|\\begin\{(?:equation|align|gather|array|split))/.test(trimmed) ||
      (/\\[A-Za-z]+/.test(trimmed) &&
        !/[\u3400-\u9fff]/.test(trimmed) &&
        trimmed.length < 600)
    ) {
      flush();
      blocks.push({ type: "formula", text: trimmed });
      continue;
    }

    const listMatch = trimmed.match(/^([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      flush();
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const next = lines[index].trim();
        const item = next.match(/^([-*+]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2].trim());
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const level = headingLevel(trimmed);
    if (level) {
      flush();
      const title = trimmed.replace(/^#{1,4}\s+/, "").trim();
      blocks.push({ type: "heading", level, text: title || trimmed });
      continue;
    }

    paragraph.push(trimmed);
  }
  flush();
  return frontMatter ? applyFrontMatter(blocks) : blocks;
}

export function renderTranslatedDocument(
  container,
  text,
  doc = globalThis.document,
  { frontMatter = false } = {},
) {
  container.replaceChildren();
  const blocks = normalizeTranslationDocument(text, { frontMatter });
  if (!blocks.length) {
    const paragraph = doc.createElement("p");
    paragraph.className = "dr-doc-p";
    paragraph.textContent = text || "";
    container.appendChild(paragraph);
    return container;
  }

  for (const block of blocks) {
    if (
      block.type === "title" ||
      block.type === "meta" ||
      block.type === "authors" ||
      block.type === "affiliation" ||
      block.type === "email"
    ) {
      const tag = block.type === "title" ? "h1" : "p";
      const node = doc.createElement(tag);
      node.className = `dr-doc-${block.type}`;
      // Author markers such as 1* / 2† are not Markdown emphasis; keep the
      // front matter verbatim.
      node.textContent = block.text;
      container.appendChild(node);
    } else if (block.type === "heading") {
      const tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      const heading = doc.createElement(tag);
      heading.className = block.level === 1 ? "dr-doc-h1" : "dr-doc-h2";
      appendTextWithMath(heading, block.text, doc);
      container.appendChild(heading);
    } else if (block.type === "reference-heading") {
      const heading = doc.createElement("h2");
      heading.className = "dr-doc-h1 dr-doc-reference-heading";
      appendTextWithMath(heading, block.text, doc);
      container.appendChild(heading);
    } else if (block.type === "list") {
      const list = doc.createElement(block.ordered ? "ol" : "ul");
      list.className = "dr-doc-list";
      for (const item of block.items) {
        const li = doc.createElement("li");
        appendTextWithMath(li, item, doc);
        list.appendChild(li);
      }
      container.appendChild(list);
    } else if (block.type === "note") {
      const note = doc.createElement("p");
      note.className = "dr-doc-note";
      appendMathOnly(note, block.text, doc);
      container.appendChild(note);
    } else if (block.type === "caption") {
      const caption = doc.createElement("div");
      caption.className = "dr-doc-caption";
      const tag = doc.createElement("span");
      tag.className = "dr-doc-caption-tag";
      tag.textContent = block.label || "图注";
      const text = doc.createElement("span");
      text.className = "dr-doc-caption-text";
      appendMathOnly(text, block.text, doc);
      caption.append(tag, text);
      container.appendChild(caption);
    } else if (block.type === "table") {
      const table = doc.createElement("div");
      table.className = "dr-doc-table-block";
      const tag = doc.createElement("span");
      tag.className = "dr-doc-caption-tag";
      tag.textContent = "表格";
      table.appendChild(tag);
      const parsed = block.table || parseMarkdownTable(block.text.split("\n"));
      if (parsed.headers.length) {
        const tableView = doc.createElement("table");
        tableView.className = "dr-doc-table";
        const thead = doc.createElement("thead");
        const headerRow = doc.createElement("tr");
        parsed.headers.forEach((cell, index) => {
          const th = doc.createElement("th");
          th.style.textAlign = parsed.aligns[index] || "left";
          appendMathOnly(th, cell, doc);
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tableView.appendChild(thead);
        const tbody = doc.createElement("tbody");
        for (const row of parsed.rows) {
          const tr = doc.createElement("tr");
          for (let index = 0; index < parsed.headers.length; index += 1) {
            const td = doc.createElement("td");
            td.style.textAlign = parsed.aligns[index] || "left";
            appendMathOnly(td, row[index] || "", doc);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        tableView.appendChild(tbody);
        table.appendChild(tableView);
      } else {
        const pre = doc.createElement("pre");
        pre.className = "dr-doc-table";
        pre.textContent = block.text;
        table.appendChild(pre);
      }
      container.appendChild(table);
    } else if (block.type === "formula") {
      container.appendChild(renderMathBlock(doc, block.text));
    } else {
      const paragraph = doc.createElement("p");
      paragraph.className = "dr-doc-p";
      appendTextWithMath(paragraph, block.text, doc);
      container.appendChild(paragraph);
    }
  }
  return container;
}
