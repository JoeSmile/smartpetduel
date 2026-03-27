import type {
  AiProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
} from "./types.js";
import { AiProviderError } from "./errors.js";

type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
  timeoutMs: number;
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  fallbackChatModel: string;
  fallbackEmbedModel: string;
};

export class OpenAiCompatibleAdapter implements AiProvider {
  readonly name = "openai_compatible" as const;

  constructor(private readonly cfg: OpenAiCompatibleConfig) {}

  private getFallbackChatEnabled(): boolean {
    return Boolean(
      this.cfg.fallbackBaseUrl &&
        this.cfg.fallbackApiKey &&
        this.cfg.fallbackChatModel,
    );
  }

  private getFallbackEmbedEnabled(): boolean {
    return Boolean(
      this.cfg.fallbackBaseUrl &&
        this.cfg.fallbackApiKey &&
        this.cfg.fallbackEmbedModel,
    );
  }

  private shouldFallbackByStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private classifyHttpStatus(status: number): "rate_limited" | "unauthorized" | "upstream_http_error" {
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403) return "unauthorized";
    return "upstream_http_error";
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, this.cfg.timeoutMs || 10000));
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<"ok" | "error" | "not_configured"> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.chatModel) {
      return "not_configured";
    }
    const check = async (baseUrl: string, apiKey: string): Promise<"ok" | "error"> => {
      try {
        const url = this.normalizeBaseUrl(baseUrl) + "/models";
        const res = await this.fetchWithTimeout(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        return res.ok ? "ok" : "error";
      } catch {
        return "error";
      }
    };
    const primary = await check(this.cfg.baseUrl, this.cfg.apiKey);
    if (primary === "ok") return "ok";
    if (!this.cfg.fallbackBaseUrl || !this.cfg.fallbackApiKey) return "error";
    return check(this.cfg.fallbackBaseUrl, this.cfg.fallbackApiKey);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.chatModel) {
      throw new AiProviderError({
        code: "not_configured",
        message: "llm chat not configured",
      });
    }
    const send = async (input: {
      baseUrl: string;
      apiKey: string;
      chatModel: string;
    }): Promise<{
      choices?: Array<{ message?: { content?: string } }>;
    }> => {
      const url = this.normalizeBaseUrl(input.baseUrl) + "/chat/completions";
      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify({
            model: input.chatModel,
            messages: request.messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 512,
          }),
        });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("AbortError")) {
          throw new AiProviderError({ code: "timeout", message: "llm chat timeout" });
        }
        throw new AiProviderError({ code: "network_error", message: "llm chat network error" });
      }
      if (!res.ok) {
        const text = await res.text();
        throw new AiProviderError({
          code: this.classifyHttpStatus(res.status),
          message: `llm chat http ${res.status}: ${text}`,
          status: res.status,
        });
      }
      return (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
    };

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = await send({
        baseUrl: this.cfg.baseUrl,
        apiKey: this.cfg.apiKey,
        chatModel: this.cfg.chatModel,
      });
    } catch (err) {
      const status = err instanceof AiProviderError ? (err.status ?? 0) : 0;
      const code = err instanceof AiProviderError ? err.code : "upstream_http_error";
      const shouldFallback =
        this.getFallbackChatEnabled() &&
        ((status > 0 && this.shouldFallbackByStatus(status)) ||
          code === "timeout" ||
          code === "network_error" ||
          code === "rate_limited");
      if (!shouldFallback) throw err;
      data = await send({
        baseUrl: this.cfg.fallbackBaseUrl,
        apiKey: this.cfg.fallbackApiKey,
        chatModel: this.cfg.fallbackChatModel,
      });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiProviderError({
        code: "empty_content",
        message: "llm chat empty content",
      });
    }
    return {
      content,
      raw: data,
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey || !this.cfg.embedModel) {
      throw new AiProviderError({
        code: "not_configured",
        message: "llm embed not configured",
      });
    }
    const input = Array.isArray(request.input) ? request.input : [request.input];
    const send = async (inputCfg: {
      baseUrl: string;
      apiKey: string;
      embedModel: string;
    }): Promise<{
      data?: Array<{ embedding?: number[] }>;
    }> => {
      const url = this.normalizeBaseUrl(inputCfg.baseUrl) + "/embeddings";
      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${inputCfg.apiKey}`,
          },
          body: JSON.stringify({
            model: inputCfg.embedModel,
            input,
          }),
        });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("AbortError")) {
          throw new AiProviderError({ code: "timeout", message: "llm embed timeout" });
        }
        throw new AiProviderError({ code: "network_error", message: "llm embed network error" });
      }
      if (!res.ok) {
        const text = await res.text();
        throw new AiProviderError({
          code: this.classifyHttpStatus(res.status),
          message: `llm embed http ${res.status}: ${text}`,
          status: res.status,
        });
      }
      return (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    };
    let data: { data?: Array<{ embedding?: number[] }> };
    try {
      data = await send({
        baseUrl: this.cfg.baseUrl,
        apiKey: this.cfg.apiKey,
        embedModel: this.cfg.embedModel,
      });
    } catch (err) {
      const status = err instanceof AiProviderError ? (err.status ?? 0) : 0;
      const code = err instanceof AiProviderError ? err.code : "upstream_http_error";
      const shouldFallback =
        this.getFallbackEmbedEnabled() &&
        ((status > 0 && this.shouldFallbackByStatus(status)) ||
          code === "timeout" ||
          code === "network_error" ||
          code === "rate_limited");
      if (!shouldFallback) throw err;
      data = await send({
        baseUrl: this.cfg.fallbackBaseUrl,
        apiKey: this.cfg.fallbackApiKey,
        embedModel: this.cfg.fallbackEmbedModel,
      });
    }
    const vectors = (data.data ?? [])
      .map((item) => item.embedding)
      .filter((v): v is number[] => Array.isArray(v));
    if (!vectors.length) {
      throw new AiProviderError({
        code: "empty_vectors",
        message: "llm embed empty vectors",
      });
    }
    return {
      vectors,
      raw: data,
    };
  }

  private normalizeBaseUrl(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }
}

