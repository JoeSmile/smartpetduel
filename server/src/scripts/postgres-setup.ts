import "dotenv/config";
import { closePostgresPool, verifyPostgresConnectivity } from "../postgres/driver.js";
import { applyPostgresSchema } from "../postgres/schema.js";

async function main(): Promise<void> {
  const status = await verifyPostgresConnectivity();
  if (status !== "ok") {
    throw new Error("Postgres connectivity failed. Check server/.env.");
  }
  await applyPostgresSchema();
  console.log("[postgres] schema applied");
}

main()
  .catch((err) => {
    console.error("[postgres] setup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
