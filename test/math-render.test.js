import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTex, renderTexToString } from "../src/math-render.js";

test("normalizes common full-LaTeX environments and unbalanced groups", () => {
  const normalized = normalizeTex(
    "\\begin{equation} \\bm{x} = \\textnormal{softmax}(y_{i} \\label{eq:x} \\end{equation}",
  );
  assert.match(normalized, /\\begin\{aligned\}/);
  assert.match(normalized, /\\end\{aligned\}/);
  assert.doesNotMatch(normalized, /\\label/);
  assert.equal((normalized.match(/\{/g) || []).length, (normalized.match(/\}/g) || []).length);
});

test("tolerant KaTeX rendering keeps an unknown command visible", () => {
  const html = renderTexToString("x + \\unknowncommand{y}", false, { tolerant: true });
  assert.match(html, /katex/);
  assert.match(html, /unknowncommand/);
});

test("strict KaTeX rendering accepts configured paper macros", () => {
  const html = renderTexToString("\\bm{x} = \\argmax_i p_i", false);
  assert.match(html, /katex/);
  assert.doesNotMatch(html, /katex-error/);
});
