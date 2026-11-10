import assert from "node:assert/strict";
import test from "node:test";
import { matchFigureRegions, reconstructTables } from "../src/reader/pdf-access.js";

function line(text, y, items, height = 10) {
  return { text, y, height, items };
}

function item(text, x, width) {
  return { text, x, width };
}

test("figure fallback stops at nearby body text instead of page top", () => {
  const caption = line("Fig. 2: Architecture", 110, [item("Fig. 2: Architecture", 55, 170)]);
  const body = line(
    "This is the next full line of body text above the figure and must not be captured.",
    430,
    [item("This is the next full line of body text above the figure and must not be captured.", 55, 490)],
  );
  const [figure] = matchFigureRegions({
    captions: [caption],
    rects: [],
    lines: [body, caption],
    view: [0, 0, 612, 792],
  });
  assert.ok(figure);
  assert.ok(figure.rect.y1 > 115);
  assert.ok(figure.rect.y2 < body.y);
  assert.ok(figure.rect.y2 < 500);
});

test("real PDF image boxes are preferred and associated with their caption", () => {
  const caption = line("Figure 1. Result", 90, [item("Figure 1. Result", 60, 150)]);
  const [figure] = matchFigureRegions({
    captions: [caption],
    rects: [{ x1: 70, y1: 130, x2: 290, y2: 330 }],
    lines: [caption],
    view: [0, 0, 612, 792],
  });
  assert.equal(figure.caption, "Figure 1. Result");
  assert.ok(figure.rect.x1 >= 60 && figure.rect.x1 < 70);
  assert.ok(figure.rect.y2 > 330);
});

test("table rows around a table caption become explicit Markdown", () => {
  const lines = [
    line("Table 1: Results", 500, [item("Table 1: Results", 50, 130)]),
    line("Method Score", 480, [item("Method", 55, 50), item("Score", 260, 40)]),
    line("Base 88.0", 460, [item("Base", 55, 35), item("88.0", 260, 30)]),
    line("Ours 91.2", 440, [item("Ours", 55, 35), item("91.2", 260, 30)]),
    line("Normal prose continues here.", 410, [item("Normal prose continues here.", 55, 210)]),
  ];
  const rebuilt = reconstructTables(lines);
  assert.equal(rebuilt.length, 3);
  assert.match(rebuilt[1].text, /^\[表格\]/);
  assert.match(rebuilt[1].text, /\| Method \| Score \|/);
  assert.match(rebuilt[1].text, /\| Ours \| 91\.2 \|/);
});

