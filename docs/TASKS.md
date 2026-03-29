# SmartPet Duel — 开发任务清单（TASKS）

**依据文档**：[SmartPet Duel PRD.md](./SmartPet%20Duel%20PRD.md) **v2.3**  
**最后同步 PRD**：YYYY-MM-DD（PRD 升版时请更新本行并对照「PRD 变更追踪」）

---

## 使用说明

- 按 **阶段编号顺序** 推进；完成子任务后勾选 `- [ ]` → `- [x]`。
- **MVP** 可跳过 **阶段四b（可选 / Phase 2）** 整段。
- **阻塞**：**附录 A**（技能/合体/解锁表）未定稿前，对战数值平衡、合体技联调、解锁联调标为依赖附录 A；见 PRD 附录 A 与第十三节里程碑。

---

## 阶段一：项目初始化

**对应 PRD**：第十三节 · 阶段一；第一节 · 技术栈

- [x] 明确仓库布局（monorepo 或 `server`/`client` 分目录），与 `smartpet-duel` 根路径一致
- [x] 初始化 Node 项目（包管理器、TypeScript 若采用则配置 `tsconfig`）
- [x] 引入 **Hono** 作为 HTTP 框架骨架（健康检查路由占位）
- [x] 添加 **Neo4j** 驱动依赖与连接配置占位（环境变量）
- [x] 添加 `LangChain`、`LangGraph` 依赖（版本与 PRD「AI 模块」一致即可）
- [x] 提供 **`.env.example`**：Neo4j URI、账号、可选 LLM API key 占位（**不入库、不进客户端**，见 PRD 十五节 NFR）
- [x] 本地 **JSON 配置** 加载骨架（宠物静态补充数据等，与 PRD「本地 JSON + Neo4j」一致）
- [x] 文档化本地运行：`README` 或 `docs/` 内最短启动步骤（含 Node 版本）

阶段一状态：已完成（server/client 脚手架、Node 25.6.1、Hono health、Neo4j/LLM 环境变量占位、JSON 配置加载骨架、README 启动说明）。

---

## 阶段二：Neo4j 图谱

**对应 PRD**：第十三节 · 阶段二；**第八节** 图谱

- [x] Neo4j 本地或 Docker 启动方式写入文档（README）
- [x] 建模节点：Player、Pet、Skill、Attribute（PRD 8.1）
- [x] 可选：Battle/Match 会话节点或等价存储（PRD 8.1 扩展、第十节回放/天梯）
- [x] 建立关系：`HAS`、`BATTLE_WITH`、`HAS_BOND`、`UNLOCK_BY`、`COUNTER`（PRD 8.2）
- [x] 编写 **Cypher** 或迁移脚本：导入 **12 只宠物** + 属性（第三节）
- [x] 导入 **属性克制** 关系（第四节，与 PRD 数值一致）
- [x] 最小查询：玩家拥有宠物、双宠羁绊、属性克制链（供引擎与 AI 使用）
- [x] 约束/索引：宠物 ID、玩家 ID 等主键唯一（按实现选型）

阶段二状态：代码侧已完成（schema+seed+查询接口）；待你本地启动 Neo4j 后执行 `pnpm --filter @smartpet-duel/server neo4j:setup` 做一次实际入库验证。

---

## 阶段三：对战引擎与成长（确定性）

**对应 PRD**：第十三节 · 阶段三；**第五、六、九节**；**第十一节** GameEngine；**十五节** NFR 4

- [x] 定义 **`ruleset_id`** 与引擎版本绑定策略（第十节回放、附录 B.6）
- [x] 定义全局 **随机种子** 与回合内随机点（先手等，第九节）
- [x] **GameEngine** 状态机：3v3 阵容、单场仅一只在场、阵亡轮换（第九节 1、4、5）
- [x] 回合流程：双方操作 → 伤害 → 阵亡 → 轮换 → 回合结束（第九节 2）
- [x] 实现伤害公式：**攻击 × 技能系数 × 克制 × 羁绊加成**（第九节 3；第五节 2）
- [x] 实现属性克制表（第四节）
- [x] 普通技能：2 个/宠、冷却与合体逻辑前置（第六节 1）；**依赖附录 A 定稿后** 填系数
- [x] 合体技：羁绊 Lv.3、搭档存活、冷却 2 回合、每场每组合体 ≤2 次（第六节 2）
- [x] AOE：全额/溅射 30%、替补不可秒杀（第六节 3）
- [x] 羁绊：暴击率、技能伤害加成（第五节 3.3）
- [x] 战后更新：共战次数、宠物等级、双宠羁绊等级（第五节 1–3）；写 Neo4j + **失败重试**（十五节 4）
- [x] 单元测试：相同种子 + 相同输入 → 相同结算（十五节 5、附录 B 与引擎）

---

