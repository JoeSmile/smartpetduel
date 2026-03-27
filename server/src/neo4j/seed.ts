import type { ManagedTransaction } from "neo4j-driver";
import { loadGameConfig } from "../config/loadGameConfig.js";
import { getNeo4jDriver } from "./driver.js";

export async function seedGraphFromConfig(): Promise<void> {
  const driver = getNeo4jDriver();
  if (!driver) throw new Error("Neo4j is not configured");
  const cfg = await loadGameConfig();

  const session = driver.session();
  try {
    await session.executeWrite(async (tx: ManagedTransaction) => {
      await tx.run(
        `
        UNWIND $attributes AS attr
        MERGE (a:Attribute {name: attr.name})
        SET a.id = attr.id
        `,
        { attributes: cfg.attributes },
      );

      await tx.run(
        `
        UNWIND $pets AS pet
        MERGE (p:Pet {id: pet.id})
        SET p.name = pet.name,
            p.attribute = pet.attribute,
            p.baseHp = pet.baseHp,
            p.baseAttack = pet.baseAttack
        WITH p, pet
        MATCH (a:Attribute {name: pet.attribute})
        MERGE (p)-[:HAS_ATTRIBUTE]->(a)
        `,
        { pets: cfg.pets },
      );

      await tx.run(
        `
        UNWIND $skills AS sk
        MERGE (s:Skill {id: sk.id})
        SET s.name = sk.name,
            s.type = sk.type,
            s.coefficient = sk.coefficient,
            s.petId = sk.petId
        WITH s, sk
        MATCH (p:Pet {id: sk.petId})
        MERGE (p)-[:HAS_SKILL]->(s)
        `,
        { skills: cfg.skills },
      );

      await tx.run(
        `
        UNWIND $comboSkills AS cs
        MERGE (s:Skill {id: cs.id})
        SET s.name = cs.name,
            s.type = 'combo',
            s.coefficient = cs.coefficient,
            s.isAoe = cs.isAoe,
            s.petAId = cs.petAId,
            s.petBId = cs.petBId
        WITH s, cs
        MATCH (a:Pet {id: cs.petAId})
        MATCH (b:Pet {id: cs.petBId})
        MERGE (a)-[:HAS_SKILL]->(s)
        MERGE (b)-[:HAS_SKILL]->(s)
        `,
        { comboSkills: cfg.comboSkills },
      );

      await tx.run(
        `
        UNWIND $counters AS c
        MATCH (src:Attribute {name: c.from})
        MATCH (dst:Attribute {name: c.to})
        MERGE (src)-[r:COUNTER]->(dst)
        SET r.multiplier = c.multiplier
        `,
        { counters: cfg.counters },
      );

      await tx.run(
        `
        UNWIND $links AS l
        MATCH (a:Pet {id: l.fromPetId})
        MATCH (b:Pet {id: l.toPetId})
        MERGE (a)-[:UNLOCK_BY]->(b)
        `,
        { links: cfg.unlockLinks },
      );
    });
  } finally {
    await session.close();
  }
}
