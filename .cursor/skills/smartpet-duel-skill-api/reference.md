# Smart Pet Duel `/skill/v1` — reference

Base: `{BASE}` = `http://127.0.0.1:3000` (replace with your host).

## Routes (mirror of root API)

| Method | Path |
|--------|------|
| GET | `/skill/v1` |
| GET | `/skill/v1/me` |
| POST | `/skill/v1/auth/login` |
| POST | `/skill/v1/battle/session/create` |
| GET | `/skill/v1/battle/session/:sessionId` |
| PATCH | `/skill/v1/battle/session/:sessionId/lineup` |
| POST | `/skill/v1/battle/session/:sessionId/ready` |
| POST | `/skill/v1/battle/session/:sessionId/start` |
| POST | `/skill/v1/battle/session/:sessionId/rematch` |
| POST | `/skill/v1/battle/session/submit` |
| POST | `/skill/v1/ai/battle/legal-actions` |
| POST | `/skill/v1/ai/battle/next-action` |
| GET | `/skill/v1/game/catalog` |
| GET | `/skill/v1/game/unlock-links` |
| GET | `/skill/v1/graph/player/:playerId/pets` |

Root equivalents: strip `/skill/v1` prefix (e.g. `/battle/session/create`).

### `GET /skill/v1/game/catalog` (AI decision data)

Response includes: `version`, `gameTitle`, `pets`, `skills`, `comboSkills`, `attributes`, `counters`, `battleRules`. The engine uses `counters` for damage multipliers (`from` = attacker attribute, `to` = defender attribute); `battleRules` documents team size, combo requirements, cooldowns, and default battle params. Pair with `POST .../legal-actions` for valid moves from live `state`.

## User-facing battle narration (for agents)

When describing a fight to the user, **do not** default to dumping `events` raw or ASCII UI. Use **pet names** and **skill names** from `GET /skill/v1/game/catalog`:

- Damage event `{ type: "damage", from, to, amount, actionId }`: e.g. 「**[attacker pet name]** 使用 **[skill name]** 攻击了 **[defender pet name]**，造成 **amount** 点伤害。」 Map `actionId` → `skills` or `comboSkills` by id; map active `petId` on side `from` / `to` from `session.state.teamA` / `teamB` at that point in the event sequence.
- `switch` / `auto_switch`: 「**[pet]** 上场 / 换下。」
- `ko`: 「**[pet]** 被击倒。」
- `battle_end`: 「战斗结束，胜者 **A|B**。」

## Example: login + me

```bash
TOKEN=$(curl -sS -X POST "$BASE/skill/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"agent@example.com"}' | jq -r '.sessionToken')

curl -sS "$BASE/skill/v1/me" -H "Authorization: Bearer $TOKEN"
```

## Example: PvE create (human vs AI)

```json
{
  "teamA": ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
  "teamB": ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
  "controllers": {
    "A": { "kind": "human", "userId": null },
    "B": { "kind": "ai", "userId": null, "aiDifficulty": "medium" }
  }
}
```

Caller should be logged in so the server can bind the human side to the current user when `userId` is null.

## Example: PvP create (lobby)

```json
{
  "controllers": {
    "A": { "kind": "human", "userId": "<uuid-user-A>" },
    "B": { "kind": "human", "userId": "<uuid-user-B>" }
  }
}
```

Creator token must be user A or B.

## Example: submit

```json
{
  "sessionId": "<id>",
  "side": "A",
  "expectedStateVersion": 3,
  "action": { "type": "skill", "skillId": "SKILL_FIRE_01_A" }
}
```

Exact `action` shape must match server `BattleAction` (see game engine / legal-actions output).

## Common HTTP errors

| Status | Typical meaning |
|--------|-----------------|
| 400 | Invalid payload, lineup/ready/start preconditions (e.g. `not_ready`, `lineup_incomplete`) |
| 401 | Missing/invalid Bearer; PvP requires login |
| 403 | Wrong user for side / PvP creator not participant |
| 404 | Session missing/expired; wrong id |
| 409 | `version_conflict`, `finished`, `lobby_not_started`, etc. |
| 429 | Rate limit (login) |

Response bodies usually include `{ ok: false, error: "<code>" }`.

## PvE demo script (text UI + streaming)

From repo `server/`:

```bash
pnpm exec tsx src/scripts/pve-battle-demo.ts
```

| Env | Meaning |
|-----|---------|
| `SPD_BASE` | API base URL (default `http://127.0.0.1:3000`) |
| `SPD_STRATEGY` | `balanced` \| `mono-fire` \| `mono-water` \| `mono-grass` \| `random` (default `balanced`) |
| `SPD_TEAM_A` | Override: `PET_x,PET_y,PET_z` (3 distinct catalog ids) |
| `SPD_TEAM_B` | Same for AI side |
| `SPD_STREAM_MS` | Delay per printed line **for the static header only** in ms (default `8`; `0` = off) |
| `SPD_UI_MODE` | `inplace` (default) = redraw the same block; `scroll` = append a new block each turn (for pipes / logs) |
| `SPD_INTERACTIVE` | `1` (default): **TTY** 且未同时设置 `SPD_TEAM_A`+`SPD_TEAM_B` 时，脚本会**逐步提示选我方 3 宠、再选对手（随机或手动）**；`0` 强制自动选阵 |
| `SPD_MANUAL_TURNS` | `1` = 每回合从合法行动中**手动选招**；`0` = 自动选 score 最高 |

The agent may set `SPD_STRATEGY` or explicit teams after reading `GET /skill/v1/game/catalog`.