## 阶段四a（必选）：图谱查询 + LangGraph 对战 AI

**对应 PRD**：第十三节 · 阶段四a；**第八节** MVP；**第十一节**；**附录 A**；**附录 B.1–B.2**

- [ ] **附录 A 定稿**：12 宠 × 2 普通技能 + 合体技表 + 解锁矩阵（至少可开发级数据，替换 TBD）
- [ ] 将技能/合体数据导入图谱或 JSON，并与 `skill_id`/`combo_id` 一致（附录 A）
- [x] Cypher 或模板服务：查询羁绊、合体技是否可用、阵容合法性（第八节 4 MVP）
- [x] 服务端枚举 **合法动作**（技能/切换/合体）供 Planner 使用（附录 B.1）
- [x] 设计 **LLM Provider 抽象层**（统一 `chat/embed/health` 接口），避免业务层绑定单一供应商
- [x] 增加 Provider 适配器骨架：`openaiCompatibleAdapter`（统一 OpenAI-compatible 协议）
- [x] 实现 **LangGraph** 管线：**Analyst → Planner → Persona**（第十一节 2）
- [x] 实现 **规则 AI fallback**（超时、非法输出、无 LLM；第十一节 2）
- [x] 易 / 中 / 难三档与 Persona 映射（附录 B.2）
- [x] 固定种子下 **规则 AI 路径** 行为可复现（附录 B.2）

---

## 阶段四b（可选 Phase 2）：向量 / NL 查询 / 解说

**对应 PRD**：第十三节 · 阶段四b；**第八节** 4 Phase 2；**第十一节** 3–5；**十五节** NFR 2

