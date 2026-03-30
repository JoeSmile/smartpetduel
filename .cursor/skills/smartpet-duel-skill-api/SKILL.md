---
name: smartpet-duel-skill-api
description: >-
  Calls Smart Pet Duel /skill/v1 APIs and catalogs. Default user-facing battle
  narration: one line per action—pet name, skill name from catalog, target pet,
  damage—no raw engine dumps unless asked. Use for skill/v1, battle session,
  lineup, OpenClaw, or SmartPet Duel automation.
---

# Smart Pet Duel — Skill API (`/skill/v1`)

## 对战过程怎么写给用户（默认）

**只输出宠物行动**，用简短中文句，不要默认贴引擎事件原文、不要整段 ASCII 面板、不要大段 `SKILL_*` / JSON（除非用户说要调试或要全文）。

**推荐句式：**

- 伤害：`[攻击方宠物名]` 使用 `[技能中文名]` 攻击了 `[防守方场上宠物名]`，造成 `[N]` 点伤害。  
  - 有暴击可加「（暴击）」。
- 换人：`[宠物A]` 下场，`[宠物B]` 上场。
- 击倒：`[宠物名]` 被击倒。
- 结束：`战斗结束，胜者 [A|B] 方`（或说明胜方阵容侧）。

**名字从哪来：** 先 `GET /skill/v1/game/catalog`，用 `pets[].id → name`、`skills[].id → name`（以及 `comboSkills` 对应连招名）。`session.state.events` 里 `damage` 的 `actionId` 即技能/连招 id，用来查中文名；`from` / `to` 为侧 `A`/`B`，结合该时刻场上**当前上场宠**（`teamA`/`teamB` 的 `roster[activeIndex]`）解析对手宠物名。若一轮内多次换人，按事件**顺序**理解先后（可与 `state` 快照对照）。

**与用户请求的对应关系：** 用户要看的是「谁打了谁、多少血」，不是协议细节。项目规则 `.cursor/rules/smartpet-terminal-output.mdc` 与此一致：**默认叙述**，**原文 stdout** 仅在用户明确要求时。

## Default agent behavior (terminal)

若用户**明确要求**「完整终端输出 / 不要摘要 / 调试」，再把脚本或 `curl` 的 stdout 全文贴出；过长被截断时说明并建议本机重跑或 `tee`。

Stable prefix for automation: same semantics as root routes, prefixed with `/skill/v1`. If `SKILL_LAYER_ENABLED=false` on the server, this tree is not mounted.

## Configuration

- **Base URL**: `{BASE}` = e.g. `http://127.0.0.1:3000` (no trailing slash). All paths below are relative to `{BASE}`.
- **Discovery**: `GET {BASE}/skill/v1` returns JSON with `endpoints` and `auth` text. Prefer calling this first to confirm the server.
- **Auth header** (after login): `Authorization: Bearer <sessionToken>`.

## Auth

1. `POST /skill/v1/auth/login`  
   Body: `{ "account": "<email or phone>" }`  
   Passwordless: creates user if missing. Response includes `sessionToken` (and `user`).
2. `GET /skill/v1/me`  
   Header: `Authorization: Bearer <sessionToken>`.

Rate limits apply to login (same as main API).

## Lineup selection (agent chooses before `create`)

1. **`GET /skill/v1/game/catalog`** — returns **`pets`**, **`skills`**, **`comboSkills`**, **`attributes`**, **`counters`** (attribute matchup multipliers), **`battleRules`** (structured battle rules for AI: team size, combo/bond/cooldown, damage notes), plus **`version`** / **`gameTitle`**. Use this single response for lineup and in-battle decisions (type chart + rule text).
2. **Rules**: each team is **exactly 3 distinct** `pet.id` values that exist in `pets` (see `battleRules.teamSize` / `distinctPetIdsPerTeam`).
3. **Strategies the agent may use** (pick one and state it briefly in the user-visible log):
   - **balanced**: one `fire`, one `water`, one `grass` (good coverage vs triangle).
   - **mono-\<attr\>**: three pets sharing one attribute (aggressive theme).
   - **random / variety**: shuffle or pick different typings to avoid mirror match.
4. **Opponent team**: either symmetric strategy or **avoid copying** player ids so both sides use different trios when possible.

Do not invent pet ids; always take ids from the catalog response.

## Terminal UI scripts (optional)

Repo script `server/src/scripts/pve-battle-demo.ts` 可打出 ASCII 面板或 `SPD_COMPACT=1` 每手一行摘要；**向用户口头讲战况时仍优先用上面的「宠物行动」句式**，脚本输出主要用于你自己对照或用户明确要求贴日志时。

