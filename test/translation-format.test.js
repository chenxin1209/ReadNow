import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTranslationDocument,
  splitLongParagraph,
} from "../src/translation-format.js";

test("translation paragraphs are separated by blank lines", () => {
  const blocks = normalizeTranslationDocument(
    "这是第一段译文。\n\n这是第二段译文，包含 English words.",
  );
  assert.equal(blocks.filter((block) => block.type === "paragraph").length, 2);
  assert.equal(blocks[0].text, "这是第一段译文。");
  assert.equal(blocks[1].text, "这是第二段译文，包含 English words.");
});

test("markdown and numbered headings become heading blocks", () => {
  const blocks = normalizeTranslationDocument(
    "# 引言\n\n正文第一段。\n\n## 2.1 方法\n\n正文第二段。",
  );
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, "引言");
  const secondHeading = blocks.find(
    (block) => block.type === "heading" && block.text === "2.1 方法",
  );
  assert.ok(secondHeading);
  assert.equal(secondHeading.level, 2);
});

test("a long single-line translation is split into readable paragraphs", () => {
  const text = Array.from({ length: 30 }, (_, index) => `这是第${index + 1}句译文。`).join("");
  const paragraphs = splitLongParagraph(text, 100);
  assert.ok(paragraphs.length > 1);
  assert.equal(paragraphs.join(""), text);
});

test("front matter is kept separate from section formatting", () => {
  const blocks = normalizeTranslationDocument(
    [
      "# DEFORMABLE DETR: 用于端到端目标检测的可变形 Transformer",
      "",
      "发表于 ICLR 2021 会议论文",
      "",
      "1* 2* Xizhou Zhu, Weijie Su, Lewei Lu",
      "",
      "1 商汤科技研究院",
      "",
      "2 中国科学技术大学",
      "",
      "{zhuwalter,luotto}@sensetime.com",
      "",
      "# 摘要",
      "",
      "正文第一段。",
    ].join("\n"),
    { frontMatter: true },
  );
  const types = blocks.map((block) => block.type);
  assert.deepEqual(types.slice(0, 5), [
    "title",
    "meta",
    "authors",
    "affiliation",
    "affiliation",
  ]);
  assert.equal(types[5], "email");
  assert.equal(blocks[6].type, "heading");
});

test("figure/table captions and formulas become distinct blocks", () => {
  const blocks = normalizeTranslationDocument(
    [
      "[图注] 图 1：不同注意力头的可视化。",
      "",
      "[表注] 表 1：消融实验结果。",
      "",
      "| Method | BLEU |",
      "| --- | --- |",
      "| Transformer | 28.4 |",
      "",
      "$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^T/\\sqrt{d_k})V$$",
      "",
      "正文继续。",
    ].join("\n"),
  );
  assert.equal(blocks[0].type, "caption");
  assert.equal(blocks[0].label, "图注");
  assert.equal(blocks[1].type, "caption");
  assert.equal(blocks[1].label, "表注");
  assert.equal(blocks[2].type, "table");
  assert.deepEqual(blocks[2].table.headers, ["Method", "BLEU"]);
  assert.equal(blocks[2].table.rows.length, 1);
  assert.equal(blocks[3].type, "formula");
  assert.equal(blocks[4].type, "paragraph");
});

test("table marker consumes a pipe table even across one blank line", () => {
  const blocks = normalizeTranslationDocument(
    [
      "[表格]",
      "",
      "Method | Score | Notes",
      "--- | ---: | ---",
      "Ours | 91.2 | $x \\mid y$",
      "Base | 88.0 | A \\| B",
      "",
      "正文。",
    ].join("\n"),
  );
  assert.equal(blocks[0].type, "table");
  assert.deepEqual(blocks[0].table.headers, ["Method", "Score", "Notes"]);
  assert.equal(blocks[0].table.aligns[1], "right");
  assert.equal(blocks[0].table.rows[1][2], "A | B");
  assert.equal(blocks[1].type, "paragraph");
});

test("loose table rows separated by tabs or aligned spaces are recovered", () => {
  const tabbed = normalizeTranslationDocument("[表格]\nMethod\tBLEU\nBase\t28.4\nOurs\t31.2");
  assert.equal(tabbed[0].type, "table");
  assert.equal(tabbed[0].table.rows.length, 2);

  const aligned = normalizeTranslationDocument("[表格]\nMethod   BLEU\nBase     28.4");
  assert.deepEqual(aligned[0].table.headers, ["Method", "BLEU"]);
  assert.deepEqual(aligned[0].table.rows[0], ["Base", "28.4"]);
});

test("a caption marker on its own absorbs the following caption line", () => {
  const blocks = normalizeTranslationDocument("[图注]\n图 2：模型结构。\n\n正文。");
  assert.equal(blocks[0].type, "caption");
  assert.equal(blocks[0].text, "图 2：模型结构。");
  assert.equal(blocks.filter((block) => block.type === "caption").length, 1);
});

test("multi-line LaTeX environments stay in one formula block", () => {
  const blocks = normalizeTranslationDocument(
    "\\begin{align}\na &= b + c \\\\\nd &= e\n\\end{align}\n\n正文。",
  );
  assert.equal(blocks[0].type, "formula");
  assert.match(blocks[0].text, /a &= b/);
  assert.match(blocks[0].text, /\\end\{align\}/);
  assert.equal(blocks[1].type, "paragraph");
});

test("multi-line double-dollar formulas stay in one formula block", () => {
  const blocks = normalizeTranslationDocument("$$\na + b = c\n$$\n\n正文。");
  assert.equal(blocks[0].type, "formula");
  assert.equal(blocks.filter((block) => block.type === "formula").length, 1);
});

test("references are rendered as smaller note blocks", () => {
  const blocks = normalizeTranslationDocument(
    "正文。\n\n参考文献\n\n[1] Vaswani A. Attention Is All You Need. 2017.\n[2] He K. Deep Residual Learning. 2016.",
  );
  assert.equal(blocks.some((block) => block.type === "reference-heading"), true);
  assert.equal(blocks.filter((block) => block.type === "note").length, 2);
});
