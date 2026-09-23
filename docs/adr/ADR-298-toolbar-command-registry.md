# ADR-298：工具栏命令注册表与下拉无障碍统一

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`views/app-tree/toolbar-menus.ts`、`views/app-tree/toolbar-events.ts`、`views/app-tree/toolbar-commands.ts`（新）、`utils/dom/dropdown.ts`、`features/context-menu/menu-defs.ts`、ADR-239（被本 ADR 修订 §2 收敛边界）、ADR-238、ADR-248

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`app-tree` 工具栏的菜单行为长期是「声明表只管长相、行为散在别处」：

1. **`action` 是裸字符串**。`toolbar-menus.ts` 的 `ToolbarMenuItem.action: string` 与
   `toolbar-events.ts` 的 `if (action === "genindex")` 分派之间**没有任何类型约束**——
   改一处字符串，另一处静默断链，`tsc` 不报错。testid 有 `VIEW_TESTIDS` 契约兜底，
   `action` 反而没有。
2. **同一块工具栏四种交互范式**：batch 逐个 `addEventListener` + bus 转发；more 用容器委托 +
   约 80 行内联 async if-else；authors 曾 hover 填充 + 借道搜索框；adv-filter 曾走僵尸内联面板。
3. **bus 中转绕路**：`batch:enable-all` / `batch:disable-all` 全仓**唯一生产者**是
   `toolbar-events.ts` 自身，**唯一消费者**是同视图的 `bus-handlers.ts`——同组件自产自销，
   而 bus 的立法理由是「跨 Shadow 边界传数据」，此处不成立。
4. **下拉零无障碍**：`.dd-wrap` 纯 hover 展开，无 `aria-haspopup` / `aria-expanded`、
   无键盘路径、无外点关闭，触屏（Android / viewer 生产形态）下 hover 语义不成立。

对照标杆是 `features/context-menu/menu-defs.ts`（`MENU_DEFS ⊂ MENU_ACTIONS ⊂ HANDLERS`
编译期钉死）与 `preview-3d` 的 `PreviewMenuNode`（行为直接挂节点）。工具栏学了声明式的皮，
没学到「行为也进表」的骨。

## 2. 决策（Decision）

**D1｜工具栏命令注册表：表现表 ⊥ 行为表，两层经 `action` 联合类型编译期钉死。**
新增 `views/app-tree/toolbar-commands.ts` 承载行为（`run(ctx, el)`），
`toolbar-menus.ts` 继续只承载表现（`labelKey`/`icon`/`testid`/`dividerBefore`）；
`ToolbarMenuItem.action` 收窄为 `keyof typeof TOOLBAR_COMMANDS`，分派器退化为表查找
（`cmds[action]?.run(ctx, el)`），消灭 if-else 链与裸字符串。落点为 view 本地模块，
**不入 `core`/`utils/dom`**（core 准入三条：引擎无关 + 不依赖上层 + 无 Wails 可单测——
命令表 import `AppTree` 与 backend seam，三条皆不满足）。

**D2｜bus 存废判据：同组件内唯一生产者的事件不上总线。**
`batch:enable-all` / `batch:disable-all` 改为命令直调 `bus-handlers.ts` 导出的执行函数，
并从 `bus.ts` 事件表与 `VOID_EVENTS` 同步退役（`satisfies` 编译期逼同步）。
跨组件事件（`dir:rename` / `tree:reload` / `tree:set-search` 等有视图外生产者）**保持 bus 不变**——
判据是「有没有视图外生产者」，不是「批量从此不用 bus」。

