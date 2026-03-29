/**
 * Text-mode battle UI helpers for terminal / agent streaming output.
 */
import readline from "node:readline";
import type { BattleState } from "../game/engine.js";

export type CatalogPet = {
  id: string;
  name: string;
  attribute: string;
  baseHp: number;
  baseAttack: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** HP bar using ASCII block chars (avoid CJK width issues in bars). */
export function hpBar(cur: number, max: number, width = 14): string {
  if (max <= 0) return "░".repeat(width);
  const filled = clamp(Math.round((cur / max) * width), 0, width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function petName(map: Map<string, CatalogPet>, id: string): string {
  return map.get(id)?.name ?? id;
}

/** Two-column battle snapshot for state (after JSON round-trip rng may be opaque). */
export function renderBattlePanel(input: {
  state: BattleState;
  petById: Map<string, CatalogPet>;
  title?: string;
  stepLabel?: string;
}): string {
  const { state, petById, title = "Smart Pet Duel · PVE", stepLabel } = input;
  const lines: string[] = [];
  const w = 56;
  const top = `╔${"═".repeat(w - 2)}╗`;
  const mid = `╠${"═".repeat(w - 2)}╣`;
  const bot = `╚${"═".repeat(w - 2)}╝`;

  lines.push(top);
  const head = `${title}  ·  第 ${state.round} 回合${state.ended ? "  ·  已结束" : ""}`;
  lines.push(`║ ${head.padEnd(w - 4)} ║`);
  if (stepLabel) {
    lines.push(`║ ${stepLabel.padEnd(w - 4)} ║`);
  }
  lines.push(mid);

  const rowSide = (label: string, side: "A" | "B") => {
    const team = side === "A" ? state.teamA : state.teamB;
    lines.push(`║ ${label.padEnd(w - 4)} ║`);
    for (let i = 0; i < 3; i += 1) {
      const p = team.roster[i]!;
      const tag = i === team.activeIndex ? "★" : " ";
      const st = p.alive ? `${p.hp}/${p.maxHp}` : "倒下";
      const bar = p.alive ? hpBar(p.hp, p.maxHp) : "──────────────";
      const name = petName(petById, p.petId);
      const line = `  ${tag}[${i}] ${name}  ${bar}  ${st}`;
      lines.push(`║ ${line.slice(0, w - 4).padEnd(w - 4)} ║`);
    }
  };

  rowSide("【我方 A】", "A");
  lines.push(`║ ${"".padEnd(w - 4)} ║`);
  rowSide("【对手 B】", "B");
  lines.push(bot);
  return lines.join("\n");
}

export function formatEventLine(ev: Record<string, unknown>): string {
  const t = ev.type as string;
  if (t === "turn_start") {
    return `◇ 回合开始  round=${ev.round}  先手=${ev.firstSide}`;
  }
  if (t === "damage") {
    const crit = ev.isCrit ? " 暴击" : "";
    return `⚔ ${ev.from} → ${ev.to}  伤害 ${ev.amount}${crit}  (${ev.actionId})`;
  }
  if (t === "action_rejected") {
    return `✗ 动作被拒  ${ev.side}  ${ev.reason}`;
  }
  if (t === "ko") {
    return `☆ 击倒  ${ev.side}  ${ev.petId}`;
  }
  if (t === "switch") {
    return `↻ 换人  ${ev.side}  → 位置 ${ev.toIndex}`;
  }
  if (t === "auto_switch") {
    return `↻ 自动上场  ${ev.side}  → 位置 ${ev.toIndex}`;
  }
  if (t === "battle_end") {
    return `★ 战斗结束  胜者 ${ev.winner}`;
  }
  return `· ${JSON.stringify(ev)}`;
}

/** Stream one string to stdout (flush-friendly for Cursor terminal). */
export async function streamOut(
  chunk: string,
  delayMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(chunk, () => {
      if (delayMs > 0) {
        setTimeout(resolve, delayMs);
      } else {
        setImmediate(resolve);
      }
    });
  });
}

export async function streamLine(line: string, delayMs: number): Promise<void> {
  await streamOut(`${line}\n`, delayMs);
}

/**
 * Replace a block of lines in-place (same screen region), instead of appending.
 * Returns `lines.length` for the next call's `previousLineCount`.
 * If stdout is not a TTY (e.g. piped), falls back to printing once without cursor moves.
 */
export function refreshBlockInPlace(
  lines: string[],
  previousLineCount: number,
): number {
  const out = process.stdout;
  if (!out.isTTY) {
    for (const line of lines) {
      out.write(`${line}\n`);
    }
    return lines.length;
  }

  const max = Math.max(previousLineCount, lines.length);
  if (previousLineCount > 0) {
    readline.moveCursor(out, 0, -previousLineCount);
  }
  for (let i = 0; i < max; i += 1) {
    readline.clearLine(out, 0);
    if (i < lines.length) {
      out.write(lines[i]!);
    }
    out.write("\n");
  }
  return lines.length;
}

/** Optional: reduce flicker while redrawing (restore cursor visibility after). */
export function ttyHideCursor(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25l");
}

export function ttyShowCursor(): void {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
}
