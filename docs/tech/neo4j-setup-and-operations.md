# Neo4j 初始化与运行操作（开发者向）

## 初始化流程

入口脚本：`server/src/scripts/neo4j-setup.ts`

执行顺序：

1. `verifyNeo4jConnectivity()`
   - Neo4j URI/账号未配置时会返回 `skipped`
2. `applySchema()`
   - 建立约束（例如 `Player.id`/`Pet.id`/`Skill.id` 唯一）
   - 建立必要索引（例如 `Pet.attribute`, `Skill.petId`）
3. `seedGraphFromConfig()`
   - 从 `config/game.json` 导入静态图谱数据：
     - `Attribute` 节点
     - `Pet` 节点 + `HAS_ATTRIBUTE`
     - `Skill` 节点 + `HAS_SKILL`
     - `COUNTER` 相克倍率关系
     - `UNLOCK_BY` 解锁链

## 运行时“读/写”入口（写入强依赖对局结束）

### 读（给 AI/图谱查询）

- 获取玩家宠物清单：`getPlayerPets(playerId)`
  - Cypher：`(pl:Player {id})-[h:HAS]->(p:Pet)`
- 获取宠物羁绊：`getBondBetweenPets(petAId, petBId)`
  - Cypher：`(a:Pet)-[HAS_BOND]->(b:Pet)` + UNION 无序方向
- 获取相克倍率：`getCounterMultiplier(attackerAttr, defenderAttr)`
  - Cypher：`(Attribute)-[COUNTER]->(Attribute)`

对应的 API 目前在 root 下提供 `/graph/*`：

- `GET /graph/player/:playerId/pets`
- `GET /graph/bond/:petAId/:petBId`
- `GET /graph/counter/:attacker/:defender`

### 写（更新长期成长统计）

- `updateBattleProgressWithRetry()`：
  - 写 `Player-HAS-Pet`
  - 写/更新 `Pet-HAS_BOND-Pet`
  - 使用 `retryAsync` 做重试，避免临时网络/事务失败
- `applyPvpEloWithRetry()`：
  - 写 PvP Elo（仅 PvP 结束触发）

写入触发点（重要）：

- 只有战斗状态 `state.ended` 且相关 side 是 `human` 才会把进度落到 Neo4j
- Neo4j 写入失败不会阻塞 battle result 的读取（捕获并忽略）

## 为什么需要重试（retryAsync）

Neo4j 连接与事务在开发/自建环境经常会遇到：

- 网络短暂抖动
- 事务冲突/超时

因此采用有限次数重试，把“对局体验”优先级放在“最终一致的图谱写入”之前。

