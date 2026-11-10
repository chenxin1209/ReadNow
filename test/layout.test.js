import assert from "node:assert/strict";
import test from "node:test";
import {
  findBestCardPosition,
  intersectionArea,
  isRectVisible,
  mapPdfRectToScreen,
  unionRects,
} from "../src/layout.js";

test("intersectionArea handles disjoint and overlapping rects", () => {
  assert.equal(
    intersectionArea(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 4, height: 4 },
    ),
    0,
  );
  assert.equal(
    intersectionArea(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 },
    ),
    25,
  );
});

test("unionRects covers all selection rectangles", () => {
  assert.deepEqual(
    unionRects([
      { x: 10, y: 20, width: 30, height: 5 },
      { x: 12, y: 30, width: 40, height: 5 },
    ]),
    { x: 10, y: 20, width: 42, height: 15 },
  );
});

test("findBestCardPosition stays inside viewport and avoids occupied cards", () => {
  const viewport = { x: 0, y: 0, width: 1000, height: 800 };
  const anchor = { x: 180, y: 200, width: 240, height: 18 };
  const occupied = [{ x: 430, y: 180, width: 360, height: 520 }];
  const result = findBestCardPosition({
    anchor,
    viewport,
    size: { width: 360, height: 480 },
    occupied,
  });
  assert.ok(result.x >= 0 && result.y >= 0);
  assert.ok(result.x + result.width <= viewport.width + 1);
  assert.ok(result.y + result.height <= viewport.height + 1);
  assert.equal(intersectionArea(result, occupied[0]), 0);
  assert.equal(intersectionArea(result, anchor), 0);
});

test("findBestCardPosition prefers whitespace over body text", () => {
  const viewport = { x: 0, y: 0, width: 1100, height: 700 };
  const anchor = { x: 260, y: 300, width: 250, height: 18 };
  const textBlock = [{ x: 40, y: 80, width: 560, height: 560 }];
  const result = findBestCardPosition({
    anchor,
    viewport,
    size: { width: 330, height: 380 },
    contentRects: textBlock,
  });
  const overlap = textBlock.reduce((sum, rect) => sum + intersectionArea(result, rect), 0);
  assert.equal(overlap, 0);
  assert.ok(result.x > 600);
});

test("mapPdfRectToScreen maps bottom-left PDF coordinates", () => {
  const pageRect = { left: 100, top: 50, width: 612, height: 792 };
  const viewport = { width: 612, height: 792, scale: 1 };
  const result = mapPdfRectToScreen([100, 700, 300, 720], pageRect, viewport);
  assert.ok(result);
  assert.equal(Math.round(result.x), 200);
  assert.equal(Math.round(result.y), 122);
  assert.equal(Math.round(result.width), 200);
  assert.equal(Math.round(result.height), 20);
});

test("isRectVisible uses an overlap threshold", () => {
  const viewport = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(isRectVisible({ x: 99, y: 0, width: 20, height: 20 }, viewport), false);
  assert.equal(isRectVisible({ x: 80, y: 0, width: 20, height: 20 }, viewport), true);
});
