import type { GameConfigJson } from "../../config/loadGameConfig.js";
import { embedWithActiveProvider } from "../providers/index.js";

export type AdviceDocType = "lineup" | "battle_report" | "pet_profile";

type AdviceDoc = {
  id: string;
  type: AdviceDocType;
  text: string;
  vector: number[];
  metadata?: Record<string, string | number | boolean>;
};

const docs = new Map<string, AdviceDoc>();
const LOCAL_EMBED_DIM = 16;

/** Avoid re-embedding the whole catalog on every request within one process. */
let indexedPetCatalogVersion: string | null = null;

function l2Normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm <= 0) return v.map(() => 0);
  return v.map((x) => x / norm);
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function localEmbed(text: string): number[] {
  const v = new Array<number>(LOCAL_EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  for (const t of tokens) {
    const h = hash32(t);
    const idx = h % LOCAL_EMBED_DIM;
    v[idx] += 1;
  }
  return l2Normalize(v);
}

async function embedText(text: string): Promise<number[]> {
  try {
    const out = await embedWithActiveProvider({ input: text });
    const vec = out.vectors[0];
    if (!vec?.length) return localEmbed(text);
    return l2Normalize(vec);
  } catch {
    return localEmbed(text);
  }
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

export async function upsertAdviceDoc(input: {
  id: string;
  type: AdviceDocType;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  const vector = await embedText(input.text);
  docs.set(input.id, {
    id: input.id,
    type: input.type,
    text: input.text,
    vector,
    metadata: input.metadata,
  });
}

export function buildPetProfileText(
  pet: GameConfigJson["pets"][number],
  skills: GameConfigJson["skills"],
): string {
  const petSkills = skills.filter((s) => s.petId === pet.id);
  const skillPart = petSkills.map((s) => `${s.name}:${s.type}`).join(" ");
  return `${pet.id} ${pet.name} attribute:${pet.attribute} hp:${pet.baseHp} atk:${pet.baseAttack} skills:${skillPart}`;
}

export async function indexPetCatalogFromConfig(config: GameConfigJson): Promise<void> {
  for (const pet of config.pets) {
    const text = buildPetProfileText(pet, config.skills);
    await upsertAdviceDoc({
      id: `pet:${pet.id}`,
      type: "pet_profile",
      text,
      metadata: { petId: pet.id, name: pet.name, attribute: pet.attribute },
    });
  }
  indexedPetCatalogVersion = config.version;
}

export async function ensurePetCatalogIndexed(config: GameConfigJson): Promise<void> {
  if (indexedPetCatalogVersion === config.version) return;
  await indexPetCatalogFromConfig(config);
}

export async function querySimilarPets(input: {
  queryText?: string;
  petId?: string;
  config: GameConfigJson;
  topK?: number;
}): Promise<
  Array<{
    id: string;
    type: AdviceDocType;
    score: number;
    text: string;
    metadata?: Record<string, string | number | boolean>;
  }>
> {
  await ensurePetCatalogIndexed(input.config);
  let queryText: string;
  if (input.petId) {
    const pet = input.config.pets.find((p) => p.id === input.petId);
    if (!pet) return [];
    queryText = buildPetProfileText(pet, input.config.skills);
  } else if (input.queryText?.trim()) {
    queryText = input.queryText.trim();
  } else {
    return [];
  }
  return querySimilarAdvice({
    queryText,
    type: "pet_profile",
    topK: input.topK ?? 5,
  });
}

export async function explainLineupRecommendation(input: {
  petIds: string[];
  config: GameConfigJson;
  topK?: number;
}): Promise<{
  members: Array<{
    petId: string;
    name: string;
    attribute: string;
    similar: Array<{
      petId: string;
      name: string;
      attribute: string;
      score: number;
    }>;
  }>;
  summary: string;
  note: string;
}> {
  const topK = Math.max(1, input.topK ?? 3);
  await ensurePetCatalogIndexed(input.config);
  const members: Array<{
    petId: string;
    name: string;
    attribute: string;
    similar: Array<{ petId: string; name: string; attribute: string; score: number }>;
  }> = [];

  for (const pid of input.petIds) {
    const pet = input.config.pets.find((p) => p.id === pid);
    if (!pet) continue;
    const hits = await querySimilarPets({
      petId: pid,
      config: input.config,
      topK: topK + 4,
    });
    const similar = hits
      .filter((h) => String(h.metadata?.petId ?? "") !== pid)
      .slice(0, topK)
      .map((h) => ({
        petId: String(h.metadata?.petId ?? h.id.replace(/^pet:/, "")),
        name: String(h.metadata?.name ?? ""),
        attribute: String(h.metadata?.attribute ?? ""),
        score: h.score,
      }));
    members.push({
      petId: pet.id,
      name: pet.name,
      attribute: pet.attribute,
      similar,
    });
  }

  const summary = members
    .map((m) => {
      const names = m.similar.map((s) => s.name).filter(Boolean);
      const tail = names.length ? names.join("、") : "—";
      return `${m.name}（${m.attribute}）相近风格：${tail}`;
    })
    .join("；");

  return {
    members,
    summary,
    note: "explanatory_similarity_only_no_stat_override",
  };
}

export async function querySimilarAdvice(input: {
  queryText: string;
  type?: AdviceDocType;
  topK?: number;
}): Promise<
  Array<{
    id: string;
    type: AdviceDocType;
    score: number;
    text: string;
    metadata?: Record<string, string | number | boolean>;
  }>
> {
  const q = await embedText(input.queryText);
  const topK = Math.max(1, input.topK ?? 3);
  const candidates = [...docs.values()].filter((d) => {
    if (!input.type) return true;
    return d.type === input.type;
  });
  return candidates
    .map((d) => ({
      id: d.id,
      type: d.type,
      score: dot(q, d.vector),
      text: d.text,
      metadata: d.metadata,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topK);
}

export function clearAdviceDocsForTest(): void {
  docs.clear();
  indexedPetCatalogVersion = null;
}

