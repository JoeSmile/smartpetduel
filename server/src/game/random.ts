function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type DeterministicRng = {
  seed: string;
  cursor: number;
};

export function createRng(seed: string): DeterministicRng {
  return { seed, cursor: 0 };
}

export function nextRandom01(rng: DeterministicRng): number {
  const n = hash32(`${rng.seed}:${rng.cursor}`);
  rng.cursor += 1;
  return n / 0xffffffff;
}

