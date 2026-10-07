# ADR-292-d1：envSource 迁移判据① 供血线单源化（不再跨槽读 sky 存档键形）

- **状态**：✅ 已采纳（Implemented）
- **日期**：2026-10-07
- **决策人**：Jieling（人类首席架构师，拍板「开工第一刀」）、AI 代理
- **关联主 ADR**：ADR-292
- **相关**：`frontend/src/preview-3d/caps/environment-capability.ts, frontend/src/preview-3d/caps/environment-migrations.ts, frontend/src/preview-3d/caps/scene-capability-registry.ts, frontend/src/preview-3d/state/env-state-schema.ts（skyEnvironment）, docs/knowledge/preview-env-state.md`

---

## 背景（一句）

ADR-292 §3.3 判据①（「env 总开关关 ∧ sky IBL 开 → `envSource="sky"`」）的实现原先**跨槽读** sky 的 localStorage 存档（`restoreState("sky").environment`），使 env 的迁移逻辑与 sky 的存档键形硬耦合——sky 一改键名/键形，判据①即静默失效（旧注释自承「改名即断链」）。

## 决策（三行）

1. 判据① 的 sky IBL 开关**改读 `envState.skyEnvironment` 单一事实源**，env 不再跨槽读 sky 槽。
2. 等价性地基 = `registry.loadAll` 按注册序串行且 **sky 先于 environment**（sky.loadState 先把存档 `environment` 恢复进 envState）——该位置性事实**必须**由机器守卫（registry 测试「顺序契约」），不得只活在注释里。
3. **显式接受语义边界**：sky 未先行 load（独立调用 env.loadState / sky cap 构造失败被 `createAll` 静默跳过）时，读到的是 schema 默认 `true` 而非 sky 存档原值，即「sky 未 load」不被认作「sky IBL 关」。生产路径（`shared-infra` createAll→loadAll）无此窗口；该边界**不违反** ADR-292「保画面不变」（env 关闭时两条分支都已无 env 侧画面，差异仅落在来源 radio 的显示）。

## 后果（一句）

env 与 sky 的存档键形解耦（sky 可自由演进键形）；代价是判据① 的正确性从「自包含读存档」变为「依赖 loadAll 注册序」，故配套三条守卫（registry 顺序契约 / sky `environment` 键 round-trip / env cross-slot 解耦两例，均经变异实证）；回退方式 = 恢复跨槽 `restoreState("sky")` 并撤守卫。

<!-- 文件名: envsource-criterion1-single-source.md → 实际文件 decisions/ADR-292-d1-envsource-criterion1-single-source.md（ADR-320 decisions 轻量模板） -->
