/** 天梯 Elo（与 PRD 十节 2 一致的可选服务端计分） */
export const DEFAULT_ELO = 1500;
const K = 32;

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** A 方得分：胜 1、负 0（无平局） */
export function computeEloPair(ra: number, rb: number, scoreA: 0 | 1): { newRa: number; newRb: number } {
  const ea = expectedScore(ra, rb);
  const eb = 1 - ea;
  const sa = scoreA;
  const sb = 1 - scoreA;
  const newRa = Math.round(ra + K * (sa - ea));
  const newRb = Math.round(rb + K * (sb - eb));
  return { newRa, newRb };
}
