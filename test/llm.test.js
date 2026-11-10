import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatRequest,
  buildHeaders,
  createSSEParser,
  extractResponseText,
  extractStreamDelta,
  requestChat,
  resolveChatEndpoint,
  resolveStreamEndpoint,
} from "../src/llm.js";

const openai = {
  provider: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-test",
  temperature: 0.2,
  maxTokens: 700,
};

test("OpenAI-compatible endpoint and request", () => {
  assert.equal(resolveChatEndpoint(openai), "https://api.example.com/v1/chat/completions");
  const request = buildChatRequest(openai, [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);
  assert.equal(request.headers.Authorization, "Bearer sk-test");
  assert.equal(request.body.model, "gpt-test");
  assert.equal(request.body.messages[1].content, "hello");
  assert.equal(request.body.stream, false);
});

test("DeepSeek thinking toggle is passed in the OpenAI-format body", () => {
  const request = buildChatRequest(
    {
      ...openai,
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      thinking: { type: "disabled" },
    },
    [{ role: "user", content: "hello" }],
  );
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(request.body.thinking, { type: "disabled" });
});

test("Anthropic request extracts system and uses x-api-key", () => {
  const config = {
    ...openai,
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-test",
  };
  const request = buildChatRequest(config, [
    { role: "system", content: "be Brief" },
    { role: "user", content: "hello" },
  ]);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "sk-test");
  assert.equal(request.body.system, "be Brief");
  assert.equal(request.body.messages.length, 1);
  assert.ok(request.body.max_tokens);
});

test("Gemini endpoint puts key and model in URL", () => {
  const config = {
    ...openai,
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "gm-key",
    model: "gemini-test",
  };
  const url = resolveChatEndpoint(config);
  assert.match(url, /models\/gemini-test:generateContent\?key=gm-key$/);
  assert.match(resolveStreamEndpoint({ ...config, model: "gemini-test" }), /alt=sse/);
  const request = buildChatRequest(config, [{ role: "user", content: "hi" }]);
  assert.equal(request.body.contents[0].parts[0].text, "hi");
  assert.equal(request.body.stream, undefined);
});

test("response extraction supports all providers", () => {
  assert.equal(
    extractResponseText("openai", { choices: [{ message: { content: "hello" } }] }),
    "hello",
  );
  assert.equal(
    extractResponseText("anthropic", { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    "ab",
  );
  assert.equal(
    extractResponseText("gemini", {
      candidates: [{ content: { parts: [{ text: "g" }, { text: "em" }] } }],
    }),
    "gem",
  );
});

test("SSE parser tolerates CRLF and multiple events", () => {
  const events = [];
  const parser = createSSEParser((event) => events.push(event));
  parser.feed('data: {"choices":[{"delta":{"content":"he"}}]}\r\n\r\n');
  parser.feed('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
  parser.feed("data: [DONE]\n\n");
  parser.end();
  assert.equal(events.length, 3);
  assert.equal(events[0].choices[0].delta.content, "he");
  assert.equal(extractStreamDelta("openai", events[1]), "llo");
  assert.equal(events[2], "[DONE]");
});

test("requestChat parses a normal response", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
    };
  };
  const result = await requestChat(openai, [{ role: "user", content: "q" }], { fetchImpl });
  assert.equal(result, "answer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
});

test("requestChat streams deltas from SSE", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"he"}}]}\n\n'),
      );
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n'),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const fetchImpl = async () => ({ ok: true, status: 200, body });
  const deltas = [];
  const result = await requestChat(
    { ...openai, stream: true },
    [{ role: "user", content: "q" }],
    { fetchImpl, onDelta: (delta) => deltas.push(delta) },
  );
  assert.equal(result, "");
  assert.equal(deltas.join(""), "hello");
});

test("requestChat surfaces friendly HTTP errors", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "invalid key" } }),
  });
  await assert.rejects(
    () => requestChat(openai, [{ role: "user", content: "q" }], { fetchImpl }),
    (error) => {
      assert.equal(error.status, 401);
      assert.match(error.message, /API Key/);
      return true;
    },
  );
});

test("headers omit authorization for empty key", () => {
  const headers = buildHeaders({ provider: "ollama", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" });
  assert.equal(headers.Authorization, undefined);
});
