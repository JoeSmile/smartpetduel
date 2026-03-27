import {
  getBondBetweenPets,
  getCounterMultiplier,
  getPlayerPets,
} from "../../neo4j/queries.js";

export type AllowlistIntent =
  | { type: "player_pets"; playerId: string }
  | { type: "bond_between_pets"; petAId: string; petBId: string }
  | { type: "counter_multiplier"; attacker: string; defender: string };

const SAFE_ID = /^[a-zA-Z0-9_:-]+$/;

function isSafeId(x: string): boolean {
  return SAFE_ID.test(x);
}

export function parseNlToAllowlistIntent(nl: string): AllowlistIntent | null {
  const text = nl.trim();
  if (!text) return null;

  const mPlayer = text.match(/player\s+([a-zA-Z0-9_:-]+)\s+pets/i);
  if (mPlayer?.[1] && isSafeId(mPlayer[1])) {
    return { type: "player_pets", playerId: mPlayer[1] };
  }

  const mBond = text.match(/bond\s+between\s+([a-zA-Z0-9_:-]+)\s+and\s+([a-zA-Z0-9_:-]+)/i);
  if (mBond?.[1] && mBond?.[2] && isSafeId(mBond[1]) && isSafeId(mBond[2])) {
    return { type: "bond_between_pets", petAId: mBond[1], petBId: mBond[2] };
  }

  const mCounter = text.match(/counter\s+([a-zA-Z0-9_:-]+)\s+vs\s+([a-zA-Z0-9_:-]+)/i);
  if (
    mCounter?.[1] &&
    mCounter?.[2] &&
    isSafeId(mCounter[1]) &&
    isSafeId(mCounter[2])
  ) {
    return {
      type: "counter_multiplier",
      attacker: mCounter[1],
      defender: mCounter[2],
    };
  }
  return null;
}

export async function executeAllowlistIntent(intent: AllowlistIntent): Promise<unknown> {
  if (intent.type === "player_pets") {
    return getPlayerPets(intent.playerId);
  }
  if (intent.type === "bond_between_pets") {
    return getBondBetweenPets(intent.petAId, intent.petBId);
  }
  return getCounterMultiplier(intent.attacker, intent.defender);
}

