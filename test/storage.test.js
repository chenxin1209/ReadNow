import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryIO, DataStore } from "../src/storage.js";

test("cards persist and reload", async () => {
  const io = createMemoryIO();
  const first = new DataStore({ dir: "data", io, debounceMs: 1 });
  await first.init();
  first.upsertCard("ATTACH", {
    id: "card-1",
    attachmentKey: "ATTACH",
    selection: { text: "quote", pageIndex: 2 },
    messages: [{ role: "user", content: "why?" }],
  });
  await first.flush();

  const second = new DataStore({ dir: "data", io, debounceMs: 1 });
  await second.init();
  const cards = second.getCards("ATTACH");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].selection.text, "quote");
  assert.equal(cards[0].messages[0].content, "why?");
});

test("translation cache round-trips and deletes", async () => {
  const io = createMemoryIO();
  const store = new DataStore({ dir: "data", io, debounceMs: 1 });
  await store.init();
  store.setCachedTranslation("k1", "译文");
  store.setPageTranslation("p1", "整页译文", { pageIndex: 0 });
  await store.flush();
  assert.equal(store.getCachedTranslation("k1"), "译文");
  assert.equal(store.getPageTranslation("p1"), "整页译文");

  store.deleteCard("ATTACH", "missing");
  await store.flush();
  assert.equal(store.getCachedTranslation("k1"), "译文");
});
