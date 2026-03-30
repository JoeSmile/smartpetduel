# Neo4j 图谱模型（MVP）

目标：用 Neo4j 表达“宠物羁绊/成长关系 + 属性相克 + 静态技能数据”，让 AI 在查询时能直接拿到结构化信息（例如：哪些宠物搭配更强、某属性对某属性的伤害倍率）。

## 节点（Nodes）

1. `Player`
   - 含义：玩家身份（用于保存 Elo、以及玩家拥有的宠物关系）。
   - 关键字段：
     - `id`：唯一玩家 id（与 Postgres 用户 id 同源）
     - `eloRating`：PvP 天梯分（可为空/未初始化）

2. `Pet`
   - 含义：游戏中的宠物种类（12 只左右）。
   - 关键字段：
     - `id`：宠物 id（来自 `config/game.json`）
     - `name`：中文名（seed 时写入）
     - `attribute`：属性（`fire|water|grass|electric|light|spirit`）
     - `baseHp` / `baseAttack`：基础面板（seed 时写入）

3. `Skill`
   - 含义：普通技能/合体技能的“定义表”。
   - 关键字段（seed 写入）：
     - `id`, `name`, `type`
     - `coefficient`：伤害/增益系数（按引擎）
     - 普通技能：`petId`
     - 合体技能：`petAId`, `petBId`，并将 `type='combo'`

4. `Attribute`
   - 含义：属性枚举节点（用于属性相克查表）。
   - 关键字段：
     - `name`：属性名（唯一）
     -（seed 同时写）`id`：`ATTR_*` id

## 关系（Relationships）

1. `(:Pet)-[:HAS_ATTRIBUTE]->(:Attribute)`
   - 含义：宠物属于哪个属性。
   - 为什么这么做：把“宠物->属性”抽成节点关系，后续可以用 Cypher 快速按属性聚合（例如统计某属性宠物的技能或相克链条）。

2. `(:Pet)-[:HAS_SKILL]->(:Skill)`
   - 含义：
     - 普通技能：宠物拥有该技能
     - 合体技能：双宠都与该 `Skill` 相连（同一个 combo 技能节点通过两条 `HAS_SKILL` 被两只宠物共享）
   - 为什么这么做：引擎执行需要 `activePet + comboId` 校验（combo 的 `petAId`/`petBId`），图上把 combo 作为 `Skill` 节点会更统一。

3. `(:Attribute)-[:COUNTER {multiplier}]->(:Attribute)`
   - 含义：属性相克倍率查表。
   - multiplier：伤害倍率（不命中默认 1.0）
   - 优点：AI 可直接读取一对属性的倍率并纳入决策。

4. `(:Pet)-[:UNLOCK_BY]->(:Pet)`
   - 含义：宠物解锁关系（`fromPetId -> toPetId`）。
   - 为什么这么做：当用户解锁/成长路径需要解释或推荐时，“解锁路径”天然是图结构。

5. 用户成长关系（下面会更细讲）：
   - `(:Player)-[:HAS {level, battleCount?}]->(:Pet)`：玩家拥有/培养了哪些宠物（以及“培养等级”）。
   - `(:Pet)-[:HAS_BOND {battles, level}]->(:Pet)`：宠物对之间共同上阵的历史（决定羁绊等级/强度）。

## 约束与索引（Constraints & Indexes）

为了保证“id 维度稳定”和“查询速度”，初始化脚本会创建：

- 唯一约束（`IF NOT EXISTS`）：
  - `Player.id` 唯一
  - `Pet.id` 唯一
  - `Skill.id` 唯一
  - `Attribute.name` 唯一
  - `Battle.id` 唯一（目前代码未必用到 seed，但约束已存在）
- 索引：
  - `Pet.attribute` 索引
  - `Skill.petId` 索引

## 典型查询目标（为什么存在这些节点/关系）

- 获取玩家的宠物清单：`Player -[:HAS]-> Pet`
- 获取宠物羁绊：`Pet -[:HAS_BOND]-> Pet`
- 获取属性相克倍率：`Attribute -[:COUNTER]-> Attribute`
- 获取解锁链：`Pet -[:UNLOCK_BY]-> Pet`

