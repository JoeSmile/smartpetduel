import type { GameConfigJson } from "../config/loadGameConfig.js";
import { CURRENT_RULESET_ID } from "./ruleset.js";
import { createRng, nextRandom01, type DeterministicRng } from "./random.js";

type Side = "A" | "B";
type OppSide = "A" | "B";

export type CombatPet = {
  petId: string;
  hp: number;
  maxHp: number;
  attack: number;
  attribute: string;
  alive: boolean;
};

export type TeamState = {
  roster: [CombatPet, CombatPet, CombatPet];
  activeIndex: 0 | 1 | 2;
};

export type BattleAction =
  | { type: "skill"; skillId: string }
  | { type: "combo"; comboId: string }
  | { type: "switch"; toIndex: 0 | 1 | 2 };

export type BattleEvent =
  | { type: "turn_start"; round: number; firstSide: Side }
  | {
      type: "damage";
      from: Side;
      to: Side;
      amount: number;
      actionId: string;
      isCrit?: boolean;
    }
  | {
      type: "action_rejected";
      side: Side;
      action: BattleAction;
      reason: string;
    }
  | { type: "ko"; side: Side; petId: string }
  | { type: "switch"; side: Side; toIndex: 0 | 1 | 2 }
  | { type: "auto_switch"; side: Side; toIndex: 0 | 1 | 2 }
  | { type: "battle_end"; winner: Side };

export type BattleState = {
  rulesetId: string;
  seed: string;
  rng: DeterministicRng;
  round: number;
  ended: boolean;
  winner: Side | null;
  teamA: TeamState;
  teamB: TeamState;
  events: BattleEvent[];
  skillReadyRoundBySide: Record<Side, Record<string, number>>;
  comboReadyRoundBySide: Record<Side, Record<string, number>>;
  comboUsageBySide: Record<Side, Record<string, number>>;
  bondLevelBySide: Record<Side, Record<string, number>>;
  normalSkillCooldownById: Record<string, number>;
  battleParams: {
    bondDamageBonusPerLevel: number;
    bondCritRatePerLevel: number;
    critMultiplier: number;
  };
};

type Catalog = {
  pets: Map<string, GameConfigJson["pets"][number]>;
  skills: Map<string, GameConfigJson["skills"][number]>;
  combos: Map<string, GameConfigJson["comboSkills"][number]>;
  counters: Map<string, number>;
};

function makeCatalog(config: GameConfigJson): Catalog {
  const pets = new Map(config.pets.map((p) => [p.id, p]));
  const skills = new Map(config.skills.map((s) => [s.id, s]));
  const combos = new Map(config.comboSkills.map((c) => [c.id, c]));
  const counters = new Map(
    config.counters.map((c) => [`${c.from}->${c.to}`, c.multiplier]),
  );
  return { pets, skills, combos, counters };
}

function makeTeamState(
  petIds: [string, string, string],
  catalog: Catalog,
): TeamState {
  const roster = petIds.map((petId) => {
    const pet = catalog.pets.get(petId);
    if (!pet) throw new Error(`pet_not_found:${petId}`);
    return {
      petId: pet.id,
      hp: pet.baseHp,
      maxHp: pet.baseHp,
      attack: pet.baseAttack,
      attribute: pet.attribute,
      alive: true,
    };
  }) as [CombatPet, CombatPet, CombatPet];
  return { roster, activeIndex: 0 };
}

function getCounterMultiplier(
  catalog: Catalog,
  attackerAttr: string,
  defenderAttr: string,
): number {
  return catalog.counters.get(`${attackerAttr}->${defenderAttr}`) ?? 1;
}

function getTeam(state: BattleState, side: Side): TeamState {
  return side === "A" ? state.teamA : state.teamB;
}

function getOpponent(side: Side): OppSide {
  return side === "A" ? "B" : "A";
}

function getPairKey(petAId: string, petBId: string): string {
  return [petAId, petBId].sort().join("|");
}

function getActiveBondLevel(state: BattleState, side: Side): number {
  const team = getTeam(state, side);
  const active = team.roster[team.activeIndex];
  if (!active.alive) return 0;
  let maxLevel = 0;
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    if (i === team.activeIndex) continue;
    const mate = team.roster[i];
    if (!mate.alive) continue;
    const level =
      state.bondLevelBySide[side][getPairKey(active.petId, mate.petId)] ?? 0;
    if (level > maxLevel) maxLevel = level;
  }
  return maxLevel;
}

function selectNextAliveIndex(team: TeamState): 0 | 1 | 2 | null {
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    if (team.roster[i].alive) return i;
  }
  return null;
}

