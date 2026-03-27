export type AiProviderName = "openclaw" | "doubao";

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

export interface AiProvider {
  readonly name: AiProviderName;
  health(): Promise<"ok" | "error" | "not_configured">;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

