import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { buildTranslatedPdf, wrapText } from "../src/pdf-export.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sansFontBytes = fs.readFileSync(path.join(root, "static/assets/NotoSansSC-Regular.ttf"));
const serifFontBytes = fs.readFileSync(path.join(root, "static/assets/NotoSerifSC-Regular.ttf"));

test("buildTranslatedPdf writes a valid, multi-page Chinese PDF", async () => {
  const longText = Array.from({ length: 70 }, (_, index) => `这是第 ${index + 1} 段译文，用于测试分页与中文字体嵌入。`).join(
    "\n\n",
  );
  const bytes = await buildTranslatedPdf({
    sansFontBytes,
    serifFontBytes,
    title: "Attention Is All You Need",
    author: "Vaswani et al.",
    pages: [
      { pageIndex: 0, pageLabel: "1", translated: longText },
      { pageIndex: 1, pageLabel: "2", translated: "第二页的简短译文。\n\n包含公式 $E=mc^2$ 的占位文本。" },
    ],
  });
  assert.ok(bytes.byteLength > 20_000);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  assert.match(pdf.getTitle() || "", /译文/);
  assert.match(pdf.getAuthor() || "", /Vaswani/);
  const firstPage = pdf.getPage(0);
  assert.ok(firstPage.getWidth() > 500);
});

test("wrapText respects the available width", async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit((await import("@pdf-lib/fontkit")).default);
  const font = await pdf.embedFont(sansFontBytes, { subset: true });
  const lines = wrapText("hello world 这是一段中文文本，用来测试换行。", font, 10, 80);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => !line || font.widthOfTextAtSize(line, 10) <= 90));
});
