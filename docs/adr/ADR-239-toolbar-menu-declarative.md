# ADR-239：工具栏下拉菜单声明式收敛（对齐 ADR-021 菜单范式）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`views/app-tree/toolbar-menus.ts, features/context-menu/menu-defs.ts, UI-Design.md §15`

---

## 1. 背景（Context）

`app-tree` 工具栏的「批量」与「更多」两个下拉菜单，其菜单项 HTML 长期**手写硬编码**在
`views/app-tree/tpl.ts` 的 `headerHTML()` 字符串里（`<button class="dd-item" data-batch="...">` /
`data-more="..."` 逐项手写）。这带来三个问题：

1. **加/删/排序/改图标一个菜单项，要手摸 `tpl.ts` 一处**；随项数膨胀编辑成本线性上升。
2. **testid 手工登记**在 `VIEW_TESTIDS`（ADR-133 阶段 B 的单一事实源），菜单项和 testid
   两处维护，漏登即契约测试红。
3. 项目已有成熟的声明式菜单范式（`features/context-menu/menu-defs.ts` 的 `MenuDef`、
   `preview-3d/menu/node-types.ts` 的 `PreviewMenuNode` + 单一渲染器），工具栏却未对齐，
   风格割裂。

## 2. 决策（Decision）

将「批量 + 更多」两个下拉的**菜单项声明**收敛为单个声明式模块
`views/app-tree/toolbar-menus.ts`：

- `BATCH_MENU_ITEMS` / `MORE_MENU_ITEMS`：按 `{ testid, action, icon, label, dividerBefore? }`
  声明菜单项，`action` 对应 `data-batch` / `data-more` 委托值（编译期约束为字符串联合语义）。
- `renderMenuItems(key)`：由数据生成 `<button class="dd-item">`（含 `data-*` 委托属性、
  `data-testid`、图标前缀、`dividerBefore` 分隔线）。
- `toolbarMenuTestids()`：派生当前两下拉全部 testid，供 `tpl.ts` 的 `VIEW_TESTIDS` 单一派生。

**明确不动的部分**（收敛边界，最小化风险）：

- `toolbar-events.ts` 的行为委托逻辑不变——仍靠 `[data-batch]` / `[data-more]` 委托绑定。
- 渲染产出**结构与原手写 HTML 逐字节等价**（保证对 tangent 测试与既有行为零影响）。
- 作者下拉（`dd-authors`）、搜索/筛选/排序/视图按钮不在本次范围。

## 3. 后果（Consequences）

**正面**：
- 增删/改图标/调分隔线一个菜单项，只需改 `toolbar-menus.ts` 一处数据声明。
- `VIEW_TESTIDS` 从声明派生，testid 无漏登记风险。
- 与 `context-menu/menu-defs.ts` 声明式范式对齐，语义统一。

**负面 / 权衡**：
- 新增一个模块（7 项菜单、~110 行声明 + 测试）。对本规模（7 项）有轻微"为小改造框架"
  倾向；**依据**：项目已有相同范式，这不是新发明，是对既有约定对齐；且「加一处菜单项可只改
  数据」的收益随菜单增长单调递增。

**已知遗留**：
- `dd-authors` 暂未收敛（作者列表是运行时动态填充，非静态菜单，语义不同，暂不强行统一）。
- 工具栏其余按钮（筛选/全选/排序/视图）仍为静态 `<button>`，非下拉菜单，不需声明式化。
- `divider` 目前只有「更多」一个用例（`open-folder` 前）；`dividerBefore` 字段已是可扩展形态。

## 4. 数据溯源

- 原手写 HTML：`views/app-tree/tpl.ts` `headerHTML()`（提交前的批量/更多下拉字符串）。
- 行为委托：`views/app-tree/toolbar-events.ts` `atTlBindBatchMenu` / `atTlBindMoreMenu`。
- testid 契约：`views/app-tree/tpl.ts` `VIEW_TESTIDS`（ADR-133 阶段 B）。
- 范式蓝本：`features/context-menu/menu-defs.ts`（ADR-021）、`preview-3d/menu/node-types.ts`。

<!-- 文件名: toolbar-menu-declarative.md → 实际文件 ADR-239-toolbar-menu-declarative.md -->