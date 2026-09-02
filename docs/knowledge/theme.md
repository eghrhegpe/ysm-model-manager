---
kind: theme
name: 主题系统 theme
tier: leaf
adr:
  - ADR-146
category: core
source_files:
  - frontend/src/app-modules.ts
  - frontend/src/theme-core.ts
  - frontend/css/variables.css
auto_fields:
  symbols_with_lines:
    - applyTheme:21
    - initTheme:34
    - normalizeTheme:17
    - unregisterDevtools:153
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - 主题、换肤、深色 / 浅色 / 跟随系统
    - 动画开关、字号、界面偏好
    - normalizeTheme、variables.css
  quick_risk_lines:
    - 主题值必须经 normalizeTheme 白名单过滤，白名单外回落 system，防脏值污染持久层
  pitfalls:
    - 脏主题值直写 → 无效 CSS 变量、页面错乱；必须经 normalizeTheme 过滤
    - 跟随系统主题未监听 prefers-color-scheme → 系统切换主题后页面未同步；必须挂 change 监听
  use_when:
    - 主题
    - 换肤
    - 深色
    - 浅色
    - 跟随系统
    - 动画开关
    - 字号
    - 界面偏好
  invariant_anchors:
    - frontend/src/app-modules.ts|normalizeTheme
    - frontend/src/utils/dom/storage.ts|safeGet
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 主题、换肤、深色 / 浅色 / 跟随系统
  - 动画开关、字号、界面偏好
  - normalizeTheme、variables.css
quick_risk_lines:
  - 主题值必须经 normalizeTheme 白名单过滤，白名单外回落 system，防脏值污染持久层
pitfalls:
  - 脏主题值直写 → 无效 CSS 变量、页面错乱；必须经 normalizeTheme 过滤
  - 跟随系统主题未监听 prefers-color-scheme → 系统切换主题后页面未同步；必须挂 change 监听

use_when:
  - 主题
  - 换肤
  - 深色
  - 浅色
  - 跟随系统
  - 动画开关
  - 字号
  - 界面偏好
invariant_anchors:
  - frontend/src/app-modules.ts|normalizeTheme
  - frontend/src/utils/dom/storage.ts|safeGet
status: active
---

# 主题系统 theme

## 概览

主题系统的实现在组件入口 `app-modules.ts`（无独立 theme.ts 文件）：提供 6 套主题皮肤（cyber/warm/pro/sakura/ocean/mint）+ `system` 跟随系统模式，全部通过在 `<body>` 上切换 `theme-*` class 实现，具体颜色/字号/间距全由 `frontend/css/variables.css` 的 CSS 变量承载——组件层无任何硬编码颜色。启动时从 Go 配置或 localStorage 恢复主题，并应用字号/字体/密度/动画等 UI 偏好。

## 核心职责

- `applyTheme(mode)`：校验合法性（非法值回落 `system`），先移除全部 6 个 `theme-*` 类再按模式添加；`system` 模式按 `matchMedia("(prefers-color-scheme: dark)")` 选 `theme-cyber`（暗）或 `theme-warm`（亮）；挂载为 `window.applyTheme` 供设置页调用
- `initTheme()`：动态 import `LoadAppConfig` 读取 Go 配置，取 `localStorage.getItem("theme") || cfg.theme || THEME_DARK`（THEME_DARK = "cyber"）并回写 localStorage；`LoadAppConfig` 失败时 catch 回退 localStorage 或默认暗色，不阻塞启动
- 系统主题监听：`matchMedia` change 事件仅在 localStorage 主题为 `system` 时重应用，并 toast 提示「已跟随系统切换至深/浅色主题」
- `applyUIPrefs()`：应用 UI 偏好——`ui-font-size`（经 `--fs-scale` 缩放，先清除旧版内联 `--fs-*`）、`ui-display-font`（`--font-display` 楷体/系统）、`ui-card-density`（`--card-padding`/`--card-gap`）、`ui-animations`（off 时给 `<html>` 加 `no-animations` 类全局关动画）
- 设置页入口（frontend/src/views/app-content/settings/init.ts）：主题卡片点选 → `window.applyTheme(themeName)` + 写 localStorage；`theme-auto` 下拉支持 off/系统跟随/按时间（白天 warm、夜晚 cyber）三种自动模式
- `variables.css`：定义 `.theme-cyber`/`.theme-warm`/`.theme-pro`/`.theme-sakura`/`.theme-ocean`/`.theme-mint` 六组变量与 `.no-animations` 覆盖规则

