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
