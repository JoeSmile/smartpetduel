import { test } from "node:test";
import assert from "node:assert/strict";
import { getLlmConfigCenter } from "./env.js";

test("llm config center reports missing required fields", () => {
  const prev = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL_CHAT: process.env.LLM_MODEL_CHAT,
    LLM_MODEL_EMBED: process.env.LLM_MODEL_EMBED,
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    LLM_FALLBACK_BASE_URL: process.env.LLM_FALLBACK_BASE_URL,
    LLM_FALLBACK_API_KEY: process.env.LLM_FALLBACK_API_KEY,
    LLM_FALLBACK_MODEL_CHAT: process.env.LLM_FALLBACK_MODEL_CHAT,
    LLM_FALLBACK_MODEL_EMBED: process.env.LLM_FALLBACK_MODEL_EMBED,
  };
  try {
    process.env.LLM_PROVIDER = "openai_compatible";
    process.env.LLM_BASE_URL = "";
    process.env.LLM_API_KEY = "";
    process.env.LLM_MODEL_CHAT = "";
    process.env.LLM_MODEL_EMBED = "";
    process.env.LLM_TIMEOUT_MS = "12000";
    process.env.LLM_FALLBACK_BASE_URL = "https://fallback.local/v1";
    process.env.LLM_FALLBACK_API_KEY = "k2";
    process.env.LLM_FALLBACK_MODEL_CHAT = "chat-fallback";
    process.env.LLM_FALLBACK_MODEL_EMBED = "embed-fallback";

    const center = getLlmConfigCenter();
    assert.equal(center.publicView.provider, "openai_compatible");
    assert.equal(center.isConfigured, false);
    assert.equal(center.publicView.hasApiKey, false);
    assert.equal(center.publicView.timeoutMs, 12000);
    assert.equal(center.publicView.fallbackBaseUrl, "https://fallback.local/v1");
    assert.equal(center.publicView.hasFallbackApiKey, true);
    assert.equal(center.publicView.fallbackChatModel, "chat-fallback");
    assert.ok(center.missing.includes("LLM_BASE_URL"));
    assert.ok(center.missing.includes("LLM_API_KEY"));
  } finally {
    process.env.LLM_PROVIDER = prev.LLM_PROVIDER;
    process.env.LLM_BASE_URL = prev.LLM_BASE_URL;
    process.env.LLM_API_KEY = prev.LLM_API_KEY;
    process.env.LLM_MODEL_CHAT = prev.LLM_MODEL_CHAT;
    process.env.LLM_MODEL_EMBED = prev.LLM_MODEL_EMBED;
    process.env.LLM_TIMEOUT_MS = prev.LLM_TIMEOUT_MS;
    process.env.LLM_FALLBACK_BASE_URL = prev.LLM_FALLBACK_BASE_URL;
    process.env.LLM_FALLBACK_API_KEY = prev.LLM_FALLBACK_API_KEY;
    process.env.LLM_FALLBACK_MODEL_CHAT = prev.LLM_FALLBACK_MODEL_CHAT;
    process.env.LLM_FALLBACK_MODEL_EMBED = prev.LLM_FALLBACK_MODEL_EMBED;
  }
});

