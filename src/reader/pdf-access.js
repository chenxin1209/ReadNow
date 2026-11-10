import { normalizeWhitespace, truncate } from "../util.js";

function unwrap(value) {
  try {
    return value?.wrappedJSObject || value;
  } catch {
    return value;
  }
}

export function getInternalReader(reader) {
  return reader?._internalReader || null;
}

export function getPdfWindow(reader) {
  const internal = getInternalReader(reader);
  const view = internal?._primaryView;
  if (!view) return null;
  return unwrap(view._iframeWindow) || null;
}

export function getPdfViewerApplication(reader) {
  const win = getPdfWindow(reader);
  if (!win) return null;
  return unwrap(win.PDFViewerApplication) || null;
}

export function getPdfDocument(reader) {
  const app = getPdfViewerApplication(reader);
  return app?.pdfDocument || app?.pdfViewer?.pdfDocument || null;
}

export function getPageCount(reader) {
  const app = getPdfViewerApplication(reader);
  return Number(app?.pdfDocument?.numPages || app?.pdfViewer?.pagesCount || 0);
}

export function getCurrentPageIndex(reader) {
  try {
    const internal = getInternalReader(reader);
    const state = internal?._state || internal?.state;
    const index = state?.primaryViewStats?.pageIndex;
    return Number.isFinite(Number(index)) ? Number(index) : 0;
  } catch {
    return 0;
  }
}

export function getCurrentPageLabel(reader) {
  try {
    const internal = getInternalReader(reader);
    const state = internal?._state || internal?.state;
    return state?.primaryViewStats?.pageLabel || "";
  } catch {
    return "";
  }
}

export function getPageView(reader, pageIndex) {
  const app = getPdfViewerApplication(reader);
  const viewer = app?.pdfViewer;
  if (!viewer) return null;
  try {
    return viewer.getPageView?.(pageIndex) || viewer._pages?.[pageIndex] || null;
  } catch {
    return null;
  }
}

export function getFrameOffset(reader) {
  const win = getPdfWindow(reader);
  try {
    const frame = win?.frameElement;
    const rect = frame?.getBoundingClientRect?.();
    if (rect) return { x: rect.left, y: rect.top };
  } catch {
    // Fall through.
  }
  return { x: 0, y: 0 };
}

export function getPageScreenRect(reader, pageIndex) {
  const pageView = getPageView(reader, pageIndex);
  const pageViewObject = unwrap(pageView);
  const div = pageViewObject?.div || pageView?.div;
  if (!div) return null;
  try {
    const rect = div.getBoundingClientRect();
    const offset = getFrameOffset(reader);
    return {
      x: offset.x + rect.left,
      y: offset.y + rect.top,
      width: rect.width,
      height: rect.height,
    };
  } catch {
    return null;
  }
}

export function getPageViewport(reader, pageIndex) {
  const pageView = getPageView(reader, pageIndex);
  const pageViewObject = unwrap(pageView);
  const viewport = pageViewObject?.viewport || pageView?.viewport;
  if (!viewport) return null;
  return {
    width: Number(viewport.width) || 0,
    height: Number(viewport.height) || 0,
    scale: Number(viewport.scale) || 1,
    rotation: Number(viewport.rotation) || 0,
  };
}

