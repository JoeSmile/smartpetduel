# SmartPet Duel（智宠对决）

依据 [`docs/SmartPet Duel PRD.md`](./docs/SmartPet%20Duel%20PRD.md) 与 [`docs/TASKS.md`](./docs/TASKS.md) 开发。

## 环境

- **Node.js**：**25.6.1**（与当前 Mac 环境一致；仓库根目录含 [`.nvmrc`](./.nvmrc)，可用 `nvm use`）
- **包管理**：pnpm

```bash
corepack enable
pnpm install
```

## 目录

| 路径 | 说明 |
|------|------|
| `server/` | Hono API、Neo4j、LangGraph |
| `client/` | React + Vite 前端（当前为占位 UI；阶段五对接 API） |
| `config/` | 本地 JSON 配置（如 `game.json`） |

## Neo4j（本地 / Docker）

推荐 Docker 启动：

```bash
docker run --name smartpet-neo4j \
  -p7474:7474 -p7687:7687 \
  -e NEO4J_AUTH=neo4j/your-password \
  -d neo4j:5
```

浏览器管理页：<http://127.0.0.1:7474>

## Postgres（本地 / Docker）

可复用你现有容器，或用下面命令启动新容器：

```bash
docker run --name smartpet-postgres \
  -p5432:5432 \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=smartpet_duel \
  -d postgres:16
```

## 本地运行

1) 后端环境变量

```bash
cp server/.env.example server/.env
```

2) 填写 `server/.env`

- `NEO4J_URI=bolt://localhost:7687`
- `NEO4J_USER=neo4j`
- `NEO4J_PASSWORD=your-password`
- `POSTGRES_HOST=127.0.0.1`
- `POSTGRES_PORT=5432`
- `POSTGRES_DB=smartpet_duel`
- `POSTGRES_USER=postgres`
- `POSTGRES_PASSWORD=your-password`

3) 初始化数据库（阶段二 + 注册）

```bash
pnpm --filter @smartpet-duel/server postgres:setup
pnpm --filter @smartpet-duel/server neo4j:setup
```

4) 启动后端（默认 `http://127.0.0.1:3000`）

```bash
pnpm dev:server
```

可用接口：

- `GET /health`
- `GET /graph/player/:playerId/pets`
- `GET /graph/bond/:petAId/:petBId`
- `GET /graph/counter/:attacker/:defender`
- `POST /auth/register`（`account`=邮箱或手机号，`password`>=6，`nickname`可选）
- `POST /auth/login`（`account`=邮箱或手机号，无需密码；若用户不存在则自动注册并登录）
- `GET /auth/me`（Header: `Authorization: Bearer <sessionToken>`）
- `POST /auth/logout`（Header: `Authorization: Bearer <sessionToken>`）
- `POST /auth/refresh`（会话轮换；支持 Bearer 或 Cookie 模式）
- `POST /auth/channel/link`（Header: `Authorization: Bearer <sessionToken>`；绑定 `provider + externalUserId`）
- `POST /auth/channel/login`（通过 `provider + externalUserId` 获取本地会话）
- `GET /ai/provider/health`（查看当前 AI Provider 健康状态）
- `GET /ai/provider/config`（查看模型配置中心的脱敏状态与缺失项）
- `POST /ai/provider/chat`（Provider 统一 chat 占位接口）
- `GET /ai/battle/demo-state`（返回一个可直接测试的对战状态样例）
- `POST /ai/battle/legal-actions`（输入 `state + side`，返回服务端合法动作枚举）
- `POST /ai/battle/next-action`（输入 `state + side + difficulty`，返回 LangGraph AI 决策动作）
- `POST /ai/battle/commentary`（输入 `round + events`，返回 1-2 句解说；失败自动模板降级）
- `POST /ai/battle/commentary`（输入 `round + events`，返回 1-2 句解说；失败自动模板降级）
- `POST /battle/session/create`（创建统一会话；支持 `human|ai` 双侧控制）
- `GET /battle/session/:sessionId`（拉取会话状态；用于断线重连）
- `POST /battle/session/submit`（提交一侧动作；服务端串行结算 + 可自动补 AI 动作）

**Skill 接入层**（稳定前缀，与根 API 语义一致；默认开启，`SKILL_LAYER_ENABLED=false` 可关闭）：

- `GET /skill/v1`：返回 JSON 发现文档（路径列表与鉴权说明）
- 例：`POST /skill/v1/auth/login`、`GET /skill/v1/me`、`POST /skill/v1/battle/session/create` …（路径 = `/skill/v1` + 原相对路径）
- 鉴权：`Authorization: Bearer <sessionToken>`（与 `POST /auth/login` 返回的 `sessionToken` 相同）

