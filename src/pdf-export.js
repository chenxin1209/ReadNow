import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { normalizeTranslationDocument } from "./translation-format.js";
import { truncate } from "./util.js";

const A4 = [595.28, 841.89];
const MARGIN_X = 52;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 46;
const HEADER_HEIGHT = 28;
const FOOTER_HEIGHT = 22;
const HEADING1_SIZE = 12; // 小四
const HEADING1_LINE = 18.5;
const BODY_SIZE = 10.5; // 五号
const BODY_LINE = 18.2;
const NOTE_SIZE = 9; // 小五
const NOTE_LINE = 14.8;
const FIRST_LINE_INDENT = BODY_SIZE * 2;
const INK = rgb(0.11, 0.13, 0.12);
const MUTED = rgb(0.42, 0.45, 0.43);
const ACCENT = rgb(0.13, 0.42, 0.34);
const RULE = rgb(0.85, 0.87, 0.84);

function sanitizePdfText(text) {
  return String(text ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function isCjk(char) {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(char);
}

function tokenize(text) {
  const tokens = [];
  let latin = "";
  const flushLatin = () => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  for (const char of text) {
    if (char === "\n") {
      flushLatin();
      tokens.push("\n");
    } else if (/\s/.test(char)) {
      flushLatin();
      tokens.push(" ");
    } else if (isCjk(char)) {
      flushLatin();
      tokens.push(char);
    } else {
      latin += char;
    }
  }
  flushLatin();
  return tokens;
}

export function wrapText(text, font, size, maxWidth, { firstLineIndent = 0 } = {}) {
  const lines = [];
  const paragraphs = sanitizePdfText(text).split(/\n{2,}/);
  const measure = (value) => font.widthOfTextAtSize(value, size);

  const wrapParagraph = (paragraph) => {
    if (!paragraph.trim()) return;
    const tokens = tokenize(paragraph);
    let line = "";
    let firstLine = true;
    let pendingSpace = false;
    const lineWidth = () => (firstLine ? Math.max(20, maxWidth - firstLineIndent) : maxWidth);

    for (const token of tokens) {
      if (token === "\n") {
        lines.push(line.trimEnd());
        line = "";
        firstLine = false;
        pendingSpace = false;
        continue;
      }
      if (token === " ") {
        pendingSpace = Boolean(line);
        continue;
      }
      const candidate = pendingSpace ? `${line} ${token}` : `${line}${token}`;
      if (!line || measure(candidate) <= lineWidth()) {
        line = candidate;
        pendingSpace = false;
      } else {
        if (/^[，。、；：！？）》」』】”’%]$/.test(token) && line) {
          line = `${line}${token}`;
          lines.push(line.trimEnd());
          line = "";
          firstLine = false;
          pendingSpace = false;
          continue;
        }
        lines.push(line.trimEnd());
        line = token;
        firstLine = false;
        pendingSpace = false;
      }
      if (measure(line) > lineWidth()) {
        let rest = line;
        while (measure(rest) > lineWidth() && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && measure(rest.slice(0, cut)) > lineWidth()) cut -= 1;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
          firstLine = false;
        }
        line = rest;
      }
    }
    lines.push(line.trimEnd());
  };

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) lines.push("");
    for (const visualLine of paragraph.split("\n")) wrapParagraph(visualLine);
  });
  return lines;
}

function isLatinRunChar(char) {
  return /[A-Za-z0-9\u00c0-\u024f\u0370-\u03ff\u2000-\u206f\u20a0-\u20cf\u2100-\u21ff\u2200-\u22ff]/.test(
    char,
  );
}

function splitFontRuns(text) {
  const runs = [];
  let current = "";
  let currentLatin = null;
  for (const char of String(text || "")) {
    const latin = isLatinRunChar(char) || char === " ";
    if (!current) {
      current = char;
      currentLatin = latin;
    } else if (latin === currentLatin) {
      current += char;
    } else {
      runs.push({ text: current, latin: currentLatin });
      current = char;
      currentLatin = latin;
    }
  }
  if (current) runs.push({ text: current, latin: currentLatin });
  return runs;
}

function measureMixedLine(text, cjkFont, latinFont, size) {
  let width = 0;
  for (const run of splitFontRuns(text)) {
    const font = run.latin ? latinFont : cjkFont;
    width += font.widthOfTextAtSize(run.text, size);
  }
  return width;
}

