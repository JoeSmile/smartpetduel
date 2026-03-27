import { embedWithActiveProvider } from "../providers/index.js";

type AdviceDocType = "lineup" | "battle_report";

type AdviceDoc = {
  id: string;
  type: AdviceDocType;
  text: string;
  vector: number[];
  metadata?: Record<string, string | number | boolean>;
};

const docs = new Map<string, AdviceDoc>();
const LOCAL_EMBED_DIM = 16;

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
}

