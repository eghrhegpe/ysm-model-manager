# ADR-240：3D 菜单内容型 panel 统一折叠卡渲染（kind 形态脱钩）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/render/render.ts (rmAppendFolder/hasFoldedBody); frontend/src/preview-3d/menu/node-render.test.ts; frontend/src/preview-3d/menu/roles.test.ts; menu-node-types.ts PreviewMenuNode.kind`

---

## 1. 背景（Context）

3D 菜单渲染核心 `renderMenu`（preview-menu/render.ts）此前用「形状前置分派」决定节点形态：
`if (node.kind === "folder" || Array.isArray(node.children))` → 折叠卡（`cap-folder`）；
否则走 `switch(node.kind)`。

问题：**渲染形态由隐式 `children` 存在性决定，而非由 `kind` 显式声明**。结果：

- `kind:"panel"` 且带 `children` → 被形状前置转成可折叠 `cap-folder`。
- `kind:"panel"` 且只带 `renderCustom`（如骨骼面板 bones、motion 详情里的工具 panel）→ 落到
  `case "panel"` → `rmAppendLeaf` → 渲染成 `cm-row` 单行导航。

于是**同一个 `kind:"panel"` 语义，只因带不带 `children`，就渲染成两种完全不同的视觉范式**
（单行 `cm-row` vs 折叠卡 `cap-folder`）。在 motion 详情（`motionDetailView`）里，带 children 的
播放/感知是折叠卡、带 renderCustom 的 bones 是单行——新旧样式在同一面板内混排，视觉割裂，且
「kind 声明什么形态」不可靠，是需求表述失真之源。

## 2. 决策（Decision）

**内容型 `panel`（带 children **或** renderCustom）统一渲染为可折叠卡**；只有**无内容**的
`panel` 才渲染为可导航单行（如 roles/environment/camera 等纯导航跳转的面板）。

实现（render.ts）：
- 新增 `hasFoldedBody(node)` 谓词：`kind==="panel"` 且无 `children` 且有 `renderCustom` → 折叠。
- 形状前置判定从 `folder || Array.isArray(children)` 扩展为 `folder || Array.isArray(children) ||
  hasFoldedBody(node)`——**带 renderCustom 的 panel 也进折叠卡**。
- `rmAppendFolder` 支持 `isCustomBody`（panel+renderCustom，无 children）：卡 body 内
  `runCustomMount` 渲染 renderCustom（逃生舱 cleanup 走 render.ts 注册表生命周期），跳过
  children-based visibleWhen 预筛与空筛 return，卡壳恒渲染。

视觉目标：**内容型面板内容一律内联进 `cap-folder` 卡壳**，与带 children 的 panel 折叠卡视觉
完全一致，消除单行 `cm-row` 与折叠卡 `cap-folder` 的混排分裂。

`kind:"custom"` 节点不受影响（保持单行过渡行为，node-render.test.ts 既有用例锁定），
schema 面板路径（`renderAdapterPanelContent`，renderCustomDirect）不经形状前置，不受影响。

## 3. 后果（Consequences）

- **正面**：内容型 panel（children 或 renderCustom）视觉统一为折叠卡，motion 详情的
  bones/播放/感知不再新旧混排；`kind` 重新成为渲染形态的可依赖信号。
- **正面**：走出「靠隐式 children 判定形态」的隐式化，后续新增内容型面板零歧义。
- **代价**：此前「renderCustom panel 在 renderMenu 平铺场景渲染成单行导航」的行为改变——带
  renderCustom 的 panel 现在折叠内联展示内容，而非点击进单行面板。受影响的既有测试（
  roles.test 锁定的 renderCustom panel 单行态）已同步更新为新折叠契约。
- **已知遗留**：dock 一级按钮的点击行为隐式化（`if (g.id === ...)` 硬编码于 core.ts
  `renderPreviewDock`）为独立问题（C），本 ADR 不覆盖，暂缓，见规划。

## 4. 数据溯源

- 症状 DOM（用户实测）：`[AnluoSakura]双月希瞳` 角色详情面板内 `preview-bones` 为 `cm-row`、
  `ysm-play`/`perception` 为 `cap-folder` → 同一面板新旧样式混排。
- 根因定位：render.ts 形状前置 L680-692 把「带 children 的 panel」转折叠卡、「只带 renderCustom
  的 panel」落单行；`motionDetailView` 用 `renderMenu` 平铺 panel 项暴露该分裂。
- 决策演化：用户选「改法 2：全内联折叠卡」+「根治 renderMenu 核心」。

<!-- 文件名: preview-menu-panel-fold.md → 实际文件 ADR-240-preview-menu-panel-fold.md -->