# ADR-091-d1：环境能力 cap 拆分：hdr-cache/background 先行，ibl 所有权段单独一刀

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-091

---

## 背景（一句）

锐评 2026-10-08 实证：`EnvironmentCapability`（`environment-capability.ts`）913 行、40 方法，声称「cap = 状态→Three 适配器」却塞了环境资产管线（PMREM 烘焙 / 三通路取图 / custom HDR 缓存 / 背景槽管理 / 缩略图），单适配器已违 ADR-091 巨函数红线。

## 决策（三行）

- 分**两个子提交**切割，降单刀风险：① `env-hdr-cache.ts`（custom HDR 缓存类：tex/name/loading/warnedMissing 四态 + 加载管线 + 缩略图）+ `env-background.ts`（`applyBackground` 助手）——**无所有权敏感**；② `env-ibl.ts`（PMREM 管线 + 三通路取图 + `disposeEnvironment`）——**ADR-292 D1 单写者契约核心承载区，单独一刀**。
- cap 本体收缩为：状态字段 + 构造器/回调接线 + `apply`/`dispose` + 持久化（已派生化，ADR-326）+ setter 群 + `getMenuNodes`——退化为真正的适配器编排壳。
- 方法论复用 ADR-091 `mount3D` 拆分先例（生命周期/纯函数下沉 → 壳只留接线）。

## 后果（一句）

拆后 `environment-capability.ts` 目标 ~280 行；`env-ibl.ts` 必须保住 `scene.environment` 单写者 + dispose 两序收敛（`envOwnsSceneEnvironment`/`envShouldYieldSlot` 守卫兜底，拆错即 `environment-capability.test.ts`「dispose 顺序收敛」两例转红）。回退 = `git revert` 对应子提交。

<!-- 文件名: cap-hdr-cache-background-ibl.md → 实际文件 decisions/ADR-091-d1-cap-hdr-cache-background-ibl.md（ADR-320 decisions 轻量模板） -->
