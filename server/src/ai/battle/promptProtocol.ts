export const PLANNER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    actionKey: { type: "string" },
  },
  required: ["actionKey"],
  additionalProperties: false,
} as const;

export function parsePlannerActionBySchema(input: {
  raw: string;
  allowedActionKeys: string[];
}): string {
  try {
    const obj = JSON.parse(input.raw) as unknown;
    if (!obj || typeof obj !== "object") return "";
    const rec = obj as { actionKey?: unknown };
    if (typeof rec.actionKey !== "string") return "";
    if (!input.allowedActionKeys.includes(rec.actionKey)) return "";
    return rec.actionKey;
  } catch {
    return "";
  }
}

