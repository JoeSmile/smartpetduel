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
| `client/` | 纯文字 UI 占位（Vite；阶段五对接 API） |
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
- `POST /auth/login`（`account`=邮箱或手机号，`password`）
- `GET /auth/me`（Header: `Authorization: Bearer <sessionToken>`）
- `POST /auth/logout`（Header: `Authorization: Bearer <sessionToken>`）

5) 启动前端（默认 `http://127.0.0.1:5173`，`/api` 代理后端）

```bash
pnpm dev:client
```

## 阶段状态

见 [`docs/TASKS.md`](./docs/TASKS.md) 勾选状态。

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
  - `POST /auth/register`
  - `POST /auth/login`
- 密码采用 `scrypt` 哈希存储，不明文落库
- 唯一冲突返回 `identifier_exists`，凭证错误返回 `invalid_credentials`

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
