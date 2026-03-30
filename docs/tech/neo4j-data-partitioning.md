# 数据分区与写入策略（Neo4j / Postgres / 内存）

当你希望“用户的 AI 端能决策并可解释”，通常会遇到一个核心问题：**对局过程数据**与**长期图谱数据**到底怎么划分存储。

本项目当前的划分目标是：让实时对战不依赖图数据库可用性，同时保证长期成长能被图谱查询高效使用。

## 1) 对局实时过程：只保存在内存（BattleSession）

### 存在哪儿

- `BattleSession`（`server/src/battle/sessionService.ts`）：
  - `state`：包含 `teamA/teamB`, `events`, `skillReadyRoundBySide` 等实时状态
  - `pendingActions`：等待 A/B 双方提交的动作
  - `phase`：`lobby` / `battle`

### 为什么不写 Neo4j / Postgres

- 实时过程包含大量“事件流”（每回合多事件、包含伤害/换人/KO等），如果全部落图，会导致：
  - 写入量巨大、扩展成本高
  - 查询端需要更复杂的聚合逻辑
  - 对数据库可用性更敏感

因此当前实现只把实时过程用于：

- 回合解算（`resolveTurn`）
- 合法性校验/AI 建议（`legal-actions`）

## 2) 对局结束的聚合更新：写 Neo4j（成长/羁绊/相克相关查询支撑）

### 当前写入内容（聚合而非全量）

在 `persistProgressIfBattleEnded()` 里：

1. `persistBattleProgress()` -> `updateBattleProgressWithRetry()`：
   - 写 `Player -[:HAS]-> Pet`：玩家与本场用到宠物的培养累计
   - 写/更新 `Pet -[:HAS_BOND]-> Pet`：本场 3 只宠物两两组合的共同出战累计
2. PvP 额外：`applyPvpEloWithRetry()`：
   - 写 `Player.eloRating`

### 为什么写“聚合值”而不是“每手动作日志”

- AI 决策（阵容推荐/解释）更需要“长期组合强度”的统计量：例如“某两只宠物一起出场更常触发连携/更高胜率”。
- 聚合写入可以把复杂的事件流压缩成少量边属性（`battles/level`），查询开销小。
- 代码层面也体现了这种目标：即使 Neo4j 同步失败，战斗结果读回也不应被阻塞（代码中捕获并忽略失败）。

## 3) 认证与用户身份：写 Postgres（users/user_sessions）

Postgres 负责的是：

- 用户/账号表（`users`）
- 会话 token（`user_sessions`）
- 第三方账号映射（`user_account_links`）

Neo4j 则负责与“图谱查询”强相关的长期关系数据。

### 为什么身份拆开

- 认证体系是强一致事务问题：用 Postgres 更直接。
- 图谱关系是结构化查询问题：用 Neo4j 更适合。
- 降低耦合：Neo4j 不需要处理密码/登录细节，Postgres 不需要处理图查询与关系边计算。

## 4) 可能的演化路径（可选扩展点）

目前图谱里已经预留了 `Battle` 约束（`schema.ts` 里有 `Battle.id`），说明未来可以扩展为：

- 对每场 PvP/PvE 生成 `Battle` 或 `Match` 节点（存 `winner`, `rulesetId`, `seed` 等）
- 再把“每回合事件流”按需落到图谱（只针对特定人群/模式/采样策略）

但在 MVP 阶段，上述扩展会明显增加写入与调试成本，所以当前选择“只落聚合成长统计”是合理的。

## 5) 优点总结

- 稳定性：Neo4j 不可用不影响对战完成
- 可扩展：图谱查询只面向“少量长期统计字段”
- 可解释：用 `HAS_BOND.level` / `HAS_BOND.battles` 等字段能解释“为何推荐某组合”
- 性能：对局实时数据不产生大量写入与图遍历