**D3｜下拉无障碍统一：click-only 展开 + ARIA 契约 + 控制器归 `utils/dom`。**
`utils/dom/dropdown.ts` 提供 `initDropdown(wrap, opts?)`：click 展开⇄收起、
`aria-haspopup`/`aria-expanded`/`role=menu`/`role=menuitem`、↑↓/Home/End/Esc 键盘导航、
外点关闭（`composedPath` 判定，兼容 Shadow retarget）、同页多下拉互斥、`onOpen` 惰性填充钩子。
键盘契约**复用** `views/context-menu` 的既有范式（其 ↑↓ 循环 / Esc 回焦为本仓活体先例），
但**不合并实现**：context-menu 挂 document 级（需 `shadowRoot.activeElement` 深焦下钻），
控制器挂 `.dd-wrap` 上——同 shadow 树内冒泡自足，无需 document 监听技巧。
hover 展开串（`dropdownHoverCSS`）**整体退役**：触屏是生产形态，键盘此前完全打不开菜单，
双模（hover + click）违 WCAG 1.4.13 且成本大于收益。下拉指示符 `▾` 由 CSS 单源生成
（`.dd-wrap > button::after`），**不进 i18n 值**。

**D4｜与 MenuNode 的关系：形异神同，不抽公共契约。**
工具栏非 3D 域，不受「3d菜单只允许 MenuNode schema」约束；`action` 的 ctx 域两者不同构
（`PreviewActionMenuCtx` 快照 vs `AppTree`），泛型化公共层须让公共模块 import 两侧视图类型，
违 core 准入与 ADR-195 精神。两边共享「声明表 + 编译期 action 联合 + 语义图标」范式即止。
「新增 UI 功能须可被 MenuNode 菜单调用」由 bus 通道满足（`tree:reload` 等已有 10+ 外部生产者先例）；
**命令双挂载现在不做**（ctx 不同构、无消费者实证，记债克制）。

**D5｜ADR-239 收敛边界修订。** ADR-239 §2「明确不动的部分」写「`toolbar-events.ts` 的行为委托
逻辑不变」——D1 正是要动它，故该边界由本 ADR 收敛：行为不再由 `data-*` 字符串委托散落分派，
改由命令表统一挂载；`data-*` 委托属性保留（fixture / testid 契约零扰动）。

## 3. 后果（Consequences）

**正面**：

- 新增 / 改名 / 删除一个菜单命令，只改命令表一处，漏挂即 `tsc` 报错（消灭静默断链）。
- 下拉键盘可达、读屏可辨、触屏可开；同页多下拉互斥由控制器统一，消除各处手写 hack。
- batch 链路从「4 跳」（声明 → 事件 → bus → handler）收敛为「1 跳」（声明 → 命令）。
- `dropdownHoverCSS` 与 locale 内嵌箭头退场，箭头样式可统一随主题缩放。

**负面 / 权衡**：

- 新增一个模块（命令表）与一个 DOM 原语（dropdown 控制器），小体量菜单有「为小改造框架」
  倾向——依据是本仓已有同范式前例（context-menu / PreviewMenuNode），非新发明。
- 删 bus 事件是对外契约的收窄：将来若有视图外模块想触发批量启停，需补一条事件。
  判据（D2）已写明，非无原则删除。
- click-only 对鼠标用户多一次点击；换取键盘 / 触屏 / 读屏可达与范式统一。

**已知遗留（记债，不在本 ADR 范围）**：

- 命令双挂载（3D MenuNode 直接触发工具栏命令）待有真实消费者再立。
- `modalPrompt` / `modalSelect` 的 `okIcon` 通道本次已补齐；`ctx.*Progress` 等**进度文案语气符**
  （📦 等）刻意保留，不属图标位。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 三子代理审查（adv-filter / 图标 / 命令表各一案） | A / B / C 三案提案与实测行号 |
| `git log --oneline -- views/app-tree/toolbar-menus.ts` | 声明表演化：`4c331cef9` 起手写 → `55072a8f2` `verticalDots` 接线 |
| 主线程实测：`bus.ts` 事件生产者/消费者扫描 | `batch:enable-all` 唯一生产者 = 消费者所在视图（D2 判据来源） |
| `menu-defs.ts:41-47`、`context-menu/index.ts:28-67` | 三层链与键盘范式活体先例（D1/D3 复用依据） |
| `frontend/AGENTS.md` bus 立法说明 | 「跨 Shadow 边界传数据」——同组件自产自销不成立（D2 反证） |
