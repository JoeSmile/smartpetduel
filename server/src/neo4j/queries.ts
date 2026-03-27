import { getNeo4jDriver } from "./driver.js";

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
