import { computeEloPair, DEFAULT_ELO } from "../game/elo.js";
import { getNeo4jDriver } from "./driver.js";
import { retryAsync } from "../utils/retry.js";

export async function getPlayerPets(playerId: string): Promise<
  Array<{ id: string; name: string; attribute: string; level: number }>
> {
  const driver = getNeo4jDriver();
  if (!driver) return [];
  const session = driver.session();
  try {
    const res = await session.run(
      `
      MATCH (pl:Player {id: $playerId})-[h:HAS]->(p:Pet)
      RETURN p.id AS id, p.name AS name, p.attribute AS attribute, coalesce(h.level, 1) AS level
      ORDER BY level DESC, p.id
      `,
      { playerId },
    );
    return res.records.map((r) => ({
      id: String(r.get("id")),
      name: String(r.get("name")),
      attribute: String(r.get("attribute")),
      level: Number(r.get("level") ?? 1),
    }));
  } finally {
    await session.close();
  }
}

export async function getBondBetweenPets(
  petAId: string,
  petBId: string,
): Promise<{ level: number; battles: number } | null> {
  const driver = getNeo4jDriver();
  if (!driver) return null;
  const session = driver.session();
  try {
    const res = await session.run(
      `
      MATCH (a:Pet {id: $petAId})-[r:HAS_BOND]->(b:Pet {id: $petBId})
      RETURN r.level AS level, r.battles AS battles
      UNION
      MATCH (a:Pet {id: $petBId})-[r:HAS_BOND]->(b:Pet {id: $petAId})
      RETURN r.level AS level, r.battles AS battles
      LIMIT 1
      `,
      { petAId, petBId },
    );
    if (!res.records.length) return null;
    return {
      level: Number(res.records[0].get("level") ?? 0),
      battles: Number(res.records[0].get("battles") ?? 0),
    };
  } finally {
    await session.close();
  }
}

export async function getCounterMultiplier(
  attackerAttribute: string,
  defenderAttribute: string,
): Promise<number> {
  const driver = getNeo4jDriver();
  if (!driver) return 1.0;
  const session = driver.session();
  try {
    const res = await session.run(
      `
      MATCH (a:Attribute {name: $attackerAttribute})-[r:COUNTER]->(b:Attribute {name: $defenderAttribute})
      RETURN r.multiplier AS multiplier
      LIMIT 1
      `,
      { attackerAttribute, defenderAttribute },
    );
    if (!res.records.length) return 1.0;
    return Number(res.records[0].get("multiplier"));
  } finally {
    await session.close();
  }
}

export async function updateBattleProgressWithRetry(input: {
  playerId: string;
  petIds: string[];
  pairBattles: Array<{ petAId: string; petBId: string; battles: number }>;
  maxAttempts?: number;
}): Promise<"ok" | "skipped"> {
  const driver = getNeo4jDriver();
  if (!driver) return "skipped";

  await retryAsync(
    async () => {
      const session = driver.session();
      try {
        await session.executeWrite(async (tx) => {
          await tx.run(
            `
            MERGE (pl:Player {id: $playerId})
            WITH pl
            UNWIND $petIds AS petId
            MATCH (p:Pet {id: petId})
            MERGE (pl)-[h:HAS]->(p)
            ON CREATE SET h.battleCount = 0, h.level = 1
            SET h.battleCount = coalesce(h.battleCount, 0) + 1,
                h.level = toInteger(floor((coalesce(h.battleCount, 0) + 1) / 5.0)) + 1
            `,
            { playerId: input.playerId, petIds: input.petIds },
          );

          await tx.run(
            `
            UNWIND $pairBattles AS pb
            MATCH (a:Pet {id: pb.petAId})
            MATCH (b:Pet {id: pb.petBId})
            MERGE (a)-[r:HAS_BOND]->(b)
            ON CREATE SET r.battles = 0, r.level = 1
            SET r.battles = coalesce(r.battles, 0) + pb.battles,
                r.level = toInteger(floor((coalesce(r.battles, 0) + pb.battles) / 3.0)) + 1
            `,
            { pairBattles: input.pairBattles },
          );
        });
      } finally {
        await session.close();
      }
    },
    { maxAttempts: input.maxAttempts ?? 3, delayMs: 120 },
  );
  return "ok";
}

