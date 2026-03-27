import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { GameConfigJson } from "../../config/loadGameConfig.js";
import type { BattleAction, BattleState } from "../../game/engine.js";
import { chatWithActiveProvider } from "../providers/index.js";
import { listLegalActions, type LegalAction } from "./legalActions.js";
import {
  parsePlannerActionBySchema,
  PLANNER_OUTPUT_JSON_SCHEMA,
} from "./promptProtocol.js";

export type Difficulty = "easy" | "medium" | "hard";
type Side = "A" | "B";

type PlannerState = {
  side: Side;
  difficulty: Difficulty;
  seed: string;
  round: number;
  legalActions: LegalAction[];
  analystNote: string;
  plannedActionKey: string;
  finalAction: BattleAction | null;
  reason: string;
  fallbackUsed: boolean;
};

const PlannerAnnotation = Annotation.Root({
  side: Annotation<Side>(),
  difficulty: Annotation<Difficulty>(),
  seed: Annotation<string>(),
  round: Annotation<number>(),
  legalActions: Annotation<LegalAction[]>(),
  analystNote: Annotation<string>(),
  plannedActionKey: Annotation<string>(),
  finalAction: Annotation<BattleAction | null>(),
  reason: Annotation<string>(),
  fallbackUsed: Annotation<boolean>(),
});

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ruleFallback(state: PlannerState): LegalAction | null {
  if (!state.legalActions.length) return null;
  const ordered = [...state.legalActions];
  if (state.difficulty === "hard") {
    return ordered[0];
  }
  if (state.difficulty === "easy") {
    const lowest = [...ordered].sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
    return lowest[0];
  }
  const idx = hash32(`${state.seed}:${state.round}:${state.side}`) % ordered.length;
  return ordered[idx] ?? ordered[0];
}

export async function decideBattleAiAction(input: {
  state: BattleState;
  config: GameConfigJson;
  side: Side;
  difficulty: Difficulty;
  forceRuleFallback?: boolean;
}): Promise<{
  action: BattleAction | null;
  reason: string;
  fallbackUsed: boolean;
  legalActions: LegalAction[];
}> {
  const legalActions = listLegalActions({
    state: input.state,
    config: input.config,
    side: input.side,
  });

  const graph = new StateGraph(PlannerAnnotation)
    .addNode("analyst", async (s) => {
      return {
        analystNote: `round=${s.round};legal=${s.legalActions.map((x) => x.key).join(",")}`,
      };
    })
    .addNode("planner", async (s) => {
      if (!s.legalActions.length) {
        return { plannedActionKey: "", reason: "no_legal_actions" };
      }
      if (input.forceRuleFallback) {
        return { plannedActionKey: "", reason: "rule_only_mode" };
      }
      try {
        const result = await chatWithActiveProvider({
          temperature: 0.2,
          maxTokens: 120,
          messages: [
            {
              role: "system",
              content:
                `You are a battle action planner. Return strict JSON matching this schema: ${JSON.stringify(
                  PLANNER_OUTPUT_JSON_SCHEMA,
                )}. Choose only from provided legal action keys.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                difficulty: s.difficulty,
                analystNote: s.analystNote,
                legalActionKeys: s.legalActions.map((x) => x.key),
              }),
            },
          ],
        });
        const actionKey = parsePlannerActionBySchema({
          raw: result.content,
          allowedActionKeys: s.legalActions.map((x) => x.key),
        });
        return { plannedActionKey: actionKey, reason: "llm_planner" };
      } catch {
        return { plannedActionKey: "", reason: "llm_unavailable" };
      }
    })
    .addNode("persona", async (s) => {
      const pickedByPlanner = s.legalActions.find((x) => x.key === s.plannedActionKey);
      if (pickedByPlanner) {
        return {
          finalAction: pickedByPlanner.action,
          reason: s.reason || "planner_selected",
          fallbackUsed: false,
        };
      }
      const fb = ruleFallback(s);
      return {
        finalAction: fb?.action ?? null,
        reason: fb ? `rule_fallback:${fb.key}` : "no_action",
        fallbackUsed: true,
      };
    })
    .addEdge(START, "analyst")
    .addEdge("analyst", "planner")
    .addEdge("planner", "persona")
    .addEdge("persona", END)
    .compile();

  const out = await graph.invoke({
    side: input.side,
    difficulty: input.difficulty,
    seed: input.state.seed,
    round: input.state.round,
    legalActions,
    analystNote: "",
    plannedActionKey: "",
    finalAction: null,
    reason: "",
    fallbackUsed: false,
  });

  return {
    action: out.finalAction,
    reason: out.reason,
    fallbackUsed: out.fallbackUsed,
    legalActions,
  };
}

