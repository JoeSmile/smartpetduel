import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiCompatibleAdapter } from "./openaiCompatibleAdapter.js";
import { AiProviderError } from "./errors.js";

test("chat falls back to secondary on retryable status", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://primary.example")) {
        return new Response("rate_limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok-from-fallback" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://primary.example/v1",
      apiKey: "k1",
      chatModel: "m1",
      embedModel: "e1",
      timeoutMs: 2000,
      fallbackBaseUrl: "https://fallback.example/v1",
      fallbackApiKey: "k2",
      fallbackChatModel: "m2",
      fallbackEmbedModel: "e2",
    });
    const out = await adapter.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(out.content, "ok-from-fallback");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat maps unauthorized without fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;

    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://primary.example/v1",
      apiKey: "k1",
      chatModel: "m1",
      embedModel: "e1",
      timeoutMs: 2000,
      fallbackBaseUrl: "https://fallback.example/v1",
      fallbackApiKey: "k2",
      fallbackChatModel: "m2",
      fallbackEmbedModel: "e2",
    });
    await assert.rejects(
      adapter.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err: unknown) =>
        err instanceof AiProviderError &&
        err.code === "unauthorized" &&
        err.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

