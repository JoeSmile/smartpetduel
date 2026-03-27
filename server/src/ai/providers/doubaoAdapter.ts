import type { AiProvider, ChatRequest, ChatResponse } from "./types.js";

type DoubaoConfig = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
};

export class DoubaoAdapter implements AiProvider {
  readonly name = "doubao" as const;

  constructor(private readonly cfg: DoubaoConfig) {}

  async health(): Promise<"ok" | "error" | "not_configured"> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.chatModel) {
      return "not_configured";
    }
    try {
      const url = this.normalizeBaseUrl(this.cfg.baseUrl) + "/models";
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
      });
      if (!res.ok) return "error";
      return "ok";
    } catch {
      return "error";
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.chatModel) {
      throw new Error("doubao_not_configured");
    }
    const url = this.normalizeBaseUrl(this.cfg.baseUrl) + "/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.chatModel,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 512,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`doubao_chat_http_${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("doubao_chat_empty_content");
    }
    return {
      content,
      raw: data,
    };
  }

  private normalizeBaseUrl(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }
}