```bash
curl -sS http://127.0.0.1:3000/skill/v1 | head
curl -sS -X POST http://127.0.0.1:3000/skill/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"user@example.com"}'
```

5) 启动前端（React + Vite，默认 `http://127.0.0.1:5173`，`/api` 代理后端）

```bash
pnpm dev:client
```

## 阶段状态

见 [`docs/TASKS.md`](./docs/TASKS.md) 勾选状态。

## 统一对战模型（PVP / PVE / AIvAI）

服务端将三种玩法统一到同一会话模型：

- `pvp`：`human vs human`
- `pve`：`human vs ai`（任一侧可为 AI）
- `aivai`：`ai vs ai`（适合批量模拟与平衡测试）

统一关键点：

- 同一 `BattleSession`（`session_id`、`state_version`、`ttl`、`ruleset_id`）
- 同一 `BattleState` 引擎结算（服务端权威）
- 同一动作协议（`BattleAction`：`skill | combo | switch`）
- 差异只在 `controllers.A/B.kind = human | ai`
- 统一等待式会话 API：`create / submit / state(get)`

代码骨架：

- `server/src/battle/sessionModel.ts`
  - `BattleSession`
  - `SideController`
  - `inferBattleMode()`
  - `assertSideControlledByUser()`

## AI Provider 接入（OpenAI-compatible）

服务端已新增统一 Provider 抽象层：

- `server/src/ai/providers/types.ts`：接口与通用类型
- `server/src/ai/providers/openaiCompatibleAdapter.ts`：OpenAI-compatible 适配器
- `server/src/ai/providers/index.ts`：按环境变量选择当前 Provider

环境变量（`server/.env`）：

- `LLM_PROVIDER=openai_compatible`
- `LLM_BASE_URL=...`
- `LLM_API_KEY=...`
- `LLM_MODEL_CHAT=...`
- `LLM_MODEL_EMBED=...`
- `LLM_TIMEOUT_MS=10000`
- `LLM_FALLBACK_BASE_URL=...`
- `LLM_FALLBACK_API_KEY=...`
- `LLM_FALLBACK_MODEL_CHAT=...`
- `LLM_FALLBACK_MODEL_EMBED=...`

说明：

- 当前基于 OpenAI-compatible 协议，`chat` 调用 `/chat/completions`，`embed` 调用 `/embeddings`；
- 渠道入口（`doubao/openclaw`）仅用于登录鉴权，不作为 LLM provider 名称。
- 默认走主配置；当主链路超时、429、5xx 或网络异常时，自动降级到 fallback 配置。
- `GET /ai/provider/config` 仅返回脱敏配置视图（如 `hasApiKey` 与 `missing`），不会回传明文 key。
- `POST /ai/provider/chat` 在失败时返回统一错误码：`not_configured|timeout|rate_limited|unauthorized|upstream_http_error|network_error|empty_content`。
- 解说开关与上限：`COMMENTARY_ENABLED`、`COMMENTARY_MAX_TOKENS`。
- 解说开关与上限：`COMMENTARY_ENABLED`、`COMMENTARY_MAX_TOKENS`。

冒烟测试（真实调用 `chat + embed`）：

```bash
pnpm --filter @smartpet-duel/server llm:smoke
```

说明：

- 若 LLM 未配置，脚本会输出 `skipped: true` 并退出成功；
- 若已配置，脚本会同时校验 `chat` 和 `embed` 链路，任一失败则返回非 0。

## 安全基线（当前实现）

- 登录/注册限流（内存窗口限流，防止短时暴力尝试）
- 密码 `scrypt` 哈希存储（不明文）
- 会话支持 HttpOnly Cookie（`sp_session`）与 Bearer 双模式
- CSRF 双提交校验：Cookie 模式下，对关键 POST（如 `logout`、`channel/link`、`refresh`）要求 `x-csrf-token`
- 会话刷新接口：`POST /auth/refresh`（旧 token 失效，新 token 生效）
- 渠道接口签名校验（`/auth/channel/link`、`/auth/channel/login`）

### 渠道验签头（channel APIs）

请求头需包含：
- `x-channel-timestamp`：毫秒时间戳（5 分钟有效窗口）
- `x-channel-nonce`：一次性随机串（窗口内不可复用）
- `x-channel-signature`：`hex(hmac_sha256(secret, provider + "\n" + timestamp + "\n" + nonce + "\n" + rawBody))`

配置项（`server/.env`）：
- `CHANNEL_SIGN_SECRET_OPENCLAW`
- `CHANNEL_SIGN_SECRET_DOUBAO`

### 一键签名请求脚本（本地验证）

