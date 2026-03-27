import { getAiConfig } from "../../env.js";
import { OpenAiCompatibleAdapter } from "./openaiCompatibleAdapter.js";
import type {
  AiProvider,
  AiProviderName,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
} from "./types.js";

export function createAiProvider(name: AiProviderName): AiProvider {
  if (name !== "openai_compatible") {
    throw new Error(`unsupported_ai_provider:${name}`);
  }
  const cfg = getAiConfig();
  return new OpenAiCompatibleAdapter({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    chatModel: cfg.chatModel,
    embedModel: cfg.embedModel,
    timeoutMs: cfg.timeoutMs,
    fallbackBaseUrl: cfg.fallbackBaseUrl,
    fallbackApiKey: cfg.fallbackApiKey,
    fallbackChatModel: cfg.fallbackChatModel,
    fallbackEmbedModel: cfg.fallbackEmbedModel,
  });
}

export function getActiveAiProvider(): AiProvider {
  return createAiProvider("openai_compatible");
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

export async function embedWithActiveProvider(
  request: EmbedRequest,
): Promise<EmbedResponse> {
  const provider = getActiveAiProvider();
  return provider.embed(request);
}

