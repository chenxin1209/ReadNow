import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageMessages,
  buildQaSystemMessage,
  buildSelectionMessages,
  chunkText,
  cleanModelText,
  pageTranslationCacheKey,
  protectMath,
  restoreMath,
  translationCacheKey,
} from "../src/translation.js";

test("chunkText keeps every character and respects the limit", () => {
  const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(40)}`).join(
    "\n\n",
  );
  const chunks = chunkText(text, 300);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 300));
  assert.equal(chunks.join("").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
});

test("cleanModelText removes fences and translation preambles", () => {
  assert.equal(cleanModelText("```text\n这是译文。\n```"), "这是译文。");
  assert.equal(cleanModelText("以下是译文：\n这是译文。"), "这是译文。");
  assert.equal(cleanModelText("【译文】内容"), "内容");
});

test("page prompt targets the language without repeating paper metadata", () => {
  const messages = buildPageMessages({
    pageText: "We propose a method.",
    pageIndex: 2,
    pageLabel: "3",
    totalPages: 10,
    targetLang: "zh-CN",
    systemPrompt: "translate",
    paper: { title: "A Paper", authors: ["Ada"], abstract: "Abstract text" },
  });
  const user = messages[1].content;
  assert.match(user, /简体中文/);
  assert.match(user, /We propose/);
  assert.doesNotMatch(user, /A Paper/);
  assert.doesNotMatch(user, /Abstract text/);
  assert.doesNotMatch(user, /第 3 页/);
});

test("QA system prompt anchors the selection and context", () => {
  const message = buildQaSystemMessage({
    systemPrompt: "You are helpful.",
    paper: { title: "Paper", authors: ["Ada"] },
    selection: { text: "the proposed method", pageIndex: 4, pageLabel: "5" },
    pageText: "context text",
    contextPages: 1,
  });
  assert.match(message.content, /the proposed method/);
  assert.match(message.content, /context text/);
  assert.match(message.content, /Ada/);
});

test("source formulas are protected and restored verbatim", () => {
  const source = "where $W_m \\in \\mathbb{R}^{C_v \\times C}$ and $$A_{mqk} \\propto \\exp$$.";
  const guarded = protectMath(source);
  assert.doesNotMatch(guarded.text, /W_m|A_\{mqk\}/);
  assert.match(guarded.text, /\[\[DRMATH_1\]\]/);
  assert.match(guarded.text, /\[\[DRMATH_2\]\]/);
  const restored = restoreMath(
    "其中 [[DRMATH_1]] 与 [[DRMATH_2]] 是权重。",
    guarded.formulas,
  );
  assert.match(restored, /\$W_m \\in \\mathbb\{R\}\^\{C_v \\times C\}\$/);
  assert.match(restored, /\$\$A_\{mqk\} \\propto \\exp\$\$/);
});

test("multi-line LaTeX environments are protected as one placeholder", () => {
  const formula = "\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}";
  const guarded = protectMath(`before\n${formula}\nafter`);
  assert.equal(guarded.formulas.length, 1);
  assert.equal(guarded.formulas[0], formula);
  assert.match(restoreMath("前 [[DRMATH_1]] 后", guarded.formulas), /\\end\{align\}/);
});

test("selection prompt excludes paper metadata", () => {
  const messages = buildSelectionMessages({
    text: "We propose Deformable DETR.",
    targetLang: "zh-CN",
    systemPrompt: "translate",
    paper: {
      title: "Deformable DETR",
      authors: ["Xizhou Zhu"],
      year: 2021,
      abstract: "DETR is slow.",
    },
  });
  const user = messages[1].content;
  assert.match(user, /Deformable DETR/);
  assert.doesNotMatch(user, /Xizhou Zhu/);
  assert.doesNotMatch(user, /2021/);
  assert.doesNotMatch(user, /DETR is slow/);
});

test("cache keys are stable and sensitive to text", () => {
  const a = translationCacheKey({ text: "hello", targetLang: "zh-CN", model: "m" });
  const b = translationCacheKey({ text: "hello", targetLang: "zh-CN", model: "m" });
  const c = translationCacheKey({ text: "hello!", targetLang: "zh-CN", model: "m" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  const page = pageTranslationCacheKey({
    attachmentKey: "ABC",
    pageIndex: 1,
    textHash: "h",
    targetLang: "zh-CN",
    model: "m",
  });
  assert.match(page, /^[0-9a-f]{16}$/);
});
