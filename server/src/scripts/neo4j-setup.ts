import "dotenv/config";
import { closeNeo4jDriver, verifyNeo4jConnectivity } from "../neo4j/driver.js";
import { applySchema } from "../neo4j/schema.js";
import { seedGraphFromConfig } from "../neo4j/seed.js";

async function main(): Promise<void> {
  const status = await verifyNeo4jConnectivity();
  if (status !== "ok") {
    throw new Error(
      `Neo4j connectivity is '${status}'. Check server/.env and Neo4j service.`,
    );
  }

  await applySchema();
  await seedGraphFromConfig();
  console.log("[neo4j] schema applied and seed completed");
}

main()
  .catch((err) => {
    console.error("[neo4j] setup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeNeo4jDriver();
  });
