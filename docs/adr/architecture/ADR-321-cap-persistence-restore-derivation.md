# ADR-321：cap 持久化读侧派生：restoreFields 还原表由 schema 键集统一驱动（跨 cap 一次拍全局）

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：读侧还原表各 cap 手写双轨清单（新增键须两处登记），写侧已 schema 派生（G-8）而读侧仍靠契约锁绷带——治本需派生还原表键集，且涉及类型校验/迁移归一职责归属，是跨 cap 共享病（ground/water/sky/light），单 cap 开刀会造新不对称，须一次拍全局
- **相关**：`docs/knowledge/ground-surface-spec.md（G-8 契约锁）/ frontend/src/preview-3d/caps/scene-capability.ts|restoreFields / frontend/src/preview-3d/state/env-state-schema.ts|getPresetKeys`

---

## 1. 背景（Context）

**切口只缝了一半的持久化双轨**（2026-10-04 地面锐评批定位）：

- **写侧已派生**：ground 的 `saveState` 由 `getPresetKeys("ground")` 遍历 schema ground 组键集自动落盘（G-8 收口 2026-10），water 同法——新增 schema 键**写侧零接线**。
- **读侧仍双轨**：`loadState` 的 `restoreFields` 还原表是**手写清单**（ground 24 字段，各带 oneOf/number/boolean 校验器与 RESTORE_SOURCE 传参），新键须人手补一行。缺口靠 ground 契约锁（「schema 每键写偏离值 → save → reset → load → 全存活，漏登记即红」）绷住——锁保证**漏了会红**，但保证不了**不加新键**：「加一个键、登记两个地方」的漂移面仍在，且每 cap 一把私锁（ground 有锁、water/sky/light 的读侧清单是否同规格无统一执法）。
- **真障碍（设计题而非清理题）**：`restoreFields` 现不仅「还原值」，还承担**类型校验**（oneOf/number/boolean 分派）与**迁移归一**（`normalizeGroundLegacyState` 考古层下沉）两职。`getPresetKeys` 派生只能替掉「键清单」那一半，**替不掉「每键一个校验器」那一半**——后者需要 schema 自身携带校验描述（type 已有，oneOf values 已有；number 的 range 已有）或一份「键 → 校验器」映射的单源。
- **跨 cap 同病**：ground/water/sky/light 四 cap 的读侧清单形态各自手写（水侧 2026-09-22 收口 enabled 幽灵键时也是逐 cap 手术）。单独给 ground 开刀 = 造出「只有 ground 半自动」的新不对称。

## 2. 决策（Decision）

**方向（提议）：读侧还原表键集派生化，跨 cap 一次拍全局**——

1. **键集单源**：`restoreFields` 的「要还原哪些键」改由 `getPresetKeys(group)` 派生（与写侧同口），各 cap 不再手写键清单；漏登记面归零。
2. **校验器单源**：每键的 oneOf/number/boolean 校验描述**下沉进 `ENV_STATE_SCHEMA` 既有字段**（type/enum values/range 已齐——缺的只是「loadState 如何把原始存档值归一」的读侧语义，如 oneOf 非法值回退目标），在 schema 层声明一次、四 cap 共用；`restoreFields` 退化为「遍历派生键集 + 按 schema 描述归一 + 逐键落地」的通用引擎（归一钩子仍允许 cap 级覆盖——迁移归一 `normalize*LegacyState` 与 RESTORE_SOURCE 传参的 cap 差异留在 cap 侧）。
3. **执法升级**：ground 的 G-8 round-trip 契约锁从「cap 私有锁」升级为**跨 cap 通用测试**（遍历 schema 各 group 键集做 save/load 偏离值存活断言），锁一次、四 cap 共享。
4. **不混入本期**：本 ADR 只定方向与接口边界；实施（schema 读侧描述字段扩展 + 通用引擎 + 四 cap 迁移 + 锁升级）单独立执行批，与 2026-10-04 地面决策批（enabled 僵尸往返摘除 / clearCustomTexture 回出厂三轴，均已完成）解耦。

**否决方案**：① 维持双轨 + 各 cap 私锁（现状——漂移面不收敛，锁规格不一）；② 只派生 ground 一 cap（造新不对称，且与写侧「全部 cap 同法」的 G-8 立法方向背反）。

## 3. 后果（Consequences）

- **正面**：「加一个 ground/water/sky/light 键」= 改 schema 一处，写侧/读侧/契约锁全跟上；cap 私有校验器代码（~24×4 行手写）归并为 schema 描述 + 通用引擎；读侧漏登记从「人肉记住」变「编译期/契约红」。
- **负面**：`ENV_STATE_SCHEMA` 承载面变宽（读侧归一语义入 schema），schema 层「零运行时依赖纯声明」的定位要扩一句「含读侧校验描述」；迁移归一钩子的 cap 级覆盖机制新增一个接口面（须防「覆盖即绕过」漂移——由跨 cap 通用锁把守）。
- **已知遗留**：enabled 幽灵键的**真·根治**（enabled 收编进 schema 键、私有门与 schema 键合一）不在本 ADR 范围——那是「cap 私有总开关归一」议题（reflector 双门 F-1 二度收口判据可复用：冲突时以有 ADR/注释/邻座援引的一方为准），待四 cap 读侧派生化落地后再拍。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 地面锐评批（2026-10-04）对 ground saveState/loadState 双轨的实读 + 用户拍板「读侧够格开 ADR，跨 cap 统一议题，不跟地面批混做」 | 本 ADR §1 切口定性 + §2 方向 |
| G-8 收口（写侧派生）现状：`env-state-schema.ts\|getPresetKeys` 已被 ground/water saveState 消费 | §2 第 1 条「与写侧同口」的既有基础 |
| water 侧 enabled 幽灵键收口（2026-09-22，逐 cap 手术先例）+ reflector F-1 双门判据 | §3 已知遗留「私有总开关归一」的判据复用源 |
| `scene-capability.ts\|restoreFields` 现形（oneOf/number/boolean 校验器 + RESTORE_SOURCE 传参 + 迁移归一前置） | §1 真障碍定性（校验器/迁移两职，派生只替清单不替校验） |

<!-- 文件名: cap-persistence-restore-derivation.md → 实际文件 architecture/ADR-321-cap-persistence-restore-derivation.md（ADR-320 architecture 全量模板） -->