function applyDamage(input: {
  state: BattleState;
  catalog: Catalog;
  from: Side;
  action: Extract<BattleAction, { type: "skill" }>;
}): void {
  const attackerTeam = getTeam(input.state, input.from);
  const defenderSide = getOpponent(input.from);
  const defenderTeam = getTeam(input.state, defenderSide);
  const attacker = attackerTeam.roster[attackerTeam.activeIndex];
  const defender = defenderTeam.roster[defenderTeam.activeIndex];
  if (!attacker.alive || !defender.alive) return;

  const skill = input.catalog.skills.get(input.action.skillId);
  if (!skill || skill.petId !== attacker.petId) {
    throw new Error("invalid_skill_for_active_pet");
  }

  const counter = getCounterMultiplier(
    input.catalog,
    attacker.attribute,
    defender.attribute,
  );
  const bondLevel = getActiveBondLevel(input.state, input.from);
  const bondBonus =
    1 + bondLevel * input.state.battleParams.bondDamageBonusPerLevel;
  const critRate = Math.min(
    1,
    bondLevel * input.state.battleParams.bondCritRatePerLevel,
  );
  const isCrit = nextRandom01(input.state.rng) < critRate;
  const critMul = isCrit ? input.state.battleParams.critMultiplier : 1;
  const raw = attacker.attack * skill.coefficient * counter * bondBonus * critMul;
  const amount = Math.max(1, Math.floor(raw));
  defender.hp = Math.max(0, defender.hp - amount);
  if (defender.hp === 0) defender.alive = false;
  input.state.events.push({
    type: "damage",
    from: input.from,
    to: defenderSide,
    amount,
    actionId: input.action.skillId,
    isCrit,
  });
}

function applyComboDamage(input: {
  state: BattleState;
  catalog: Catalog;
  from: Side;
  action: Extract<BattleAction, { type: "combo" }>;
}): void {
  const attackerTeam = getTeam(input.state, input.from);
  const defenderSide = getOpponent(input.from);
  const defenderTeam = getTeam(input.state, defenderSide);
  const attacker = attackerTeam.roster[attackerTeam.activeIndex];
  const defender = defenderTeam.roster[defenderTeam.activeIndex];
  if (!attacker.alive || !defender.alive) return;

  const combo = input.catalog.combos.get(input.action.comboId);
  if (!combo || combo.petAId !== attacker.petId) {
    throw new Error("invalid_combo_for_active_pet");
  }

  const partner = attackerTeam.roster.find((x) => x.petId === combo.petBId);
  if (!partner || !partner.alive) {
    throw new Error("combo_partner_not_alive");
  }

  const pairBondLevel =
    input.state.bondLevelBySide[input.from][getPairKey(combo.petAId, combo.petBId)] ??
    0;
  if (pairBondLevel < 3) {
    throw new Error("combo_bond_level_too_low");
  }

  const comboReadyRound =
    input.state.comboReadyRoundBySide[input.from][combo.id] ?? 1;
  if (input.state.round < comboReadyRound) {
    throw new Error("combo_on_cooldown");
  }

  const comboUsed = input.state.comboUsageBySide[input.from][combo.id] ?? 0;
  if (comboUsed >= 2) {
    throw new Error("combo_usage_limit_reached");
  }

  const counter = getCounterMultiplier(
    input.catalog,
    attacker.attribute,
    defender.attribute,
  );
  const bondLevel = getActiveBondLevel(input.state, input.from);
  const bondBonus =
    1 + bondLevel * input.state.battleParams.bondDamageBonusPerLevel;
  const critRate = Math.min(
    1,
    bondLevel * input.state.battleParams.bondCritRatePerLevel,
  );
  const isCrit = nextRandom01(input.state.rng) < critRate;
  const critMul = isCrit ? input.state.battleParams.critMultiplier : 1;
  const raw = attacker.attack * combo.coefficient * counter * bondBonus * critMul;
  const amount = Math.max(1, Math.floor(raw));
  defender.hp = Math.max(0, defender.hp - amount);
  if (defender.hp === 0) defender.alive = false;
  input.state.events.push({
    type: "damage",
    from: input.from,
    to: defenderSide,
    amount,
    actionId: combo.id,
    isCrit,
  });

  if (combo.isAoe) {
    const splash = Math.max(1, Math.floor(amount * 0.3));
    for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
      if (i === defenderTeam.activeIndex) continue;
      const benchPet = defenderTeam.roster[i];
      if (!benchPet.alive) continue;
      // Bench units cannot be KO-ed by splash.
      const nextHp = Math.max(1, benchPet.hp - splash);
      benchPet.hp = nextHp;
      input.state.events.push({
        type: "damage",
        from: input.from,
        to: defenderSide,
        amount: splash,
        actionId: `${combo.id}:splash`,
      });
    }
  }

  input.state.comboUsageBySide[input.from][combo.id] = comboUsed + 1;
  input.state.comboReadyRoundBySide[input.from][combo.id] = input.state.round + 3;
}