function cropCanvasRegion(canvas, viewport, rect, doc) {
  try {
    if (!canvas || !viewport?.convertToViewportPoint || !doc) return null;
    const [x1, y1] = viewport.convertToViewportPoint(rect.x1, rect.y2);
    const [x2, y2] = viewport.convertToViewportPoint(rect.x2, rect.y1);
    const left = Math.max(0, Math.min(x1, x2) - 2);
    const top = Math.max(0, Math.min(y1, y2) - 2);
    const width = Math.min(viewport.width - left, Math.abs(x2 - x1) + 4);
    const height = Math.min(viewport.height - top, Math.abs(y2 - y1) + 4);
    const scaleX = canvas.width / Math.max(1, viewport.width);
    const scaleY = canvas.height / Math.max(1, viewport.height);
    const sourceX = left * scaleX;
    const sourceY = top * scaleY;
    const sourceWidth = width * scaleX;
    const sourceHeight = height * scaleY;
    if (sourceWidth < 8 || sourceHeight < 8) return null;
    const output = doc.createElement("canvas");
    output.width = Math.max(1, Math.round(sourceWidth));
    output.height = Math.max(1, Math.round(sourceHeight));
    const context = output.getContext("2d");
    if (!context) return null;
    context.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      output.width,
      output.height,
    );
    return output.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Capture from the visible PDF.js canvas when possible. If Zotero has already
 * recycled that canvas (common just after a page turn), render the PDF page to
 * a small off-screen canvas instead of silently dropping the figure.
 */
export async function capturePageRegion(reader, pageIndex, rect, doc) {
  const pageView = unwrap(getPageView(reader, pageIndex));
  const visible = cropCanvasRegion(pageView?.canvas, pageView?.viewport, rect, doc);
  if (visible) return visible;

  try {
    const pdf = getPdfDocument(reader);
    if (!pdf?.getPage || !doc) return null;
    const page = unwrap(await pdf.getPage(pageIndex + 1));
    if (!page?.getViewport || !page?.render) return null;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(1.25, Math.min(2.25, 1800 / Math.max(base.width, base.height, 1)));
    const viewport = page.getViewport({ scale });
    const canvas = doc.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    const task = page.render({ canvasContext: context, viewport, intent: "display" });
    await (task?.promise || task);
    return cropCanvasRegion(canvas, viewport, rect, doc);
  } catch {
    return null;
  }
}

export function getReaderArea(reader) {
  const doc = reader?._iframeWindow?.document;
  if (!doc) return null;
  const split = doc.getElementById("split-view") || doc.querySelector(".split-view");
  if (split) {
    const rect = split.getBoundingClientRect();
    if (rect.width > 120 && rect.height > 120) {
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
  }
  return {
    x: 0,
    y: 0,
    width: doc.documentElement.clientWidth,
    height: doc.documentElement.clientHeight,
  };
}

function itemText(item) {
  return String(item?.str ?? "");
}

function groupTextItems(items) {
  const valid = items
    .filter((item) => item && typeof item.str === "string" && item.str.length)
    .map((item) => {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const x = Number(transform[4]) || 0;
      const y = Number(transform[5]) || 0;
      return {
        text: item.str,
        x,
        y,
        width: Number(item.width) || 0,
        height: Number(item.height) || Math.abs(Number(transform[3])) || 10,
        hasEOL: Boolean(item.hasEOL),
      };
    });
  if (!valid.length) return [];

  const lines = [];
  let current = null;
  for (const item of valid.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2, Math.min(item.height, current?.height || item.height) * 0.45);
    if (!current || Math.abs(current.y - item.y) > tolerance) {
      current = { y: item.y, height: item.height, items: [item] };
      lines.push(current);
    } else {
      current.items.push(item);
      current.height = Math.max(current.height, item.height);
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const items = line.items.sort((a, b) => a.x - b.x);
      let output = "";
      let previous = null;
      for (const item of items) {
        if (previous) {
          const gap = item.x - (previous.x + previous.width);
          const averageChar = item.width / Math.max(1, item.text.length);
          if (gap > Math.max(1.5, averageChar * 0.35)) output += " ";
        }
        output += item.text;
        previous = item;
      }
      return { text: output, y: line.y, height: line.height, items };
    });
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}

function lineTableCells(line) {
  const items = [...(line?.items || [])].sort((a, b) => a.x - b.x);
  if (!items.length) return [];
  if (items.length === 1) {
    return items[0].text.split(/\t+|\s{3,}/).map((cell) => cell.trim()).filter(Boolean);
  }
  const charWidths = items
    .filter((item) => item.text.trim())
    .map((item) => item.width / Math.max(1, item.text.trim().length));
  const threshold = Math.max(8, (line.height || 10) * 0.72, median(charWidths) * 2.4);
  const cells = [];
  let current = "";
  let previous = null;
  for (const item of items) {
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    if (previous && gap > threshold) {
      if (current.trim()) cells.push(current.trim());
      current = item.text;
    } else {
      const wordGap = previous && gap > Math.max(1.5, median(charWidths) * 0.3) ? " " : "";
      current += `${wordGap}${item.text}`;
    }
    previous = item;
  }
  if (current.trim()) cells.push(current.trim());
  return cells;
}

function markdownTable(rows) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  if (columnCount < 2) return "";
  const escape = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const normalized = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, columnCount - row.length)).fill(""),
  ]);
  const render = (row) => `| ${row.map(escape).join(" | ")} |`;
  return [
    "[表格]",
    render(normalized[0]),
    render(Array(columnCount).fill("---")),
    ...normalized.slice(1).map(render),
  ].join("\n");
}

