# Skill 层（`/skill/v1`）给 AI 端的知识整理

目标：让外部 AI/Agent 在不关心内部引擎细节的前提下，仍能完成“查规则 -> 选阵 -> 合法行动 -> 拉取结果/解释”的闭环。

## 1) Skill 层提供哪些能力

- 鉴权与用户会话：`/skill/v1/auth/login`、`/skill/v1/me`
- 静态游戏数据（catalog）：`/skill/v1/game/catalog`
- 大部分对战驱动：`/skill/v1/battle/session/*`
- 给 AI 做合法动作过滤：`/skill/v1/ai/battle/legal-actions`、`/skill/v1/ai/battle/next-action`
- 可选读取 Neo4j 玩家宠物：`/skill/v1/graph/player/:playerId/pets`

## 2) 推荐的“决策闭环”工作流（适用于 PvE/PvP/AIVAI）

1. 发现与健康确认（可选但推荐）
   - `GET /skill/v1`：查看 endpoints 列表、确认 Skill 层是否启用
2. 登录（需要 human side 的模式才需要）
   - `POST /skill/v1/auth/login` 拿 `sessionToken`
   - 后续带 `Authorization: Bearer <sessionToken>`
3. 拉取静态规则与图鉴
   - `GET /skill/v1/game/catalog`
   - 使用：
     - `pets[]`：宠物 id/name/attribute/baseHp/baseAttack
     - `skills[]`：技能 id/name/type/coefficient
     - `comboSkills[]`：连携 id/宠物对/系数/是否 AoE
     - `attributes[]`：属性枚举
     - `counters[]`：属性相克倍率（`from`->`to`）
     - `battleRules`：结构化规则说明（团队规模、连携/羁绊门槛、冷却/溅射等）
4. 组阵/创建 session
   - AIVAI：两个 side 都用 `{ kind: "ai" }`
   - PvE：human + ai（可利用人类超时托管）
   - PvP：两个 side 都为 human（必须登录并传 userId）
5. 每回合合法行动选择
   - 在你要做“自选动作”的情况下，优先用：
     - `POST /skill/v1/ai/battle/legal-actions`（基于当前 `state` + `side`）
   - 然后再：
     - 从合法集合中选 `skill/combo/switch`
6. 提交与同步
   - 需要你提交动作的模式（PvP/PvE 的 human side）：
     - `POST /skill/v1/battle/session/submit` 并带 `expectedStateVersion`
   - 如果你只是观察 AIVAI：
     - 直接 `GET /skill/v1/battle/session/:sessionId` 轮询直到 `state.ended`

## 3) 动作 schema（Action types）

提交给引擎/或由 AI 规划生成的动作类型一致：

- `{"type":"skill","skillId":"..."}`：普通技能
- `{"type":"combo","comboId":"..."}`：合体技能
- `{"type":"switch","toIndex":0|1|2}`：切换出战宠物（bench->active）

注意：引擎会拒绝不合法动作，并 push `action_rejected` 事件。

## 4) 为什么 catalog 里要包含 `counters` / `battleRules`

因为 AI 端需要同时回答两类问题：

1. 选什么宠物、技能、连携（图鉴查找）
2. 为什么它更可能赢（规则/相克推理 + 决策可解释性）

`counters` 让 AI 能做属性相克倍率计算；`battleRules` 则把引擎约束（队伍大小、连携羁绊门槛、冷却/溅射等）结构化输出，减少“猜规则”的风险。

## 5) 使用 Skill 层时的注意点（最关键）

1. stateVersion 一致性（仅对需要你 `submit` 的模式）
   - 你的动作必须基于最新 `GET /battle/session/:id` 得到的 `stateVersion`
   - 提交时传 `expectedStateVersion`
   - 若冲突通常会以 409 类错误返回：重新拉取 state 再提交
2. 强烈建议先 `legal-actions`
   - 自选动作时，直接 submit 很容易触发冷却/条件不满足导致 `action_rejected`
3. AIVAI 不要误用 submit
   - 双方都是 AI 时，服务端会内部填充 pending actions 并自动推进
   - 客户端更应以轮询为主
4. Neo4j 写入在很多情况下不会发生
   - Neo4j 长期成长/羁绊写入一般只对 `human` side 生效
   - PvP Elo 也通常只在“PvP 且双方人类”时触发
   - 因此：不要依赖 AIVAI/PvE(ai-ai) 来更新图谱数据
5. “看事件”与“做决策”要分开
   - 事件流（`state.events`）适合战后解释/调试
   - 决策阶段更建议先用 `legal-actions` 或 `next-action`，避免反复解析事件流造成开销

## 6) 端点速查（汇总）

- Discovery：`GET /skill/v1`
- Auth：`POST /skill/v1/auth/login`、`GET /skill/v1/me`
- Static：`GET /skill/v1/game/catalog`、`GET /skill/v1/game/unlock-links`
- Battle：
  - create：`POST /skill/v1/battle/session/create`
  - poll：`GET /skill/v1/battle/session/:sessionId`
  - PvP lobby：`PATCH /skill/v1/battle/session/:sessionId/lineup`、`POST .../ready`、`POST .../start`
  - submit：`POST /skill/v1/battle/session/submit`
  - rematch：`POST /skill/v1/battle/session/:sessionId/rematch`
- AI helper：
  - legal：`POST /skill/v1/ai/battle/legal-actions`
  - suggest：`POST /skill/v1/ai/battle/next-action`

## 7) 如果你要把“为什么这样做”写成更工程化的规则

你可以补充你希望 AI 端的策略口径，例如：

- 只使用 `legal-actions` 过滤 + 再做相克/羁绊启发式
- 或者完全依赖 `next-action` 的服务端建议

我也可以根据你的偏好把该文档进一步改成“可配置策略模板”（例如：只选最优伤害、还是保留 combo/cooldown、是否为了解释而倾向安全动作）。

