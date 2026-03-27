export type AiProviderName = "openai_compatible";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse = {
  content: string;
  raw?: unknown;
};

export type EmbedRequest = {
  input: string | string[];
};

export type EmbedResponse = {
  vectors: number[][];
  raw?: unknown;
};

export interface AiProvider {
  readonly name: AiProviderName;
  health(): Promise<"ok" | "error" | "not_configured">;
  chat(request: ChatRequest): Promise<ChatResponse>;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

