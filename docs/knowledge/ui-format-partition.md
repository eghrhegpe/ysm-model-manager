---
kind: ui-format-partition
name: UI 格式分工与外迁触发线
tier: leaf
category: ui
status: active
source_files:
  - frontend/src/utils/icon/ui-icons.ts
  - frontend/src/utils/icon/workshop-icons.ts
  - frontend/src/views/app-content/tpl.ts
  - frontend/src/views/app-content/tpl-diagnostics.ts
  - frontend/src/views/app-sidebar/tpl.ts
  - frontend/src/views/app-preview/tpl-summary.ts
  - frontend/src/views/app-sidebar/sidebar-css.ts
  - frontend/src/views/app-content/css/content-css.ts
  - frontend/src/utils/dom/shadow-style.ts
auto_fields:
  symbols_with_lines:
    - contentCSS
    - createShadowStyle
    - diagnosticsHTML
    - emptyInstanceStateHTML
    - footerHTML
    - getSiteIcon
    - getTagIconFromRole
    - githubHTML
    - headerHTML
    - ICONS
    - InstanceCardHeaderData
    - instanceCardHeaderHTML
    - instancesHTML
    - listContainerHTML
    - loadErrorStateHTML
    - repositoryHTML
    - safeUrl
    - ShadowStyle
    - sidebarCSS
    - SummaryAnimGroup
    - SummaryAuthor
    - summaryCardHTML
    - SummaryConfigMenu
    - syncResultContentHTML
    - SyncResultData
    - syncResultPanelHTML
    - UI_ICONS
    - UiIconName
    - uiIconNames
    - VIEW_TESTIDS
    - workshopHTML
    - YSMHeader
    - YsmSummary
use_when:
  - 换 React
  - 用 tsx
  - 为什么没 JSX
  - 格式分工
  - UI 外迁
  - svg 外迁
  - css 独立文件
  - shadow dom
quick_groups:
  - 前端分层与边界
  - 重构与域切分
  - 前端分层与边界
  - UI 交互与弹窗
quick_intents:
  - 判断是否该换 React/Vue/Svelte 或引入 tsx
  - 判断某个 tpl.ts / *-css.ts / ui-icons.ts 该不该外迁
  - 搞清为什么"没格式分工"其实分了（角色 vs 后缀）
  - 评估"UI 挤在 TS 里"是负债还是合理取舍
quick_risk_lines:
  - HTML/CSS/SVG 全在 TS 里≠「没格式分工」；角色已按 tpl.ts / *-css.ts / ui-icons.ts / resource_types.json 分层，触发线未写死是缺口，不是"没分工"
  - 阈值要锚在**当前实测最大值**上（app-sidebar/tpl.ts 已 350、ui-icons.ts 已 125 图标）；空口"超过 100 就迁"在存量就超线的代码上毫无意义
  - 外迁方向只加**局部能力**（lit-html / Vite ?raw），不换根框架；主战场 Three.js/VRM/MMD 走 Canvas/WebGL，DOM 层收益极低
---

# UI 格式分工与外迁触发线

## 概览

前端是**原生 TS (Web Components + Shadow DOM)**，无 React/Vue/Svelte、无 `.tsx/.jsx`、无 `.html`、无 `.css`、无 `.svg` 文件。HTML/CSS/SVG 都作为字符串住在 TS 里。

**这不是"没格式分工"，是"角色分工"已经按语义拆好了，但触发外迁的阈值未写死。** 本卡把角色分工现状和**基于实测最大值**的外迁触发线写下来，供下次决策直接命中。

## 现有格式分工（角色层面）

| 角色 | 文件形态 | 单一出处 |
|---|---|---|
| HTML 模板 | `views/<view>/tpl.ts` / `tpl-*.ts`（字符串拼接） | 每视图一份 |
| CSS | `views/<view>/*-css.ts` 或 `css/*-css.ts`（TS 字符串，走 `adoptedStyleSheets`） | 每视图一份 |
| UI chrome 图标 | `utils/icon/ui-icons.ts` | 单一常量 `UI_ICONS` |
| 业务域图标 | `utils/icon/workshop-icons.ts` | 创作者/平台徽标域 |
| i18n | `core/i18n/locales/{zh-CN,en,ja}.ts`（.ts 换类型检查） | 三语同步 |
| 数据 | `resource_types.json` / `creators.json` / `workshop_sites.json` / `workshop-github.json` | Go 单一事实源 |
| 事件/总线 | `bus.ts`（跨 Shadow 边界） | — |
| 3D | `views/app-preview/*-3d.ts` + `preview-3d/` | Canvas/WebGL 主战场 |

