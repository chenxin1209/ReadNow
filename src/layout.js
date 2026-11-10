import { clamp } from "./util.js";

/** @typedef {{x:number,y:number,width:number,height:number}} Rect */

export function normalizeRect(rect) {
  if (!rect) return null;
  const x = Number(rect.x ?? rect.left ?? 0);
  const y = Number(rect.y ?? rect.top ?? 0);
  const width = Number(rect.width ?? (rect.right != null ? rect.right - x : 0));
  const height = Number(rect.height ?? (rect.bottom != null ? rect.bottom - y : 0));
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

export function fromDomRect(rect) {
  if (!rect) return null;
  return normalizeRect({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

export function right(rect) {
  return rect.x + rect.width;
}

export function bottom(rect) {
  return rect.y + rect.height;
}

export function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function intersectionArea(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const rightEdge = Math.min(right(a), right(b));
  const bottomEdge = Math.min(bottom(a), bottom(b));
  if (rightEdge <= left || bottomEdge <= top) return 0;
  return (rightEdge - left) * (bottomEdge - top);
}

export function area(rect) {
  return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0;
}

export function unionRects(rects) {
  const valid = (rects || []).map(normalizeRect).filter(Boolean);
  if (!valid.length) return null;
  const x = Math.min(...valid.map((r) => r.x));
  const y = Math.min(...valid.map((r) => r.y));
  const x2 = Math.max(...valid.map(right));
  const y2 = Math.max(...valid.map(bottom));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function clampRect(rect, viewport) {
  const width = Math.min(rect.width, viewport.width);
  const height = Math.min(rect.height, viewport.height);
  const x = clamp(rect.x, viewport.x, viewport.x + viewport.width - width);
  const y = clamp(rect.y, viewport.y, viewport.y + viewport.height - height);
  return { x, y, width, height };
}

export function rectContainsPoint(rect, point) {
  return (
    rect &&
    point &&
    point.x >= rect.x &&
    point.x <= right(rect) &&
    point.y >= rect.y &&
    point.y <= bottom(rect)
  );
}

function distanceBetweenRects(a, b) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function candidate(label, x, y, size) {
  return { label, x, y, width: size.width, height: size.height };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const output = [];
  for (const item of candidates) {
    if (!item) continue;
    const key = `${Math.round(item.x / 4)}:${Math.round(item.y / 4)}:${Math.round(item.width)}:${Math.round(item.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function scoreCandidate(rect, context) {
  const {
    anchor,
    viewport,
    occupied,
    contentRects,
    pageRect,
    cardArea,
    preferNear,
  } = context;

  let score = 0;
  const reasons = [];

  const occupiedOverlap = occupied.reduce((sum, other) => sum + intersectionArea(rect, other), 0);
  if (occupiedOverlap > 0) {
    score += (occupiedOverlap / cardArea) * 1400;
    reasons.push("occupied");
  }

  const anchorOverlap = intersectionArea(rect, anchor);
  if (anchorOverlap > 0) {
    score += (anchorOverlap / Math.max(area(anchor), 1)) * 120;
    reasons.push("anchor");
  }

  let contentOverlap = 0;
  for (const block of contentRects) {
    contentOverlap += intersectionArea(rect, block);
  }
  if (contentOverlap > 0) {
    // Overlapping body text is allowed but should be strongly minimized:
    // a nearby card that hides a sentence is worse than a slightly farther
    // card in a genuine margin.
    score += Math.min(contentOverlap / cardArea, 1) * 52;
    reasons.push("text");
  }

  const anchorCenter = center(anchor);
  const rectCenter = center(rect);
  const distance = Math.hypot(anchorCenter.x - rectCenter.x, anchorCenter.y - rectCenter.y);
  const maxDistance = Math.hypot(viewport.width, viewport.height) || 1;
  score += (distance / maxDistance) * (preferNear ? 9 : 5);
  reasons.push("distance");

  // Prefer a small breathing gap from the selection, not flush against it.
  if (intersectionArea(rect, anchor) === 0) {
    const gapX = Math.max(rect.x - right(anchor), anchor.x - right(rect), 0);
    const gapY = Math.max(rect.y - bottom(anchor), anchor.y - bottom(rect), 0);
    const gap = Math.max(gapX, gapY);
    if (gap > 72) score += Math.min((gap - 72) / 18, 18);
    if (gap < 8) score += 4;
  }

  // A card floating in the reader margin is better than one sitting on the
  // page. This matters when the PDF text layer isn't available yet.
  if (pageRect) {
    const pageOverlap = intersectionArea(rect, pageRect) / cardArea;
    score += pageOverlap * 8;
    if (pageOverlap < 0.15) score += 0.6;
  }

  // Massive cards should not be glued to an edge.
  const edge = 8;
  if (
    rect.x <= viewport.x + edge ||
    rect.y <= viewport.y + edge ||
    right(rect) >= viewport.x + viewport.width - edge ||
    bottom(rect) >= viewport.y + viewport.height - edge
  ) {
    score += 0.8;
  }

  return { score, reasons };
}

/**
 * Pick a spot for an anchored Q&A card. Lower score is better. The scorer
 * deliberately balances four goals: stay near the quote, avoid covering body
 * text, avoid other cards, and stay inside the visible reader area.
 */
export function findBestCardPosition({
  anchor,
  viewport,
  size,
  occupied = [],
  contentRects = [],
  pageRect = null,
  gap = 14,
  margin = 8,
  gridStep = 30,
  preferNear = true,
}) {
  const anchorRect = normalizeRect(anchor);
  const viewRect = normalizeRect(viewport);
  if (!anchorRect || !viewRect) {
    return { x: viewRect?.x || 0, y: viewRect?.y || 0, width: size?.width || 360, height: size?.height || 480, score: Infinity, reason: "fallback" };
  }

  const width = Math.min(Math.max(1, Number(size?.width) || 400), viewRect.width - margin * 2);
  const height = Math.min(Math.max(1, Number(size?.height) || 480), viewRect.height - margin * 2);
  const box = { width, height };
  const usable = {
    x: viewRect.x + margin,
    y: viewRect.y + margin,
    width: Math.max(1, viewRect.width - margin * 2),
    height: Math.max(1, viewRect.height - margin * 2),
  };

  const rightOfAnchor = right(anchorRect) + gap;
  const leftOfAnchor = anchorRect.x - width - gap;
  const belowAnchor = bottom(anchorRect) + gap;
  const aboveAnchor = anchorRect.y - height - gap;

  const candidates = [
    candidate("right", rightOfAnchor, anchorRect.y, box),
    candidate("left", leftOfAnchor, anchorRect.y, box),
    candidate("below", anchorRect.x, belowAnchor, box),
    candidate("above", anchorRect.x, aboveAnchor, box),
    candidate("below-right", rightOfAnchor, belowAnchor, box),
    candidate("above-right", rightOfAnchor, aboveAnchor, box),
    candidate("below-left", leftOfAnchor, belowAnchor, box),
    candidate("above-left", leftOfAnchor, aboveAnchor, box),
    candidate("top-right", usable.x + usable.width - width, usable.y, box),
    candidate("bottom-right", usable.x + usable.width - width, usable.y + usable.height - height, box),
    candidate("top-left", usable.x, usable.y, box),
    candidate("bottom-left", usable.x, usable.y + usable.height - height, box),
  ];

  if (pageRect) {
    const page = normalizeRect(pageRect);
    if (page) {
      candidates.push(
        candidate("page-right", right(page) + gap, Math.max(usable.y, anchorRect.y - 20), box),
        candidate("page-left", page.x - width - gap, Math.max(usable.y, anchorRect.y - 20), box),
        candidate("page-bottom", anchorRect.x, bottom(page) + gap, box),
      );
    }
  }

  // A coarse grid finds genuine whitespace that the hand-picked spots miss,
  // for example a wide blank column in a two-column paper.
  for (let y = usable.y; y <= usable.y + usable.height - height; y += gridStep) {
    for (let x = usable.x; x <= usable.x + usable.width - width; x += gridStep) {
      if (!preferNear) {
        candidates.push(candidate("grid", x, y, box));
        continue;
      }
      const dx = Math.abs(x + width / 2 - (anchorRect.x + anchorRect.width / 2));
      const dy = Math.abs(y + height / 2 - (anchorRect.y + anchorRect.height / 2));
      if (dx < width * 1.7 && dy < height * 1.4) {
        candidates.push(candidate("grid-near", x, y, box));
      }
    }
  }

  const unique = dedupeCandidates(candidates);
  let best = null;
  for (const item of unique) {
    const rect = clampRect(item, usable);
    const { score, reasons } = scoreCandidate(rect, {
      anchor: anchorRect,
      viewport: viewRect,
      occupied: occupied.map(normalizeRect).filter(Boolean),
      contentRects: contentRects.map(normalizeRect).filter(Boolean),
      pageRect: normalizeRect(pageRect),
      cardArea: area(rect),
      preferNear,
    });
    if (!best || score < best.score) {
      best = { ...rect, score, reason: item.label, reasons };
    }
  }

  if (!best) {
    best = { ...clampRect({ x: rightOfAnchor, y: anchorRect.y, ...box }, usable), score: Infinity, reason: "fallback" };
  }
  return best;
}

/**
 * Convert a Zotero/PDF annotation rect ([x1, y1, x2, y2], origin bottom-left)
 * into viewport coordinates using a PDFPageView's DOM rect and viewport.
 */
export function mapPdfRectToScreen(rect, pageDomRect, pageViewport) {
  if (!Array.isArray(rect) || rect.length < 4 || !pageDomRect || !pageViewport) return null;
  const [rawX1, rawY1, rawX2, rawY2] = rect.map(Number);
  if (![rawX1, rawY1, rawX2, rawY2].every(Number.isFinite)) return null;
  const x1 = Math.min(rawX1, rawX2);
  const x2 = Math.max(rawX1, rawX2);
  const y1 = Math.min(rawY1, rawY2);
  const y2 = Math.max(rawY1, rawY2);

  const scale = Number(pageViewport.scale) || 1;
  const pageHeightPoints =
    Number(pageViewport.height) > 0 && scale > 0
      ? Number(pageViewport.height) / scale
      : Number(pageDomRect.height) / scale;
  const pageWidthPoints =
    Number(pageViewport.width) > 0 && scale > 0
      ? Number(pageViewport.width) / scale
      : Number(pageDomRect.width) / scale;

  const width = Number(pageDomRect.width);
  const height = Number(pageDomRect.height);
  const scaleX = pageWidthPoints > 0 ? width / pageWidthPoints : scale;
  const scaleY = pageHeightPoints > 0 ? height / pageHeightPoints : scale;
  const pageLeft = Number(pageDomRect.left ?? pageDomRect.x);
  const pageTop = Number(pageDomRect.top ?? pageDomRect.y);

  const left = pageLeft + x1 * scaleX;
  const top = pageTop + (pageHeightPoints - y2) * scaleY;
  const outWidth = Math.max(1, (x2 - x1) * scaleX);
  const outHeight = Math.max(1, (y2 - y1) * scaleY);

  return { x: left, y: top, width: outWidth, height: outHeight };
}

export function rectsFromPosition(position) {
  return Array.isArray(position?.rects) ? position.rects : [];
}

export function isRectVisible(rect, viewport, threshold = 0.08) {
  const r = normalizeRect(rect);
  const v = normalizeRect(viewport);
  if (!r || !v) return false;
  return intersectionArea(r, v) / area(r) >= threshold;
}