/**
 * Recover simple PDF tables from repeated horizontal cell gaps around a table
 * caption. The marker gives the translator an explicit, lossless structure.
 */
export function reconstructTables(lines) {
  const output = [...lines];
  const consumed = new Set();
  const replacements = new Map();
  const captionIndexes = output
    .map((line, index) => (TABLE_CAPTION_RE.test(line.text.trim()) ? index : -1))
    .filter((index) => index >= 0);

  const collect = (captionIndex, step) => {
    const entries = [];
    let previous = output[captionIndex];
    for (
      let index = captionIndex + step, seen = 0;
      index >= 0 && index < output.length && seen < 18;
      index += step, seen += 1
    ) {
      const line = output[index];
      const gap = Math.abs(previous.y - line.y);
      if (gap > Math.max(30, (previous.height + line.height) * 2.4)) break;
      const cells = lineTableCells(line);
      if (cells.length < 2 || cells.length > 12) break;
      entries.push({ index, cells });
      previous = line;
    }
    if (step < 0) entries.reverse();
    return entries;
  };

  for (const captionIndex of captionIndexes) {
    const before = collect(captionIndex, -1);
    const after = collect(captionIndex, 1);
    const run = before.length >= after.length ? before : after;
    if (run.length < 2) continue;
    const commonColumns = median(run.map((entry) => entry.cells.length));
    const stableRows = run.filter((entry) => Math.abs(entry.cells.length - commonColumns) <= 1);
    if (stableRows.length < 2) continue;
    const table = markdownTable(stableRows.map((entry) => entry.cells));
    if (!table) continue;
    const start = Math.min(...stableRows.map((entry) => entry.index));
    replacements.set(start, table);
    stableRows.forEach((entry) => consumed.add(entry.index));
  }

  return output.flatMap((line, index) => {
    const replacement = replacements.get(index);
    if (replacement) return [{ ...line, text: replacement, isReconstructedTable: true }];
    return consumed.has(index) ? [] : [line];
  });
}

function dehyphenate(text) {
  return String(text)
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
    .replace(/([A-Za-z])-\s*\n\s*([a-z])/g, "$1$2");
}

