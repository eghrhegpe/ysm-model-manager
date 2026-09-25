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
    - applyTheme
    - applyThemeAuto
    - applyTimeTheme
    - initTheme
    - loadView
    - normalizeTheme
    - normalizeThemeAuto
    - SYSTEM_DARK_THEME
    - SYSTEM_LIGHT_THEME
    - Theme
    - THEME_AUTO_VALID
    - THEME_DARK
    - THEME_VALID
    - ThemeCard
    - timeThemeForHour
    - unregisterDevtools
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
  - frontend/src/theme-core.ts|normalizeTheme
  - frontend/src/utils/base/primitives/storage.ts|safeGet
status: active
---

# 主题系统 theme

## 概览

主题系统的纯逻辑实现在 `frontend/src/theme-core.ts`（2026-08-17 神桶拆分自 `app-modules.ts`；`app-modules.ts` 仅 re-export `applyTheme/initTheme/normalizeTheme` 并在启动 IIFE 中装配）：提供 6 套主题皮肤（cyber/warm/pro/sakura/ocean/mint）+ `system` 跟随系统模式，全部通过在 `<body>` 上切换 `theme-*` class 实现，具体颜色/字号/间距全由 `frontend/css/variables.css` 的 CSS 变量承载——组件层无任何硬编码颜色。启动时从 Go 配置或 localStorage 恢复主题，并应用字号/字体/密度/动画等 UI 偏好。

## 核心职责

- `applyTheme(mode)`：校验合法性（非法值回落 `system`），先移除全部 6 个 `theme-*` 类再按模式添加；`system` 模式按 `matchMedia("(prefers-color-scheme: dark)")` 选 `theme-cyber`（暗）或 `theme-warm`（亮）的映射走 `SYSTEM_DARK_THEME`/`SYSTEM_LIGHT_THEME` 常量（原三元硬编码，2026-09 提常量单点可改）；挂载为 `window.applyTheme` 供设置页调用
- **类型护栏（2026-10 锐评第七轮）**：`THEME_VALID` 是 `as const` 元组，导出 `Theme`（含 system）与 `ThemeCard`（去 system，卡片/图标/文案表键域）两个联合；`normalizeTheme` 返回 `Theme`，白名单判定收口在单一守卫 `isTheme`（`readonly` 元组下不再收宽 `string`，两处各写 `as` 强转是漂移温床）。下游「值 → 图标/文案」表必须写 `Record<ThemeCard, …>`——加主题漏键即编译期红（此前 `Record<string, …>` 只能运行时回落裸主题名）
- `initTheme()`：动态 import `LoadAppConfig` 读取 Go 配置，取 `localStorage.getItem("theme") || cfg.theme || THEME_DARK`（THEME_DARK = "cyber"）并回写 localStorage；`LoadAppConfig` 失败时 catch 回退 localStorage 或默认暗色，不阻塞启动
- 系统主题监听：`matchMedia` change 事件仅在 localStorage 主题为 `system` 时重应用，并 toast 提示「已跟随系统切换至深/浅色主题」
- `timeThemeForHour(hour)` / `applyTimeTheme()`：纯函数时段判定（6:00–17:59 → warm，其余 → cyber）+ 应用并返回主题名；2026-09 自设置页 `theme.ts` 下沉至 theme-core（设置页与启动链共用单源，原两份时段逻辑漂移）
- `applyThemeAuto()`：启动链在 `initTheme` 后调用，按 `theme-auto` 重算——`time` 模式按当前时刻重算时段主题并回写 `theme` 键（P3 修复重启失效：白天设 time 夜间重启不再定格亮色）；`system` 由 initTheme 经 `theme` 键已处理不重复接管；`off`/缺省沿用定格值不动
- `applyUIPrefs()`：应用 UI 偏好——`ui-font-size`（**五档** xsmall/small/normal/medium/large = −2/−1/0/+1/+2px，写入 `--fs-scale` 偏移）、`ui-display-font`（`--font-display` 楷体/系统）、`ui-card-density`（写 `--card-pad-y`/`--card-pad-x` 两分量，`--card-padding` 由二者拼出；另有 `--card-gap`，以及 app-tree 虚拟滚动行高 `--tree-row-grid`/`--tree-row-list`——行高数值单一事实源在 `views/app-tree/render.ts` 的 `ROW_H_*` 常量，`ui-prefs.ts` 只做 px 字符串化注入，杜绝「改 JS 行高忘改 CSS」漂移）、`ui-animations`（off 时给 `<html>` 加 `no-animations` 类全局关动画）；真基准 `--fs-base-size`（13px）单点定义于 variables.css `:root`，此处不再内联覆盖（旧版曾写死 12px）
- **密度消费面**：`--card-padding`/`--card-gap` 由旧式卡片（`.model-card`/`.model-card-sm`/`.gh-card`/`.pick-card`）与整合包侧栏 `instance-card`（`app-sidebar/sidebar-css.ts`）消费；树行高变量由 `app-tree` 行 CSS（`.fl`/`.fh`/`.fl-list`/`.fh-list`）消费。密度变更时 `ui-prefs.ts` 额外 `bus.emit("ui:card-density")`，`app-tree` 订阅后 `_renderTree()` 重排虚拟滚动（行高变了必须重算 JS 切片与 paddingTop/Bottom）；纯 CSS 变量消费方无需重排
- 设置页入口（frontend/src/views/app-content/settings/init.ts）：主题卡片点选 → `window.applyTheme(themeName)` + 写 localStorage；主题卡片色点（--bg/--accent/--bd 预览）经 theme.ts 探针从 variables.css 逐主题取真实色回填 inline——Shadow DOM 内卡片 `.theme-x` 类匹配不到 document 规则，var() 只会拿到当前主题（六卡同色历史缺陷，2026-09 修）；`theme-auto` 下拉支持 off/系统跟随/按时间（白天 warm、夜晚 cyber）三种自动模式
- `variables.css`：定义 `.theme-cyber`/`.theme-warm`/`.theme-pro`/`.theme-sakura`/`.theme-ocean`/`.theme-mint` 六组变量与 `.no-animations` 双层通配规则（文档层 `.no-animations *` 覆盖光 DOM；shadow 域另 adopt `utils/dom/css.ts` 的 `noAnimationsCSS`）

