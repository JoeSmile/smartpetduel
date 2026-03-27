import { getAiConfig } from "../../env.js";
import { DoubaoAdapter } from "./doubaoAdapter.js";
import { OpenClawAdapter } from "./openclawAdapter.js";
import type { AiProvider, AiProviderName, ChatRequest, ChatResponse } from "./types.js";

export function createAiProvider(name: AiProviderName): AiProvider {
  const cfg = getAiConfig();
  if (name === "openclaw") {
    return new OpenClawAdapter({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      chatModel: cfg.chatModel,
    });
  }
  return new DoubaoAdapter({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    chatModel: cfg.chatModel,
  });
}

export function getActiveAiProvider(): AiProvider {
  const cfg = getAiConfig();
  return createAiProvider(cfg.provider);
}

export async function getAiProviderHealth(): Promise<{
  provider: AiProviderName;
  status: "ok" | "error" | "not_configured";
}> {
  const provider = getActiveAiProvider();
  const status = await provider.health();
  return { provider: provider.name, status };
}

export async function chatWithActiveProvider(
  request: ChatRequest,
): Promise<ChatResponse> {
  const provider = getActiveAiProvider();
  return provider.chat(request);
}