**分工不是靠后缀，是靠目录与命名约定**（`tpl.ts` / `*-css.ts` / `*-deps.ts` / `*-testids.ts`）。

## 实测基线（决策锚）

判断该不该外迁时，**先对齐当前实测最大值**——阈值若低于当前最大值，说明存量已欠债，触发线是"新增即违规"，而非"新代码超线才迁"。

> 下面每个数字都是**取样快照**（2026-10-24 复核）。数字随代码演化必腐，所以每条都带可复跑的口径；
> 判断现状请重跑，不要把快照当当前值。

- `views/` 非测试 `.ts` 最多 `app-content/` **81** 文件，其余视图 14–37 文件
  （口径：`find frontend/src/views/<view> -name '*.ts' ! -name '*.test.ts' | wc -l`）
- `tpl*.ts` 行数 top：`app-sidebar/tpl.ts` **350**、`app-preview/tpl-summary.ts` **326**、`app-content/tpl.ts` **311**、
  `app-preview/tpl.ts` **310**、`app-content/settings/tpl-settings-appearance.ts` **292**
  （`app-content/tpl.ts` 曾 561——越线后已按 C 组「拆子模板」拆出 `tpl-diagnostics.ts`，见下方裁定记录）
- `*-css.ts` 行数 top：`utils/dom/css.ts` **166**、`app-sidebar/sidebar-css.ts` **151**、`app-nav/nav-css.ts` **133**、
  `app-sync-manager/sm-css.ts` **113**、`app-preview/css.ts` **111**
- `ui-icons.ts` **125** 个 svg 图标（`workshop-icons.ts` 是业务域图标，独立成集不混）
  （口径：`grep -cE '^  [a-zA-Z][a-zA-Z0-9]*:' frontend/src/utils/icon/ui-icons.ts`）
- 全仓 `.ts`（非测试）里的 HTML 开标签约 **3351** 处
  （口径：`grep -roE '<[a-zA-Z][a-zA-Z0-9]*[ >]' frontend/src --include=*.ts | wc -l`，需自行排除测试文件）

## 不变量（触发线）

**A. 根框架不变量**（长期稳定，无需讨论）

1. **无 React/Vue/Svelte/lit 运行时**——不新增。主战场 3D 走 Canvas/WebGL，DOM 只是外壳；塞 UI 框架运行时不换来对等的生产力。
2. **HTML/CSS/SVG 保持 TS 字符串**——除非命中下面的外迁触发线。
3. **Web Component + Shadow DOM** 是唯一视图载体；`attachShadow({mode:"open"})` + `adoptedStyleSheets` 走 shadow 内 CSS。
4. **i18n 用 `.ts`**（不是 `.json`）换类型检查——`locales-consistency.test.ts` 兜底。
5. **UI chrome 图标只走 `UI_ICONS` 单一出处**——`workshop-icons.ts` 是分开的业务域图标集，不混。
6. **模板 testid 单一事实源**：每视图 `VIEW_TESTIDS: readonly string[]`（ADR-133），契约测试静态聚合。

**B. 外迁触发线**（局部渐进，不换根框架；每条硬阈值以实测最大值为锚）

| 观察对象 | 当前实测最大 | 触发线（超过即评估外迁） | 外迁目标 |
|---|---|---|---|
| 单 `tpl*.ts` 行数 | `app-sidebar/tpl.ts` 350 | > 400 | 先**拆子模板**（`tpl-diagnostics.ts` / `tpl-workshop.ts` 范式）；带循环渲染才试点 `lit-html` |
| 单 `*-css.ts` 行数 | `utils/dom/css.ts` 166 | > 250 | 切真 `.css` + `?raw` 或 `?inline` 导入 |
| `ui-icons.ts` 图标数 | 125 图标 | > 180 | 切真 `.svg` 文件 + `import x from "./x.svg?raw"` |
| 新视图非测试 `.ts` 数 | `app-content/` 81 | > 120 | 按业务子域拆多视图（不是拆更多文件塞进单视图） |

