import { STORE_VERSION } from "./constants.js";
import { safeJsonParse } from "./util.js";

const CHATS_FILE = "chats.json";
const CACHE_FILE = "cache.json";
const MAX_TRANSLATION_ENTRIES = 600;
const MAX_PAGE_ENTRIES = 2000;

function emptyChats() {
  return { version: STORE_VERSION, attachments: {} };
}

function emptyCache() {
  return { version: STORE_VERSION, entries: {}, pages: {} };
}

function pruneObject(object, maxEntries, dateField = "updatedAt") {
  const entries = Object.entries(object || {});
  if (entries.length <= maxEntries) return object;
  entries.sort((a, b) => Number(b[1]?.[dateField] || 0) - Number(a[1]?.[dateField] || 0));
  return Object.fromEntries(entries.slice(0, maxEntries));
}

export class DataStore {
  constructor({ dir, io, debounceMs = 450, logger = () => {} }) {
    this.dir = dir;
    this.io = io;
    this.debounceMs = debounceMs;
    this.logger = logger;
    this.chats = emptyChats();
    this.cache = emptyCache();
    this.loaded = false;
    this.timer = null;
    this.saving = null;
    this.dirtyChats = false;
    this.dirtyCache = false;
  }

  path(name) {
    return `${this.dir}/${name}`;
  }

  async init() {
    if (this.loaded) return this;
    await this.io.mkdir(this.dir);
    this.chats = (await this.readJson(CHATS_FILE, emptyChats())) || emptyChats();
    this.cache = (await this.readJson(CACHE_FILE, emptyCache())) || emptyCache();
    if (!this.chats.attachments || typeof this.chats.attachments !== "object") {
      this.chats.attachments = {};
    }
    if (!this.cache.entries || typeof this.cache.entries !== "object") {
      this.cache.entries = {};
    }
    if (!this.cache.pages || typeof this.cache.pages !== "object") {
      this.cache.pages = {};
    }
    this.loaded = true;
    return this;
  }

  async readJson(name, fallback) {
    try {
      const text = await this.io.readText(this.path(name));
      if (!text) return fallback;
      const parsed = safeJsonParse(text, null);
      if (!parsed || typeof parsed !== "object") {
        this.logger(`Ignoring invalid ${name}`);
        return fallback;
      }
      return parsed;
    } catch (error) {
      if (error?.name !== "NotFoundError" && !/does not exist|not found/i.test(String(error?.message))) {
        this.logger(`Failed to read ${name}: ${error}`);
      }
      return fallback;
    }
  }

  getCards(attachmentKey) {
    return (this.chats.attachments?.[attachmentKey]?.cards || [])
      .slice()
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }

  upsertCard(attachmentKey, card) {
    if (!attachmentKey || !card?.id) return;
    const bucket = (this.chats.attachments[attachmentKey] ||= {
      updatedAt: 0,
      cards: [],
    });
    const index = bucket.cards.findIndex((item) => item.id === card.id);
    const now = Date.now();
    card.updatedAt = now;
    if (!card.createdAt) card.createdAt = now;
    if (index === -1) bucket.cards.push(card);
    else bucket.cards[index] = card;
    bucket.updatedAt = now;
    this.markChatsDirty();
  }

  deleteCard(attachmentKey, cardId) {
    const bucket = this.chats.attachments?.[attachmentKey];
    if (!bucket) return;
    bucket.cards = bucket.cards.filter((item) => item.id !== cardId);
    bucket.updatedAt = Date.now();
    this.markChatsDirty();
  }

  getCachedTranslation(key) {
    return this.cache.entries?.[key]?.text || "";
  }

  setCachedTranslation(key, text) {
    if (!key || !text) return;
    this.cache.entries[key] = { text, updatedAt: Date.now() };
    this.cache.entries = pruneObject(this.cache.entries, MAX_TRANSLATION_ENTRIES);
    this.markCacheDirty();
  }

  getPageTranslation(key) {
    return this.cache.pages?.[key]?.text || "";
  }

  setPageTranslation(key, text, meta = {}) {
    if (!key || !text) return;
    this.cache.pages[key] = { text, updatedAt: Date.now(), ...meta };
    this.cache.pages = pruneObject(this.cache.pages, MAX_PAGE_ENTRIES);
    this.markCacheDirty();
  }

  markChatsDirty() {
    this.dirtyChats = true;
    this.scheduleSave();
  }

  markCacheDirty() {
    this.dirtyCache = true;
    this.scheduleSave();
  }

  scheduleSave() {
    if (!this.loaded) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((error) => this.logger(`Save failed: ${error}`));
    }, this.debounceMs);
  }

  async flush() {
    if (!this.loaded) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) {
      await this.saving;
    }
    this.saving = this.doSave();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  async doSave() {
    const writes = [];
    if (this.dirtyChats) {
      this.dirtyChats = false;
      writes.push(
        this.io.writeText(this.path(CHATS_FILE), JSON.stringify(this.chats)).catch((error) => {
          this.dirtyChats = true;
          throw error;
        }),
      );
    }
    if (this.dirtyCache) {
      this.dirtyCache = false;
      writes.push(
        this.io.writeText(this.path(CACHE_FILE), JSON.stringify(this.cache)).catch((error) => {
          this.dirtyCache = true;
          throw error;
        }),
      );
    }
    await Promise.all(writes);
  }

  async destroy() {
    await this.flush();
  }
}

export function createMemoryIO(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async mkdir() {},
    async readText(path) {
      if (!files.has(path)) {
        const error = new Error("Not found");
        error.name = "NotFoundError";
        throw error;
      }
      return files.get(path);
    },
    async writeText(path, text) {
      files.set(path, text);
    },
  };
}
