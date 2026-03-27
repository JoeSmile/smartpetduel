import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

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
  provider: "openclaw" | "doubao";
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
} {
  const rawProvider = (process.env.LLM_PROVIDER ?? "doubao").toLowerCase();
  const provider = rawProvider === "openclaw" ? "openclaw" : "doubao";
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
  return { provider, baseUrl, apiKey, chatModel, embedModel };
}

export function getChannelAuthConfig(): {
  openclawSecret: string;
  doubaoSecret: string;
} {
  const openclawSecret = process.env.CHANNEL_SIGN_SECRET_OPENCLAW ?? "";
  const doubaoSecret = process.env.CHANNEL_SIGN_SECRET_DOUBAO ?? "";
  return { openclawSecret, doubaoSecret };
}
