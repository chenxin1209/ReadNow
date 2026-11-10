import {
  DEFAULT_PREFS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  PREF_BRANCH,
  PROVIDERS,
} from "./constants.js";

function prefKey(name) {
  return `${PREF_BRANCH}${name}`;
}

export function getRawPref(name, fallback) {
  try {
    const value = Zotero.Prefs.get(prefKey(name), true);
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setRawPref(name, value) {
  Zotero.Prefs.set(prefKey(name), value, true);
}

export function clearRawPref(name) {
  Zotero.Prefs.clear(prefKey(name), true);
}

export function apiKeyPrefName(provider) {
  const id = String(provider || "openai");
  return `key${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

export function getApiKey(provider) {
  return String(getRawPref(apiKeyPrefName(provider), "") || "");
}

export function setApiKey(provider, value) {
  setRawPref(apiKeyPrefName(provider), String(value || ""));
}

export function getProviderPreset(provider) {
  return PROVIDERS[provider] || PROVIDERS.openai;
}

export function getDefaultSettings(provider = "deepseek") {
  const preset = getProviderPreset(provider);
  return {
    ...DEFAULT_PREFS,
    provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
    translationModel: preset.translationModel,
    apiKey: "",
  };
}

export function getSettings(overrides = {}) {
  const rawProvider = String(getRawPref("provider", DEFAULT_PREFS.provider));
  const provider = PROVIDERS[rawProvider] ? rawProvider : "openai";
  const preset = getProviderPreset(provider);
  const baseUrl = String(getRawPref("baseUrl", "") || preset.baseUrl);
  const rawModel = String(getRawPref("model", "") || preset.model);
  const rawTranslationModel = String(
    getRawPref("translationModel", "") || rawModel || preset.translationModel,
  );
  // DeepSeek retired the old deepseek-chat default in favor of deepseek-flash.
  const model =
    provider === "deepseek" && rawModel === "deepseek-chat" ? "deepseek-flash" : rawModel;
  const translationModel =
    provider === "deepseek" && rawTranslationModel === "deepseek-chat"
      ? "deepseek-flash"
      : rawTranslationModel;
  const settings = {
    provider,
    baseUrl,
    model,
    translationModel,
    apiKey: getApiKey(provider),
    targetLang: String(getRawPref("targetLang", DEFAULT_PREFS.targetLang)),
    autoTranslate: Boolean(getRawPref("autoTranslate", DEFAULT_PREFS.autoTranslate)),
    autoTranslatePage: Boolean(
      getRawPref("autoTranslatePage", DEFAULT_PREFS.autoTranslatePage),
    ),
    autoRestore: Boolean(getRawPref("autoRestore", DEFAULT_PREFS.autoRestore)),
    stream: Boolean(getRawPref("stream", DEFAULT_PREFS.stream)),
    deepseekThinking: Boolean(
      getRawPref("deepseekThinking", DEFAULT_PREFS.deepseekThinking),
    ),
    temperature: Number(getRawPref("temperature", DEFAULT_PREFS.temperature)),
    maxTokens: Math.max(64, Number(getRawPref("maxTokens", DEFAULT_PREFS.maxTokens)) || 2048),
    contextPages: Math.max(0, Number(getRawPref("contextPages", DEFAULT_PREFS.contextPages)) || 0),
    systemPrompt: String(getRawPref("systemPrompt", DEFAULT_SYSTEM_PROMPT)),
    translationPrompt: String(getRawPref("translationPrompt", DEFAULT_TRANSLATION_PROMPT)),
    pdfFontSize: Math.max(9, Number(getRawPref("pdfFontSize", DEFAULT_PREFS.pdfFontSize)) || 11),
    saveChats: Boolean(getRawPref("saveChats", DEFAULT_PREFS.saveChats)),
  };
  return { ...settings, ...overrides };
}

export function saveSettings(patch = {}) {
  const provider = patch.provider || String(getRawPref("provider", DEFAULT_PREFS.provider));
  if (patch.provider) setRawPref("provider", patch.provider);
  if (patch.apiKey !== undefined) setApiKey(provider, patch.apiKey);
  const scalarKeys = [
    "baseUrl",
    "model",
    "translationModel",
    "targetLang",
    "autoTranslate",
    "autoTranslatePage",
    "autoRestore",
    "stream",
    "deepseekThinking",
    "temperature",
    "maxTokens",
    "contextPages",
    "systemPrompt",
    "translationPrompt",
    "pdfFontSize",
    "saveChats",
  ];
  for (const key of scalarKeys) {
    if (patch[key] !== undefined) {
      setRawPref(key, patch[key]);
    }
  }
  return getSettings();
}

export function resetSettings() {
  const keys = [
    "provider",
    "baseUrl",
    "model",
    "translationModel",
    "targetLang",
    "autoTranslate",
    "autoTranslatePage",
    "autoRestore",
    "stream",
    "deepseekThinking",
    "temperature",
    "maxTokens",
    "contextPages",
    "systemPrompt",
    "translationPrompt",
    "pdfFontSize",
    "saveChats",
  ];
  for (const key of keys) clearRawPref(key);
  for (const provider of Object.keys(PROVIDERS)) {
    clearRawPref(apiKeyPrefName(provider));
  }
  return getSettings();
}

export function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "未配置";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