function drawMixedLine(page, text, x, y, { cjkFont, latinFont, size, color }) {
  let cursor = x;
  for (const run of splitFontRuns(text)) {
    const font = run.latin ? latinFont : cjkFont;
    page.drawText(run.text, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(run.text, size);
  }
  return cursor;
}

function drawTableBlock({
  current,
  table,
  fonts,
  contentWidth,
  bodyBottom,
  addPage,
  headerTitle,
}) {
  if (!table?.headers?.length) return current;
  const columns = Math.max(
    table.headers.length,
    ...((table.rows || []).map((row) => row.length || 0)),
  );
  if (!columns) return current;
  const columnWidth = contentWidth / columns;
  const fontSize = 8.5;
  const lineHeight = 11.5;
  const padding = 4;
  const gridColor = rgb(0.78, 0.81, 0.78);
  const headerFill = rgb(0.94, 0.95, 0.93);
  const rows = [table.headers, ...(table.rows || [])];

  const layoutRow = (cells) =>
    Array.from({ length: columns }, (_, index) =>
      wrapText(
        stripInlineMarkdown(cells[index] || ""),
        fonts.serif,
        fontSize,
        columnWidth - padding * 2,
      ),
    );

  const drawRow = (cells, isHeader, allowHeaderRepeat = true) => {
    const cellLines = layoutRow(cells);
    const rowHeight =
      Math.max(1, ...cellLines.map((lines) => Math.max(1, lines.length))) * lineHeight +
      padding * 2;
    if (current.y - rowHeight < bodyBottom) {
      current = addPage(headerTitle, true);
      if (!isHeader && allowHeaderRepeat) {
        drawRow(table.headers, true, false);
      }
    }
    const rowTop = current.y;
    if (isHeader) {
      current.page.drawRectangle({
        x: MARGIN_X,
        y: rowTop - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: headerFill,
      });
    }
    for (let index = 0; index < columns; index += 1) {
      const align = table.aligns?.[index] || "left";
      let y = rowTop - padding - fontSize;
      for (const line of cellLines[index]) {
        if (line) {
          let x = MARGIN_X + index * columnWidth + padding;
          if (align === "center" || align === "right") {
            const width = measureMixedLine(line, fonts.serif, fonts.times, fontSize);
            x =
              align === "center"
                ? MARGIN_X + index * columnWidth + (columnWidth - width) / 2
                : MARGIN_X + (index + 1) * columnWidth - padding - width;
          }
          drawMixedLine(current.page, line, x, y, {
            cjkFont: fonts.serif,
            latinFont: fonts.times,
            size: fontSize,
            color: INK,
          });
        }
        y -= lineHeight;
      }
      if (index > 0) {
        current.page.drawLine({
          start: { x: MARGIN_X + index * columnWidth, y: rowTop },
          end: { x: MARGIN_X + index * columnWidth, y: rowTop - rowHeight },
          thickness: 0.6,
          color: gridColor,
        });
      }
    }
    current.page.drawLine({
      start: { x: MARGIN_X, y: rowTop },
      end: { x: MARGIN_X + contentWidth, y: rowTop },
      thickness: 0.6,
      color: gridColor,
    });
    current.page.drawLine({
      start: { x: MARGIN_X, y: rowTop - rowHeight },
      end: { x: MARGIN_X + contentWidth, y: rowTop - rowHeight },
      thickness: 0.6,
      color: gridColor,
    });
    current.y -= rowHeight;
  };

  rows.forEach((row, index) => drawRow(row, index === 0));
  return current;
}

function drawHeader(page, font, latinFont, title, pageNumber, isContinuation) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: MARGIN_X,
    y: height - MARGIN_TOP - HEADER_HEIGHT,
    width: width - MARGIN_X * 2,
    height: 0.6,
    color: RULE,
  });
  const headerTitle = truncate(title || "论文译文", 74);
  drawMixedLine(page, headerTitle, MARGIN_X, height - MARGIN_TOP - 8, {
    cjkFont: font,
    latinFont,
    size: 8.2,
    color: MUTED,
  });
  const rightText = isContinuation ? "ReadNow 译文（续）" : "ReadNow 译文";
  const rightWidth = measureMixedLine(rightText, font, latinFont, 8.2);
  drawMixedLine(page, rightText, width - MARGIN_X - rightWidth, height - MARGIN_TOP - 8, {
    cjkFont: font,
    latinFont,
    size: 8.2,
    color: ACCENT,
  });
  page.drawText(String(pageNumber), {
    x: width - MARGIN_X - latinFont.widthOfTextAtSize(String(pageNumber), 8) / 2,
    y: MARGIN_BOTTOM - 4,
    size: 8,
    font: latinFont,
    color: MUTED,
  });
}

function stripInlineMarkdown(text) {
  return String(text || "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1（$2）");
}

