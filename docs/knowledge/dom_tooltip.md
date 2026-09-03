---
kind: dom_tooltip
name: 悬浮提示 tooltip
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/tooltip.ts
auto_fields:
  symbols_with_lines:
    - attachTooltip
    - ensureTooltipStyles
    - promoteTitle
    - promoteTitleIfPresent
    - TooltipOptions
    - YSW_TOOLTIP_CSS
  tests:
    - frontend/src/utils/dom/tooltip.test.ts
tests:
  - frontend/src/utils/dom/tooltip.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - tooltip、悬浮提示、hover 提示
  - title 气泡、3D 按钮
quick_risk_lines:
  - 悬浮提示必须走 dom/tooltip.ts 的毛玻璃 tooltip，禁止用原生 title
pitfalls:
  - 用原生 title → 延迟 ~1s、样式不可控；必须经 tooltip.ts
  - tooltip 不监听跨 Shadow DOM → FAB 按钮无法接 tooltip；必须经 document.body 挂载

use_when:
  - tooltip
  - 悬浮提示
  - hover 提示
  - title 气泡
  - 3D 按钮
status: active
---

# 悬浮提示 tooltip

## 概览

3D 预览控制层的自定义悬浮提示组件（单例 light DOM），替代原生 `title` 的迟缓黄气泡（~1s 延迟、样式不可控）。毛玻璃风格对齐 3D HUD（`fab.ts` `.ysm-3d-popup` 同族）；tooltip 节点挂 `document.body`，`position:fixed` + `getBoundingClientRect` 定位——监听器直接挂目标元素，**跨 Shadow DOM 边界可用**（预览面板内 FAB 也能接）。

## 核心职责

- **样式幂等注入**: `ensureTooltipStyles()` — id=`ysw-tooltip-styles` 注入 head 一次（模式同 `ensureFabStyles`）
- **悬停显示/离开隐藏**: 默认 350ms 延迟防扫过频闪；文案惰性 getter 在显示时刻求值（适配 i18n 运行时切换）
- **定位**: 目标上方水平居中、夹在视口内；上方放不下翻到下方；页面滚动捕获阶段统一隐藏（原生 title 同行为）
- **兜底**: MutationObserver 监听 body subtree——目标元素被移除 DOM（菜单整体重建，mouseleave 不触发）时自动隐藏

## 对外 API / 入口

- `attachTooltip(el, getText: string | (() => string), opts?: { delayMs? }): () => void` — 返回 cleanup（摘除全部监听并隐藏）
- `promoteTitle(el)` — 元素原生 `title` 升级为自定义 tooltip：摘除 title 防双气泡、aria-label 缺失时补齐可达性
- `promoteTitleIfPresent(el | null)` — promoteTitle 的空值守卫版（querySelector 绑定点一行接入）

## 与其他子系统关系

- `fab.ts` `createIconButton`：`opts.title` 走本组件（不设原生 title），aria-label 承担可达性——topBar 全部图标按钮（✕ 关闭 / ◀▶ 面板切换 / 📷 截图 / ⟲ 重置等）自动获得 tooltip
- `preview-menu/core.ts`：➕追加到场景 / ●设为焦点 / ⚙模型工具 / 角色路径 4 处由 `.title=` 改 `attachTooltip`
- `app-preview` 面板 FAB（Shadow DOM 内）：`detail.ts` / `detail-3d.ts` / `skeleton.ts` / `maid-3d.ts` 共 9 处绑定点 `promoteTitleIfPresent`
- 底部 dock 导航按钮（`preview-dock-navbtn`）**不接**——常显文字标签，tooltip 冗余

## 不变量

- 单例：同一时刻至多一个 tooltip 可见（模块级 `st` 状态）
- z-index = `calc(var(--z-fullscreen, 9999) + 1)`，恒在 3D overlay 之上
- `pointer-events:none`，tooltip 本体永不挡交互
- 文案空字符串不显示；延迟触发前元素脱离 DOM 则放弃显示

## 相关

- [dom-fab](./dom-fab.md) — createIconButton 工厂（title 行为本组件承接）
- [app_preview](./app-preview.md) — 预览面板 FAB 所在组件