/** PvP 结束更新双方 Elo；人机 / PvE 不应调用 */
export async function applyPvpEloWithRetry(input: {
  winner: "A" | "B";
  userIdA: string;
  userIdB: string;
  maxAttempts?: number;
}): Promise<"ok" | "skipped"> {
  const driver = getNeo4jDriver();
  if (!driver) return "skipped";

  const scoreA: 0 | 1 = input.winner === "A" ? 1 : 0;

  await retryAsync(
    async () => {
      const session = driver.session();
      try {
        await session.executeWrite(async (tx) => {
          await tx.run(
            `MERGE (a:Player {id: $idA})
             ON CREATE SET a.eloRating = $def`,
            { idA: input.userIdA, def: DEFAULT_ELO },
          );
          await tx.run(
            `MERGE (b:Player {id: $idB})
             ON CREATE SET b.eloRating = $def`,
            { idB: input.userIdB, def: DEFAULT_ELO },
          );
          const r = await tx.run(
            `MATCH (a:Player {id: $idA}), (b:Player {id: $idB})
             RETURN coalesce(a.eloRating, $def) AS ra, coalesce(b.eloRating, $def) AS rb`,
            { idA: input.userIdA, idB: input.userIdB, def: DEFAULT_ELO },
          );
          if (!r.records.length) return;
          const ra = Number(r.records[0].get("ra"));
          const rb = Number(r.records[0].get("rb"));
          const { newRa, newRb } = computeEloPair(ra, rb, scoreA);
          await tx.run(
            `MATCH (a:Player {id: $idA}), (b:Player {id: $idB})
             SET a.eloRating = $newRa, b.eloRating = $newRb`,
            {
              idA: input.userIdA,
              idB: input.userIdB,
              newRa,
              newRb,
            },
          );
        });
      } finally {
        await session.close();
      }
    },
    { maxAttempts: input.maxAttempts ?? 3, delayMs: 120 },
  );
  return "ok";
}

export async function getLadderLeaderboard(limit: number): Promise<
  Array<{ playerId: string; eloRating: number }>
> {
  const driver = getNeo4jDriver();
  if (!driver) return [];
  const session = driver.session();
  try {
    const res = await session.run(
      `
      MATCH (p:Player)
      RETURN p.id AS playerId, coalesce(p.eloRating, $def) AS eloRating
      ORDER BY eloRating DESC, playerId ASC
      LIMIT $limit
      `,
      { limit: Math.min(100, Math.max(1, limit)), def: DEFAULT_ELO },
    );
    return res.records.map((rec) => ({
      playerId: String(rec.get("playerId")),
      eloRating: Number(rec.get("eloRating")),
    }));
  } finally {
    await session.close();
  }
}

/** 1-based rank：并列时按「高于本人分数的人数 + 1」 */
export async function getPlayerLadderRank(playerId: string): Promise<{
  rank: number;
  eloRating: number;
  totalPlayers: number;
} | null> {
  const driver = getNeo4jDriver();
  if (!driver) return null;
  const session = driver.session();
  try {
    const cnt = await session.run(
      `MATCH (p:Player) RETURN count(p) AS total`,
      {},
    );
    const totalPlayers = Number(cnt.records[0]?.get("total") ?? 0);

    const me = await session.run(
      `
      OPTIONAL MATCH (pl:Player {id: $playerId})
      RETURN coalesce(pl.eloRating, $def) AS myElo
      `,
      { playerId, def: DEFAULT_ELO },
    );
    const myElo = Number(me.records[0]?.get("myElo") ?? DEFAULT_ELO);

    const ahead = await session.run(
      `
      MATCH (p:Player)
      WHERE coalesce(p.eloRating, $def) > $myElo
      RETURN count(p) AS n
      `,
      { myElo, def: DEFAULT_ELO },
    );
    const n = Number(ahead.records[0]?.get("n") ?? 0);
    return {
      rank: n + 1,
      eloRating: myElo,
      totalPlayers,
    };
  } finally {
    await session.close();
  }
}