function blockToLines(block, fonts, contentWidth) {
  block = { ...block, text: stripInlineMarkdown(block.text) };
  if (
    block.type === "title" ||
    block.type === "meta" ||
    block.type === "authors" ||
    block.type === "affiliation" ||
    block.type === "email"
  ) {
    const config = {
      title: { size: 18, line: 27, font: fonts.sans, latinFont: fonts.timesBold, before: 2, after: 8 },
      meta: { size: BODY_SIZE, line: BODY_LINE, font: fonts.serif, latinFont: fonts.times, before: 0, after: 3 },
      authors: { size: 11, line: 18, font: fonts.serif, latinFont: fonts.times, before: 3, after: 4 },
      affiliation: { size: 10, line: 16, font: fonts.serif, latinFont: fonts.times, before: 0, after: 2 },
      email: { size: 9.5, line: 15, font: fonts.serif, latinFont: fonts.times, before: 0, after: 2 },
    }[block.type];
    const lines = wrapText(block.text, config.font, config.size, contentWidth);
    return {
      gapBefore: config.before,
      gapAfter: config.after,
      lines: lines.map((text) => ({
        text,
        font: config.font,
        latinFont: config.latinFont,
        size: config.size,
        lineHeight: config.line,
        indent: 0,
        align: "center",
      })),
    };
  }

  if (block.type === "caption") {
    const lines = wrapText(`[${block.label || "图注"}] ${block.text}`, fonts.serif, 9.5, contentWidth);
    return {
      gapBefore: 4,
      gapAfter: 2,
      lines: lines.map((text) => ({
        text,
        font: fonts.serif,
        latinFont: fonts.times,
        size: 9.5,
        lineHeight: 15,
        indent: 0,
      })),
    };
  }

  if (block.type === "table") {
    const lines = ["[表格]", ...block.text.split("\n").filter(Boolean)];
    return {
      gapBefore: 4,
      gapAfter: 4,
      lines: lines.map((text) => ({
        text,
        font: fonts.serif,
        latinFont: fonts.times,
        size: 8.5,
        lineHeight: 12.5,
        indent: 0,
      })),
    };
  }

  if (block.type === "formula") {
    const lines = wrapText(block.text, fonts.serif, BODY_SIZE, contentWidth);
    return {
      gapBefore: 4,
      gapAfter: 3,
      lines: lines.map((text) => ({
        text,
        font: fonts.serif,
        latinFont: fonts.times,
        size: BODY_SIZE,
        lineHeight: BODY_LINE,
        indent: 0,
        align: "center",
      })),
    };
  }

  if (block.type === "heading") {
    const size = block.level === 1 ? HEADING1_SIZE : BODY_SIZE;
    const lineHeight = block.level === 1 ? HEADING1_LINE : BODY_LINE;
    const font = block.level === 1 ? fonts.sans : fonts.serif;
    const lines = wrapText(block.text, font, size, contentWidth);
    return {
      gapBefore: block.level === 1 ? 12 : 8,
      gapAfter: 4,
      lines: lines.map((text) => ({
        text,
        font,
        latinFont: fonts.timesBold,
        size,
        lineHeight,
        indent: 0,
      })),
    };
  }
  if (block.type === "reference-heading") {
    const lines = wrapText(block.text, fonts.sans, HEADING1_SIZE, contentWidth);
    return {
      gapBefore: 14,
      gapAfter: 4,
      lines: lines.map((text) => ({
        text,
        font: fonts.sans,
        latinFont: fonts.timesBold,
        size: HEADING1_SIZE,
        lineHeight: HEADING1_LINE,
        indent: 0,
      })),
    };
  }
  if (block.type === "note") {
    const lines = wrapText(block.text, fonts.serif, NOTE_SIZE, contentWidth);
    return {
      gapBefore: 2,
      gapAfter: 1,
      lines: lines.map((text) => ({
        text,
        font: fonts.serif,
        latinFont: fonts.times,
        size: NOTE_SIZE,
        lineHeight: NOTE_LINE,
        indent: 0,
      })),
    };
  }
  if (block.type === "list") {
    const lines = [];
    block.items.forEach((item, index) => {
      const prefix = block.ordered ? `${index + 1}. ` : "· ";
      const wrapped = wrapText(`${prefix}${item}`, fonts.serif, BODY_SIZE, contentWidth - 18);
      wrapped.forEach((text, lineIndex) => {
        lines.push({
          text,
          font: fonts.serif,
          latinFont: fonts.times,
          size: BODY_SIZE,
          lineHeight: BODY_LINE,
          indent: lineIndex === 0 ? 18 : 30,
        });
      });
    });
    return { gapBefore: 2, gapAfter: 5, lines };
  }

  const wrapped = wrapText(block.text, fonts.serif, BODY_SIZE, contentWidth, {
    firstLineIndent: FIRST_LINE_INDENT,
  });
  return {
    gapBefore: 0,
    gapAfter: 5,
    lines: wrapped.map((text, index) => ({
      text,
      font: fonts.serif,
      latinFont: fonts.times,
      size: BODY_SIZE,
      lineHeight: BODY_LINE,
      indent: index === 0 ? FIRST_LINE_INDENT : 0,
    })),
  };
}

