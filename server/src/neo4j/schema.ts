import { getNeo4jDriver } from "./driver.js";

const schemaQueries = [
  "CREATE CONSTRAINT player_id_unique IF NOT EXISTS FOR (p:Player) REQUIRE p.id IS UNIQUE",
  "CREATE CONSTRAINT pet_id_unique IF NOT EXISTS FOR (p:Pet) REQUIRE p.id IS UNIQUE",
  "CREATE CONSTRAINT skill_id_unique IF NOT EXISTS FOR (s:Skill) REQUIRE s.id IS UNIQUE",
  "CREATE CONSTRAINT attribute_name_unique IF NOT EXISTS FOR (a:Attribute) REQUIRE a.name IS UNIQUE",
  "CREATE CONSTRAINT battle_id_unique IF NOT EXISTS FOR (b:Battle) REQUIRE b.id IS UNIQUE",
  "CREATE INDEX pet_attribute_idx IF NOT EXISTS FOR (p:Pet) ON (p.attribute)",
  "CREATE INDEX skill_pet_id_idx IF NOT EXISTS FOR (s:Skill) ON (s.petId)",
];

export async function applySchema(): Promise<void> {
  const driver = getNeo4jDriver();
  if (!driver) throw new Error("Neo4j is not configured");

  const session = driver.session();
  try {
    for (const q of schemaQueries) {
      await session.run(q);
    }
  } finally {
    await session.close();
  }
}