- [x] **方案 A**：向量库 + 战报/阵容 embedding（第十一节 3）；仅建议层，**不改数值**
- [x] **方案 B**：NL→预定义模板或 allowlist NL→Cypher；**禁止** 任意 Cypher 拼接（十五节 3）
- [x] 增加模型配置中心：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL_CHAT`、`LLM_MODEL_EMBED`
- [x] 支持主备模型切换策略（同协议多模型主备；超时/限流自动降级）
- [x] 解说员 LLM：基于结构化事件、1–2 句；**开关** + token 上限（十一节 4；十五节 2）
- [x] 内容侧 embedding：相似宠物/阵容解释（十一节 5）
- [x] 统一提示词输出协议（JSON Schema），确保不同供应商输出可被稳定解析
- [x] Provider 冒烟测试：OpenAI-compatible `chat` 与（如启用）`embed` 链路
- [x] 适配器错误码语义统一（`chat`/`embed` 超时、限流、鉴权失败）
- [x] 验收：附录 B.3、B.4（allowlist、不编造数值）

---

## 阶段五：API + 文字 UI

**对应 PRD**：第十三节 · 阶段五；**第十二节**；**第九节** 6–7；**十五节** NFR 1

本阶段原列会话、UI、鉴权、渠道等与 **RAG、Neo4j 无直接对应**，已从本清单移除；实现与验收见仓库 `README` 与代码提交历史。图谱只读/背包等能力依赖 **阶段二** 与既有 `/api/graph/*`、`/api/game/*` 接口。

---

## 阶段五·PvP 房间与自选阵容（目标流程）

**目标**：凡 **PvP 对战**（双方均为可操作方：双人类，或一方人类一方 AI 等由 `controllers` 定义的组合），**各自只选己方 3 只宠**，不再由邀请方代选对手阵容；流程上对齐常见对战：**加入房间 → 各自选阵 → 准备 → 房主开始 → 进入现有回合引擎**。

**与当前实现的差距**：现网为「创建即 `createBattleState` + 主机代填 `teamB`」；需引入 **战前大厅态** 与 **分步 API**，开战后再接入既有 `resolveTurn` 与托管逻辑。

### A. 会话模型与状态机（服务端）

- [x] 扩展 `BattleSession`（或等价结构）：区分 **`lobby`（选阵/准备）** 与 **`battle`（已开战）**；开战前 **`BattleState` 可不创建** 或占位，避免未齐阵就进入 `resolveTurn`。
- [x] 战前字段（示例）：每侧阵容草稿 `teamA` / `teamB`（`[pet×3] | null`）、`ready: { A, B }`、`started: boolean`、`createdBy`（房主侧，默认 A）。
- [x] **权限**：仅 **对应侧 controller** 可更新己方阵容与己方准备态；**仅房主**可调用「开始对战」（或约定仅 A 方 userId）。
- [ ] **校验**：双方阵容各 3 只互不重复；若启用图谱背包约束，仅校验 **人类侧** 与 Neo4j 背包一致（AI 侧全库或规则另定）。（当前：服务端校验图鉴内三宠互异；背包约束仍为客户端）

### B. HTTP API（建议形态，实现时可微调命名）

- [x] `POST /battle/session/create`（PvP）：仅创建 **大厅**（对手 userId、双方 controller 类型），**不**立即生成完整 `BattleState`；返回 `sessionId` 与大厅态。
- [x] `PATCH /battle/session/:id/lineup`：`side` + `team`（三宠），鉴权为当前用户必须控制该 `side`。
- [x] `POST /battle/session/:id/ready`：标记当前用户所在侧为已准备；可允许重复提交幂等。
- [x] `POST /battle/session/:id/start`：**仅房主**；条件：`teamA`、`teamB` 均已设且双方 `ready`（或约定 AI 侧自动 ready）；**此时**调用 `createBattleState`、写入 `seed` 等，转入现有对战流程。
- [x] 开战前：**拒绝** `submit` 回合动作；开战后：现有 `POST /battle/session/submit` 不变。
- [x] `GET /battle/session/:id`：拉取大厅或对战态，供邀请链接加入方同步 UI。

### C. 与 AI 侧的组合（「无论是人还是 AI」）

- [x] 明确产品规则：**PvP 指 `mode === "pvp"`（双人为人类）** 时，双方均自选；若未来支持 **人类 vs AI** 仍走「房间 + 自选己方」时，人类选阵、AI 侧在 `start` 前由服务端按规则生成或默认阵（**不**再由人类代选 AI 阵）。
- [x] **双 AI 观战 / AiVai**（`aivai`）：不强制大厅 UI；可选任务——创建时 **双方阵容均由服务端随机或配置**，与「人类 PvP 自选」分流，避免混在同一套「准备」流程里（可单列脚本或管理端）。

### D. 客户端（文字 UI）

- [x] 邀请方：创建 PvP 大厅 → 仅填对手 ID / 分享链接，**不再**包含对手阵容下拉。
- [x] 双方进入同一 `sessionId` 后：**各显示己方选阵**（与 PvE 我方逻辑一致，背包约束仅作用于己方人类）。
- [x] **准备** 按钮（受邀方必点；房主也可点以示就绪）。
- [x] **开始对战** 按钮（仅房主可见且满足条件可点）。
- [x] 开战前隐藏或禁用区域 4 操作指令；开战后与现网一致。
- [x] 邀请链接：`?joinPvp=` 进入 **大厅** 而非直接终局。

### E. 回归与迁移

- [x] **PvE**：保持「创建即战」或仅人类侧选阵 + 敌方随机，**不受** PvP 大厅逻辑破坏。
- [x] **天梯 Elo**：仍在 **PvP 双人类且对局结束** 时更新（与现逻辑一致）。
- [x] 补充 `sessionService` 单测或集成测：大厅 → 双 ready → start → 一回合 submit。

### F. 难度与依赖（备忘）

- **复杂度**：中等（状态机 + 多接口 + 双端联调）；**不**改伤害与回合结算公式。
- **依赖**：Postgres 用户、现有鉴权；可选 Neo4j 背包校验（阶段二）。

---

## 阶段五·续：战斗回放 + 天梯排行

**对应 PRD**：第十三节 · 阶段五·续；**第十节**；**第二节** 流程 7；**十五节** NFR 6–7

> 下列仅保留与 **Neo4j** 相关的条目；其余回放、重演、Elo、PvP 计分、跨入口一致性等非图谱任务已自本清单移除。

- [x] 榜单与本人排名：可选在 **Neo4j** 的 `Player` 节点或属性中存天梯分，并与读回逻辑一致（十节 2）— 已实现 `Player.eloRating`、PvP 结束时 `applyPvpEloWithRetry`、`GET /graph/ladder`、`GET /graph/ladder/player/:playerId`

---

## 阶段六：整体验收与回归

**对应 PRD**：第十三节 · 阶段六；**附录 B.5–B.7**；**十五节** NFR 5

> 下列仅保留与 **Neo4j（战后图谱写入）** 或 **RAG / Phase 2（向量与 NL）** 相关的条目；其余 AI 批量、供应商报告、回放回归、天梯链式、确定性冒烟等已自本清单移除。

- [x] **Neo4j**：端到端验证 **战后图谱写入**（宠物等级、羁绊、共战等）正确且可重试（第五节、十五节 4）— `updateBattleProgressWithRetry` + `phase6TasksAcceptance.test.ts`（未配置时 skipped）
- [x] **RAG / Phase 2**：端到端验证（可选）**向量 embedding、解说员、NL→allowlist** 等开关关闭或降级路径仍安全可用（阶段四b；十五节 2–3）— `phase6TasksAcceptance.test.ts` + 既有 `phase4bAcceptance` / commentary 测试


## PRD 变更追踪

- PRD 升版（如 v2.4+）时：通读 **第十三节 里程碑**、**附录 A/B**、**第十五节 NFR**，在本 TASKS 中增删或调整任务并更新文首「最后同步 PRD」日期。
