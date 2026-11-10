import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "../src/markdown.js";

test("parseMarkdown recognizes headings, lists, code and quotes", () => {
  const blocks = parseMarkdown(
    "# Title\n\n- one\n- two\n\n```js\nconsole.log(1)\n```\n\n> note\n\nA paragraph with **bold**.",
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "list", "code", "quote", "paragraph"],
  );
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[2].language, "js");
});

test("parseInline tokenizes common inline markdown", () => {
  const tokens = parseInline("a **b** and `c` and [d](https://example.com) and $e$");
  assert.ok(tokens.some((token) => token.type === "strong" && token.value === "b"));
  assert.ok(tokens.some((token) => token.type === "code" && token.value === "c"));
  assert.ok(
    tokens.some(
      (token) => token.type === "link" && token.href === "https://example.com" && token.value === "d",
    ),
  );
  assert.ok(tokens.some((token) => token.type === "math" && token.value === "e"));
});

test("raw HTML is treated as text, never a block", () => {
  const blocks = parseMarkdown("<script>alert(1)</script>");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].text, "<script>alert(1)</script>");
});

test("snake_case identifiers are not turned into emphasis", () => {
  const tokens = parseInline("MOCK_CHAT_OK and h_t stay intact");
  assert.equal(tokens.some((token) => token.type === "em"), false);
  assert.equal(tokens.map((token) => token.value).join(""), "MOCK_CHAT_OK and h_t stay intact");
});

test("unsafe link protocols are not tokenized as links", () => {
  const tokens = parseInline("[click](javascript:alert(1))");
  assert.equal(tokens.some((token) => token.type === "link"), false);
});