**触发线只管体积，不管格式。** 越线第一动作永远是「在同一种格式内拆文件」（同族 `tpl-*.ts` 先例已有 5 个：
`tpl-workshop` / `tpl-oldest` / `tpl-recycle` / `tpl-dedup` / `tpl-diagnostics`）；C 组那三条**换格式**的外迁，
门槛比这张表高——`lit-html` 试点还要求「带循环渲染」，不是「行数越线」单条成立。把体积越线直接读成
「该上模板引擎」是把两种病混为一谈。

**触发线的语义**：不是"超过就动手"，是"新增代码前必读此卡"。已有存量不追溯，但**新代码不得让指标继续扩大**（如：新增视图若单目录已到 81，先考虑拆而不是继续加文件）。

**C. 局部试点候选**（真需要时按此顺序，最温和在前）

1. **CSS 外迁**：`*-css.ts` > 250 行时切 `.css` 文件（Vite `?raw` 导入或 `?inline`），保留 shadow DOM 隔离。
2. **SVG 外迁**：`ui-icons.ts` > 180 图标时切 `.svg` 静态资产（Vite `?raw`），保留 `.ws-icon` 视觉约定。
3. **模板局部试点**：单 `tpl*.ts` 行数超 400 **且**带循环渲染时，试点 `lit-html`（信号级、不换根框架、不引 React/Vue）。
   注意：**只超行数不构成试点理由**——先走第 0 步「拆子模板」，拆完仍超且循环密集才谈试点。
4. **禁**：换 React/Vue/Svelte 等根框架。收益低（3D 主战场无关），迁移代价高（全仓数千处 HTML 字符串 + ADR-190/208 seam 治理要重设计）。

## 陷阱

- **误诊「纯 TS = 没格式分工」**：角色已按 `tpl.ts` / `*-css.ts` / `ui-icons.ts` / `resource_types.json` 分层，触发线未写死是缺口，不是没分工。见本卡"现有格式分工"表。
- **空口拍阈值**：触发线必须锚在**实测最大值**上。写"超过 100 就迁"在存量 125 图标的 `ui-icons.ts` 面前毫无意义——要么承认欠债、要么调整基线。
- **把 CSS 外迁当唯一出路**：Shadow DOM 天然隔离 CSS，独立 `.css` 文件的收益（无 stylelint、无 minify 收益）**远小于 Web 应用**；触发线要设宽，别一超就迁。
- **引入信号库当"轻量换框架"**：`lit-html` 试点必须限定在**模板片段**层，不进生命周期、不改 Web Component 骨架；一旦越界就成事实框架。
- **把 `workshop-icons.ts` 塞进 `UI_ICONS`**：一个是业务域（创作者/平台），一个是 UI chrome；合并就丢分工。

## 与其他子系统关系

- **`fe-layering-seams`**：features 禁 HTML 字面量，一律走 `*-deps.ts` seam——本卡的"HTML 只住在 tpl.ts"是其上游约束（features 侧的 HTML 是**违规**，views 侧才合法）。
- **`app-tree` / `app-sidebar` / `app-preview` / `app-content`**：本卡观察的四个视图是当前分工范式的样本；拆视图/加图标/写模板前先对齐本卡阈值。
- **ADR-133**（VIEW_TESTIDS）：HTML 字符串无类型检查的兜底机制；本卡的触发线**不改**此机制，仅补充"什么时候把字符串迁出去"。
- **ADR-190/208**（禁 HTML 字面量 + seam）：与 A.4–A.6 一起构成"HTML 只在一处生长"的闭环。


## 裁定记录

- `2026-10-24`：app-content/tpl.ts 越 400 行线时只做同格式拆子模板（拆出 tpl-diagnostics.ts + lastTabOf 上提为 tabs-shell.ts|readLastTab），不触发 CSS/SVG/lit-html 外迁｜四项触发线里只有 tpl 行数越线，且是文件体积问题而非格式问题；换格式的门槛比体积表高，混读会把两种病当一种｜回退 = `frontend/src/views/app-content/tpl.ts|diagnosticsHTML`

## 相关

- 前端分层与 seam：`fe-layering-seams`
- 前端/Go 边界：`fe-go-boundary`
- 视图分工样本：`app-content`、`app-preview`、`app-tree`、`app-sidebar`
- 治理红线：`skills/governance-rules.md`
- 反模式与陷阱：`skills/pitfalls.md`
