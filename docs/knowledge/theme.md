---
kind: theme
name: 主题系统 theme
tier: leaf
category: core
source_files:
  - frontend/src/app-modules.ts
  - frontend/css/variables.css
use_when:
  - 主题
  - 换肤
  - 深色
  - 浅色
  - 跟随系统
  - 动画开关
  - 字号
  - 界面偏好
---

# 主题系统 theme

## 概览

主题系统的实现在组件入口 `app-modules.ts`（无独立 theme.ts 文件）：提供 6 套主题皮肤（cyber/warm/pro/sakura/ocean/mint）+ `system` 跟随系统模式，全部通过在 `<body>` 上切换 `theme-*` class 实现，具体颜色/字号/间距全由 `frontend/css/variables.css` 的 CSS 变量承载——组件层无任何硬编码颜色。启动时从 Go 配置或 localStorage 恢复主题，并应用字号/字体/密度/动画等 UI 偏好。

## 核心职责

- `applyTheme(mode)`：校验合法性（非法值回落 `system`），先移除全部 6 个 `theme-*` 类再按模式添加；`system` 模式按 `matchMedia("(prefers-color-scheme: dark)")` 选 `theme-cyber`（暗）或 `theme-warm`（亮）；挂载为 `window.applyTheme` 供设置页调用
- `initTheme()`：动态 import `LoadAppConfig` 读取 Go 配置，取 `localStorage.getItem("theme") || cfg.theme || THEME_DARK`（THEME_DARK = "cyber"）并回写 localStorage；`LoadAppConfig` 失败时 catch 回退 localStorage 或默认暗色，不阻塞启动
- 系统主题监听：`matchMedia` change 事件仅在 localStorage 主题为 `system` 时重应用，并 toast 提示「已跟随系统切换至深/浅色主题」
- `applyUIPrefs()`：应用 UI 偏好——`ui-font-size`（经 `--fs-scale` 缩放，先清除旧版内联 `--fs-*`）、`ui-display-font`（`--font-display` 楷体/系统）、`ui-card-density`（`--card-padding`/`--card-gap`）、`ui-animations`（off 时给 `<html>` 加 `no-animations` 类全局关动画）
- 设置页入口（components/app-content/community/settings.ts）：主题卡片点选 → `window.applyTheme(themeName)` + 写 localStorage；`theme-auto` 下拉支持 off/系统跟随/按时间（白天 warm、夜晚 cyber）三种自动模式
- `variables.css`：定义 `.theme-cyber`/`.theme-warm`/`.theme-pro`/`.theme-sakura`/`.theme-ocean`/`.theme-mint` 六组变量与 `.no-animations` 覆盖规则

## 对外 API / 入口

- 全局函数：`window.applyTheme(mode: string)`
- 入口函数（app-modules.ts 内部）：`initTheme()`、`applyUIPrefs()`，启动 IIFE 中依次执行
- Wails binding（动态 import）：`LoadAppConfig`（仅取 `cfg.theme`）
- localStorage 键：`theme`、`theme-auto`、`ui-font-size`、`ui-display-font`、`ui-card-density`、`ui-animations`
- 派发 bus：`toast:show`（跟随系统切换提示）

## 与其他子系统关系

- 启动编排在 [app_modules](./app_modules.md)（initTheme → applyUIPrefs → checkUpdateSilent）
- 主题选择 UI 在 app-content 设置页（settings.ts），经 `window.applyTheme` 与 localStorage 与入口同步
- 所有组件样式消费 CSS 变量（见 [shared_styles](./shared_styles.md) 与各组件 css），Shadow DOM 内用 `:host-context(.theme-*)` 做主题特判
- 动画开关 `no-animations` 被各组件 CSS（如 app-tree-styles）以 `animation: none !important` 响应

## 不变量

- 主题切换只允许经 body 的 `theme-*` class，全部视觉值走 CSS 变量，禁止组件内硬编码主题颜色（治理红线 §3.3）
- 合法模式仅 6 套皮肤 + `system`，非法值一律回落 `system`，不产生无主题状态
- `LoadAppConfig` 失败必须回退 localStorage/默认值，主题初始化失败不得阻塞启动序列
- 系统偏好监听只在 `system` 模式下生效，手动选定主题不被系统变化覆盖
- UI 偏好修改只操作 CSS 变量与类名（`--fs-scale`/`no-animations`），不直接改各 `--fs-*` 计算值

## 相关

- [app_modules](./app_modules.md) — 启动序列与主题挂载
- [shared_styles](./shared_styles.md) — 消费 CSS 变量的共享样式
- [wails_bindings](./wails_bindings.md) — LoadAppConfig 后端
