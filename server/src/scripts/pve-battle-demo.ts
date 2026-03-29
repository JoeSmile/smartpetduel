/**
 * PvE demo: login → **可选交互选阵** → 开战 → 回合（可自动或手动选招）.
 * Text-mode UI: `SPD_UI_MODE=inplace` 时同屏刷新；`scroll` 为滚动日志。
 *
 * Env:
 *   SPD_BASE           API base (default http://127.0.0.1:3000)
 *   SPD_STRATEGY       balanced | mono-fire | mono-water | mono-grass | random（自动选阵时用）
 *   SPD_TEAM_A / B     覆盖阵容: PET_x,PET_y,PET_z
 *   SPD_INTERACTIVE    1（默认，TTY 且无 TEAM_* 时）交互选阵；0 强制自动选阵
 *   SPD_MANUAL_TURNS   1 = 每回合手动选招；0 = 自动选最高分（默认）
 *   SPD_STREAM_MS      仅用于阶段标题等行延迟
 *   SPD_UI_MODE        inplace | scroll
 *   SPD_COMPACT        1 = 只打印每手一行摘要，不画面板/长战报
 */
import type { BattleAction, BattleState } from "../game/engine.js";
import {
  formatEventLine,
  refreshBlockInPlace,
  renderBattlePanel,
  streamLine,
  ttyHideCursor,
  ttyShowCursor,
  type CatalogPet,
} from "./battleTextUi.js";
import {
  interactivePickOpponentTeam,
  interactivePickTeam,
  printPetCatalog,
} from "./pveInteractiveLineup.js";
import { parseTeamEnv, pickLineup, type LineupStrategy } from "./pveLineup.js";
import { isStdinTty, question } from "./pveReadline.js";

const BASE = process.env.SPD_BASE ?? "http://127.0.0.1:3000";
const PREFIX = `${BASE}/skill/v1`;
const STREAM_MS = Number(process.env.SPD_STREAM_MS ?? "8");
const delay = Number.isFinite(STREAM_MS) && STREAM_MS >= 0 ? STREAM_MS : 8;
const UI_MODE = (process.env.SPD_UI_MODE ?? "inplace").toLowerCase();
const SCROLL_MODE = UI_MODE === "scroll";

const STRATEGY = (process.env.SPD_STRATEGY ?? "balanced").toLowerCase() as LineupStrategy;
const validStrategies: LineupStrategy[] = [
  "balanced",
  "mono-fire",
  "mono-water",
  "mono-grass",
  "random",
];
const strategy: LineupStrategy = validStrategies.includes(STRATEGY as LineupStrategy)
  ? (STRATEGY as LineupStrategy)
  : "balanced";

const MANUAL_TURNS = (process.env.SPD_MANUAL_TURNS ?? "0").toLowerCase() === "1";
const COMPACT = (process.env.SPD_COMPACT ?? "0").toLowerCase() === "1";

function useInteractiveLineup(): boolean {
  if (COMPACT) return false;
  if ((process.env.SPD_INTERACTIVE ?? "1").toLowerCase() === "0") return false;
  if (!isStdinTty()) return false;
  if (process.env.SPD_TEAM_A && process.env.SPD_TEAM_B) return false;
  return true;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON ${r.status}: ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${JSON.stringify(data)}`);
  }
  return data as T;
}

function petMap(catalog: { pets: CatalogPet[] }): Map<string, CatalogPet> {
  return new Map(catalog.pets.map((p) => [p.id, p]));
}

function buildDynamicLines(input: {
  state: BattleState;
  names: Map<string, CatalogPet>;
  step: number;
  actionLabel: string | null;
  eventFromIndex: number;
}): string[] {
  const { state, names, step, actionLabel, eventFromIndex } = input;
  const lines: string[] = [];
  if (actionLabel) {
    lines.push(actionLabel);
  }
  const panel = renderBattlePanel({
    state,
    petById: names,
    stepLabel: step > 0 ? `操作步 #${step}` : "开战快照",
  });
  lines.push(...panel.split("\n"));
  lines.push("── 本回合战报 ──");
  const slice = state.events.slice(eventFromIndex);
  if (slice.length === 0) {
    lines.push("   （暂无新事件）");
  } else {
    for (const ev of slice) {
      lines.push(`   ${formatEventLine(ev as Record<string, unknown>)}`);
    }
  }
  return lines;
}

/** One-line summary for SPD_COMPACT (new events this submit). */
function compactEventsSummary(events: unknown[]): string {
  if (events.length === 0) return "（无新事件）";
  return events
    .map((ev) => formatEventLine(ev as Record<string, unknown>))
    .join(" ｜ ");
}

