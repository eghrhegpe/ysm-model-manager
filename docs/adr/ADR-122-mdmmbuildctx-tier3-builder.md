# ADR-122：MdMmBuildCtx 三档重构与 tier3 Builder 化否决

- **状态**：🔄 部分采纳（Partially Accepted）— tier3 Builder 化方向已否决
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-26
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`frontend/src/utils/3d/adapters/mmd-adapter.ts|MdMmBuildCtx`；提交 `2fbfe5ce`（tier1 域拆分）、`99d41318`（tier2 Pick 收窄）；审计卡 `docs/knowledge/frontend_repo_audit.md`（`:29`/`:52` 已同步）

---

## 1. 背景（Context）

`MdMmBuildCtx` 是 `mmd-adapter.ts` 内 `buildMmdScene` 的巨型可变上下文（原 60 字段，tier1 后 55 字段），被 MMD 构建管线的 8 个 stage 共享。三档重构计划：

- **tier1（域拆分）**— 已落地（`2fbfe5ce`）：扁平 60 字段拆为 6 个生命周期域接口 `MdMm{Io,Parse,Texture,Anim,Perception,Trace}State`，`MdMmBuildCtx extends` 组合，访问路径零改动。
- **tier2（stage 签名收窄）**— 已落地（`99d41318`）：8 个 stage 各自 `Pick<MdMmBuildCtx,…>` 类型，函数体越界访问编译期即报错（tsc 即域纪律执行器）。
- **tier3（Builder 化）**— 提案：把 `const c = {} as MdMmBuildCtx` 单体构造改为 Builder 模式，结构化装配 + 不可变 ctx。

本 ADR 裁决 tier3 是否采纳。

## 2. 决策（Decision）

**否决 tier3 Builder 化方向；改走 "typed seeded base" 轻量针对性收口。**

理由：

1. **模式错配（核心）**：实测构造点 `mmd-adapter.ts:1135-1165`，`c` 是**顺序异步管线累加器**——`stage1→2→parse→3→4→5→6` 依次 `await` 执行，各 stage 既读上游字段又写下游字段（`c.buildSucceeded` / `c.blobUrls` 被多 stage 改写），`finally` 还回读 `c.buildSucceeded` 决定资源回收。这不是 "组装完 → 产出不可变结果" 的对象。Builder 的不可变收益在此不成立；强行套 Builder 要么仍持可变 partial（失去收益），要么要改 8 个 stage 契约让各 stage 返回字段由编排器合并——大改、回归风险高。

2. **唯一真实缺陷可针对性修复**：当前 `const c = {} as MdMmBuildCtx`（`mmd-adapter.ts:1141`）的 `as` 强转使 tsc 不校验 55 字段是否齐备，漏初始化字段运行时即 `undefined`。该风险用 **typed seeded base / 工厂返回完整对象**（让 tsc 校验字段完整性）即可捕获，无需 Builder 仪式。

3. **成本/价值错位 + 纪律约束**：现状无运行时 bug 报告；tier1/2 已买走主体安全（域纪律 + `!` 非空断言清零）。`mmd-adapter.ts` 本轮已 churn 两次（域拆分 + Pick 收窄），再加全套 Builder 重构违反「针对性修复非全量重写」工程纪律，且收益边际。

## 3. 后果（Consequences）

- **正面**：钉死否决理由，防止后人重复提案 tier3 Builder 化、浪费一轮评估；轻量 typed-base 修复即可捕获主要安全收益（编译期字段齐备校验）。
- **负面 / 已知遗留**：`c` 运行时仍是单对象全闭包共享、跨 stage 可变；跨 stage 写入依赖管线序，未加额外不变式保护（tier2 Pick 收窄已限制各 stage 的*读域*，但未限制*写*）。若未来出现漏初始化 bug，再评估 typed-base 或局部 `Object.freeze`。
- **后续待办（非本 ADR 实施进度）**：typed seeded base 轻量修复——消除 `mmd-adapter.ts:1141` 的 `as` 强转，改为类型校验的构造（预计 ~1–2 函数改动，10% churn）。

## 4. 数据溯源

- 构造点实测：`frontend/src/utils/3d/adapters/mmd-adapter.ts:1135-1165`（管线序）、`:1141`（`as` 强转）、`:184-269`（6 域接口）、`:278-348`（8 个 `Pick` stage Ctx）。
- tier1 落地：`2fbfe5ce`（域拆分 + `!` 清零 + 转义）。
- tier2 落地：`99d41318`（逐 stage `Pick` 收窄，字段 60→55）。
- 审计卡已同步：`docs/knowledge/frontend_repo_audit.md` `:29` / `:52`（tier1/2 落地、tier3 Builder 化待办、行号刷新）。

<!-- 文件名: mdmmbuildctx-tier3-builder.md → 实际文件 ADR-122-mdmmbuildctx-tier3-builder.md -->