## 对外 API / 入口

- 全局函数：`window.applyTheme(mode: string)`
- 入口函数（app-modules.ts 内部）：`initTheme()`、`applyUIPrefs()`，启动 IIFE 中依次执行
- Wails binding（动态 import）：`LoadAppConfig`（仅取 `cfg.theme`）
- localStorage 键：`theme`、`theme-auto`、`ui-font-size`、`ui-display-font`、`ui-card-density`、`ui-animations`
- 派发 bus：`toast:show`（跟随系统切换提示）

## 与其他子系统关系

- 启动编排在 [app_modules](./app-modules.md)（initTheme → applyUIPrefs → checkUpdateSilent）
- 主题选择 UI 在 app-content 设置页（settings.ts），经 `window.applyTheme` 与 localStorage 与入口同步
- 所有组件样式消费 CSS 变量（见 [shared_styles](./shared-styles.md) 与各组件 css），Shadow DOM 内用 `:host-context(.theme-*)` 做主题特判
- 动画开关 `no-animations` 被各组件 CSS（如 app-tree-styles）以 `animation: none !important` 响应

## 不变量

- 主题切换只允许经 body 的 `theme-*` class，全部视觉值走 CSS 变量，禁止组件内硬编码主题颜色（治理红线 §3.3；主题卡片预览 swatch 的硬编码 hex 属装饰豁免，表述已加限定）
- 变量取值口径（`variables.css` 头注释已同步）：**亮色主题 `--accent` 取深色系**（文字对比度 ≥4.5:1 on `--bg`）；**深色主题取亮色系**；`--txt`/`--muted` 的色相必须与 `--accent` 同色系（禁止冷灰混入暖色主题等色相脱节）；`--bd` 一律 `color-mix` 派生自 `--accent`（改 accent 无需同步边框）
- 合法模式仅 6 套皮肤 + `system`，非法值一律回落 `system`，不产生无主题状态
- `LoadAppConfig` 失败必须回退 localStorage/默认值，主题初始化失败不得阻塞启动序列
- 系统偏好监听只在 `system` 模式下生效，手动选定主题不被系统变化覆盖
- **写入侧也须写合法值**：设置页主题卡写 6 套皮肤名、`theme-auto="time"` 时经 `applyTimeTheme()` 把实际主题（warm/cyber）写入 `theme` 键——不允许写 `"time"`/`"dark"` 等非法值到 `theme`（否则重启 initTheme 归一化为 system，按时间段模式被静默降级，P2 修复）
- **设置页主题读写同样走 safe 包装**（P3 修复：`themeGet`/`themeSet` 与 app-modules 的 safeGet/safeSet 同口径——原设置页裸 localStorage 在隐私模式下抛错中断 initSettings、主题卡片整页失效）
- UI 偏好修改只操作 CSS 变量与类名（`--fs-scale`/`no-animations`），不直接改各 `--fs-*` 计算值
- **P3 观察**：`theme-auto="time"` 按时间自动切换**仅设置页会话内生效**——启动链（app-modules）不读 `theme-auto`，重启后应用持久层的定格主题（warm/cyber）而非按当前时刻重算（白天设 time 夜间重启仍亮色）；自动模式（system/time）变更未同步 ysm_config.json（localStorage 被清理后回退 cfg 旧主题）

## 相关

- [app_modules](./app-modules.md) — 启动序列与主题挂载
- [shared_styles](./shared-styles.md) — 消费 CSS 变量的共享样式
- [wails_bindings](./wails-bindings.md) — LoadAppConfig 后端
