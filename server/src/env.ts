import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

type LlmProvider = "openai_compatible";

export function getNeo4jConfig(): {
  uri: string;
  user: string;
  password: string;
} {
  const uri = process.env.NEO4J_URI ?? "";
  const user = process.env.NEO4J_USER ?? "";
  const password = process.env.NEO4J_PASSWORD ?? "";
  return { uri, user, password };
}

export function getPostgresConfig(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
} {
  const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  const database = process.env.POSTGRES_DB ?? "smartpet_duel";
  const user = process.env.POSTGRES_USER ?? "postgres";
  const password = process.env.POSTGRES_PASSWORD ?? "";
  const ssl = (process.env.POSTGRES_SSL ?? "false").toLowerCase() === "true";
  return { host, port, database, user, password, ssl };
}

export function getAiConfig(): {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
  timeoutMs: number;
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  fallbackChatModel: string;
  fallbackEmbedModel: string;
} {
  const center = getLlmConfigCenter();
  return center.active;
}

export function getLlmConfigCenter(): {
  active: {
    provider: LlmProvider;
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
  missing: Array<"LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL_CHAT" | "LLM_MODEL_EMBED">;
  isConfigured: boolean;
  publicView: {
    provider: LlmProvider;
    baseUrl: string;
    chatModel: string;
    embedModel: string;
    timeoutMs: number;
    fallbackBaseUrl: string;
    fallbackChatModel: string;
    hasFallbackApiKey: boolean;
    hasApiKey: boolean;
    missing: string[];
    isConfigured: boolean;
  };
} {
  const provider: LlmProvider = "openai_compatible";
  const baseUrl =
    process.env.LLM_BASE_URL ??
    process.env.EMBEDDING_BASE_URL ??
    "";
  const apiKey =
    process.env.LLM_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.DASHSCOPE_API_KEY ??
    "";
  const chatModel =
    process.env.LLM_MODEL_CHAT ??
    process.env.OPENAI_MODEL ??
    "";
  const embedModel =
    process.env.LLM_MODEL_EMBED ??
    process.env.EMBEDDING_MODEL ??
    "";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 10000);
  const fallbackBaseUrl = process.env.LLM_FALLBACK_BASE_URL ?? "";
  const fallbackApiKey = process.env.LLM_FALLBACK_API_KEY ?? "";
  const fallbackChatModel = process.env.LLM_FALLBACK_MODEL_CHAT ?? "";
  const fallbackEmbedModel = process.env.LLM_FALLBACK_MODEL_EMBED ?? "";
  const missing: Array<
    "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL_CHAT" | "LLM_MODEL_EMBED"
  > = [];
  if (!baseUrl) missing.push("LLM_BASE_URL");
  if (!apiKey) missing.push("LLM_API_KEY");
  if (!chatModel) missing.push("LLM_MODEL_CHAT");
  if (!embedModel) missing.push("LLM_MODEL_EMBED");
  const isConfigured = missing.length === 0;
  return {
    active: {
      provider,
      baseUrl,
      apiKey,
      chatModel,
      embedModel,
      timeoutMs,
      fallbackBaseUrl,
      fallbackApiKey,
      fallbackChatModel,
      fallbackEmbedModel,
    },
    missing,
    isConfigured,
    publicView: {
      provider,
      baseUrl,
      chatModel,
      embedModel,
      timeoutMs,
      fallbackBaseUrl,
      fallbackChatModel,
      hasFallbackApiKey: Boolean(fallbackApiKey),
      hasApiKey: Boolean(apiKey),
      // Keep raw env readable for migration diagnostics.
      // This does not affect runtime routing, which is fixed to openai_compatible.
      missing,
      isConfigured,
    },
  };
}

export function getChannelAuthConfig(): {
  openclawSecret: string;
  doubaoSecret: string;
} {
  const openclawSecret = process.env.CHANNEL_SIGN_SECRET_OPENCLAW ?? "";
  const doubaoSecret = process.env.CHANNEL_SIGN_SECRET_DOUBAO ?? "";
  return { openclawSecret, doubaoSecret };
}

export function getCommentaryConfig(): {
  enabled: boolean;
  maxTokens: number;
} {
  const enabled = (process.env.COMMENTARY_ENABLED ?? "false").toLowerCase() === "true";
  const maxTokens = Number(process.env.COMMENTARY_MAX_TOKENS ?? 96);
  return { enabled, maxTokens };
}
