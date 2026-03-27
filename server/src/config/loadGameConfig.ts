import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type GameConfigJson = {
  version: string;
  gameTitle: string;
  pets: Array<{
    id: string;
    name: string;
    attribute: string;
    baseHp: number;
    baseAttack: number;
  }>;
  attributes: Array<{ id: string; name: string }>;
  counters: Array<{ from: string; to: string; multiplier: number }>;
  skills: Array<{
    id: string;
    petId: string;
    name: string;
    type: string;
    coefficient: number;
  }>;
  comboSkills: Array<{
    id: string;
    petAId: string;
    petBId: string;
    name: string;
    coefficient: number;
    isAoe: boolean;
  }>;
  unlockLinks: Array<{ fromPetId: string; toPetId: string }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadGameConfig(): Promise<GameConfigJson> {
  const root = path.resolve(__dirname, "../../..", "config", "game.json");
  const raw = await readFile(root, "utf-8");
  return JSON.parse(raw) as GameConfigJson;
}
