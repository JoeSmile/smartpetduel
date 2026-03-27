import neo4j, { type Driver } from "neo4j-driver";
import { getNeo4jConfig } from "../env.js";

let driver: Driver | null = null;

/**
 * 懒创建 Neo4j Driver；未配置 URI 时返回 null（阶段一只做占位）。
 */
export function getNeo4jDriver(): Driver | null {
  const { uri, user, password } = getNeo4jConfig();
  if (!uri || !user) return null;
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function verifyNeo4jConnectivity(): Promise<
  "ok" | "skipped" | "error"
> {
  const d = getNeo4jDriver();
  if (!d) return "skipped";
  try {
    await d.verifyConnectivity();
    return "ok";
  } catch {
    return "error";
  }
}

export async function closeNeo4jDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
