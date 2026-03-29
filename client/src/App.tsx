import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

type PetView = {
  petId: string;
  hp: number;
  maxHp: number;
  attack: number;
  attribute: string;
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
  bondLevelBySide?: Record<"A" | "B", Record<string, number>>;
};

type SideController = {
  kind: "human" | "ai";
  userId: string | null;
  aiDifficulty?: "easy" | "medium" | "hard";
};

type PvpLobbySnapshot = {
  teamA: [string, string, string] | null;
  teamB: [string, string, string] | null;
  readyA: boolean;
  readyB: boolean;
};

type BattleSession = {
  sessionId: string;
  mode: "pvp" | "pve" | "aivai";
  stateVersion: number;
  status: "pending" | "running" | "finished";
  phase?: "lobby" | "battle";
  lobby?: PvpLobbySnapshot | null;
  state: BattleState | null;
  controllers?: { A: SideController; B: SideController };
  pendingActions?: Partial<Record<"A" | "B", BattleAction>>;
  humanTurnTimeoutSec?: number;
  awaitingHumanSince?: string | null;
  lastAutopilot?: { side: "A" | "B"; at: string } | null;
  clientChannel?: string | null;
};

type SessionApiResponse = { ok: true; session: BattleSession } | { ok: false; error: string };
type TurnBlock = {
  round: number;
  firstSide: "A" | "B" | "?";
  lines: string[];
  dmgA: number;
  dmgB: number;
};

type AuthUser = {
  id: string;
  registerType: "email" | "phone";
  email: string | null;
  phone: string | null;
  nickname: string | null;
};

const STORAGE_TOKEN = "sp_session_token";
const STORAGE_CSRF = "sp_csrf_token";
const DEMO_USER_ID = "demo-player-a";

const ELEMENT_ICON: Record<string, string> = {
  fire: "🔥",
  water: "💧",
  grass: "🌱",
  electric: "⚡",
  light: "✨",
  spirit: "🌙",
};

const ATTR_LABEL: Record<string, string> = {
  fire: "火",
  water: "水",
  grass: "草",
  electric: "电",
  light: "光",
  spirit: "灵",
};

function attrIconLabel(attr: string) {
  return (
    <>
      <span aria-hidden style={{ marginRight: 1 }}>
        {ELEMENT_ICON[attr] ?? "❔"}
      </span>
      {ATTR_LABEL[attr] ?? attr}
    </>
  );
}

type InventoryPet = {
  id: string;
  name: string;
  attribute: string;
  level: number;
};

