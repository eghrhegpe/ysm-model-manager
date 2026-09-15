# ADR-241：3D dock 一级路由声明化（组定义 direct 判定收敛 core.ts 隐式分支）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/defs.ts (PreviewMenuGroupDef + PREVIEW_MENU_GROUPS); frontend/src/preview-3d/menu/core.ts (renderPreviewDock L420-530)`

---

## 1. 背景（Context）

dock 一级按钮的「点击后去哪」此前由 core.ts `renderPreviewDock` 的 `btn.onclick` 内**多层隐式分支**决定，同一直达概念四处散落、实现机制不同：

1. `model` → `directToPanel:"roles"`（数据表显式声明，最干净）。
2. `motion` → `if (g.id === "motion")` **硬编码特例**：有活跃角色 → 直达 motionDetailView（动作详情）；否则角色列表。
3. `env`/`settings` → 靠 `panels.length === 1 && groupItems.length === 1` **单 panel 自动推断**（隐式副作用，非声明）——组内恰 1 个 panel 才直达，否则组根视图。
4. `scene` → `g.id !== "scene"` **反向特判**走 renderMenu 组根视图（每 panel → row + headerToggle + navigate）。

问题（用户 2026-09 追问）：同一个「点击直达一个面板/视图」的意图，defs 表里 model 显式、env/settings 靠推断、motion 靠 id 特例、scene 靠反向特判——**四处机制不同，读 `PREVIEW_MENU_GROUPS` 看不出每个组点了去哪**，属需求表述失真（同 ADR-240 的 kind 形态脱钩精神）。

对齐 MikuMikuAR 参考：dock 一级按钮不应靠「capability + 面板数量 + id 特判」的隐式链，而应**每个组显式声明自己的路由域/行为**（MikuMikuAR 每个根按钮独立 `registerPopupMenu` + 显式 `showXxx` 入口）。

## 2. 决策（Decision）

**给 `PreviewMenuGroupDef` 增加路由策略字段，让每个 dock 组「点击后去哪」全部由 `PREVIEW_MENU_GROUPS` 数据表显式声明**，core.ts `btn.onclick` 收敛为纯查表，删除一切 `g.id === ...` 隐式分支与「单 panel 自动推断」副作用。

字段设计（全部可选，缺省 → 组根视图兜底）：
- `directToPanel?: string`（已有）——静态直达某面板节点 id。model → `roles`；env → `environment`；settings → `settings`（**补显式，删单 panel 推断**）。
- `directViewKey?: "motion"`（新增）——直达**动态**视图工厂的 key（motion 的活跃角色动作详情；`directToPanel` 表达不了「依赖 sceneRegistry 活跃角色」的动态目标）。key → 工厂映射留在 core.ts（因需注入 sceneRegistry/motionDetailView，不进纯数据 defs），触发从 `if(g.id==="motion")` 改为查 `directViewKey==="motion"`。
- `rootView?: boolean`（新增）——显式声明走 renderMenu 通用组根视图（每 panel → row + headerToggle + navigate）。scene 用它，取代 `g.id !== "scene"` 反向特判。

core.ts `btn.onclick` 收敛后无任何 `g.id === "..."` 字面量：全 5 组都有显式路由声明，新增组需声明能力一一对应。

`motion` 强调：`directViewKey` 映射表在 core.ts 仍是「一处名字」，但这与「用 id 特判」有本质区别——`directViewKey` 是**声明**（组定义说明它走哪个动态工厂），工厂注册在路由表；新增动态组只加一条声明 + 一条工厂映射，不改 onclick 结构。

## 3. 后果（Consequences）

- **正面**：`PREVIEW_MENU_GROUPS` 一张表可读「每个 dock 组点了去哪」；删除 `if(g.id==="motion")`、单 panel 推断、`g.id!=="scene"` 三处隐式分支；dock 路由零隐式。
- **正面**：对齐 MikuMikuAR「每 dock 按钮显式菜单域」范式；与 ADR-240 的 kind 形态脱钩同一收敛方向。
- **代价**：env/settings 补 directToPanel 后，若未来向 env/settings 组注入第 2 个 core panel，不再自动退化组根视图——显式直达优先（当前 env/settings adapter 不注入额外 panel，grep 实证，行为不变）。
- **已知遗留**：`directViewKey:"motion"` 的动态工厂映射表仍在 core.ts（需注入 sceneRegistry/详情工厂），是「多态路由表」而非 id 特判，属可接受的动态注入边界。adapter 注入 panel 的 `dockGroup` 字段仍未收敛成独立 `navDomain`（归属域语义），留待后续（可选 ADR）。

## 4. 数据溯源

- 症状（用户 2026-09 追问）：「同一直达概念三处实现」——model 显式 directToPanel、env/settings 单 panel 推断、motion id 特例。
- MikuMikuAR 参考：每 dock 根按钮显式 `registerPopupMenu`（`motion-popup.ts`/`env-menu.ts`/`scene-menu.ts`/`library-browse.ts`）+ nav 映射，无共享隐性推断层。
- 决策演化：用户对话拍板「先做 B：路由表」——最小、最高价值、不动 adapter。

<!-- 文件名: preview-dock-route-decl.md → 实际文件 ADR-241-preview-dock-route-decl.md -->
