import type { AiProvider, ChatRequest, ChatResponse } from "./types.js";

type OpenClawConfig = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
};

export class OpenClawAdapter implements AiProvider {
  readonly name = "openclaw" as const;

  constructor(private readonly cfg: OpenClawConfig) {}

  async health(): Promise<"ok" | "error" | "not_configured"> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.chatModel) {
      return "not_configured";
    }
    return "ok";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const status = await this.health();
    if (status !== "ok") {
      throw new Error("openclaw_not_configured");
    }

    // 占位实现：后续替换为 OpenClaw 实际 API 调用。
    const lastUserMessage =
      [...request.messages].reverse().find((m) => m.role === "user")?.content ??
      "";
    return {
      content: `[openclaw-placeholder:${this.cfg.chatModel}] ${lastUserMessage}`,
      raw: { provider: this.name, placeholder: true },
    };
  }
}

