import {
  chatWithActiveProvider,
  embedWithActiveProvider,
  getAiProviderHealth,
} from "../ai/providers/index.js";
import { isAiProviderError } from "../ai/providers/errors.js";

async function main(): Promise<void> {
  const health = await getAiProviderHealth();
  if (health.status === "not_configured") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "llm_not_configured",
          provider: health.provider,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (health.status !== "ok") {
    console.error(
      JSON.stringify(
        {
          ok: false,
          stage: "health",
          provider: health.provider,
          status: health.status,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const chat = await chatWithActiveProvider({
    messages: [
      {
        role: "system",
        content: "Reply with one short sentence.",
      },
      {
        role: "user",
        content: "Say hello from SmartPet Duel smoke test.",
      },
    ],
    temperature: 0,
    maxTokens: 64,
  });
  const embed = await embedWithActiveProvider({
    input: ["PET_FIRE_01 lineup", "PET_WATER_01 counter"],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: health.provider,
        health: health.status,
        chatPreview: chat.content.slice(0, 120),
        embedVectorCount: embed.vectors.length,
        embedDim: embed.vectors[0]?.length ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  if (isAiProviderError(err)) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "llm_smoke_failed",
          code: err.code,
          detail: err.message,
          status: err.status ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  console.error(`[llm-smoke] ${String(err)}`);
  process.exit(1);
});