function applySwitch(
  state: BattleState,
  side: Side,
  team: TeamState,
  toIndex: 0 | 1 | 2,
): void {
  if (!team.roster[toIndex].alive) throw new Error("switch_to_dead_pet");
  team.activeIndex = toIndex;
  state.events.push({ type: "switch", side, toIndex });
}

function maybeProcessKo(state: BattleState, side: Side): void {
  const team = getTeam(state, side);
  const current = team.roster[team.activeIndex];
  if (current.alive) return;
  state.events.push({ type: "ko", side, petId: current.petId });
  const nextAlive = selectNextAliveIndex(team);
  if (nextAlive === null) {
    state.ended = true;
    state.winner = getOpponent(side);
    state.events.push({ type: "battle_end", winner: state.winner });
    return;
  }
  team.activeIndex = nextAlive;
  state.events.push({ type: "auto_switch", side, toIndex: nextAlive });
}

export function createBattleState(input: {
  config: GameConfigJson;
  seed: string;
  teamA: [string, string, string];
  teamB: [string, string, string];
  rulesetId?: string;
  normalSkillCooldownById?: Record<string, number>;
  bondLevelBySide?: Partial<Record<Side, Record<string, number>>>;
  battleParams?: Partial<BattleState["battleParams"]>;
}): BattleState {
  const catalog = makeCatalog(input.config);
  return {
    rulesetId: input.rulesetId ?? CURRENT_RULESET_ID,
    seed: input.seed,
    rng: createRng(input.seed),
    round: 1,
    ended: false,
    winner: null,
    teamA: makeTeamState(input.teamA, catalog),
    teamB: makeTeamState(input.teamB, catalog),
    events: [],
    skillReadyRoundBySide: { A: {}, B: {} },
    comboReadyRoundBySide: { A: {}, B: {} },
    comboUsageBySide: { A: {}, B: {} },
    bondLevelBySide: {
      A: input.bondLevelBySide?.A ?? {},
      B: input.bondLevelBySide?.B ?? {},
    },
    normalSkillCooldownById: input.normalSkillCooldownById ?? {},
    battleParams: {
      bondDamageBonusPerLevel: input.battleParams?.bondDamageBonusPerLevel ?? 0.03,
      bondCritRatePerLevel: input.battleParams?.bondCritRatePerLevel ?? 0.02,
      critMultiplier: input.battleParams?.critMultiplier ?? 1.5,
    },
  };
}

export function resolveTurn(input: {
  state: BattleState;
  config: GameConfigJson;
  actionA: BattleAction;
  actionB: BattleAction;
}): BattleState {
  if (input.state.ended) return input.state;
  const catalog = makeCatalog(input.config);
  const roll = nextRandom01(input.state.rng);
  const firstSide: Side = roll < 0.5 ? "A" : "B";
  const secondSide: Side = firstSide === "A" ? "B" : "A";
  input.state.events.push({
    type: "turn_start",
    round: input.state.round,
    firstSide,
  });

  const execute = (side: Side, action: BattleAction): void => {
    const team = getTeam(input.state, side);
    if (!team.roster[team.activeIndex].alive || input.state.ended) return;
    try {
      if (action.type === "switch") {
        applySwitch(input.state, side, team, action.toIndex);
        return;
      }
      if (action.type === "skill") {
        const readyRound =
          input.state.skillReadyRoundBySide[side][action.skillId] ?? 1;
        if (input.state.round < readyRound) {
          throw new Error("skill_on_cooldown");
        }
        applyDamage({ state: input.state, catalog, from: side, action });
        const cooldown = input.state.normalSkillCooldownById[action.skillId] ?? 0;
        input.state.skillReadyRoundBySide[side][action.skillId] =
          input.state.round + cooldown + 1;
        maybeProcessKo(input.state, getOpponent(side));
        return;
      }
      applyComboDamage({ state: input.state, catalog, from: side, action });
      maybeProcessKo(input.state, getOpponent(side));
    } catch (err) {
      input.state.events.push({
        type: "action_rejected",
        side,
        action,
        reason: err instanceof Error ? err.message : "unknown_action_error",
      });
    }
  };

  execute(firstSide, firstSide === "A" ? input.actionA : input.actionB);
  execute(secondSide, secondSide === "A" ? input.actionA : input.actionB);
  input.state.round += 1;
  return input.state;
}