function multiplyMatrix(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMatrix(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

const FALLBACK_OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintJpegXObject: 82,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
};

async function getPageImageRects(reader, pageObject, { includeVector = false } = {}) {
  try {
    const win = getPdfWindow(reader);
    const OPS =
      win?.pdfjsLib?.OPS ||
      win?.PDFViewerApplication?.pdfjsLib?.OPS ||
      FALLBACK_OPS;
    if (typeof pageObject?.getOperatorList !== "function") return [];
    const ops = await pageObject.getOperatorList();
    const fnArray = ops?.fnArray || [];
    const argsArray = ops?.argsArray || [];
    const imageOps = new Set(
      [
        OPS.paintImageXObject,
        OPS.paintJpegXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
      ].filter((value) => value !== undefined),
    );
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const rects = [];
    const pageView = pageObject.view || [0, 0, 612, 792];
    const pageArea = Math.max(1, (pageView[2] - pageView[0]) * (pageView[3] - pageView[1]));
    const pathOps = new Set([13, 14, 15, 16, 17, 18, 19]);
    const paintOps = new Set([20, 21, 22, 23, 24, 25, 26, 27, 94]);
    let pathBox = null;
    const addBox = (box) => {
      if (!box) return;
      const width = Math.max(0, box.x2 - box.x1);
      const height = Math.max(0, box.y2 - box.y1);
      const area = width * height;
      if (area > pageArea * 0.01 && area < pageArea * 0.8) rects.push(box);
    };
    const includePoint = (x, y) => {
      const point = applyMatrix(ctm, Number(x) || 0, Number(y) || 0);
      if (!pathBox) {
        pathBox = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      } else {
        pathBox.x1 = Math.min(pathBox.x1, point.x);
        pathBox.y1 = Math.min(pathBox.y1, point.y);
        pathBox.x2 = Math.max(pathBox.x2, point.x);
        pathBox.y2 = Math.max(pathBox.y2, point.y);
      }
    };

    for (let index = 0; index < fnArray.length; index += 1) {
      const fn = fnArray[index];
      if (includeVector && pathOps.has(fn)) {
        const args = argsArray[index] || [];
        if (fn === 19) {
          const [x, y, width, height] = args.map(Number);
          includePoint(x, y);
          includePoint(x + width, y + height);
        } else if (fn !== 18) {
          for (let offset = 0; offset + 1 < args.length; offset += 2) {
            includePoint(args[offset], args[offset + 1]);
          }
        }
      } else if (includeVector && fn === 91) {
        const minMax = argsArray[index]?.[2];
        if (Array.isArray(minMax) && minMax.length === 4) {
          includePoint(minMax[0], minMax[1]);
          includePoint(minMax[2], minMax[3]);
        }
      } else if (includeVector && fn === 74) {
        const matrix = argsArray[index]?.[0];
        const bbox = argsArray[index]?.[1];
        if (Array.isArray(matrix) && matrix.length === 6 && Array.isArray(bbox) && bbox.length === 4) {
          const formMatrix = multiplyMatrix(ctm, matrix.map(Number));
          const points = [
            applyMatrix(formMatrix, bbox[0], bbox[1]),
            applyMatrix(formMatrix, bbox[2], bbox[1]),
            applyMatrix(formMatrix, bbox[0], bbox[3]),
            applyMatrix(formMatrix, bbox[2], bbox[3]),
          ];
          addBox({
            x1: Math.min(...points.map((point) => point.x)),
            y1: Math.min(...points.map((point) => point.y)),
            x2: Math.max(...points.map((point) => point.x)),
            y2: Math.max(...points.map((point) => point.y)),
          });
        }
      } else if (includeVector && paintOps.has(fn)) {
        addBox(pathBox);
        pathBox = null;
      } else if (includeVector && fn === 28) {
        pathBox = null;
      } else if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        const matrix = argsArray[index];
        if (Array.isArray(matrix) && matrix.length === 6) {
          ctm = multiplyMatrix(ctm, matrix.map(Number));
        }
      } else if (imageOps.has(fn)) {
        const corners = [
          applyMatrix(ctm, 0, 0),
          applyMatrix(ctm, 1, 0),
          applyMatrix(ctm, 0, 1),
          applyMatrix(ctm, 1, 1),
        ];
        const xs = corners.map((point) => point.x);
        const ys = corners.map((point) => point.y);
        const rect = {
          x1: Math.min(...xs),
          y1: Math.min(...ys),
          x2: Math.max(...xs),
          y2: Math.max(...ys),
        };
        const area = Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1);
        // Ignore full-page backgrounds and tiny image masks.
        if (area > pageArea * 0.01 && area < pageArea * 0.8) rects.push(rect);
      }
    }
    const merged = [];
    for (const rect of rects.sort(
      (a, b) =>
        (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1),
    )) {
      const area = Math.max(1, (rect.x2 - rect.x1) * (rect.y2 - rect.y1));
      const overlap = merged.some((other) => {
        const width = Math.max(
          0,
          Math.min(rect.x2, other.x2) - Math.max(rect.x1, other.x1),
        );
        const height = Math.max(
          0,
          Math.min(rect.y2, other.y2) - Math.max(rect.y1, other.y1),
        );
        return (width * height) / area > 0.7;
      });
      if (!overlap) merged.push(rect);
    }
    return merged;
  } catch {
    return [];
  }
}

const FIGURE_CAPTION_RE =
  /^(?:(?:fig(?:ure)?\.?|图)\s*(?:s?\d+[a-z]?|[ivxlcdm]+|[一二三四五六七八九十百]+))(?:\s*[-–—.:：、]|\s|$)/i;

const TABLE_CAPTION_RE =
  /^(?:(?:table|tab\.?|表)\s*(?:s?\d+[a-z]?|[ivxlcdm]+|[一二三四五六七八九十百]+))(?:\s*[-–—.:：、]|\s|$)/i;

function lineBounds(line) {
  const items = line?.items || [];
  if (!items.length) return null;
  return {
    x1: Math.min(...items.map((item) => item.x)),
    y1: line.y,
    x2: Math.max(...items.map((item) => item.x + item.width)),
    y2: line.y + (line.height || 10),
  };
}

