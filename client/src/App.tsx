import { useEffect, useMemo, useState } from "react";

type PetView = {
  petId: string;
  hp: number;
  maxHp: number;
  alive: boolean;
};

type TeamView = {
  roster: [PetView, PetView, PetView];
  activeIndex: 0 | 1 | 2;
};

type BattleAction =
  | { type: "skill"; skillId: string }
  | { type: "combo"; comboId: string }
  | { type: "switch"; toIndex: 0 | 1 | 2 };

type LegalAction = {
  key: string;
  action: BattleAction;
  source: "skill" | "combo" | "switch";
  score: number;
  reason: string;
};

type BattleEvent =
  | { type: "turn_start"; round: number; firstSide: "A" | "B" }
  | { type: "damage"; from: "A" | "B"; to: "A" | "B"; amount: number; actionId: string; isCrit?: boolean }
  | { type: "action_rejected"; side: "A" | "B"; reason: string }
  | { type: "ko"; side: "A" | "B"; petId: string }
  | { type: "switch"; side: "A" | "B"; toIndex: 0 | 1 | 2 }
  | { type: "auto_switch"; side: "A" | "B"; toIndex: 0 | 1 | 2 }
  | { type: "battle_end"; winner: "A" | "B" };

type BattleState = {
  round: number;
  ended: boolean;
  winner: "A" | "B" | null;
  teamA: TeamView;
  teamB: TeamView;
  events: BattleEvent[];
};

type BattleSession = {
  sessionId: string;
  mode: "pvp" | "pve" | "aivai";
  stateVersion: number;
  status: "pending" | "running" | "finished";
  state: BattleState;
};

type SessionApiResponse = { ok: true; session: BattleSession } | { ok: false; error: string };
type TurnBlock = {
  round: number;
  firstSide: "A" | "B" | "?";
  lines: string[];
  dmgA: number;
  dmgB: number;
};

const DEMO_USER_ID = "demo-player-a";
const ELEMENT_ICON: Record<string, string> = {
  fire: "🔥",
  water: "💧",
  grass: "🌱",
  electric: "⚡",
  light: "✨",
  spirit: "🌙",
};

const PET_META: Record<string, { name: string; attribute: string }> = {
  PET_FIRE_01: { name: "炎绒狐", attribute: "fire" },
  PET_FIRE_02: { name: "烬甲兽", attribute: "fire" },
  PET_FIRE_03: { name: "炽焰狸", attribute: "fire" },
  PET_WATER_01: { name: "沧澜龟", attribute: "water" },
  PET_WATER_02: { name: "幽紫水母", attribute: "water" },
  PET_WATER_03: { name: "沧浪鲸", attribute: "water" },
  PET_GRASS_01: { name: "青芽龙", attribute: "grass" },
  PET_GRASS_02: { name: "叶绒鹿", attribute: "grass" },
  PET_GRASS_03: { name: "木叶精灵", attribute: "grass" },
  PET_SPECIAL_01: { name: "闪光电伊", attribute: "electric" },
  PET_SPECIAL_02: { name: "星甲兽", attribute: "light" },
  PET_SPECIAL_03: { name: "云纹灵猫", attribute: "spirit" },
};

const ACTION_NAME: Record<string, string> = {
  SKILL_FIRE_01_A: "火球",
  SKILL_FIRE_01_B: "灼烧",
  SKILL_FIRE_02_A: "撞击",
  SKILL_FIRE_02_B: "火焰铠甲",
  SKILL_FIRE_03_A: "火焰爪",
  SKILL_FIRE_03_B: "高速突袭",
  SKILL_WATER_01_A: "水浪",
  SKILL_WATER_01_B: "护盾",
  SKILL_WATER_02_A: "毒刺",
  SKILL_WATER_02_B: "麻痹触须",
  SKILL_WATER_03_A: "海啸",
  SKILL_WATER_03_B: "水流压制",
  SKILL_GRASS_01_A: "藤鞭",
  SKILL_GRASS_01_B: "治愈",
  SKILL_GRASS_02_A: "叶刃",
  SKILL_GRASS_02_B: "闪避",
  SKILL_GRASS_03_A: "木刃",
  SKILL_GRASS_03_B: "光合作用",
  SKILL_SPECIAL_01_A: "电击",
  SKILL_SPECIAL_01_B: "高速闪避",
  SKILL_SPECIAL_02_A: "星光冲击",
  SKILL_SPECIAL_02_B: "防御强化",
  SKILL_SPECIAL_03_A: "幻影冲击",
  SKILL_SPECIAL_03_B: "命运闪避",
  COMBO_FIRE_01: "火焰旋风",
  COMBO_FIRE_SPIRIT_01: "火炎爆发",
  COMBO_WATER_01: "沧澜守护",
  COMBO_WATER_GRASS_01A: "剧毒水流",
  COMBO_WATER_GRASS_01B: "疾风叶刃",
  COMBO_GRASS_01: "森林守护",
  COMBO_LIGHTNING_01: "雷霆风暴",
};

