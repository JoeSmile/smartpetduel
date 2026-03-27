export const CURRENT_RULESET_ID = "spd_ruleset_v1";

export type RulesetCompat = "compatible" | "incompatible";

export function checkRulesetCompatible(input: {
  runtimeRulesetId: string;
  recordRulesetId: string;
}): RulesetCompat {
  return input.runtimeRulesetId === input.recordRulesetId
    ? "compatible"
    : "incompatible";
}