## 对外 API / 入口

- 全局函数：`window.applyTheme(mode: string)`
- 入口函数：`initTheme()` + `applyThemeAuto()`（均定义于 `theme-core.ts`，启动链依次调用）、`applyUIPrefs()`（定义于 `views/app-content/settings/ui-prefs.ts`，由 `app-modules.ts` 启动链调用），启动 IIFE 中依次执行
- Wails binding（动态 import）：`LoadAppConfig`（仅取 `cfg.theme`）
- localStorage 键：`theme`、`theme-auto`、`ui-font-size`、`ui-display-font`、`ui-card-density`、`ui-animations`
- 派发 bus：`toast:show`（跟随系统切换提示）

## 与其他子系统关系

- 启动编排在 [app_modules](./app-modules.md)（initTheme → applyThemeAuto → applyUIPrefs → checkUpdateSilent）
- 主题选择 UI 在 app-content 设置页（settings.ts），经 `window.applyTheme` 与 localStorage 与入口同步
- 所有组件样式消费 CSS 变量（见 [shared_styles](./shared-styles.md) 与各组件 css），Shadow DOM 内用 `:host-context(.theme-*)` 做主题特判
- 动画开关 `no-animations` 为双层通配：文档层 `variables.css` 的 `.no-animations *` 直接覆盖光 DOM（含 `::before/::after`，如 cyber 网格背景）；Shadow 域各自 adopt `noAnimationsCSS` 片段（`:host-context(.no-animations) *`），漏带由 `scripts/css-layer-check.ts` 检查 4 阻断。**禁止再新增逐类 `.no-animations .foo` 条目**（白名单必漏，且文档层选择器匹配不到 shadow 内部）

## 不变量

- 主题切换只允许经 body 的 `theme-*` class，全部视觉值走 CSS 变量，禁止组件内硬编码主题颜色（治理红线 §3.3；设置页主题卡片色点由 theme.ts 探针从 variables.css 取真实色回填 inline，同样零硬编码）
- 变量取值口径（`variables.css` 头注释已同步）：**亮色主题 `--accent` 取深色系**（文字对比度 ≥4.5:1 on `--bg`）；**深色主题取亮色系**；`--txt`/`--muted` 的色相必须与 `--accent` 同色系（禁止冷灰混入暖色主题等色相脱节）；`--bd` 一律 `color-mix` 派生自 `--accent`（改 accent 无需同步边框）；**文字层级口径**（2026-09 层级扁平治理）：正文级（列表主名/数值读数/错误正文/主操作按钮文字/导航项）用 `--txt`，`--muted` 仅限真次要（提示/元信息/禁用与非激活态/装饰图标）
- 合法模式仅 6 套皮肤 + `system`，非法值一律回落 `system`，不产生无主题状态
- `LoadAppConfig` 失败必须回退 localStorage/默认值，主题初始化失败不得阻塞启动序列
- 系统偏好监听只在 `system` 模式下生效，手动选定主题不被系统变化覆盖
- **写入侧也须写合法值**：设置页主题卡写 6 套皮肤名、`theme-auto="time"` 时经 `applyTimeTheme()`（定义于 theme-core.ts，2026-09 自设置页下沉）把实际主题（warm/cyber）写入 `theme` 键——不允许写 `"time"`/`"dark"` 等非法值到 `theme`（否则重启 initTheme 归一化为 system，按时间段模式被静默降级，P2 修复）
- **设置页主题读写同样走 safe 包装**（P3 修复：`themeGet`/`themeSet` 与 app-modules 的 safeGet/safeSet 同口径——原设置页裸 localStorage 在隐私模式下抛错中断 initSettings、主题卡片整页失效）
- UI 偏好修改只操作 CSS 变量与类名（`--fs-scale`/`no-animations`），不直接改各 `--fs-*` 计算值；`--fs-base-size` 是唯一真基准——核心 7 个 + 语义 6 个 `--fs-*` 全派生自它，故「调基准」与「调偏移」是两个正交杠杆（前者设计级、后者用户级）
- **P3 修复**（2026-09）：`theme-auto="time"` 按时间自动切换现已全链生效——启动链 `applyThemeAuto()` 读 `theme-auto`，`time` 模式按当前时刻重算时段主题并回写 `theme` 键（白天设 time 夜间重启不再定格亮色）。
- **P4 修复**（2026-09，本会话落地）：**theme-auto 落盘同步**——扩 `AppConfig.ThemeAuto` + `SaveAppConfig` 六参签名；设置页 auto 下拉 change / 卡片点击均同步 theme-auto（2026-10 锐评第八轮起统一经 `views/app-content/settings/path-cards.ts|saveCfg`，设置域唯一 SaveAppConfig 实参点，patch 语义 + 保存前重读最新）；initTheme 从 cfg.themeAuto 兜底恢复 localStorage（localStorage 被清理后可从 ysm_config.json 回退）。

## 相关

- [app_modules](./app-modules.md) — 启动序列与主题挂载
- [shared_styles](./shared-styles.md) — 消费 CSS 变量的共享样式
- [wails_bindings](./wails-bindings.md) — LoadAppConfig 后端