function overlap1d(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function clampPdfRect(rect, view) {
  const x1 = Math.max(view[0], Math.min(view[2], rect.x1));
  const y1 = Math.max(view[1], Math.min(view[3], rect.y1));
  const x2 = Math.max(x1, Math.max(view[0], Math.min(view[2], rect.x2)));
  const y2 = Math.max(y1, Math.max(view[1], Math.min(view[3], rect.y2)));
  return { x1, y1, x2, y2 };
}

function inferCaptionColumn(caption, view) {
  const pageWidth = view[2] - view[0];
  const middle = view[0] + pageWidth / 2;
  const bounds = lineBounds(caption) || { x1: view[0], x2: view[2] };
  const margin = Math.max(10, pageWidth * 0.025);
  if (bounds.x2 < middle + pageWidth * 0.035 && bounds.x1 < middle - pageWidth * 0.08) {
    return { x1: view[0] + margin, x2: middle - margin * 0.45 };
  }
  if (bounds.x1 > middle - pageWidth * 0.035 && bounds.x2 > middle + pageWidth * 0.08) {
    return { x1: middle + margin * 0.45, x2: view[2] - margin };
  }
  return { x1: view[0] + margin, x2: view[2] - margin };
}

function isLikelyBodyLine(line, column) {
  if (!line || FIGURE_CAPTION_RE.test(line.text.trim()) || TABLE_CAPTION_RE.test(line.text.trim())) {
    return false;
  }
  const bounds = lineBounds(line);
  if (!bounds) return false;
  const span = overlap1d(bounds.x1, bounds.x2, column.x1, column.x2);
  const columnWidth = Math.max(1, column.x2 - column.x1);
  return (
    (line.text.trim().length >= 45 && span > columnWidth * 0.42) ||
    ((line.items?.length || 0) >= 8 && span > columnWidth * 0.58)
  );
}

function fallbackFigureRect(caption, lines, captions, view) {
  const bounds = lineBounds(caption);
  if (!bounds) return null;
  const column = inferCaptionColumn(caption, view);
  const pageHeight = view[3] - view[1];
  const lower = bounds.y2 + Math.max(3, caption.height * 0.25);
  let upper = view[3] - Math.max(16, pageHeight * 0.025);

  const bodyAbove = lines
    .filter((line) => line.y > lower + 18 && isLikelyBodyLine(line, column))
    .filter((line) => {
      const candidate = lineBounds(line);
      return candidate && overlap1d(candidate.x1, candidate.x2, column.x1, column.x2) > 0;
    })
    .sort((a, b) => a.y - b.y)[0];
  if (bodyAbove) upper = Math.min(upper, bodyAbove.y - Math.max(5, bodyAbove.height * 0.4));

  const nextCaption = captions
    .filter((other) => other !== caption && other.y > caption.y + 24)
    .sort((a, b) => a.y - b.y)[0];
  if (nextCaption) upper = Math.min(upper, nextCaption.y - 8);
  upper = Math.min(upper, lower + pageHeight * 0.64);
  if (upper - lower < Math.max(38, pageHeight * 0.055)) return null;
  return clampPdfRect({ x1: column.x1, y1: lower, x2: column.x2, y2: upper }, view);
}

/** Associate real PDF image/vector boxes with figure captions. */
export function matchFigureRegions({ captions = [], rects = [], lines = [], view = [0, 0, 612, 792] }) {
  const pageHeight = Math.max(1, view[3] - view[1]);
  return captions.flatMap((caption, captionIndex) => {
    const captionBounds = lineBounds(caption);
    if (!captionBounds) return [];
    const column = inferCaptionColumn(caption, view);
    const candidates = rects
      .filter((rect) => {
        const horizontal = overlap1d(rect.x1, rect.x2, column.x1, column.x2);
        const gap = rect.y1 - captionBounds.y2;
        return horizontal > Math.min(18, (rect.x2 - rect.x1) * 0.18) && gap > -12 && gap < pageHeight * 0.62;
      })
      .sort((a, b) => {
        const gapA = Math.max(0, a.y1 - captionBounds.y2);
        const gapB = Math.max(0, b.y1 - captionBounds.y2);
        return gapA - gapB || (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1);
      });

    let region = null;
    if (candidates.length) {
      const primary = candidates[0];
      const related = candidates.filter((rect) => {
        const gapX = Math.max(primary.x1 - rect.x2, rect.x1 - primary.x2, 0);
        const gapY = Math.max(primary.y1 - rect.y2, rect.y1 - primary.y2, 0);
        return rect === primary || (gapX <= 18 && gapY <= 24);
      });
      region = {
        x1: Math.min(...related.map((rect) => rect.x1)) - 4,
        y1: Math.min(...related.map((rect) => rect.y1)) - 4,
        x2: Math.max(...related.map((rect) => rect.x2)) + 4,
        y2: Math.max(...related.map((rect) => rect.y2)) + 4,
      };
      region = clampPdfRect(region, view);
    } else {
      region = fallbackFigureRect(caption, lines, captions, view);
    }
    if (!region) return [];
    return [{
      rect: region,
      caption: caption.text.trim(),
      captionIndex,
    }];
  });
}

async function getFigureLayout(pageObject) {
  try {
    const page = unwrap(pageObject) || pageObject;
    const getTextContent = page?.getTextContent;
    if (typeof getTextContent !== "function") return [];
    const content = await getTextContent.call(page, {
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const lines = groupTextItems(content.items || []);
    const view = page.view || [0, 0, 612, 792];
    return {
      lines,
      captions: lines.filter((line) => FIGURE_CAPTION_RE.test(line.text.trim())),
      view,
    };
  } catch {
    return { lines: [], captions: [], view: pageObject?.view || [0, 0, 612, 792] };
  }
}

export async function getPageFigures(reader, pageIndex) {
  const pdf = getPdfDocument(reader);
  if (!pdf?.getPage) return [];
  const page = await pdf.getPage(pageIndex + 1);
  const pageObject = unwrap(page) || page;
  const rects = await getPageImageRects(reader, pageObject, { includeVector: true });
  const layout = await getFigureLayout(pageObject);
  return matchFigureRegions({ ...layout, rects });
}

export async function getPageFigureRects(reader, pageIndex) {
  return (await getPageFigures(reader, pageIndex)).map((figure) => figure.rect);
}

function isInsideImage(item, rects) {
  if (!rects.length) return false;
  const transform = item.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(transform[4]) || 0;
  const y = Number(transform[5]) || 0;
  const width = Number(item.width) || 0;
  const height = Number(item.height) || Math.abs(Number(transform[3])) || 10;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return rects.some(
    (rect) =>
      centerX >= rect.x1 - 2 &&
      centerX <= rect.x2 + 2 &&
      centerY >= rect.y1 - 2 &&
      centerY <= rect.y2 + 2,
  );
}

export async function extractPageText(reader, pageIndex) {
  const pdf = getPdfDocument(reader);
  if (!pdf?.getPage) throw new Error("当前阅读器没有可用的 PDF 文本层");
  const page = await pdf.getPage(pageIndex + 1);
  // PDF.js page proxies expose getTextContent() on the wrapped object in
  // Zotero 7/10, not on the Xray wrapper.
  const pageObject = unwrap(page);
  const getTextContent = pageObject?.getTextContent || page?.getTextContent;
  if (typeof getTextContent !== "function") {
    throw new Error("当前 PDF 页面没有可用的文本层");
  }
  const content = await getTextContent.call(pageObject || page, {
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  });
  const imageRects = await getPageImageRects(reader, pageObject || page);
  let filteredItems = (content.items || []).filter(
    (item) => !isInsideImage(item, imageRects),
  );
  let lines = groupTextItems(filteredItems);
  const figureCaptions = lines.filter((line) =>
    FIGURE_CAPTION_RE.test(line.text.trim()),
  );
  if (figureCaptions.length) {
    const vectorRects = await getPageImageRects(reader, pageObject || page, {
      includeVector: true,
    });
    const figureRects = [];
    const captionRects = [];
    const view = pageObject?.view || page?.view || [0, 0, 612, 792];
    for (const caption of figureCaptions) {
      const captionItems = caption.items || [];
      const left = Math.min(...captionItems.map((item) => item.x));
      const right = Math.max(...captionItems.map((item) => item.x + item.width));
      const candidates = vectorRects
        .filter(
          (rect) =>
            rect.y1 > caption.y - 20 &&
            rect.y1 - caption.y < 240 &&
            rect.x2 > left &&
            rect.x1 < right,
        )
        .sort((a, b) => a.y1 - b.y1);
      if (candidates[0]) figureRects.push(candidates[0]);
      const bottom = caption.y + (caption.height || 10) + 4;
      if (view[3] - 24 - bottom > 40) {
        captionRects.push({
          x1: view[0] + 12,
          y1: bottom,
          x2: view[2] - 12,
          y2: view[3] - 24,
        });
      }
    }
    if (figureRects.length) {
      filteredItems = filteredItems.filter(
        (item) => !isInsideImage(item, figureRects),
      );
    } else if (captionRects.length) {
      // The caption fallback region can contain some body text; only drop
      // short labels there, which is what figure text usually looks like.
      filteredItems = filteredItems.filter(
        (item) =>
          !(isInsideImage(item, captionRects) && item.str.trim().length < 80),
      );
    }
    if (figureRects.length || captionRects.length) {
      lines = groupTextItems(filteredItems);
    }
  }
  if (pageIndex > 0) {
    lines = lines.filter((line, index) => {
      if (index > 1) return true;
      const value = line.text.trim();
      if (/^\d{1,4}$/.test(value)) return false;
      return !(
        value.length < 160 &&
        /^(?:Published as|Proceedings of|Preprint|Under review|arXiv:|ICLR|NeurIPS|CVPR|ICCV|ECCV|ICML|AAAI|ACL|EMNLP|IEEE|ACM)\b/i.test(
          value,
        )
      );
    });
  }
  lines = reconstructTables(lines);
  const text = dehyphenate(
    normalizeWhitespace(
      lines
        .map((line) => line.text)
        .join("\n")
        .replace(/\s+\n/g, "\n"),
    ),
  );
  const pageView = getPageView(reader, pageIndex);
  return {
    text,
    pageIndex,
    pageLabel: pageView?.pageLabel || "",
    lineCount: lines.length,
    charCount: text.length,
  };
}

export function extractAllPageTexts(reader, onProgress) {
  const count = getPageCount(reader);
  if (!count) throw new Error("无法读取 PDF 页数");
  const results = [];
  return (async () => {
    for (let index = 0; index < count; index += 1) {
      results.push(await extractPageText(reader, index));
      onProgress?.(index + 1, count);
    }
    return results;
  })();
}

export function getVisibleTextRects(reader, pageIndex, limit = 700) {
  const pageView = getPageView(reader, pageIndex);
  const pageViewObject = unwrap(pageView);
  const div = pageViewObject?.div || pageView?.div;
  const textLayer = pageViewObject?.textLayer || pageView?.textLayer;
  if (!div) return [];
  let spans = [];
  try {
    spans = Array.from(
      textLayer?.textDivs || div.querySelectorAll(".textLayer span") || [],
    );
  } catch {
    return [];
  }
  const rects = [];
  const offset = getFrameOffset(reader);
  for (const span of spans) {
    if (rects.length >= limit) break;
    try {
      const rect = span.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || !span.textContent?.trim()) continue;
      rects.push({
        x: offset.x + rect.left,
        y: offset.y + rect.top,
        width: rect.width,
        height: rect.height,
      });
    } catch {
      // Ignore detached text spans.
    }
  }
  return rects;
}

export function getPaperInfo(reader) {
  try {
    const attachment = Zotero.Items.get(reader.itemID);
    const item = attachment?.parentItem || attachment;
    if (!item) return { title: "", authors: [], year: "", abstract: "" };
    const creators = item.getCreators?.() || [];
    const authors = creators
      .map((creator) => {
        if (creator.lastName || creator.firstName) {
          return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
        }
        return creator.name || "";
      })
      .filter(Boolean);
    const date = item.getField?.("date") || "";
    const year = (String(date).match(/\b(1[6-9]\d{2}|20\d{2})\b/) || [])[1] || "";
    return {
      title: item.getField?.("title") || attachment?.getField?.("title") || "未命名论文",
      authors,
      year,
      publication: item.getField?.("publicationTitle") || item.getField?.("proceedingsTitle") || "",
      abstract: truncate(item.getField?.("abstractNote") || "", 3000),
      itemKey: item.key || "",
    };
  } catch {
    return { title: "未命名论文", authors: [], year: "", abstract: "" };
  }
}

export function getAttachmentKey(reader) {
  try {
    return reader?._item?.key || Zotero.Items.get(reader.itemID)?.key || String(reader.itemID);
  } catch {
    return String(reader?.itemID || "unknown");
  }
}

export function getPageLabel(reader, pageIndex) {
  const pageView = getPageView(reader, pageIndex);
  // Never fall back to the currently visible page label: non-rendered pages
  // would all display the same number in a multi-page view.
  return pageView?.pageLabel || String(pageIndex + 1);
}