type GameCatalog = {
  pets: Array<{
    id: string;
    name: string;
    attribute: string;
    baseHp: number;
    baseAttack: number;
  }>;
  skills: Array<{
    id: string;
    petId: string;
    name: string;
    type: string;
    coefficient: number;
  }>;
  comboSkills?: Array<{
    id: string;
    petAId: string;
    petBId: string;
    name: string;
    coefficient: number;
    isAoe: boolean;
  }>;
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

/** 与 config/game.json 中 12 宠一致，用于创建对局 */
const DEFAULT_TEAM_A: [string, string, string] = [
  "PET_FIRE_01",
  "PET_FIRE_02",
  "PET_WATER_01",
];
/** PvP 战前大厅：双方各自提交阵容（HTTP PATCH），准备后由房主开战 */
const DEFAULT_TEAM_B: [string, string, string] = [
  "PET_GRASS_01",
  "PET_GRASS_02",
  "PET_SPECIAL_01",
];
const ALL_PET_IDS: string[] = Object.keys(PET_META).sort();

/** 敌方 AI：从全库随机 3 只，互不重复 */
function randomLineupB(): [string, string, string] {
  const pool = [...ALL_PET_IDS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return [pool[0]!, pool[1]!, pool[2]!];
}

function validateLineup(
  a: [string, string, string],
  b: [string, string, string],
): string | null {
  if (new Set(a).size !== 3) return "我方 3 只宠物须互不相同";
  if (new Set(b).size !== 3) return "敌方 3 只宠物须互不相同";
  return null;
}

/** 同时拥有解锁链两端时，只保留高阶（to），隐藏低阶（from） */
function hideLowerTierWhenHigherOwned(
  pets: InventoryPet[],
  unlockLinks: Array<{ fromPetId: string; toPetId: string }>,
): InventoryPet[] {
  const ids = new Set(pets.map((p) => p.id));
  const hide = new Set<string>();
  for (const { fromPetId, toPetId } of unlockLinks) {
    if (ids.has(fromPetId) && ids.has(toPetId)) hide.add(fromPetId);
  }
  return pets.filter((p) => !hide.has(p.id));
}

function petOptionLabelFromInventory(p: InventoryPet): string {
  const icon = ELEMENT_ICON[p.attribute] ?? "❔";
  const lab = ATTR_LABEL[p.attribute] ?? p.attribute;
  return `${icon}[${lab}] ${p.name} · Lv.${p.level}`;
}

function petOptionLabelFromCatalogId(id: string): string {
  const m = PET_META[id];
  if (!m) return id;
  const icon = ELEMENT_ICON[m.attribute] ?? "❔";
  const lab = ATTR_LABEL[m.attribute] ?? m.attribute;
  return `${icon}[${lab}] ${m.name}`;
}

function referenceDamageHint(
  baseAttack: number,
  coefficient: number,
  skillType: string,
): string | null {
  if (coefficient <= 0) return null;
  if (
    skillType === "damage" ||
    skillType === "damage_dot" ||
    skillType === "aoe_damage" ||
    skillType === "control"
  ) {
    const v = Math.max(1, Math.floor(baseAttack * coefficient));
    return `参考伤害约 ${v}（攻击×系数，未计克制/羁绊/暴击）`;
  }
  return null;
}

function PetHoverPanel({ petId, catalog }: { petId: string; catalog: GameCatalog }) {
  const pet = catalog.pets.find((p) => p.id === petId);
  const skills = catalog.skills.filter((s) => s.petId === petId);
  if (!pet) {
    return <div style={{ fontSize: 11 }}>暂无图鉴数据</div>;
  }
  return (
    <div style={{ fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{pet.name}</div>
      <div style={{ color: "#555", marginBottom: 6 }}>
        {ELEMENT_ICON[pet.attribute] ?? "❔"}[{ATTR_LABEL[pet.attribute] ?? pet.attribute}] 攻击{" "}
        {pet.baseAttack} ｜ HP {pet.baseHp}
      </div>
      <div style={{ fontWeight: 600, borderTop: "1px solid #e0e0e0", paddingTop: 4 }}>技能与参考伤害</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 14 }}>
        {skills.map((s) => {
          const hint = referenceDamageHint(pet.baseAttack, s.coefficient, s.type);
          return (
            <li key={s.id} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ color: "#666" }}>
                {s.type} ｜ 系数 {s.coefficient}
              </div>
              {hint ? <div style={{ color: "#176" }}>{hint}</div> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PetLineupDropdown({
  value,
  petIds,
  renderOptionLabel,
  onChange,
  catalog,
  disabled,
}: {
  value: string;
  petIds: string[];
  renderOptionLabel: (id: string) => string;
  onChange: (id: string) => void;
  catalog: GameCatalog | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", display: "inline-block", verticalAlign: "middle", marginLeft: 6 }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        style={{
          maxWidth: 280,
          fontSize: 12,
          textAlign: "left",
          padding: "4px 8px",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {renderOptionLabel(value)} <span style={{ opacity: 0.55 }}>▾</span>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "100%",
            left: 0,
            marginTop: 2,
            minWidth: 268,
            maxHeight: 300,
            overflowY: "auto",
            overflowX: "visible",
            background: "#fff",
            border: "1px solid #aaa",
            boxShadow: "0 4px 14px rgba(0,0,0,.14)",
          }}
        >
          {petIds.map((id) => (
            <div
              key={id}
              style={{ position: "relative" }}
              onMouseEnter={() => setHoverId(id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <button
                type="button"
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  fontSize: 12,
                  border: "none",
                  borderBottom: "1px solid #eee",
                  background: hoverId === id ? "#eef6ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                {renderOptionLabel(id)}
              </button>
              {hoverId === id ? (
                catalog ? (
                  <div
                    style={{
                      borderTop: "1px solid #ddeeff",
                      background: "#f7fbff",
                      padding: 8,
                    }}
                  >
                    <PetHoverPanel petId={id} catalog={catalog} />
                  </div>
                ) : (
                  <div
                    style={{
                      borderTop: "1px solid #eee",
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "#666",
                    }}
                  >
                    图鉴加载中…
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_TOKEN);
}

function getStoredCsrf(): string | null {
  return localStorage.getItem(STORAGE_CSRF);
}

function apiHeaders(json = true): HeadersInit {
  const h: Record<string, string> = {
    "x-client-channel": "web",
  };
  if (json) h["content-type"] = "application/json";
  const t = getStoredToken();
  if (t) h.authorization = `Bearer ${t}`;
  return h;
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
  return `回合 ${evt.round} 开始，先手：${evt.firstSide}`;
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

function lastTurnStart(events: BattleEvent[]): { round: number; firstSide: "A" | "B" } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === "turn_start") return { round: e.round, firstSide: e.firstSide };
  }
  return null;
}

/** 按事件顺序维护场上索引，将伤害归属到当时出手方的上场宠物（含溅射） */
function computeBattleDamageStats(state: BattleState): {
  byPet: Array<{ petId: string; side: "A" | "B"; damage: number }>;
  totalA: number;
  totalB: number;
} {
  let activeA: 0 | 1 | 2 = 0;
  let activeB: 0 | 1 | 2 = 0;
  const petDamage = new Map<string, { side: "A" | "B"; damage: number }>();
  let totalA = 0;
  let totalB = 0;

  const add = (petId: string, side: "A" | "B", amount: number) => {
    const cur = petDamage.get(petId);
    if (cur) cur.damage += amount;
    else petDamage.set(petId, { side, damage: amount });
    if (side === "A") totalA += amount;
    else totalB += amount;
  };

  for (const e of state.events) {
    if (e.type === "damage") {
      const side = e.from;
      const idx = side === "A" ? activeA : activeB;
      const team = side === "A" ? state.teamA : state.teamB;
      const petId = team.roster[idx].petId;
      add(petId, side, e.amount);
    } else if (e.type === "switch") {
      if (e.side === "A") activeA = e.toIndex;
      else activeB = e.toIndex;
    } else if (e.type === "auto_switch") {
      if (e.side === "A") activeA = e.toIndex;
      else activeB = e.toIndex;
    }
  }

  const byPet = [...petDamage.entries()]
    .map(([petId, v]) => ({ petId, side: v.side, damage: v.damage }))
    .sort((a, b) => b.damage - a.damage);

  return { byPet, totalA, totalB };
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

function bondSummary(side: "A" | "B", state: BattleState): string {
  const m = state.bondLevelBySide?.[side];
  if (!m || !Object.keys(m).length) return "羁绊：—";
  return Object.entries(m)
    .map(([k, v]) => `${k.split("|").map((id) => PET_META[id]?.name ?? id).join("+")}:Lv${v}`)
    .join(" ｜ ");
}

function actionButtonLabel(key: string): string {
  const colon = key.indexOf(":");
  const kind = colon >= 0 ? key.slice(0, colon) : key;
  const rest = colon >= 0 ? key.slice(colon + 1) : "";
  if (kind === "switch") return `切换位次 ${Number(rest) + 1}`;
  return ACTION_NAME[rest] ?? rest;
}

const SKILL_TYPE_HINT: Record<string, string> = {
  damage: "单体伤害",
  damage_dot: "持续伤害",
  aoe_damage: "群体伤害",
  shield: "护盾",
  heal: "治疗",
  control: "控制",
  debuff: "减益",
  evade: "闪避",
  regen: "持续回复",
  buff: "增益",
};

function skillHoverTitle(
  sk: { type: string; coefficient: number; name: string },
  currentAttack: number,
): string {
  const kind = SKILL_TYPE_HINT[sk.type] ?? sk.type;
  const t = sk.type;
  const isDamageKind =
    t === "damage" || t === "damage_dot" || t === "aoe_damage" || t === "control";
  if (isDamageKind) {
    if (sk.coefficient > 0) {
      const v = Math.max(1, Math.floor(currentAttack * sk.coefficient));
      return `${kind} · 参考伤害约 ${v}（当前攻击 ${currentAttack} × 系数 ${sk.coefficient}，未计属性克制、羁绊与暴击）`;
    }
    return `${kind} · 系数 ${sk.coefficient}`;
  }
  if (t === "heal") {
    return `治疗 · 意图为回复生命（系数 ${sk.coefficient}；实际数值以战斗结算为准）`;
  }
  if (t === "shield") {
    return `护盾 · 意图为抵挡或吸收伤害（系数 ${sk.coefficient}）`;
  }
  if (t === "evade") {
    return `闪避 · 规避或降低被命中（系数 ${sk.coefficient}）`;
  }
  if (t === "debuff") {
    return `减益 · 削弱对手（系数 ${sk.coefficient}）`;
  }
  if (t === "buff") {
    return `增益 · 强化己方（系数 ${sk.coefficient}）`;
  }
  if (t === "regen") {
    return `持续回复 · 持续恢复生命（系数 ${sk.coefficient}）`;
  }
  return `${sk.name} · ${kind} · 系数 ${sk.coefficient}`;
}

function comboHoverTitle(
  c: { coefficient: number; isAoe: boolean },
  currentAttack: number,
): string {
  const scope = c.isAoe ? "群体" : "单体";
  if (c.coefficient <= 0) {
    return `${scope}合体 · 合体系数 ${c.coefficient}（守护/辅助向，效果以战斗结算为准） · 需对应羁绊 Lv≥3，每场至多 2 次`;
  }
  const main = Math.max(1, Math.floor(currentAttack * c.coefficient));
  let s = `${scope}合体 · 参考主目标伤害约 ${main}（当前攻击 ${currentAttack} × 合体系数 ${c.coefficient}，未计克制/羁绊/暴击）`;
  if (c.isAoe) {
    s += `；溅射替补伤害约 floor(主伤害×0.3)`;
  }
  s += ` · 需对应羁绊 Lv≥3，每场至多 2 次`;
  return s;
}

function legalActionButtonLines(
  la: LegalAction,
  catalog: GameCatalog | null,
  teamA: TeamView | undefined,
  currentAttack: number,
): { primary: string; secondary: string; title: string } {
  const colon = la.key.indexOf(":");
  const kind = colon >= 0 ? la.key.slice(0, colon) : la.key;
  const rest = colon >= 0 ? la.key.slice(colon + 1) : "";

  if (kind === "switch") {
    const idx = Number(rest) as 0 | 1 | 2;
    const pet = teamA?.roster[idx];
    const who = pet ? petLabel(pet.petId) : `位次 ${idx + 1}`;
    return {
      primary: `切换上场 · ${who}`,
      secondary: `换下当前上场宠物，由替补位 ${idx + 1} 出战`,
      title: `切换上场：${who}（位次 ${idx + 1}）`,
    };
  }

  if (kind === "skill") {
    const sk = catalog?.skills.find((s) => s.id === rest);
    const name = sk?.name ?? ACTION_NAME[rest] ?? rest;
    const title = sk
      ? skillHoverTitle(sk, currentAttack)
      : `图鉴未加载，仅知技能名：${name}`;
    return {
      primary: name,
      secondary: "",
      title,
    };
  }

  if (kind === "combo") {
    const c = catalog?.comboSkills?.find((x) => x.id === rest);
    const name = c?.name ?? ACTION_NAME[rest] ?? rest;
    const scope = c ? (c.isAoe ? "群体" : "单体") : "—";
    const secondary = c
      ? `合体技 · ${scope} · 合体系数 ${c.coefficient} · 需对应羁绊 Lv≥3，每场至多 2 次`
      : "合体技（加载图鉴后可看完整说明）";
    const title = c ? comboHoverTitle(c, currentAttack) : `合体 · ${name}（图鉴未加载）`;
    return {
      primary: `合体 · ${name}`,
      secondary,
      title,
    };
  }

  return {
    primary: actionButtonLabel(la.key),
    secondary: la.reason,
    title: `${la.key}（${la.reason}）`,
  };
}

async function createSession(
  userId: string,
  teamA: [string, string, string],
  teamB: [string, string, string],
): Promise<SessionApiResponse> {
  const res = await fetch("/api/battle/session/create", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      teamA,
      teamB,
      controllers: {
        A: { kind: "human", userId },
        B: { kind: "ai", userId: null, aiDifficulty: "medium" },
      },
      clientChannel: "web",
    }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function createPvpSession(
  creatorUserId: string,
  opponentUserId: string,
): Promise<SessionApiResponse> {
  const res = await fetch("/api/battle/session/create", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      controllers: {
        A: { kind: "human", userId: creatorUserId },
        B: { kind: "human", userId: opponentUserId.trim() },
      },
      clientChannel: "web",
    }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function patchPvpLineup(
  sessionId: string,
  side: "A" | "B",
  team: [string, string, string],
  expectedStateVersion: number,
): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${encodeURIComponent(sessionId)}/lineup`, {
    method: "PATCH",
    headers: apiHeaders(),
    body: JSON.stringify({ side, team, expectedStateVersion }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function postPvpReady(
  sessionId: string,
  side: "A" | "B",
  expectedStateVersion: number,
): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${encodeURIComponent(sessionId)}/ready`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ side, expectedStateVersion }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function postPvpStart(sessionId: string, expectedStateVersion: number): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ expectedStateVersion }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function postPvpRematch(sessionId: string, expectedStateVersion: number): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${encodeURIComponent(sessionId)}/rematch`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ expectedStateVersion }),
  });
  return (await res.json()) as SessionApiResponse;
}

async function getSession(sessionId: string): Promise<SessionApiResponse> {
  const res = await fetch(`/api/battle/session/${sessionId}`, { headers: apiHeaders(false) });
  return (await res.json()) as SessionApiResponse;
}

async function getLegalActions(state: BattleState, side: "A" | "B"): Promise<LegalAction[]> {
  const res = await fetch("/api/ai/battle/legal-actions", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ state, side }),
  });
  const json = (await res.json()) as { ok: boolean; legalActions?: LegalAction[] };
  return json.legalActions ?? [];
}

async function submitAction(input: {
  sessionId: string;
  side: "A" | "B";
  expectedStateVersion: number;
  action: BattleAction;
  userId: string;
}): Promise<SessionApiResponse> {
  const res = await fetch("/api/battle/session/submit", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: input.side,
      action: input.action,
      expectedStateVersion: input.expectedStateVersion,
      userId: input.userId,
    }),
  });
  return (await res.json()) as SessionApiResponse;
}

const panelStyle: CSSProperties = {
  border: "1px solid #ccc",
  padding: 10,
  marginTop: 8,
  background: "#fafafa",
};

const headingStyle: CSSProperties = { fontWeight: 700, marginBottom: 6 };

const logScrollBox: CSSProperties = {
  maxHeight: 240,
  overflowY: "auto",
  border: "1px solid #ddd",
  padding: 8,
  background: "#fff",
  fontSize: 12,
};

export function App() {
  const [session, setSession] = useState<BattleSession | null>(null);
  const [legalActions, setLegalActions] = useState<LegalAction[]>([]);
  const [status, setStatus] = useState("未开始");
  const [loading, setLoading] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authForm, setAuthForm] = useState({ account: "" });
  const [lineupA, setLineupA] = useState<[string, string, string]>(() => [...DEFAULT_TEAM_A]);
  /** 仅作默认占位（PvE 敌方随机；PvP 大厅内由各方自行 PATCH） */
  const [lineupB, setLineupB] = useState<[string, string, string]>(() => [...DEFAULT_TEAM_B]);
  const [matchMode, setMatchMode] = useState<"pve" | "pvp">("pve");
  const [opponentUserId, setOpponentUserId] = useState("");
  /** null = 加载中；有数据 = 图谱返回并经解锁链去低阶后的背包 */
  const [teamAInventory, setTeamAInventory] = useState<InventoryPet[] | null>(null);
  const [gameCatalog, setGameCatalog] = useState<GameCatalog | null>(null);
  const [ladderInfo, setLadderInfo] = useState<{
    rows: Array<{ playerId: string; eloRating: number }>;
    self: { rank: number; eloRating: number; totalPlayers: number } | null;
  } | null>(null);

  const effectiveUserId = authUser?.id ?? DEMO_USER_ID;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get("joinPvp");
    if (!join) return;
    let cancelled = false;
    void (async () => {
      const res = await getSession(join);
      if (cancelled) return;
      if (res.ok) {
        setSession(res.session);
        setStatus("已从邀请链接载入 PvP 对局");
      } else {
        setStatus(`加入失败: ${res.error}`);
      }
      params.delete("joinPvp");
      const q = params.toString();
      const url = `${window.location.pathname}${q ? `?${q}` : ""}`;
      window.history.replaceState({}, "", url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSession = useCallback(async (sid: string) => {
    const res = await getSession(sid);
    if (res.ok) setSession(res.session);
  }, []);

  /** PvP 房间内全程轮询：大厅、对战中等待对方、终局后等待房主「再来一局」等 */
  useEffect(() => {
    if (session?.mode !== "pvp" || !session.sessionId) return;
    const sid = session.sessionId;
    const id = window.setInterval(() => {
      void refreshSession(sid);
    }, 2000);
    return () => window.clearInterval(id);
  }, [session?.mode, session?.sessionId, refreshSession]);

  useEffect(() => {
    void (async () => {
      const t = getStoredToken();
      if (!t) return;
      const res = await fetch("/api/auth/me", { headers: apiHeaders(false) });
      const json = (await res.json()) as { ok?: boolean; user?: AuthUser };
      if (json.ok && json.user) setAuthUser(json.user);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/game/catalog");
        const json = (await res.json()) as {
          ok?: boolean;
          pets?: GameCatalog["pets"];
          skills?: GameCatalog["skills"];
          comboSkills?: GameCatalog["comboSkills"];
        };
        if (json.ok && json.pets && json.skills) {
          setGameCatalog({
            pets: json.pets,
            skills: json.skills,
            comboSkills: json.comboSkills ?? [],
          });
        }
      } catch {
        setGameCatalog(null);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [topRes, selfRes] = await Promise.all([
          fetch("/api/graph/ladder?limit=8"),
          fetch(`/api/graph/ladder/player/${encodeURIComponent(effectiveUserId)}`),
        ]);
        const topJson = (await topRes.json()) as {
          ok?: boolean;
          rows?: Array<{ playerId: string; eloRating: number }>;
        };
        const selfJson = (await selfRes.json()) as {
          ok?: boolean;
          rank?: number;
          eloRating?: number;
          totalPlayers?: number;
        };
        if (cancelled) return;
        if (topJson.ok && topJson.rows) {
          setLadderInfo({
            rows: topJson.rows,
            self:
              selfRes.ok && selfJson.ok && selfJson.rank !== undefined
                ? {
                    rank: selfJson.rank,
                    eloRating: Number(selfJson.eloRating ?? 1500),
                    totalPlayers: Number(selfJson.totalPlayers ?? 0),
                  }
                : null,
          });
        } else {
          setLadderInfo(null);
        }
      } catch {
        if (!cancelled) setLadderInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setTeamAInventory(null);
      try {
        const [petsRes, linksRes] = await Promise.all([
          fetch(`/api/graph/player/${encodeURIComponent(effectiveUserId)}/pets`),
          fetch("/api/game/unlock-links"),
        ]);
        const petsJson = (await petsRes.json()) as {
          pets?: Array<{ id: string; name: string; attribute: string; level?: number }>;
        };
        const linksJson = (await linksRes.json()) as {
          ok?: boolean;
          unlockLinks?: Array<{ fromPetId: string; toPetId: string }>;
        };
        if (cancelled) return;
        const raw: InventoryPet[] = (petsJson.pets ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          attribute: p.attribute,
          level: typeof p.level === "number" ? p.level : 1,
        }));
        const links = linksJson.unlockLinks ?? [];
        setTeamAInventory(hideLowerTierWhenHigherOwned(raw, links));
      } catch {
        if (!cancelled) setTeamAInventory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  const teamAStrictInventory = useMemo(() => {
    if (!teamAInventory || teamAInventory.length < 3) return null;
    return teamAInventory;
  }, [teamAInventory]);

  const teamAPetIdOptions = useMemo(() => {
    if (!teamAInventory) return [];
    if (teamAStrictInventory) return teamAStrictInventory.map((p) => p.id);
    return ALL_PET_IDS;
  }, [teamAInventory, teamAStrictInventory]);

  const renderLabelTeamA = useCallback(
    (id: string) => {
      if (teamAStrictInventory) {
        const row = teamAStrictInventory.find((p) => p.id === id);
        return row ? petOptionLabelFromInventory(row) : petOptionLabelFromCatalogId(id);
      }
      return petOptionLabelFromCatalogId(id);
    },
    [teamAStrictInventory],
  );

  useEffect(() => {
    if (!teamAStrictInventory) return;
    const ids = teamAStrictInventory.map((p) => p.id);
    setLineupA((prev) => {
      const valid =
        prev.every((id) => ids.includes(id)) && new Set(prev).size === 3;
      if (valid) return prev;
      return [ids[0]!, ids[1]!, ids[2]!] as [string, string, string];
    });
  }, [teamAStrictInventory]);

  const mySide = useMemo<"A" | "B">(() => {
    if (!session?.controllers) return "A";
    const a = session.controllers.A;
    const b = session.controllers.B;
    if (a.kind === "human" && a.userId === effectiveUserId) return "A";
    if (b.kind === "human" && b.userId === effectiveUserId) return "B";
    return "A";
  }, [session, effectiveUserId]);

  const inActivePvpRoom = Boolean(session?.mode === "pvp" && session.sessionId);

  const inLobby = Boolean(
    session?.mode === "pvp" &&
      (session.phase === "lobby" ||
        (session.state == null && session.phase !== "battle")),
  );

  const me = useMemo(() => {
    if (!session?.state) return undefined;
    return mySide === "A" ? session.state.teamA : session.state.teamB;
  }, [session, mySide]);
  const enemy = useMemo(() => {
    if (!session?.state) return undefined;
    return mySide === "A" ? session.state.teamB : session.state.teamA;
  }, [session, mySide]);

  const lobbyDraftTeam = useMemo((): [string, string, string] => {
    if (!session?.lobby) return mySide === "A" ? lineupA : lineupB;
    const t = mySide === "A" ? session.lobby.teamA : session.lobby.teamB;
    if (t) return t;
    return mySide === "A" ? lineupA : lineupB;
  }, [session?.lobby, mySide, lineupA, lineupB]);

  const canAct = useMemo(() => {
    if (!session?.state || inLobby || session.state.ended || loading) return false;
    if (session.pendingActions?.[mySide]) return false;
    return true;
  }, [session, loading, mySide, inLobby]);

  const turnBlocks = useMemo(
    () => buildTurnBlocks(session?.state?.events ?? []),
    [session?.state?.events],
  );
  const lastStart = useMemo(
    () => lastTurnStart(session?.state?.events ?? []),
    [session?.state?.events],
  );

  useEffect(() => {
    if (!session?.sessionId || !session.state || session.state.ended || inLobby) {
      setLegalActions([]);
      return;
    }
    void getLegalActions(session.state, mySide).then(setLegalActions);
  }, [
    session?.state?.round,
    session?.state?.ended,
    session?.stateVersion,
    session?.state,
    mySide,
    inLobby,
  ]);

  async function onCreate() {
    if (teamAStrictInventory) {
      const allowed = new Set(teamAStrictInventory.map((p) => p.id));
      for (const id of lineupA) {
        if (!allowed.has(id)) {
          setStatus("我方阵容须从当前图谱背包中选择（每只不可重复）");
          return;
        }
      }
    }
    const teamBRandom = randomLineupB();
    const bad = validateLineup(lineupA, teamBRandom);
    if (bad) {
      setStatus(bad);
      return;
    }
    setLoading(true);
    setStatus("创建对局中...");
    const res = await createSession(effectiveUserId, lineupA, teamBRandom);
    setLoading(false);
    if (!res.ok) {
      setStatus(`创建失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("对局已创建（等待式：请用「刷新局面」或提交操作后同步状态）");
  }

  async function onCreatePvp() {
    if (!authUser) {
      setStatus("PvP 邀请须先登录（双方须为已注册用户）");
      return;
    }
    const opp = opponentUserId.trim();
    if (!opp || opp === authUser.id) {
      setStatus("请填写对手的用户 ID（UUID），且不能与自己相同");
      return;
    }
    if (teamAStrictInventory) {
      const allowed = new Set(teamAStrictInventory.map((p) => p.id));
      for (const id of lineupA) {
        if (!allowed.has(id)) {
          setStatus("我方阵容须从当前图谱背包中选择（每只不可重复）");
          return;
        }
      }
    }
    if (new Set(lineupA).size !== 3) {
      setStatus("我方 3 只宠物须互不相同");
      return;
    }
    setLoading(true);
    setStatus("创建 PvP 房间（战前大厅）…");
    const res = await createPvpSession(authUser.id, opp);
    setLoading(false);
    if (!res.ok) {
      setStatus(`创建失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("房间已创建：双方进入大厅自选阵容并准备，房主点击「开始对战」");
    if (res.session.phase === "lobby" && res.session.controllers?.A.userId === authUser.id) {
      void (async () => {
        const cur = await getSession(res.session.sessionId);
        if (!cur.ok || cur.session.phase !== "lobby" || cur.session.lobby?.teamA) return;
        const p = await patchPvpLineup(
          res.session.sessionId,
          "A",
          lineupA,
          cur.session.stateVersion,
        );
        if (p.ok) setSession(p.session);
      })();
    }
  }

  async function onRefresh() {
    if (!session?.sessionId) return;
    setLoading(true);
    await refreshSession(session.sessionId);
    setLoading(false);
    setStatus("已刷新局面");
  }

  async function onAction(action: BattleAction) {
    if (!session) return;
    setLoading(true);
    const res = await submitAction({
      sessionId: session.sessionId,
      side: mySide,
      expectedStateVersion: session.stateVersion,
      action,
      userId: effectiveUserId,
    });
    setLoading(false);
    if (!res.ok) {
      setStatus(`提交失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    const isPvpHumanWait =
      res.session.mode === "pvp" &&
      res.session.state &&
      !res.session.state.ended &&
      res.session.pendingActions?.[mySide];
    setStatus(
      isPvpHumanWait
        ? "已提交，等待对方出招（局面将自动刷新）"
        : "已提交动作",
    );
    if (res.session.mode === "pvp" && res.session.sessionId) {
      window.setTimeout(() => {
        void refreshSession(res.session.sessionId);
      }, 400);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account: authForm.account,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      sessionToken?: string;
      csrfToken?: string;
      user?: AuthUser;
      error?: string;
    };
    setLoading(false);
    if (!json.ok || !json.sessionToken || !json.user) {
      setStatus(`登录失败: ${json.error ?? "unknown"}`);
      return;
    }
    localStorage.setItem(STORAGE_TOKEN, json.sessionToken);
    if (json.csrfToken) localStorage.setItem(STORAGE_CSRF, json.csrfToken);
    setAuthUser(json.user);
    setStatus(`已登录 ${json.user.nickname ?? json.user.id}`);
  }

  async function onLogout() {
    const token = getStoredToken();
    const csrf = getStoredCsrf();
    if (token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
      });
    }
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_CSRF);
    setAuthUser(null);
    setStatus("已退出");
  }

  const logLines = useMemo(() => {
    const ev = session?.state?.events ?? [];
    return [...ev].reverse().map((e) => formatEventLine(e));
  }, [session?.state?.events]);

  const damageStats = useMemo(() => {
    if (!session?.state?.ended) return null;
    return computeBattleDamageStats(session.state);
  }, [session?.state]);

  async function onLobbyLineupChange(i: 0 | 1 | 2, petId: string) {
    if (!session?.sessionId || !session.lobby || !authUser) return;
    const next = [...lobbyDraftTeam] as [string, string, string];
    next[i] = petId;
    if (mySide === "A") setLineupA(next);
    else setLineupB(next);
    setLoading(true);
    const res = await patchPvpLineup(session.sessionId, mySide, next, session.stateVersion);
    setLoading(false);
    if (!res.ok) {
      setStatus(`保存阵容失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("已保存我方阵容（未准备前可继续修改）");
  }

  async function onLobbyReady() {
    if (!session?.sessionId || !authUser) return;
    setLoading(true);
    try {
      let s = session;
      const hasServerTeam =
        mySide === "A" ? Boolean(s.lobby?.teamA) : Boolean(s.lobby?.teamB);
      if (!hasServerTeam) {
        const patch = await patchPvpLineup(
          s.sessionId,
          mySide,
          lobbyDraftTeam,
          s.stateVersion,
        );
        if (!patch.ok) {
          setStatus(`准备失败: 请先确认阵容已保存（${patch.error}）`);
          return;
        }
        setSession(patch.session);
        s = patch.session;
      }
      const res = await postPvpReady(s.sessionId, mySide, s.stateVersion);
      if (!res.ok) {
        setStatus(`准备失败: ${res.error}`);
        return;
      }
      setSession(res.session);
      setStatus("已准备");
    } finally {
      setLoading(false);
    }
  }

  async function onLobbyStart() {
    if (!session?.sessionId || !authUser) return;
    setLoading(true);
    try {
      const fresh = await getSession(session.sessionId);
      if (!fresh.ok) {
        setStatus(`开战失败: ${fresh.error}`);
        return;
      }
      const res = await postPvpStart(fresh.session.sessionId, fresh.session.stateVersion);
      if (!res.ok) {
        setStatus(
          res.error === "not_ready"
            ? "开战失败: 请确认双方已准备且阵容已保存（若刚改阵请重新点准备）"
            : `开战失败: ${res.error}`,
        );
        return;
      }
      setSession(res.session);
      setStatus("对战已开始");
    } finally {
      setLoading(false);
    }
  }

  async function onRematchToLobby() {
    if (!session?.sessionId || !authUser || !session.state?.ended) return;
    setLoading(true);
    const res = await postPvpRematch(session.sessionId, session.stateVersion);
    setLoading(false);
    if (!res.ok) {
      setStatus(`返回大厅失败: ${res.error}`);
      return;
    }
    setSession(res.session);
    setStatus("已返回大厅：请重新选阵并准备，房主开战后开始新对局");
    if (res.session.phase === "lobby" && res.session.controllers?.A.userId === authUser.id) {
      void (async () => {
        const cur = await getSession(res.session.sessionId);
        if (!cur.ok || cur.session.phase !== "lobby" || cur.session.lobby?.teamA) return;
        const p = await patchPvpLineup(
          res.session.sessionId,
          "A",
          lineupA,
          cur.session.stateVersion,
        );
        if (p.ok) setSession(p.session);
      })();
    }
  }

  const pvpPhaseLabel =
    session?.mode === "pvp"
      ? inLobby
        ? "大厅（选阵/准备）"
        : session?.state?.ended
          ? "已结束 → 可再来一局"
          : "对战中"
      : null;

  return (
    <main style={{ fontFamily: "monospace", padding: 12, lineHeight: 1.5, maxWidth: 960 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>智宠对决 · 文字对战台</div>
      <div style={{ fontSize: 12, color: "#555" }}>
        PvE：提交后由回包同步。已进入 PvP 房间时隐藏下方「开战阵容」表单，专注对战区；PvP
        全程每 2 秒自动拉取（仍可手动刷新）。终局后房主可将房间重置为大厅再来一局（同一邀请链接）。
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>账号（Web 登录 / 匿名试玩）</div>
        {authUser ? (
          <div>
            <div>
              已登录：{authUser.nickname ?? authUser.id}（{authUser.id}）
            </div>
            <button type="button" onClick={() => void onLogout()} disabled={loading}>
              退出
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void onLogin(e)}>
            <div>
              <input
                placeholder="邮箱或手机号（无需密码，首次将自动注册）"
                value={authForm.account}
                onChange={(e) => setAuthForm((f) => ({ ...f, account: e.target.value }))}
                style={{ width: 320 }}
              />
            </div>
            <button type="submit" disabled={loading} style={{ marginTop: 6 }}>
              登录
            </button>
            <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
              未登录时使用匿名 ID 创建对局；登录后操作与 user_id 一致
            </span>
          </form>
        )}
      </div>

      {!inActivePvpRoom ? (
      <div style={panelStyle}>
        <div style={headingStyle}>开战阵容（创建对局前）</div>
        <div style={{ marginBottom: 10, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>模式：</span>
          <label style={{ marginLeft: 8 }}>
            <input
              type="radio"
              name="matchMode"
              checked={matchMode === "pve"}
              onChange={() => setMatchMode("pve")}
            />{" "}
            PvE（人机，敌方随机）
          </label>
          <label style={{ marginLeft: 14 }}>
            <input
              type="radio"
              name="matchMode"
              checked={matchMode === "pvp"}
              onChange={() => setMatchMode("pvp")}
            />{" "}
            PvP（邀请，须登录）
          </label>
        </div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 8, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, color: "#333", marginBottom: 4 }}>宠物克制规则</div>
          <div>
            技能伤害会按<strong>出手方属性</strong>对<strong>目标当前上场宠物属性</strong>查表乘算；未列出组合为 ×1。
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>
              三角：
              {attrIconLabel("fire")}克{attrIconLabel("grass")}、{attrIconLabel("grass")}克{attrIconLabel("water")}、
              {attrIconLabel("water")}克{attrIconLabel("fire")}，倍率 <strong>×1.5</strong>
            </li>
            <li>
              {attrIconLabel("electric")}克{attrIconLabel("water")}，倍率 <strong>×2.0</strong>
            </li>
            <li>
              {attrIconLabel("light")}
              <span aria-hidden style={{ margin: "0 3px", fontWeight: 600 }}>
                ⇄
              </span>
              {attrIconLabel("spirit")}：双方互打时伤害倍率 <strong>×1.2</strong>。
              {attrIconLabel("light")}、{attrIconLabel("spirit")} 对 {attrIconLabel("electric")} 造成伤害时倍率{" "}
              <strong>×1.2</strong>。
            </li>
          </ul>
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>我方（A 方）</span>
          {teamAInventory === null ? (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>加载背包中…</span>
          ) : null}
          {teamAInventory !== null && teamAStrictInventory === null ? (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#a60" }}>
              图谱可战宠物不足 3 只，已显示全部宠物供选阵
            </span>
          ) : null}
          {teamAInventory === null
            ? null
            : [0, 1, 2].map((i) => (
                <PetLineupDropdown
                  key={`a-${i}`}
                  value={lineupA[i]}
                  petIds={teamAPetIdOptions}
                  renderOptionLabel={renderLabelTeamA}
                  catalog={gameCatalog}
                  onChange={(v) => {
                    setLineupA((prev) => {
                      const next = [...prev] as [string, string, string];
                      next[i] = v;
                      return next;
                    });
                  }}
                />
              ))}
        </div>
        {matchMode === "pve" ? (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>敌方（B · AI）</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>
              阵容在创建 PvE 时从全库随机 3 只（互不重复），不可自选。
            </span>
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>对手用户 ID（UUID）</span>
              <input
                type="text"
                value={opponentUserId}
                onChange={(e) => setOpponentUserId(e.target.value)}
                placeholder="对手登录后个人资料中的用户 ID"
                style={{ marginLeft: 8, width: 320, fontSize: 12 }}
                autoComplete="off"
              />
            </div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 8, lineHeight: 1.5 }}>
              你为 <strong>A 方（房主）</strong>，对手为 <strong>B 方</strong>。双方须已注册。创建后为战前大厅：下方「我方」阵容作为你进入大厅时的默认阵；对手通过邀请链接登录后<strong>自行选阵</strong>并准备，房主在双方准备后开战。
            </div>
          </div>
        )}
        <button
          type="button"
          style={{ marginTop: 8, fontSize: 12 }}
          onClick={() => {
            setLineupA([...DEFAULT_TEAM_A]);
            setLineupB([...DEFAULT_TEAM_B]);
          }}
        >
          恢复我方默认阵容（PvP 仅影响你方默认阵）
        </button>
      </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        {!inActivePvpRoom ? (
          matchMode === "pve" ? (
            <button type="button" onClick={() => void onCreate()} disabled={loading}>
              创建 PvE 对局
            </button>
          ) : (
            <button type="button" onClick={() => void onCreatePvp()} disabled={loading}>
              创建 PvP 邀请对局
            </button>
          )
        ) : (
          <span style={{ fontSize: 13, color: "#333", fontWeight: 600 }}>已在 PvP 房间中</span>
        )}
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading || !session}
          style={{ marginLeft: 8 }}
        >
          刷新局面
        </button>
        {inActivePvpRoom ? (
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setStatus("已离开房间；可重新创建对局");
            }}
            disabled={loading}
            style={{ marginLeft: 8 }}
          >
            离开房间
          </button>
        ) : null}
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>状态: {status}</div>

      {inLobby && session && authUser ? (
        <div style={panelStyle}>
          <div style={headingStyle}>PvP 战前大厅</div>
          <div style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.5 }}>
            你是 <strong>{mySide} 方</strong>。修改下方阵容会自动保存到服务器；双方点击「准备」后，由{" "}
            <strong>A 方（房主）</strong>点击「开始对战」。页面每 3 秒同步大厅状态，也可点「刷新局面」。
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>我方阵容（大厅）</span>
            {teamAInventory === null ? (
              <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>加载背包中…</span>
            ) : null}
            {teamAInventory !== null && teamAStrictInventory === null ? (
              <span style={{ marginLeft: 8, fontSize: 12, color: "#a60" }}>
                图谱可战宠物不足 3 只，已显示全部宠物供选阵
              </span>
            ) : null}
            {teamAInventory === null
              ? null
              : ([0, 1, 2] as const).map((i) => (
                  <PetLineupDropdown
                    key={`lobby-${i}`}
                    value={lobbyDraftTeam[i]!}
                    petIds={teamAPetIdOptions}
                    renderOptionLabel={renderLabelTeamA}
                    catalog={gameCatalog}
                    onChange={(v) => void onLobbyLineupChange(i, v)}
                  />
                ))}
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            A 准备: {session.lobby?.readyA ? "是" : "否"} ｜ B 准备: {session.lobby?.readyB ? "是" : "否"}
          </div>
          <button type="button" onClick={() => void onLobbyReady()} disabled={loading}>
            准备
          </button>
          {mySide === "A" ? (
            <button
              type="button"
              style={{ marginLeft: 8 }}
              onClick={() => void onLobbyStart()}
              disabled={loading}
            >
              开始对战（房主）
            </button>
          ) : null}
        </div>
      ) : null}

      {session?.mode === "pvp" && session.sessionId ? (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <button
            type="button"
            onClick={() => {
              const u = `${window.location.origin}${window.location.pathname}?joinPvp=${session.sessionId}`;
              void navigator.clipboard.writeText(u).then(
                () => setStatus("已复制邀请链接到剪贴板"),
                () => setStatus("复制失败，请手动复制会话 ID"),
              );
            }}
          >
            复制 PvP 邀请链接
          </button>
          <span style={{ marginLeft: 8, color: "#666" }}>对手登录后打开链接进入大厅选阵</span>
        </div>
      ) : null}

      <div style={panelStyle}>
        <div style={headingStyle}>区域 1 · 对战状态</div>
        <div>会话 ID: {session?.sessionId ?? "—"}</div>
        <div>
          模式: {session?.mode ?? "—"} ｜ 阶段:{" "}
          {session?.mode === "pvp"
            ? (pvpPhaseLabel ?? "—")
            : session?.state
              ? session.state.ended
                ? "已结束"
                : "对战中"
              : "—"}{" "}
          ｜ 进度: {session?.state ? `${session.state.round} 回合` : "—"} ｜ 状态版本:{" "}
          {session?.stateVersion ?? "—"}
        </div>
        <div>
          先手（最近 turn_start）:{" "}
          {lastStart ? `R${lastStart.round} / ${lastStart.firstSide}` : "—"}
        </div>
        <div>
          战局:{" "}
          {!session?.state
            ? "战前大厅"
            : session.state.ended
              ? `已结束，胜方 ${session.state.winner}`
              : "进行中"}
        </div>
        <div>
          渠道埋点 clientChannel: {session?.clientChannel ?? "—"} ｜ 人类回合时限:{" "}
          {session?.humanTurnTimeoutSec ?? "—"}s
        </div>
        <div>
          等待人类操作自: {session?.awaitingHumanSince ?? "—"} ｜ 上次托管:{" "}
          {session?.lastAutopilot
            ? `${session.lastAutopilot.side} @ ${session.lastAutopilot.at}`
            : "—"}
        </div>
      </div>

      {session?.state?.ended && damageStats ? (
        <div style={panelStyle}>
          <div style={headingStyle}>战斗统计（输出伤害）</div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            队伍合计：我方 {mySide === "A" ? damageStats.totalA : damageStats.totalB} ｜ 对手{" "}
            {mySide === "A" ? damageStats.totalB : damageStats.totalA}
          </div>
          <div style={{ fontSize: 12 }}>
            {damageStats.byPet.length ? (
              <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {damageStats.byPet.map((row, i) => (
                  <li key={`${row.petId}-${i}`} style={{ marginBottom: 4 }}>
                    #{i + 1} {petLabel(row.petId)}（{row.side === mySide ? "我方" : "对手"}）—{" "}
                    <strong>{row.damage}</strong> 伤害
                  </li>
                ))}
              </ol>
            ) : (
              <div>无伤害记录</div>
            )}
          </div>
        </div>
      ) : null}

      {session?.mode === "pvp" && session.state?.ended && authUser ? (
        <div style={panelStyle}>
          <div style={headingStyle}>下一局</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 8, lineHeight: 1.5 }}>
            本局已结束。房主将房间重置为战前大厅后，双方可重新选阵、准备并开始新对局（会话 ID
            与邀请链接不变）。
          </div>
          {session.controllers?.A.userId === authUser.id ? (
            <button type="button" disabled={loading} onClick={() => void onRematchToLobby()}>
              再来一局（返回大厅）
            </button>
          ) : (
            <div style={{ fontSize: 13, color: "#666" }}>等待房主点击「再来一局」…</div>
          )}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={panelStyle}>
          <div style={headingStyle}>区域 2 · 我方宠物</div>
          {!session?.state ? (
            <div style={{ fontSize: 12, color: "#666" }}>战前大厅：开战后显示我方宠物状态</div>
          ) : !me ? (
            <div>—</div>
          ) : (
            [0, 1, 2].map((i) => {
              const p = me.roster[i as 0 | 1 | 2];
              const mark = i === me.activeIndex ? "场上" : "替补";
              return (
                <div key={`a-${i}`} style={{ marginBottom: 4 }}>
                  [{mark}] {petLabel(p.petId)} ｜ Lv— ｜ ATK {p.attack} ｜ {hpBar(p.hp, p.maxHp)}{" "}
                  ｜ {p.alive ? "存活" : "阵亡"}
                </div>
              );
            })
          )}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {session?.state ? bondSummary(mySide, session.state) : ""}
          </div>
        </div>

        <div style={panelStyle}>
          <div style={headingStyle}>
            区域 3 · {session?.mode === "pvp" ? "对手宠物" : "敌方宠物（PvE）"}
          </div>
          {!session?.state ? (
            <div style={{ fontSize: 12, color: "#666" }}>战前大厅：对手阵容开战后可见</div>
          ) : !enemy ? (
            <div>—</div>
          ) : (
            [0, 1, 2].map((i) => {
              const p = enemy.roster[i as 0 | 1 | 2];
              const mark = i === enemy.activeIndex ? "场上" : "替补";
              return (
                <div key={`b-${i}`} style={{ marginBottom: 4 }}>
                  [{mark}] {petLabel(p.petId)} ｜ Lv— ｜ ATK {p.attack} ｜ {hpBar(p.hp, p.maxHp)} ｜{" "}
                  {p.alive ? "存活" : "阵亡"}
                </div>
              );
            })
          )}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {session?.state ? bondSummary(mySide === "A" ? "B" : "A", session.state) : ""}
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>区域 4 · 操作指令（技能 / 切换 / 合体）</div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
          技能按钮仅显示名称；鼠标悬停可看参考伤害或治疗/护盾等效果说明（按当前上场攻击估算，未计克制/羁绊/暴击）。切换与合体仍带简要副行。
        </div>
        {!canAct ? (
          <div>当前不可操作</div>
        ) : legalActions.length ? (
          legalActions.slice(0, 12).map((x) => {
            const atk = me?.roster[me.activeIndex]?.attack ?? 0;
            const lines = legalActionButtonLines(x, gameCatalog, me, atk);
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => void onAction(x.action)}
                disabled={!canAct}
                title={lines.title}
                style={{
                  marginRight: 8,
                  marginTop: 8,
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  textAlign: "left",
                  maxWidth: 320,
                  padding: "8px 10px",
                  verticalAlign: "top",
                }}
              >
                <span style={{ fontWeight: 600 }}>{lines.primary}</span>
                {lines.secondary ? (
                  <span style={{ fontSize: 11, color: "#444", marginTop: 3, lineHeight: 1.35 }}>
                    {lines.secondary}
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <div>暂无合法动作（可能等待同步或托管处理中，请点「刷新局面」）</div>
        )}
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>区域 5 · 战斗日志</div>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
          共 {logLines.length} 条事件，倒序（最新在上），下方可垂直滚动
        </div>
        <pre style={{ ...logScrollBox, whiteSpace: "pre-wrap", margin: 0 }}>
          {logLines.length ? logLines.join("\n") : "—"}
        </pre>
        <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
          回合块索引（共 {turnBlocks.length} 回合）
          {turnBlocks.slice(-3).map((b) => (
            <span key={`tb-${b.round}-${b.firstSide}`} style={{ marginLeft: 8 }}>
              R{b.round}:{b.firstSide} 我伤{mySide === "A" ? b.dmgA : b.dmgB}/敌伤
              {mySide === "A" ? b.dmgB : b.dmgA}
            </span>
          ))}
        </div>
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>区域 6 · 回放与天梯</div>
        <div style={{ fontSize: 12, marginBottom: 6, color: "#555" }}>
          战斗回放：事件流持久化后在此展示列表（见 PRD 十节）
        </div>
        {ladderInfo ? (
          <div style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>天梯（Neo4j · Elo，仅 PvP 双人对局结束时更新）</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {ladderInfo.rows.map((r, i) => (
                <li key={r.playerId} style={{ marginBottom: 2 }}>
                  #{i + 1} {r.playerId} — {r.eloRating}
                </li>
              ))}
            </ol>
            {ladderInfo.self ? (
              <div style={{ marginTop: 8, color: "#333" }}>
                本人（{effectiveUserId}）：第 {ladderInfo.self.rank} / {ladderInfo.self.totalPlayers} 名 · Elo{" "}
                {ladderInfo.self.eloRating}
              </div>
            ) : (
              <div style={{ marginTop: 8, color: "#888" }}>本人排名未返回（可能 Neo4j 未连接）</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#888" }}>天梯榜加载失败或未配置 Neo4j</div>
        )}
      </div>
    </main>
  );
}
