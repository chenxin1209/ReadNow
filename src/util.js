export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uniqueId(prefix = "id") {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}-${cryptoObj.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function debounce(fn, wait = 200) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = (...args) => {
    debounced.cancel();
    fn(...args);
  };
  return debounced;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Stable 64-bit-ish FNV-1a hash, returned as 16 hex chars.
 * Used for translation cache keys, not for cryptography.
 */
export function hashString(input) {
  const text = String(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function truncate(text, maxChars, ellipsis = "…") {
  const value = String(text ?? "");
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - ellipsis.length)).trimEnd() + ellipsis;
}

export function normalizeWhitespace(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ \u00a0]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitParagraphs(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ensureSentence(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return /[.!?。！？:：;；]$/.test(value) ? value : `${value}。`;
}

export function redactSecrets(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (!secret || String(secret).length < 6) continue;
    output = output.split(String(secret)).join("[已隐藏密钥]");
  }
  output = output.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[已隐藏密钥]");
  return output;
}

export function formatError(error, secrets = []) {
  if (!error) return "未知错误";
  if (typeof error === "string") return redactSecrets(error, secrets);
  const message = error.message || String(error);
  const status = error.status ? `HTTP ${error.status}: ` : "";
  return redactSecrets(`${status}${message}`, secrets);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatRelativeTime(timestamp) {
  const time = Number(timestamp);
  if (!Number.isFinite(time) || time <= 0) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(time).toLocaleDateString();
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripCodeFence(text) {
  let value = String(text ?? "").trim();
  const fence = value.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) value = fence[1];
  value = value.replace(/^```(?:[a-zA-Z0-9_-]+)?\s*/i, "").replace(/\s*```$/i, "");
  return value.trim();
}

export function countWords(text) {
  const value = String(text ?? "").trim();
  if (!value) return 0;
  const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (value.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length;
  return cjk + latin;
}

export function toPlainText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
