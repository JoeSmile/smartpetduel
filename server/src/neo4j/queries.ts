import { getNeo4jDriver } from "./driver.js";
import { retryAsync } from "../utils/retry.js";

export async function getPlayerPets(playerId: string): Promise<
  Array<{ id: string; name: string; attribute: string }>
> {
  const driver = getNeo4jDriver();
  if (!driver) return [];
  const session = driver.session();
  try {
    const res = await session.run(
      `
      MATCH (pl:Player {id: $playerId})-[:HAS]->(p:Pet)
      RETURN p.id AS id, p.name AS name, p.attribute AS attribute
      ORDER BY p.id
      `,
      { playerId },
    );
    return res.records.map((r) => ({
      id: String(r.get("id")),
      name: String(r.get("name")),
      attribute: String(r.get("attribute")),
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
