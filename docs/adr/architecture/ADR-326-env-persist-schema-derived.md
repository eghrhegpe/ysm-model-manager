# ADR-326：环境能力持久化键派生化：消灭手抄摘键/还原表

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：持久化键轨是用户配置承重轨，手抄摘键/还原表漏登记即静默丢配置（P1-5 实证），需以 schema 单一事实源派生收口
- **相关**：`frontend/src/preview-3d/state/env-state-schema.ts; frontend/src/preview-3d/caps/environment-capability.ts; frontend/src/preview-3d/caps/env-persist.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
`EnvironmentCapability` 的 `saveState` 一直**手摘 6 键**（`envEnabled`/`preset`/`envSource`/`intensity`/`resolution`/`useAsBackground`，非 `getPresetKeys("environment")` 派生），`loadState` 还原表也是**手写双轨清单**。后果：schema 加键而两处任一漏登记 ⇒ **自动持久化、静默不还原**（用户改了下次启动就没了，且零报错）。

这是全仓唯一**存档键名 ≠ schema 键名**的 cap（`preset`→`envPreset`、`intensity`→`envIntensity`、`resolution`→`envResolution`、`useAsBackground`→`envUseAsBackground`），最需要机器守卫——而 2026-10-08 才补上 `[P1-5]` 契约锁，此前**零守卫**。

同族先例对比（2026-10-08 源码树实证）：
- **water 已完整派生**：`water-persist.ts|restoreWaterSchemaKeys` 读 `ENV_STATE_SCHEMA[key].type` 分派、`getPresetKeys("water")` 提供键集。
- **ground 写侧已派生**：`saveState` 走 `getPresetKeys("ground")` 摘键（`getPresetKeys("ground")` 遍历），读侧仍手写 `restoreFields` 双轨清单（有 `[G-8]` 守卫兜底）。
- **environment 两侧都未派生**：写侧手摘、读侧手写还原表——缺口最大，且恰是唯一需处理存档键别名的 cap。

## 2. 决策（Decision）

以 schema 为**单一事实源**派生 environment 的持久化键轨，把「加键」这个动作从「两处手抄登记」收敛为「一处 schema 声明」。三件套：

1. **`env-state-schema.ts` 增 `ARCHIVE_ALIAS` 表 + `getArchiveKey(key)`**——不动 `_FieldDef` 核心类型（它承载值域/派发类型，污染面大），另立独立别名表。environment 6 键声明 `archiveAlias`：`envPreset→preset`、`envIntensity→intensity`、`envResolution→resolution`、`envUseAsBackground→useAsBackground`（`envEnabled`/`envSource` 无前缀方言本就同名，不声明）。`getArchiveKey` = `ARCHIVE_ALIAS[key] ?? key`。
2. **新建 `caps/env-persist.ts`**（仿 `water-persist.ts` 先例，environment 专属叶）：`saveEnvState()` 从 `getPresetKeys("environment")` 派生摘键、经 `getArchiveKey` 映射存档键名，`override` 形参接 cap 专用裁决（如 custom 无缓存回落 studio 的 `preset`）；`restoreEnvPartial(state)` 反向派生 `Partial<EnvState>`，按 `ENV_STATE_SCHEMA[key].type` 分派 number/boolean/enum，类型不匹配跳过（保持 schema 默认），全程 `source: "auto-model"` + `skipMiddleware: true`。
3. **`environment-capability.ts` 的 `saveState`/`loadState` 改走派生**——`loadState` 保留 `normalizeEnvLegacyState` 迁移与 custom HDR 无缓存裁决（运行时事实不可由 schema 派生），仅把「标量键批量恢复」这一段交给 `restoreEnvPartial`。

**为何不顺手统一键名**：`preset`/`intensity`/`resolution`/`useAsBackground` 有跨代读者（迁移模块与 loadState 旧档分支），改名有迁移债，收益低于风险——先派生收口，改名是独立一刀（同 `[P1-5]` 注释口径）。

**为何不推广到 ground 读侧**：ground 读侧已表驱动（`restoreFields` spec）+ 有 `[G-8]` 守卫，且 schema 键名 = 存档键名、无别名需求，改造收益小风险不小。本刀聚焦缺口最大的 environment，先例已立、模式可复用，留作后续。

## 3. 后果（Consequences）

**正面**
- **漏登记从根上不可能**：加 schema 键自动带出持久化，不再依赖「saveState 摘键 + loadState 还原表」两处人工同步。`[P1-5]` 契约锁从「逼回登记流程」升级为「派生即登记」——偏离值登记是测试自证，不再是承重。
- **消灭一类静默故障**：环境组「用户改了下个会话就没了」这类 bug 失去结构性成因。
- **为第 1 刀（cap 拆分）铺路**：`env-persist.ts` 即拆分后独立模块的雏形。

**负面**
- **`ARCHIVE_ALIAS` 需维护**：但仅 environment 6 键、且是显式声明表，维护面比「手抄摘键 + 手写还原表」两处小一半；`satisfies` 穷尽守卫逼出漏声明。
- **`saveState` 的 `override` 形参是逃生门**：cap 专用裁决（custom 回落）仍可能手写——但裁决是运行时事实（HDR 缓存存在与否），本就不可能派生化，属正确边界。

**已知遗留**
- 跨代存档迁移债保留：`preset`/`intensity`/`resolution`/`useAsBackground` 旧键名继续由 `environment-migrations.ts` 承载，不改名。
- ground 读侧仍手写 `restoreFields` spec（有 `[G-8]` 守卫），本刀不处理。

## 4. 数据溯源

- `environment-capability.ts|saveState`/`loadState` 源码树实读（2026-10-08）：saveState 手摘 6 键（`envEnabled`/`preset`/`envSource`/`intensity`/`resolution`/`useAsBackground`），loadState 手写双轨还原清单。
- `environment-capability.test.ts`「[P1-5]」契约锁：`DEVIATION` 表显式声明 schema 键 → 存档键映射，正是别名需求的第一手证据。
- `water-persist.ts|restoreWaterSchemaKeys` 先例：schema 派生恢复的已验证范式（2026-10-08 P1-0/P3-1 下沉）。
- `ground-capability.ts|saveState` 先例：写侧 `getPresetKeys("ground")` 派生已落地，读侧 `restoreFields` 仍手写（本刀不处理，理由见决策）。
- `env-state-schema.ts` `_FieldDef` 类型实读：加可选 `archiveAlias` 会污染核心类型，故另立 `ARCHIVE_ALIAS` 表。

<!-- 文件名: env-persist-schema-derived.md → 实际文件 architecture/ADR-326-env-persist-schema-derived.md（ADR-320 architecture 全量模板） -->
