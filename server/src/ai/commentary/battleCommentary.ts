import { getCommentaryConfig } from "../../env.js";
import type { BattleEvent } from "../../game/engine.js";
import { chatWithActiveProvider } from "../providers/index.js";

/** Appendix B.4: commentary must not invent integers absent from the grounded context. */
function allowedIntegersFromGrounding(round: number, events: BattleEvent[]): Set<number> {
  const blob = JSON.stringify({ round, events });
  const s = new Set<number>();
  for (const m of blob.matchAll(/\d+/g)) {
    s.add(parseInt(m[0], 10));
  }
  return s;
}

function commentaryViolatesNumericGrounding(text: string, allowed: Set<number>): boolean {
  for (const m of text.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    if (!allowed.has(n)) return true;
  }
  return false;
}

function buildTemplateCommentary(events: BattleEvent[]): string {
  const damages = events.filter((e): e is Extract<BattleEvent, { type: "damage" }> => e.type === "damage");
  const kos = events.filter((e): e is Extract<BattleEvent, { type: "ko" }> => e.type === "ko");
  const highest = damages.reduce(
    (best, cur) => (cur.amount > best.amount ? cur : best),
    { amount: 0, from: "A" as const, to: "B" as const, actionId: "none", type: "damage" as const },
  );
  if (!damages.length && !kos.length) {
    return "本回合双方以试探为主，暂未形成有效击杀。";
  }
  const topLine =
    damages.length > 0
      ? `本回合最高伤害来自 ${highest.from} 方技能 ${highest.actionId}，打出 ${highest.amount} 点伤害。`
      : "本回合双方持续拉扯，关键输出有限。";
  const koLine =
    kos.length > 0
      ? `共出现 ${kos.length} 次击倒事件，战局节奏明显加快。`
      : "暂未出现击倒，双方仍在争夺换人节奏。";
  return `${topLine}${koLine}`;
}

export async function generateBattleCommentary(input: {
  events: BattleEvent[];
  round: number;
  llm?: (args: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ content: string }>;
}): Promise<{
  enabled: boolean;
  commentary: string;
  fallbackUsed: boolean;
}> {
  const cfg = getCommentaryConfig();
  if (!cfg.enabled) {
    return {
      enabled: false,
      commentary: "commentary_disabled",
      fallbackUsed: true,
    };
  }

  const llm = input.llm ?? chatWithActiveProvider;
  const conciseEvents = input.events
    .filter((e) => e.type === "damage" || e.type === "ko" || e.type === "switch")
    .slice(-12);
  const numericAllowlist = allowedIntegersFromGrounding(input.round, conciseEvents);
  try {
    const out = await llm({
      temperature: 0.3,
      maxTokens: cfg.maxTokens,
      messages: [
        {
          role: "system",
          content:
            "你是对战解说员。仅输出1-2句中文解说，不编造事件或数值，不输出JSON。",
        },
        {
          role: "user",
          content: JSON.stringify({
            round: input.round,
            events: conciseEvents,
          }),
        },
      ],
    });
    const text = out.content.trim();
    if (!text) throw new Error("empty_commentary");
    if (commentaryViolatesNumericGrounding(text, numericAllowlist)) {
      throw new Error("commentary_numeric_grounding_failed");
    }
    return { enabled: true, commentary: text, fallbackUsed: false };
  } catch {
    return {
      enabled: true,
      commentary: buildTemplateCommentary(input.events),
      fallbackUsed: true,
    };
  }
}

