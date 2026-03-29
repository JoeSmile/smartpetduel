import type { CatalogPet } from "./battleTextUi.js";
import { question } from "./pveReadline.js";
import { pickLineup, type LineupStrategy } from "./pveLineup.js";

function parseIndex(raw: string, max: number): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return n - 1;
}

/** Print catalog as numbered list (1-based for humans). */
export function printPetCatalog(pets: CatalogPet[]): void {
  const byAttr = new Map<string, CatalogPet[]>();
  for (const p of pets) {
    const a = p.attribute;
    if (!byAttr.has(a)) byAttr.set(a, []);
    byAttr.get(a)!.push(p);
  }
  console.log("\n—— 图鉴（按属性）——");
  for (const attr of [...byAttr.keys()].sort()) {
    console.log(`\n【${attr}】`);
    for (const p of byAttr.get(attr)!) {
      const idx = pets.indexOf(p) + 1;
      console.log(
        `  ${String(idx).padStart(2)}. ${p.name}  ${p.id}  HP${p.baseHp}  ATK${p.baseAttack}`,
      );
    }
  }
  console.log("\n—— 序号总表（选阵时填下面序号）——");
  pets.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${p.name} (${p.id})`);
  });
  console.log("");
}

/**
 * Pick 3 distinct pets by 1-based index, three prompts.
 */
export async function interactivePickTeam(
  label: string,
  pets: CatalogPet[],
): Promise<[string, string, string]> {
  const ids: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    let ok = false;
    while (!ok) {
      const raw = await question(
        `【${label}】第 ${i + 1} 只：输入序号 1–${pets.length}（已选 ${i}/3）: `,
      );
      const idx = parseIndex(raw, pets.length);
      if (idx === null) {
        console.log("  无效序号，请重试。");
        continue;
      }
      const id = pets[idx]!.id;
      if (used.has(id)) {
        console.log("  这只已选过，请选别的。");
        continue;
      }
      used.add(id);
      ids.push(id);
      ok = true;
    }
  }
  return [ids[0]!, ids[1]!, ids[2]!];
}

export async function interactivePickOpponentTeam(input: {
  pets: CatalogPet[];
  teamA: [string, string, string];
  strategy: LineupStrategy;
  seed: string;
}): Promise<[string, string, string]> {
  const { pets, teamA, strategy, seed } = input;
  const exclude = new Set(teamA);
  console.log("\n对手阵容：");
  console.log("  r — 随机生成（与你方不重复宠）");
  console.log("  m — 手动选三只（与选我方相同）");
  let mode = "";
  while (mode !== "r" && mode !== "m") {
    mode = (await question("请选择 [r/m]: ")).toLowerCase();
    if (mode !== "r" && mode !== "m") {
      console.log("  请输入 r 或 m");
    }
  }
  if (mode === "r") {
    return pickLineup(
      pets,
      strategy === "random" ? "random" : "balanced",
      `${seed}-B`,
      exclude,
    );
  }
  printPetCatalog(pets);
  return interactivePickTeam("对手", pets);
}
