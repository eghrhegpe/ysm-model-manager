---
kind: shared-styles
name: 共享样式 shared-styles
tier: leaf
category: ui
source_files:
  - frontend/src/utils/dom/css.ts
  - frontend/src/views/app-tree/app-tree-styles.ts
use_when:
  - 共享样式
  - 按钮样式
  - btn-base
  - focus-visible
  - tree 样式
  - Shadow DOM 样式
  - CSS 变量
---

# 共享样式 shared-styles

## 概览

两个样式模块为 Shadow DOM 组件提供可复用的 CSS 字符串：`utils/dom/css.ts` 导出全应用统一的按钮体系 `.btn-base` 与通用 focus-visible 规则；`views/app-tree/app-tree-styles.ts` 导出 app-tree 组件的完整样式 `treeCSS`（内联插入 `${btnBaseCSS}` 复用按钮体系）。样式独立成文件可避免 JS 热更新时重编译 CSS，所有颜色/间距/字号均消费 CSS 变量，随主题切换自动适配。

## 核心职责

- `btnBaseCSS`：`.btn-base` 基础按钮（hover/active/focus-visible/disabled 全状态）+ 尺寸变体（`.sm`/`.lg`）+ 语义变体（`.primary`/`.danger`/`.accent`/`.warn`），padding/圆角/过渡全走 `var(--btn-*)` 变量
- `focusVisibleCSS`：Shadow DOM 内通用 `:focus-visible` 焦点环（`color-mix` 取 `var(--accent)` 30% 透明）
- `treeCSS`：app-tree 完整样式——头部工具栏（`.hdr`/搜索框/排序）、高级筛选面板（`.adv-filter`/`.af-inp`）、虚拟滚动容器（`.vs-wrap`）、作者分组行（`.fh`）与文件行（`.fl`）及紧凑列表模式（`.fh-list`/`.fl-list`）、启用开关（`.ck` 含 partial 半态）、选中/悬停/锁定/`.ban` 态、元数据彩色标签（`.tag-author`/`.tag-work`/`.tag-date`，走 `var(--meta-*)`）、悬停快捷操作（`.hover-actions`）、下拉菜单（`.dd-menu`/`.batch-menu`）、空态（`.empty`）
- `no-animations` 响应：`treeCSS` 末尾对 `.fl`/`.fh` 强制 `animation: none !important`

## 对外 API / 入口

- 导出：`btnBaseCSS: string`、`focusVisibleCSS: string`（frontend/src/utils/dom/css.ts）；`treeCSS: string`（frontend/src/views/app-tree/app-tree-styles.ts）
- 消费方式：组件在 Shadow DOM 内经 `adoptedStyleSheets` 或 `<style>` 注入（如 app-tree 注入 `treeCSS`）
- 无 bus 事件、无 Go 调用

## 与其他子系统关系

- `treeCSS` 被 [app_tree](./app-tree.md) 组件注入使用；`btnBaseCSS` 被各 Shadow DOM 组件（tree/sidebar/sync-manager 等）拼接复用
- 所有变量值来自主题系统（frontend/css/variables.css，见知识卡 [theme](./theme.md)），Shadow DOM 跨主题特判用 `:host-context(.theme-*)`
- 按钮交互一致性（UX 维度「交互一致性」）依赖全应用按钮统一走 `.btn-base`

## 不变量

- 所有颜色/尺寸必须走 CSS 变量（`var(--txt)`/`var(--bd)`/`var(--btn-*)` 等），禁止引入硬编码主题色（治理红线 §3.3；`#a6e3a1` 等少量状态色为历史存量）
- 新增按钮样式必须扩展 `.btn-base` 变体，禁止另起一套按钮类（Design.md 唯一设计规范）；`components.css` 存在 `.btn-base` 平行副本（light DOM 用，primary:hover 混色与 css.ts 分叉，P3 观察待统一）
- `treeCSS` 内联 `${btnBaseCSS}` **与 `${focusVisibleCSS}`**（P2 修复：原仅内联按钮体系，`.srch-inp`/`.sort-sel` 显式 `outline:none` 导致键盘聚焦无可见焦点环，a11y 缺口）；保持按钮体系单一来源，不得复制改写
- 动画必须可被 `no-animations` 类关闭——**Shadow DOM 内必须用 `:host-context(.no-animations)`**（P2 修复：该类挂在 documentElement 上，后代选择器不能跨界上溯 shadow 边界，原 `.no-animations .fl` 永不命中）

## 相关

- [theme](./theme.md) — CSS 变量来源与主题切换
- [app_tree](./app-tree.md) — treeCSS 消费方
- `docs/Design.md` — 唯一设计规范（按钮/动画口径）