脚本：`server/src/scripts/channel-sign-demo.ts`

- 渠道登录（不需要 bearer）：

```bash
pnpm --filter @smartpet-duel/server channel:demo \
  --action=login \
  --provider=doubao \
  --externalUserId=ext_001 \
  --baseUrl=http://127.0.0.1:3000 \
  --secret="$CHANNEL_SIGN_SECRET_DOUBAO"
```

- 渠道绑定（需要已登录用户 token）：

```bash
pnpm --filter @smartpet-duel/server channel:demo \
  --action=link \
  --provider=doubao \
  --externalUserId=ext_001 \
  --bearerToken=<sessionToken> \
  --baseUrl=http://127.0.0.1:3000 \
  --secret="$CHANNEL_SIGN_SECRET_DOUBAO"
```

> 也可不传 `--secret`，脚本会从环境变量读取：
> `CHANNEL_SIGN_SECRET_OPENCLAW` / `CHANNEL_SIGN_SECRET_DOUBAO`

### 渠道最小接入时序（可跑通）

1. 网站用户先完成 `register/login`（拿到本地 `sessionToken`）
2. 首次进入豆包/OpenClaw：渠道侧拿到稳定 `externalUserId`
3. 渠道调用 `/auth/channel/link`（带 bearer + 渠道签名）完成绑定
4. 后续再进同渠道：仅调用 `/auth/channel/login`（渠道签名）拿本地 `sessionToken`
5. 客户端用该 token 请求游戏接口（匹配、战斗、回放、天梯）

### 豆包 / OpenClaw 接入清单

- [ ] 渠道可拿到稳定 `externalUserId`
- [ ] 渠道保存 `provider`（`doubao` / `openclaw`）
- [ ] 渠道配置签名密钥并安全存储（不要下发到前端）
- [ ] 每次请求生成 `timestamp + nonce + signature`
- [ ] 首次走 `channel/link`，后续走 `channel/login`
- [ ] 登录成功后把本地 `sessionToken` 注入后续游戏 API 请求
- [ ] 服务端已部署为渠道可访问 HTTPS 域名

## 当前改动总结（到本次对话）

### 1) 工程与目录（阶段一）

- 已完成 monorepo 结构：`server/` + `client/` + `config/`
- Node 版本按当前环境使用 `25.6.1`
- `server` 已具备 Hono 基础服务与健康检查接口
- `config/game.json` 已从占位升级为可用的基础游戏配置（12 宠、属性、克制、技能与合体映射）

### 2) Neo4j 图谱（阶段二）

- 已实现图谱初始化与导入：
  - 约束/索引：`server/src/neo4j/schema.ts`
  - 导入脚本：`server/src/neo4j/seed.ts`
  - 一键初始化：`pnpm --filter @smartpet-duel/server neo4j:setup`
- 已提供最小查询接口：
  - `GET /graph/player/:playerId/pets`
  - `GET /graph/bond/:petAId/:petBId`
  - `GET /graph/counter/:attacker/:defender`

### 3) Postgres 用户系统（注册/登录）

- 已接入 Postgres，注册信息落库到 `users` 表（邮箱/手机号二选一，格式校验，不做真实性校验）
- 已提供：
  - `POST /auth/register`（仍要求密码长度等，供显式注册场景）
  - `POST /auth/login`（仅需 `account`，不校验密码；首次登录会自动创建用户，服务端为其生成随机密码哈希占位）
- 密码采用 `scrypt` 哈希存储，不明文落库
- 唯一冲突返回 `identifier_exists`；登录仅校验账号格式与是否存在（或自动创建）

### 4) 会话体系（最小可用）

- 新增 `user_sessions` 表，登录后签发 `sessionToken`
- 已提供：
  - `GET /auth/me`（`Authorization: Bearer <sessionToken>`）
  - `POST /auth/logout`（删除当前 token）
- 已验证链路：`login -> me -> logout -> me(失效)`

### 5) 脚本与运行说明补充

- 新增脚本：
  - `pnpm --filter @smartpet-duel/server postgres:setup`
  - `pnpm --filter @smartpet-duel/server neo4j:setup`
- `/health` 同时返回 Neo4j 与 Postgres 连接状态
- 建议在 `server/.env` 中显式设置：
  - `NEO4J_URI=bolt://127.0.0.1:7687`
  - `POSTGRES_HOST=127.0.0.1`
  - `POSTGRES_SSL=false`

### 6) 已知注意事项

- 某些环境下 `localhost` 解析可能异常，导致 Neo4j 连接失败；优先使用 `127.0.0.1`
- 若端口 `3000` 被占用，可临时设置 `PORT=3001`（或其他端口）启动后端
