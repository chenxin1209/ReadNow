import { isHttpUrl } from "./util.js";

export class LLMError extends Error {
  constructor(message, { status = 0, code = "", details = "" } = {}) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function trimSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function hasEndpoint(base, marker) {
  return base.toLowerCase().includes(marker.toLowerCase());
}

export function resolveChatEndpoint(config) {
  const provider = config.provider || "openai";
  let base = trimSlash(config.baseUrl);
  if (!base) throw new LLMError("尚未填写 API 地址");
  if (!/^https?:\/\//i.test(base)) throw new LLMError("API 地址必须以 http:// 或 https:// 开头");

  if (provider === "gemini") {
    if (hasEndpoint(base, ":generatecontent") || hasEndpoint(base, ":streamgeneratecontent")) {
      return base;
    }
    const model = encodeURIComponent(config.model || "gemini-2.0-flash");
    if (base.includes("/models/")) {
      return `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(config.apiKey || "")}`;
    }
    return `${base}/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey || "")}`;
  }
  if (provider === "anthropic") {
    if (hasEndpoint(base, "/messages")) return base;
    return `${base}/messages`;
  }
  if (hasEndpoint(base, "/chat/completions")) return base;
  // Some compatible providers expose the completion endpoint without /v1.
  return `${base}/chat/completions`;
}

export function resolveModelsEndpoint(config) {
  const provider = config.provider || "openai";
  let base = trimSlash(config.baseUrl);
  if (!base) throw new LLMError("尚未填写 API 地址");
  if (provider === "gemini") {
    return base.includes("/models")
      ? `${base}?key=${encodeURIComponent(config.apiKey || "")}`
      : `${base}/models?key=${encodeURIComponent(config.apiKey || "")}`;
  }
  if (provider === "anthropic") return "";
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/chat/completions")) return base.replace(/\/chat\/completions$/, "/models");
  return `${base}/models`;
}

export function buildHeaders(config, { stream = false } = {}) {
  const provider = config.provider || "openai";
  const headers = {
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
  };
  if (provider === "anthropic") {
    if (config.apiKey) headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (provider === "gemini") {
    if (config.apiKey) headers["x-goog-api-key"] = config.apiKey;
  } else if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/chenxin1209/ReadNow";
    headers["X-Title"] = "ReadNow for Zotero";
  }
  return headers;
}

function normalizeMessages(messages) {
  return (messages || [])
    .filter((message) => message && message.role && String(message.content ?? "").trim())
    .map((message) => ({
      role: ["system", "assistant", "user"].includes(message.role) ? message.role : "user",
      content: String(message.content),
    }));
}

function mergeAnthropicMessages(messages) {
  const output = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const previous = output[output.length - 1];
    if (previous && previous.role === message.role) {
      previous.content += `\n\n${message.content}`;
    } else {
      output.push({ role: message.role, content: message.content });
    }
  }
  if (!output.length) output.push({ role: "user", content: "Hello" });
  return output;
}

export function buildChatRequest(config, messages, { stream = false } = {}) {
  const provider = config.provider || "openai";
  const normalized = normalizeMessages(messages);
  const url = resolveChatEndpoint(config);
  const headers = buildHeaders(config, { stream });
  const temperature = Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.2;
  const maxTokens = Math.max(1, Number(config.maxTokens) || 2048);

  let body;
  if (provider === "anthropic") {
    const system = normalized
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    body = {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      messages: mergeAnthropicMessages(normalized).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(stream ? { stream: true } : {}),
    };
    if (system) body.system = system;
  } else if (provider === "gemini") {
    const system = normalized
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    body = {
      contents: normalized
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
  } else {
    body = {
      model: config.model,
      messages: normalized,
      temperature,
      max_tokens: maxTokens,
      stream,
      ...(config.thinking ? { thinking: config.thinking } : {}),
    };
  }

  return { url, headers, body, provider };
}

export function resolveStreamEndpoint(config) {
  const url = resolveChatEndpoint(config);
  if ((config.provider || "openai") !== "gemini") return url;
  if (hasEndpoint(url, ":streamgeneratecontent")) return url;
  return url.replace(":generateContent", ":streamGenerateContent").replace(/([?&])key=/, "$1alt=sse&key=");
}

export function extractResponseText(provider, data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (provider === "anthropic") {
    const parts = Array.isArray(data.content) ? data.content : [];
    return parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("");
  }
  if (provider === "gemini") {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
    if (!text && candidate?.finishReason === "SAFETY") {
      throw new LLMError("模型因安全策略拒绝了这次请求，请调整问题后重试");
    }
    return text;
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

export function extractStreamDelta(provider, event) {
  if (!event || event === "[DONE]") return "";
  if (typeof event === "string") return "";
  if (provider === "anthropic") {
    if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
      return event.delta.text;
    }
    return "";
  }
  if (provider === "gemini") {
    return (event.candidates?.[0]?.content?.parts || [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  const delta = event.choices?.[0]?.delta;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

export function createSSEParser(onEvent) {
  let buffer = "";
  const dispatch = (raw) => {
    const lines = raw.split("\n");
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const data = dataLines.join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") {
      onEvent("[DONE]");
      return;
    }
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Ignore malformed keep-alive / vendor-specific events.
    }
  };

  return {
    feed(chunk) {
      buffer += String(chunk ?? "").replace(/\r\n?/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatch(event);
        boundary = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = "";
    },
  };
}

function providerHint(status) {
  if (status === 401 || status === 403) return "API Key 无效、已过期或没有权限，请到设置中检查。";
  if (status === 404) return "接口地址或模型名不存在，请检查 Base URL 与模型名称。";
  if (status === 429) return "请求过于频繁或额度不足，请稍后重试。";
  if (status >= 500) return "服务商暂时不可用，请稍后重试。";
  return "";
}

async function parseErrorResponse(response) {
  let details = "";
  let message = "";
  try {
    const text = await response.text();
    details = text.slice(0, 2000);
    const parsed = JSON.parse(text);
    message = parsed?.error?.message || parsed?.message || parsed?.error?.status || "";
  } catch {
    // Keep the raw body.
  }
  const hint = providerHint(response.status);
  const finalMessage = [message || `请求失败（HTTP ${response.status}）`, hint].filter(Boolean).join(" ");
  return new LLMError(finalMessage, { status: response.status, details });
}

export async function requestChat(config, messages, options = {}) {
  const win = globalThis.Zotero?.getMainWindow?.();
  const fetchImpl = options.fetchImpl || globalThis.fetch || win?.fetch?.bind(win);
  if (typeof fetchImpl !== "function") {
    throw new LLMError("当前环境不支持网络请求");
  }
  const stream = Boolean(config.stream && options.onDelta);
  const built = buildChatRequest(config, messages, { stream });
  const url = stream ? resolveStreamEndpoint(config) : built.url;

  const AbortControllerImpl =
    options.AbortControllerImpl ||
    globalThis.AbortController ||
    globalThis.Zotero?.getMainWindow?.()?.AbortController;
  if (typeof AbortControllerImpl !== "function") {
    throw new LLMError("当前环境不支持可取消的网络请求");
  }
  const controller = new AbortControllerImpl();
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 120000);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
      credentials: "omit",
      redirect: "follow",
    });
  } catch (error) {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
    if (controller.signal.aborted) {
      if (timedOut) throw new LLMError("请求超时，请检查网络或调大超时时间后再试");
      throw new LLMError("请求已取消");
    }
    throw new LLMError(
      `无法连接 API：${error?.message || error}。请检查网络、代理与 Base URL；本地模型请确认服务已启动。`,
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
    throw await parseErrorResponse(response);
  }

  try {
    if (stream) {
      const contentType = String(response.headers?.get?.("content-type") || "");
      if (!response.body?.getReader || (contentType && !contentType.includes("text/event-stream"))) {
        const text = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new LLMError("模型服务没有返回流式事件，也不是有效的 JSON；请在设置中关闭流式输出后重试");
        }
        const full = extractResponseText(built.provider, parsed);
        if (full) options.onDelta(full);
        return full;
      }
      const reader = response.body.getReader();
      const TextDecoderImpl =
        options.TextDecoderImpl || globalThis.TextDecoder || win?.TextDecoder;
      const decoder = new TextDecoderImpl();
      const parser = createSSEParser((event) => {
        if (event === "[DONE]") return;
        const delta = extractStreamDelta(built.provider, event);
        if (delta) options.onDelta(delta);
      });
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.done) break;
        parser.feed(decoder.decode(result.value, { stream: true }));
      }
      parser.feed(decoder.decode());
      parser.end();
      return "";
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LLMError("API 返回了无法解析的内容，可能不是 OpenAI 兼容接口", {
        details: text.slice(0, 2000),
      });
    }
    const output = extractResponseText(built.provider, parsed);
    if (!output) {
      throw new LLMError("API 返回了空结果，请检查模型名称或稍后重试", {
        details: JSON.stringify(parsed).slice(0, 2000),
      });
    }
    return output;
  } catch (error) {
    if (error instanceof LLMError) throw error;
    if (controller.signal.aborted) {
      if (timedOut) throw new LLMError("请求超时，请检查网络或调大超时时间后再试");
      throw new LLMError("请求已取消");
    }
    throw new LLMError(`读取 API 响应失败：${error?.message || error}`);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternal);
  }
}

export async function listModels(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = resolveModelsEndpoint(config);
  if (!endpoint) return [];
  const headers = buildHeaders(config);
  headers.Accept = "application/json";
  delete headers["Content-Type"];
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers,
    credentials: "omit",
  });
  if (!response.ok) throw await parseErrorResponse(response);
  const data = await response.json();
  const raw = data.data || data.models || [];
  return raw
    .map((item) => {
      const id = item.id || item.name || "";
      return String(id).replace(/^models\//, "");
    })
    .filter(Boolean);
}

export function validateApiConfig(config) {
  if (!config?.baseUrl) return "请填写 API 地址";
  if (!isHttpUrl(config.baseUrl)) return "API 地址必须以 http:// 或 https:// 开头";
  if (!config?.model) return "请填写模型名称";
  const isLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(
    config.baseUrl,
  );
  if (!config?.apiKey && config.provider !== "ollama" && !isLocal) {
    return "请填写 API Key";
  }
  if (/your-endpoint|your-model/.test(config.baseUrl + config.model)) {
    return "请把示例地址和模型名替换成你自己的配置";
  }
  return "";
}
