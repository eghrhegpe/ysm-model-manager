# ADR-270-d6：R10 收尾：截图多角度编排与菜单候选派生归属纠正（适配器域知识回迁 preview-3d/adapters）

- **状态**：✅ 已采纳（Adopted，2026-10-07；d5 决策 3 遗留的「menu 声明层 2 条 + screenshot 引擎 2 条」，用户以「按优先级来」授权按规划推进）
- **日期**：2026-10-07
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

ADR-270-d5 把 R10 的 14 条穿透边收敛到 4 条后，剩下两族仍未治：`skeleton-render.ts` → `screenshot/{screenshot-lights,screenshot-render}.ts`（**多角度截图编排住在视图层**），以及 `mmd-controls.ts` / `skeleton-fill-panel.ts` → `menu/panels/multi-model.ts`（**菜单候选派生与切换语义住在视图层**）；复勘发现两者同病——不是 import 写法问题，而是**适配器域知识住错了层**。

## 决策（四行）

1. **截图族（2 条边）——编排回迁**：`views/app-preview/skeleton-render.ts` 内「取 screenshot 灯光 → `buildYsmShotRenderArgs` 组装实参 → `renderMultiAngle` → 按视角 key 选帧」整段迁入 `preview-3d/adapters/`（与 d5 迁入的 `buildYsmShotRenderArgs` 同址，复用而非新建转发）。`skeleton-render.ts` 有 14 处 HTML 字面量、是模板文件，**留在 views**，只留触发与展示；**不新建任何以再导出为主体的面**（反桶契约 R1）。
2. **菜单族（2 条边）——域知识回迁**：`multiModelSelectNode` 本身是 70 行**零运行时依赖**的声明原语（文件头自述「任何 adapter 一行调用即得」），**它不是病根**；病根是两处调用点里的**候选派生与切换语义**——MMD 侧的 `zipModelCandidates` 虚拟路径 + basename 匹配 + `switchTo(虚拟路径)` 重建内容层，YSM 侧的组件下标 + `-1=All` 哨兵 + per-scene 会话态闭包 + `mgCount > 1` 守卫——**都是适配器域知识**。故按族迁入适配器面（MMD → `adapters/mmd/`，YSM → YSM 侧适配器面），views 只注入会话态并消费返回的 `PreviewMenuNode`。
3. **明确否决「把 `menu/panels/multi-model.ts` 加进 R10 白名单」**：R10 立法文本（`check-layering.ts` R10 段）**逐字**把 `menu/panels/**` 列为「内部细节穿透」；把该文件加白名单＝改立法去迁就现状，而白名单只治标（候选派生仍留在 views），且会为后续真实穿透开口子。**R10 白名单的语义是「入口面」，不是「常用文件的赦免名单」**——两者混淆会让 R10 退化成走形式。
4. **收尾口径**：本刀完成后 `check-layering.ts --update` 收紧 R10 基线 **4 → 0**（只减不增守卫兜底）；R9 的 ADR-249「默认值单一事实源」立法边**不动**；R10 射程与白名单**不做任何放宽**（本刀 0 处白名单改动）。

## 后果（一句）

收益 = R10 归零、`preview-3d` 的入口面重新成为 views 触达 3D 的唯一通道，且「候选从哪来、切档要做什么」这类适配器域知识回到适配器层（后续新增资源类型时，视图侧无需再学一遍候选语义）；代价 = 两族编排/派生逻辑跨目录搬迁 + 随迁测试，硬验收 = **行为等价**（既有测试除 import 路径外零改动即须全绿，另加 `npx vite build` + `npm run typecheck` + `check-layering --json` 的 `regressions=0` 且 R10 债务 0）；回退 = `git revert` 该提交并把基线还原 4 条（无数据迁移、无持久格式变更）。

<!-- 文件名: r10-screenshot-menu-adapter-domain-knowledge.md → 实际文件 decisions/ADR-270-d6-r10-screenshot-menu-adapter-domain-knowledge.md（ADR-320 decisions 轻量模板） -->