/**
 * Build a clean, reflowed translated PDF. Text layout follows the requested
 * thesis style: 黑体 12pt headings, 宋体 10.5pt body with a two-character
 * first-line indent, and 9pt notes/references.
 *
 * @param {Object} options
 * @param {Uint8Array|ArrayBuffer} options.sansFontBytes Heading font (Noto Sans SC)
 * @param {Uint8Array|ArrayBuffer} [options.serifFontBytes] Body font (Noto Serif SC)
 * @param {Uint8Array|ArrayBuffer} [options.fontBytes] Backward-compatible alias for sansFontBytes
 * @param {Array<{pageIndex:number,pageLabel?:string,translated:string,text?:string}>} options.pages
 * @param {string} options.title
 */
export async function buildTranslatedPdf({
  sansFontBytes,
  serifFontBytes,
  fontBytes,
  pages,
  title,
  author = "",
  subject = "ReadNow 机器翻译",
  sourceUrl = "",
}) {
  const headingBytes = sansFontBytes || fontBytes;
  const bodyBytes = serifFontBytes || headingBytes;
  if (!headingBytes || !bodyBytes) {
    throw new Error("缺少中文字体文件，无法生成译文 PDF");
  }
  if (!Array.isArray(pages) || !pages.length) throw new Error("没有可导出的译文页面");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title ? `${title}（译文）` : "论文译文");
  pdf.setAuthor(author || "ReadNow for Zotero");
  pdf.setSubject(subject);
  pdf.setCreator("ReadNow for Zotero");
  pdf.setProducer("ReadNow for Zotero · pdf-lib");
  pdf.setCreationDate(new Date());
  if (sourceUrl) pdf.setKeywords([sourceUrl]);

  // Subsetting large CJK fonts can drop glyphs in pdf-lib, so embed full faces.
  const fonts = {
    sans: await pdf.embedFont(headingBytes, { subset: false }),
    serif: await pdf.embedFont(bodyBytes, { subset: false }),
    times: await pdf.embedFont(StandardFonts.TimesRoman),
    timesBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };

  const contentWidth = A4[0] - MARGIN_X * 2;
  const bodyTop = A4[1] - MARGIN_TOP - HEADER_HEIGHT - 14;
  const bodyBottom = MARGIN_BOTTOM + FOOTER_HEIGHT;
  let pdfPageNumber = 0;

  const addPage = (headerTitle, continuation = false) => {
    pdfPageNumber += 1;
    const page = pdf.addPage(A4);
    drawHeader(page, fonts.sans, fonts.times, headerTitle, pdfPageNumber, continuation);
    return { page, y: bodyTop };
  };

  for (const entry of pages) {
    const label = entry.pageLabel ? `第 ${entry.pageLabel} 页` : `第 ${entry.pageIndex + 1} 页`;
    const headerTitle = `${title || "论文译文"} · ${label}`;
    let current = addPage(headerTitle, false);
    let firstPart = true;

    const blocks = normalizeTranslationDocument(entry.translated || "", {
      frontMatter: entry.pageIndex === 0,
    });
    if (!blocks.length) {
      blocks.push({ type: "paragraph", text: "（本页尚未翻译）" });
    }

    for (const block of blocks) {
      if (block.type === "table" && block.table?.headers?.length) {
        current.y -= 4;
        current = drawTableBlock({
          current,
          table: block.table,
          fonts,
          contentWidth,
          bodyBottom,
          addPage,
          headerTitle,
        });
        current.y -= 6;
        continue;
      }
      const layout = blockToLines(block, fonts, contentWidth);
      current.y -= layout.gapBefore;
      for (const line of layout.lines) {
        if (current.y - line.lineHeight < bodyBottom) {
          current = addPage(headerTitle, true);
          firstPart = false;
          current.y -= 4;
        }
        if (line.text) {
          const latinFont = line.latinFont || fonts.times;
          const lineWidth = measureMixedLine(line.text, line.font, latinFont, line.size);
          const x =
            line.align === "center"
              ? Math.max(MARGIN_X, (A4[0] - lineWidth) / 2)
              : MARGIN_X + line.indent;
          drawMixedLine(current.page, line.text, x, current.y - line.size, {
            cjkFont: line.font,
            latinFont,
            size: line.size,
            color: INK,
          });
        }
        current.y -= line.lineHeight;
      }
      current.y -= layout.gapAfter;
    }

    // If the first page had no room for anything, keep it (not blank in layout).
    if (!firstPart) {
      // Continuation pages were already created with their own header.
    }
  }

  return pdf.save();
}