async function pickActionForTurn(
  step: number,
  legal: Array<{ action: BattleAction; score: number; key: string }>,
): Promise<(typeof legal)[number]> {
  if (!MANUAL_TURNS || legal.length <= 1) {
    return legal[0]!;
  }
  console.log(`\n—— 第 ${step + 1} 手 · 请选择行动 ——`);
  legal.forEach((x, i) => {
    console.log(`  ${i + 1}. ${x.key}  (score ${x.score})`);
  });
  let choice: (typeof legal)[number] | undefined;
  while (!choice) {
    const raw = await question(`输入序号 1–${legal.length}: `);
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > legal.length) {
      console.log("  无效，请重试。");
      continue;
    }
    choice = legal[n - 1];
  }
  return choice!;
}

async function main(): Promise<void> {
  const account = `demo-${Date.now()}@pve.local`;
  const interactive = useInteractiveLineup();

  if (!COMPACT) {
    await streamLine("", 0);
    await streamLine("╔══════════════════════════════════════════════════════════╗", delay);
    await streamLine(
      `║     智宠对决 · PVE（${SCROLL_MODE ? "滚动" : "原地"} · ${interactive ? "交互选阵" : "自动选阵"}）              ║`,
      delay,
    );
    await streamLine("╚══════════════════════════════════════════════════════════╝", delay);
    await streamLine(`  API: ${BASE}`, delay);
    await streamLine("", delay);
  }

  if (!COMPACT) await streamLine("【1/4】登录 —— 正在注册会话账号…", delay);
  const login = await j<{
    ok: boolean;
    sessionToken: string;
    user: { id: string; nickname: string | null };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account }),
  });
  const token = login.sessionToken;
  const userId = login.user.id;
  const auth = { Authorization: `Bearer ${token}` };
  if (!COMPACT) {
    await streamLine(`  已登录：${account}  userId=${userId.slice(0, 8)}…`, delay);
    await streamLine("", delay);
  }

  if (!COMPACT) await streamLine("【2/4】图鉴 —— 拉取 catalog…", delay);
  const catalogRes = await j<{ ok: boolean; pets: CatalogPet[] }>("/game/catalog", {
    method: "GET",
  });
  const catalog = catalogRes.pets;
  const names = petMap({ pets: catalog });
  if (!COMPACT) await streamLine(`  共 ${catalog.length} 只宠物可上场。`, delay);

  const customA = parseTeamEnv(process.env.SPD_TEAM_A);
  const customB = parseTeamEnv(process.env.SPD_TEAM_B);
  const seedBase = `pve-${Date.now()}`;

  let teamA: [string, string, string];
  let teamB: [string, string, string];

  if (interactive && !customA) {
    await streamLine("", delay);
    await streamLine("【3/4】选阵 —— 请依次选择我方 3 只上场宠（序号见下表）", delay);
    printPetCatalog(catalog);
    teamA = await interactivePickTeam("我方", catalog);
  } else {
    if (!COMPACT) {
      await streamLine("", delay);
      await streamLine(
        `【3/4】选阵 —— 自动（策略 ${strategy}${customA ? "，已用 SPD_TEAM_A" : ""}）`,
        delay,
      );
    }
    teamA = customA ?? pickLineup(catalog, strategy, `${seedBase}-A`);
  }

  const excludeB = new Set(teamA);
  if (interactive && !customB) {
    teamB = await interactivePickOpponentTeam({
      pets: catalog,
      teamA,
      strategy,
      seed: seedBase,
    });
  } else {
    if (!COMPACT && (!interactive || customB)) {
      await streamLine(
        customB
          ? "  对手阵容：来自 SPD_TEAM_B"
          : `  对手阵容：自动生成（与己方尽量不重复）`,
        delay,
      );
    }
    teamB =
      customB ??
      pickLineup(catalog, strategy === "random" ? "random" : "balanced", `${seedBase}-B`, excludeB);
  }

  for (const id of [...teamA, ...teamB]) {
    if (!names.has(id)) {
      throw new Error(`Unknown pet id in lineup: ${id}`);
    }
  }

  const labelA = teamA.map((id) => `${names.get(id)?.name ?? id}`).join(" / ");
  const labelB = teamB.map((id) => `${names.get(id)?.name ?? id}`).join(" / ");
  if (COMPACT) {
    console.log(
      `[compact] A: ${labelA}  vs  B: ${labelB}  |  autoPlay=${!MANUAL_TURNS}`,
    );
  } else {
    await streamLine("", delay);
    await streamLine("【4/4】开战 —— 阵容确认", delay);
    await streamLine(`  我方 A：${labelA}`, delay);
    await streamLine(`  对手 B：${labelB}`, delay);
    if (MANUAL_TURNS) {
      await streamLine(`  本局：每回合手动选招（SPD_MANUAL_TURNS=1）`, delay);
    } else {
      await streamLine(`  本局：我方自动选当前合法行动中 score 最高者（设 SPD_MANUAL_TURNS=1 可手动）`, delay);
    }
    await streamLine("", delay);
  }

  const created = await j<{
    ok: boolean;
    session: {
      sessionId: string;
      stateVersion: number;
      state: BattleState | null;
    };
  }>("/battle/session/create", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      teamA,
      teamB,
      controllers: {
        A: { kind: "human", userId },
        B: { kind: "ai", userId: null, aiDifficulty: "medium" },
      },
      seed: `pve-demo-${Date.now()}`,
    }),
  });

  const sessionId = created.session.sessionId;
  let version = created.session.stateVersion;
  if (!created.session.state) {
    throw new Error("Expected battle state after create");
  }
  let state: BattleState = created.session.state;

  if (!COMPACT) {
    await streamLine(`  sessionId: ${sessionId}`, delay);
    await streamLine("", delay);
    await streamLine("════════ 战斗开始 · 下方为回合过程 ════════", delay);
    await streamLine("", delay);
  }

  let eventShownThrough = 0;
  let dynamicLineCount = 0;

  const redraw = (lines: string[]) => {
    if (SCROLL_MODE) {
      for (const line of lines) {
        process.stdout.write(`${line}\n`);
      }
      dynamicLineCount = 0;
      return;
    }
    dynamicLineCount = refreshBlockInPlace(lines, dynamicLineCount);
  };

  if (!SCROLL_MODE && !COMPACT) {
    ttyHideCursor();
  }

  try {
    if (!COMPACT) {
      redraw(
        buildDynamicLines({
          state,
          names,
          step: 0,
          actionLabel: null,
          eventFromIndex: eventShownThrough,
        }),
      );
    }
    eventShownThrough = state.events.length;
    if (COMPACT) {
      console.log("—— 每手一行（回合引擎事件摘要）——");
    }

    for (let step = 0; step < 200; step += 1) {
      if (state.ended) {
        break;
      }

      type LegalRes = {
        ok: boolean;
        legalActions: Array<{ action: BattleAction; score: number; key: string }>;
      };
      const legalRes: LegalRes = await j<LegalRes>("/ai/battle/legal-actions", {
        method: "POST",
        body: JSON.stringify({ state, side: "A" }),
      });
      const legal = legalRes.legalActions;
      if (!legal.length) {
        if (!SCROLL_MODE && !COMPACT) ttyShowCursor();
        await streamLine("无合法动作，停止。", delay);
        return;
      }

      if (MANUAL_TURNS && !SCROLL_MODE && !COMPACT) {
        ttyShowCursor();
      }
      const chosen = await pickActionForTurn(step, legal);
      if (MANUAL_TURNS && !SCROLL_MODE && !COMPACT) {
        ttyHideCursor();
      }

      type SubRes = {
        ok: boolean;
        session: { stateVersion: number; state: BattleState | null; status: string };
      };
      const sub: SubRes = await j<SubRes>("/battle/session/submit", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          sessionId,
          side: "A",
          action: chosen.action,
          expectedStateVersion: version,
          userId,
        }),
      });

      const nextState = sub.session.state;
      if (!nextState) {
        throw new Error("Missing state after submit");
      }
      state = nextState;
      version = sub.session.stateVersion;

      const fromIdx = eventShownThrough;
      const newEvents = state.events.slice(fromIdx, state.events.length);
      if (COMPACT) {
        console.log(
          `第${step + 1}手 · ${chosen.key} · ${compactEventsSummary(newEvents as unknown[])}`,
        );
      } else {
        redraw(
          buildDynamicLines({
            state,
            names,
            step: step + 1,
            actionLabel: `▶▶ 第 ${step + 1} 手 · 我方选择 ${chosen.key}  (score ${chosen.score})`,
            eventFromIndex: fromIdx,
          }),
        );
      }
      eventShownThrough = state.events.length;

      if (state.ended) {
        break;
      }
    }

    if (!SCROLL_MODE && !COMPACT) {
      ttyShowCursor();
    }
    if (state.ended) {
      if (!COMPACT) process.stdout.write("\n");
      console.log(`结束 · 胜者 ${state.winner}`);
    } else {
      await streamLine("达到步数上限。", delay);
    }
  } catch (e) {
    if (!SCROLL_MODE && !COMPACT) ttyShowCursor();
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