async function createSession(): Promise<SessionApiResponse> {
  const res = await fetch("/api/battle/session/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
      teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
      controllers: {
        A: { kind: "human", userId: DEMO_USER_ID },
        B: { kind: "ai", userId: null, aiDifficulty: "medium" },
      },
    }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function getSession(sessionId: string): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${sessionId}`);
  return (await res.json()) as SessionApiResponse;
}

async function getLegalActions(state: BattleState): Promise<LegalAction[]> {
  const res = await fetch("/api/ai/battle/legal-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, side: "A" }),
  });
  const json = (await res.json()) as { ok: boolean; legalActions?: LegalAction[] };
  return json.legalActions ?? [];
}

async function submitAction(input: {
  sessionId: string;
  expectedStateVersion: number;
  action: BattleAction;
}): Promise<SessionApiResponse> {
  const res = await fetch("/api/battle/session/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: "A",
      action: input.action,
      expectedStateVersion: input.expectedStateVersion,
      userId: DEMO_USER_ID,
    }),
  });
  return (await res.json()) as SessionApiResponse;
}

function formatEventLine(evt: BattleEvent): string {
  if (evt.type === "damage") {
    const name = ACTION_NAME[evt.actionId.replace(":splash", "")] ?? evt.actionId;
    const suffix = evt.actionId.endsWith(":splash") ? "·溅射" : "";
    return `${evt.from} -> ${evt.to} 造成 ${evt.amount} 伤害（${name}${suffix}${evt.isCrit ? "，暴击" : ""}）`;
  }
  if (evt.type === "action_rejected") return `${evt.side} 动作被拒绝：${evt.reason}`;
  if (evt.type === "ko") return `${evt.side} 宠物倒下：${evt.petId}`;
  if (evt.type === "switch") return `${evt.side} 主动切换到位次 ${evt.toIndex + 1}`;
  if (evt.type === "auto_switch") return `${evt.side} 自动换宠到位次 ${evt.toIndex + 1}`;
  if (evt.type === "battle_end") return `战斗结束，胜方：${evt.winner}`;
  return `回合开始，先手：${evt.firstSide}`;
}

function buildTurnBlocks(events: BattleEvent[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let current: TurnBlock | null = null;
  for (const evt of events) {
    if (evt.type === "turn_start") {
      if (current) blocks.push(current);
      current = {
        round: evt.round,
        firstSide: evt.firstSide,
        lines: [],
        dmgA: 0,
        dmgB: 0,
      };
      continue;
    }
    if (!current) {
      current = { round: 0, firstSide: "?", lines: [], dmgA: 0, dmgB: 0 };
    }
    current.lines.push(formatEventLine(evt));
    if (evt.type === "damage") {
      if (evt.from === "A") current.dmgA += evt.amount;
      else current.dmgB += evt.amount;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function hpBar(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const fill = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return `${"■".repeat(fill)}${"□".repeat(10 - fill)} ${hp}/${maxHp}`;
}

function petLabel(petId: string): string {
  const meta = PET_META[petId];
  if (!meta) return petId;
  return `${ELEMENT_ICON[meta.attribute] ?? "❔"}${meta.name}`;
}

function padRight(text: string, len: number): string {
  if (text.length >= len) return text.slice(0, len);
  return `${text}${" ".repeat(len - text.length)}`;
}

export function App() {
  const [session, setSession] = useState<BattleSession | null>(null);
  const [legalActions, setLegalActions] = useState<LegalAction[]>([]);
  const [status, setStatus] = useState("未开始");
  const [loading, setLoading] = useState(false);

  const me = session?.state.teamA;
  const enemy = session?.state.teamB;

  const canAct = useMemo(
    () => Boolean(session && !session.state.ended && !loading),
    [session, loading],
  );
  const turnBlocks = useMemo(
    () => buildTurnBlocks(session?.state.events ?? []),
    [session?.state.events],
  );
  const recentBlocks = useMemo(() => turnBlocks.slice(-4), [turnBlocks]);

  useEffect(() => {
    if (!session?.sessionId || session.state.ended) return;
    const timer = setInterval(async () => {
      const res = await getSession(session.sessionId);
      if (!res.ok) return;
      setSession(res.session);
    }, 1800);
    return () => clearInterval(timer);
  }, [session?.sessionId, session?.state.ended]);

  useEffect(() => {
    if (!session || session.state.ended) return;
    void getLegalActions(session.state).then(setLegalActions);
  }, [session?.state.round, session?.state.ended, session?.stateVersion]);

  async function onCreate() {
    setLoading(true);
    setStatus("创建对局中...");
    const res = await createSession();
    setLoading(false);
    if (!res.ok) {
      setStatus(`创建失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("对局已创建");
  }

  async function onAction(action: BattleAction) {
    if (!session) return;
    setLoading(true);
    const res = await submitAction({
      sessionId: session.sessionId,
      expectedStateVersion: session.stateVersion,
      action,
    });
    setLoading(false);
    if (!res.ok) {
      setStatus(`提交失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("已提交动作");
  }

  function buildTextPanel(): string {
    const line = "=".repeat(72);
    const cut = "-".repeat(72);
    if (!session || !me || !enemy) {
      return `${line}\n⌛ 等待创建对局...\n${line}`;
    }
    const myCurrent = me.roster[me.activeIndex];
    const enCurrent = enemy.roster[enemy.activeIndex];
    const lastBlock = recentBlocks[recentBlocks.length - 1];
    const roundTitle = `⚔ 第 ${session.state.round} 回合 · ${session.state.ended ? "战斗结束" : "战斗中"}`;
    const leftTitle = "🐉 己方阵容";
    const rightTitle = "🧌 对方阵容";
    const width = 34;
    const rows = [0, 1, 2].map((i) => {
      const l = me.roster[i as 0 | 1 | 2];
      const r = enemy.roster[i as 0 | 1 | 2];
      const left = `${i === me.activeIndex ? ">" : " "} [${i + 1}] ${petLabel(l.petId)} (${l.hp}/${l.maxHp})`;
      const right = `${i === enemy.activeIndex ? ">" : " "} [${i + 1}] ${petLabel(r.petId)} (${r.hp}/${r.maxHp})`;
      return `${padRight(left, width)} | ${padRight(right, width)}`;
    });
    const actionLines = lastBlock
      ? lastBlock.lines.slice(-3)
      : ["本回合暂无行动记录"];
    const summaryLine = lastBlock
      ? `✨ 回合小结：我方造成 ${lastBlock.dmgA} ｜敌方造成 ${lastBlock.dmgB}`
      : "✨ 回合小结：-";

    return [
      line,
      roundTitle,
      line,
      `${padRight(leftTitle, width)} | ${padRight(rightTitle, width)}`,
      ...rows,
      cut,
      "⚔ 当前出战",
      `己方: ${petLabel(myCurrent.petId)} | HP: ${myCurrent.hp}/${myCurrent.maxHp} | ${hpBar(myCurrent.hp, myCurrent.maxHp)}`,
      `对方: ${petLabel(enCurrent.petId)} | HP: ${enCurrent.hp}/${enCurrent.maxHp} | ${hpBar(enCurrent.hp, enCurrent.maxHp)}`,
      cut,
      "✨ 本回合行动:",
      ...actionLines.map((x) => `- ${x}`),
      summaryLine,
      cut,
      `🎮 操作面板：可选动作 ${legalActions.length} 个（只显示当前可执行，避免刷屏）`,
      line,
    ].join("\n");
  }

  return (
    <main style={{ fontFamily: "monospace", padding: 12, lineHeight: 1.5 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>智宠对决 · 文字对战台</div>
      <div>🔥火 💧水 🌱草 ⚡电 🪨岩 ✨光 🌙暗</div>
      <div>状态: {status}</div>
      <div>
        会话: {session?.sessionId ?? "-"} | 模式: {session?.mode ?? "-"} | 回合:{" "}
        {session?.state.round ?? "-"} | 版本: {session?.stateVersion ?? "-"}
      </div>
      <div>战局: {session?.state.ended ? `已结束，胜方 ${session.state.winner}` : "进行中/未开始"}</div>

      <div style={{ marginTop: 8 }}>
        <button onClick={onCreate} disabled={loading}>
          创建 PvE 对局
        </button>
      </div>

      <pre
        style={{
          marginTop: 10,
          border: "1px solid #ccc",
          padding: 10,
          whiteSpace: "pre-wrap",
          overflowX: "auto",
          background: "#fafafa",
        }}
      >
        {buildTextPanel()}
      </pre>

      <div style={{ marginTop: 10, border: "1px solid #ccc", padding: 8 }}>
        <div style={{ fontWeight: 700 }}>操作面板</div>
        <div>
          提示：优先选择高分动作；若没有合体技，通常是羁绊不足、搭档阵亡或冷却中。
        </div>
        {!canAct ? (
          <div>当前不可操作</div>
        ) : legalActions.length ? (
          legalActions.slice(0, 8).map((x) => (
            <button
              key={x.key}
              onClick={() => void onAction(x.action)}
              disabled={!canAct}
              style={{ marginRight: 6, marginTop: 6 }}
              title={`score=${x.score}, reason=${x.reason}`}
            >
              {x.key}（{ACTION_NAME[x.key.split(":")[1] ?? ""] ?? "动作"}）
            </button>
          ))
        ) : (
          <div>暂无动作（可能在等待 AI 出手或同步中）</div>
        )}
      </div>

      <div style={{ marginTop: 10, border: "1px solid #ccc", padding: 8 }}>
        <div style={{ fontWeight: 700 }}>
          战斗回合索引（最近 {recentBlocks.length} / {turnBlocks.length || 0} 回合）
        </div>
        {recentBlocks.length ? (
          recentBlocks.map((blk) => (
            <div key={`idx-${blk.round}-${blk.lines.length}`}>
              - 第 {blk.round || "?"} 回合 | 先手 {blk.firstSide} | 我方伤害 {blk.dmgA} | 敌方伤害{" "}
              {blk.dmgB}
            </div>
          ))
        ) : (
          <div>暂无日志</div>
        )}
      </div>
    </main>
  );
}