- `SPD_UI_MODE=inplace`：终端同屏刷新。  
- `SPD_COMPACT=1`：只打每手一行摘要（仍偏技术向，不如自然语言战报友好）。  
- `SPD_INTERACTIVE=1`（TTY）：交互选阵；`SPD_MANUAL_TURNS=1`：手动选招。

## Controllers and modes

`controllers.A` / `controllers.B` are `SideController`:

- `{ "kind": "human", "userId": "<uuid>" | null }` — for logged-in flows, server may bind `userId` from session.
- `{ "kind": "ai", "userId": null, "aiDifficulty": "easy" | "medium" | "hard" }` (difficulty optional).

**Mode** (derived server-side): both human → **pvp**; both ai → **aivai**; otherwise **pve**.

Optional header `X-Client-Channel: web | openclaw | doubao` or body `clientChannel` (defaults to `web` if omitted).

## PvE / AIvAI: create → poll → submit

1. **Create** — `POST /skill/v1/battle/session/create`  
   Requires `teamA`, `teamB` (each length-3 pet id arrays), and `controllers` for both sides.  
   For human side(s), caller should be logged in if the human must be bound to the current user.
2. **Poll** — `GET /skill/v1/battle/session/:sessionId`  
   Returns `{ ok, session }` or 404 if expired/missing. Use `session.stateVersion` for optimistic concurrency.
3. **Submit** — `POST /skill/v1/battle/session/submit`  
   Body: `sessionId`, `side` (`A`|`B`), `action` (see engine types), `expectedStateVersion` (number).  
   If Bearer auth present, optional `userId` must match the session user. Without Bearer, `userId` is required where the server expects it.

**Actions**: `BattleAction` is one of `{ "type": "skill", "skillId": "..." }`, `{ "type": "combo", "comboId": "..." }`, `{ "type": "switch", "toIndex": 0 | 1 | 2 }`. Use `POST /skill/v1/ai/battle/legal-actions` with `{ state, side }` to list valid moves from current `session.state`.

## PvP: lobby → lineup → ready → start → … → rematch

Requires **login**. Creator must be one of the two human `userId`s.

1. **Create lobby** — `POST /skill/v1/battle/session/create`  
   `controllers`: both `{ "kind": "human", "userId": "<uuidA>" }` and `{ "kind": "human", "userId": "<uuidB>" }` (distinct). No `teamA`/`teamB` in body for PvP lobby creation.
2. **Lineup** (each side) — `PATCH /skill/v1/battle/session/:sessionId/lineup`  
   Body: `side`, `team` (length-3), `expectedStateVersion` (match current `session.stateVersion`).
3. **Ready** — `POST /skill/v1/battle/session/:sessionId/ready`  
   Body: `side`, `expectedStateVersion`.
4. **Start** — `POST /skill/v1/battle/session/:sessionId/start`  
   Body: `expectedStateVersion`.
5. **Poll / submit** — same as PvE.
6. **Rematch** (after battle ended) — `POST /skill/v1/battle/session/:sessionId/rematch`  
   Body: `expectedStateVersion`.

On `409` / version errors, re-`GET` session and retry with new `expectedStateVersion`.

## AI helpers (stateless)

- `POST /skill/v1/ai/battle/legal-actions` — `{ state, side }` → `legalActions`.
- `POST /skill/v1/ai/battle/next-action` — `{ state, side, difficulty? }` → suggested action (+ metadata from server).

## Game / graph (read-only)

- `GET /skill/v1/game/catalog` — full static game data for AI: pets, skills, comboSkills, attributes, counters, battleRules, version, gameTitle.
- `GET /skill/v1/game/unlock-links` — progression unlock edges between pets.
- `GET /skill/v1/graph/player/:playerId/pets` — Neo4j-backed list (may be empty if DB unavailable).

## Agent workflow checklist

- [ ] `GET /skill/v1` to verify discovery.
- [ ] `GET /game/catalog` → choose two valid trios (explain strategy).
- [ ] `POST /auth/login` → store `sessionToken`.
- [ ] For PvP: ensure both user ids exist; run lineup/ready/start in order with fresh `stateVersion` each time.
- [ ] Poll `GET .../battle/session/:id` until `state` reflects turn; submit with matching `expectedStateVersion`.
- [ ] Use `legal-actions` before choosing an `action` when unsure.
- [ ] When telling the user how the battle went, **pet-action sentences only** (see top section), not raw logs—unless they ask for raw output.

## More detail

See [reference.md](reference.md) for method/path table, demo env vars, and common error codes.
