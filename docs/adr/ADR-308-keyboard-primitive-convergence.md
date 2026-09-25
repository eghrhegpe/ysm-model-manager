# ADR-308：键盘原语收敛与全局快捷键注册表

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/dom/key-router.ts; frontend/src/views/app-content/tabs-a11y.ts; frontend/src/views/app-content/tabs-shell.ts; frontend/src/views/app-sync-manager/events.ts; frontend/src/preview-3d/menu/shell/slide-menu.ts; frontend/src/views/app-nav/index.ts; frontend/src/views/app-sidebar/; frontend/src/utils/dom/dropdown.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-09 前端 a11y 普查（574 生产 .ts 实证）确认 a11y 按纪律高度集中（「a11y 属性只经模板产出 + 键盘语义单点委托」，sync-manager 卡明文立法），文件覆盖率低（aria-* 12 文件）≠ 普及率低。但键盘交互面存在三个结构性缺口：

1. **同构重复**：「方向键循环 + Home/End + 激活 + roving tabindex」手写 6 处——`tabs-a11y.ts|bindTabA11y`（唯一声明式 spec 原语）、`tabs-shell.ts|bindSubBar`、`app-sync-manager/events.ts`（状态 radio 委托）、`slide-menu.ts|smBindKeyboardNav`、`app-nav/index.ts|anBindNavItems`、`dropdown.ts|onWrapKeydown`。语义两变体（radio 移动即激活 / tab 移动即激活 vs 列表只移焦）三处各写一遍，无公共原语。
2. **全局快捷键散点**：document 级 keydown 10 处 / 8 文件（devtools F12、树面板 Ctrl+F/Delete/方向键、3D Esc×2、独立 F 调试切换、WASD 键状态、zoom/creator 浮层 Esc、键位一次性捕获、Tab 陷阱），互斥靠临时约定（`isPreviewOverlayActive()` 让路 ADR-175 M1、输入阻断栈、`isEditableTarget()` 守卫）维持——**无仲裁注册表、无碰撞检测**，`aria-keyshortcuts` 自动声明仅 3D 键位页一处。
3. **零键盘顶层视图**：`app-sidebar/` 9 个生产文件 0 个键盘监听（对照 app-nav 全套 ↑↓/Enter/Home/End/End 可达）。

既判例：ADR-298 D3（下拉 a11y 统一 = 实例级键盘原语落地）、ADR-300 §3（诊断页 pill 键盘化，toolbar+radiogroup 姿势）均为「单点收敛」先例；ADR-027 明文「列表/树的集中式键盘导航（roving tabindex）尚未建立，是新建能力而非修复」。本 ADR 把实例级收敛升级为**原语级收敛 + 全局仲裁注册表**。

## 2. 决策（Decision）

- **D1｜全局组合键注册表 = combo 键语义唯一出口（✅ 已落地 2026-09-25）**：`utils/dom/key-router.ts` 注册表——`registerShortcut({id, combo, when?, handler})` 单点 document keydown 分发 + 组合匹配纯函数（修饰键掩码 + 主键，大小写不敏感）+ 注册期同组合碰撞响亮告警 + 末个 shortcut 摘除监听（根治 HMR/vi.resetModules 叠加注册）；`listShortcuts()` / `formatAriaKeyShortcuts()` 供快捷键帮助页与 aria-keyshortcuts 自动声明消费。已收编 app-tree（`tree:find` / `tree:delete` / `tree:nav-down` / `tree:nav-up`，3D 让路 = `when: () => !isPreviewOverlayActive()` 门禁）与 app-modules（`devtools` F12 / Ctrl+Shift+I）。
  - **边界**：注册表只管 **combo 组合键**（一次按键事件完成语义）。键状态类输入（WASD 长按 / 双轨键——`preview-3d/infra/input-and-animation.ts` 的 keydown+keyup 表驱动）与一次性捕获（设置页键位改绑 capture）语义不同，**不进注册表**；3D 键位表驱动（ADR-036）与冲突检测维持原样。
- **D2｜列表/单选键盘原语泛化（待拍板）**：6 处同构收敛为 `utils/dom/bind-roving.ts`（`bindRoving(root, spec)`；spec = 选择器 + 激活语义预设（`radio`/`tab`/`list`）+ 循环性 + onActivate 副作用），泛化 `bindTabA11y` 的声明式形态；ADR-300 §3 的 toolbar+radiogroup 兼容姿势（无 role 的旧 bar 跳过键盘增强）沿用。接入顺序：app-sidebar（零键盘顶层视图，先补可达性）→ 3D slide-menu / cap-controls 行控件（**3D 域红线**：MenuNode schema 结构不动，键盘仅是行为层增强，新增 UI 功能须仍可被 MenuNode schema 菜单调用）。
- **D3｜a11y 静态门禁替代运行时自动推导（待拍板）**：`scripts/check-a11y.ts` + `docs/.a11y-baseline.json`（只减不增，同 `.layering-baseline.json` 范式）防退化；**不做** ARIA 启发式扫描自动挂 role/aria + 键盘 handler（与「模板唯一出口」纪律冲突、误报风险高）——「自动化生成按键操作」的正确形态 = D1/D2 的 spec 驱动生成（写 spec → 按键行为自动挂全），不是运行时推导。

## 3. 后果（Consequences）

- **正面**：新增组合键零成本（写一条 spec）且碰撞从「约定」变「检测」（注册期 + 运行期双告警）；快捷键帮助页 / aria-keyshortcuts 获得单一数据源；同构 6 处收敛为 1 原语，sidebar 键盘可达；全仓「键盘语义唯一出口」立法从组件级（sync-manager 单点委托）升级到应用级。
- **负面 / 已知遗留**：裸键匹配收紧为「无修饰键」（app-tree 原漏查 shift——Shift+方向键导航退役，按 ARIA 列表导航规范属有意收紧）；注册表按注册顺序触发 + 碰撞即双发（互斥须收进 `when` 门禁，契约测试锁定）；D2/D3 在 ADR 拍板前不动 3D 域代码，散点 10 处中 3D 侧 5 处（Esc×2 / F 调试 / WASD）维持现状。

## 4. 数据溯源

- 2026-09-25 前端 a11y 普查（生产 574 .ts：aria-* 12 文件 / keydown 监听 26 文件 / tabindex 27 文件 / role 26 文件 / `aria-keyshortcuts` 1 文件 / document 级 keydown 散点 10 处 8 文件 / 同构键盘实现 6 处 / `app-sidebar/` 0 键盘）→ D1–D3 立项
- 实例收敛先例：ADR-298 D3（dropdown）/ ADR-300 §3（pill 键盘化，已落地）/ ADR-036（3D 键位表驱动）/ ADR-175 M1（overlay-active 让路契约）
- D1 实施溯源：`frontend/src/utils/dom/key-router.ts`（+ 契约测试 14 条）收编 `views/app-tree/index.ts` 键盘段与 `app-modules.ts` devtools 段（2026-09-25）

<!-- 文件名: keyboard-primitive-convergence.md → 实际文件 ADR-308-keyboard-primitive-convergence.md -->
