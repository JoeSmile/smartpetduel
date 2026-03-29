import type { CatalogPet } from "./battleTextUi.js";

export type LineupStrategy =
  | "balanced"
  | "mono-fire"
  | "mono-water"
  | "mono-grass"
  | "random"

/** Deterministic shuffle from seed string (for reproducible demos). */
function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  let s = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    s ^= seedStr.charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function byAttr(pets: CatalogPet[], attr: string): CatalogPet[] {
  return pets.filter((p) => p.attribute === attr);
}

/**
 * Build a 3-pet team from catalog. `salt` varies A vs B lineups.
 * Optional `exclude` avoids duplicate pets on the other side when possible.
 */
export function pickLineup(
  pets: CatalogPet[],
  strategy: LineupStrategy,
  salt: string,
  exclude?: Set<string>,
): [string, string, string] {
  const pool = pets.filter((p) => !exclude?.has(p.id));
  if (pool.length < 3) {
    throw new Error("catalog needs at least 3 pets (after exclude)");
  }

  if (strategy === "balanced") {
    const f = byAttr(pool, "fire")[0];
    const w = byAttr(pool, "water")[0];
    const g = byAttr(pool, "grass")[0];
    if (f && w && g) {
      return [f.id, w.id, g.id];
    }
    const sh = seededShuffle(pool, salt);
    return [sh[0]!.id, sh[1]!.id, sh[2]!.id];
  }

  if (strategy === "mono-fire" || strategy === "mono-water" || strategy === "mono-grass") {
    const attr =
      strategy === "mono-fire" ? "fire" : strategy === "mono-water" ? "water" : "grass";
    const mono = byAttr(pool, attr);
    if (mono.length >= 3) {
      const sh = seededShuffle(mono, salt);
      return [sh[0]!.id, sh[1]!.id, sh[2]!.id];
    }
  }

  const sh = seededShuffle(pool, salt);
  return [sh[0]!.id, sh[1]!.id, sh[2]!.id];
}

/** Parse `PET_1,PET_2,PET_3` from env; returns null if invalid. */
export function parseTeamEnv(raw: string | undefined): [string, string, string] | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  if (new Set(parts).size !== 3) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}
