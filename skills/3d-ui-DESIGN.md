# MikuMikuAR — DESIGN.md（视觉 / 品牌规范）

> **定位（2026-08-31 审计补充）**：本文为 **3D 预览子域**视觉/品牌规范（MikuMikuAR 时期移植）。主题 Design Tokens 与组件/交互规范以上位 `docs/Design.md` 为准；本文色值/字号以 `frontend/src/app.css` 的 `:root` Design Tokens 为单一真相源。

> **单一真相源**：本文所有色值、字号、间距均以 `frontend/src/app.css` 的 `:root` Design Tokens 为准，**不引用 `docs/design.md` 中的 CSS 示例**（后者部分示例已过时，见文末「已知漂移」）。
>
> **与 `docs/design.md` 的分工**：`docs/design.md` = UI **组件/架构规范**（MenuNode Schema、builder API、键盘导航）；本文 = UI **视觉/品牌规范**（颜色、排版、圆角、间距、动效）。二者互补，搬运样式读本文，搬运结构读 `docs/design.md`。

---

## M1 — Visual Theme & Atmosphere

MikuMikuAR 是一个 AR 桌面应用（WebView2 + Babylon.js），UI 叠在 3D 场景之上，因此视觉体系围绕「**不抢 3D 场景的戏、同时保持可读**」设计。

- **核心关键词**：深色 / 沉浸 / 玻璃质感 / 克制
- **情绪**：像一块浮在 3D 舞台上的深色玻璃 HUD，而非传统「应用程序窗口」
- **设计哲学**：背景半透明 + backdrop-blur 毛玻璃，让 3D 场景透出来；白色透明度层级负责结构，`accent` 蓝负责「当前/激活」的唯一强调
- **明暗**：**单一深色主题**，无亮色主题。背景基色 `#1e1e28`，任何卡片/浮层不得使用不透明的浅色表面
- **密度**：中等偏高——控制类 UI（滑条/开关密集），但列表行保持 38px 最小高度与 2px 行间距

**核心视觉规则（一句话）**：`rgba(255,255,255,α)` 的 α 层级构建 hover / 边框 / 分隔；`accent` 蓝色 `#4a6cf7` 标记唯一交互强调；`rgba(0,0,0,α)` 构建卡片底与遮罩。

---

## M2 — Color Palette & Roles

### 2.1 强调色（Accent / Primary）

| 角色 | CSS Token | 色值 | 使用场景 |
|------|-----------|------|---------|
| Accent（主强调） | `--accent` | `#4a6cf7` | 激活态、主按钮、开关开启、聚焦环、选中文本背景 |
| Accent RGB | `--accent-rgb` | `74, 108, 247` | 需要 `rgba(var(--accent-rgb), α)` 的场景（如 seek 进度条） |
| Accent Hover | `--accent-hover` | `#3a5ce7` | 主按钮 hover |
| Accent Dim | `--accent-dim` | `rgba(74, 108, 247, 0.2)` | 聚焦环、选中高亮、输入框聚焦环 |

### 2.2 文字色（5 级灰阶，白 → 深）

| 角色 | CSS Token | 色值 | 使用场景 |
|------|-----------|------|---------|
| 正文主色 | `--text` | `#e8edf5` | 行标题、正文 |
| 亮标题 | `--text-bright` | `#c8d0e0` | 弹窗标题、返回键 |
| 次要文字 | `--text-dim` | `#a0aac0` | 副标题、辅助说明 |
| 弱文字 | `--text-muted` | `#7882a0` | 占位、禁用、空状态 |
| 深文字 | `--text-dark` | `#5a6280` | 极少用（最弱层级） |

### 2.3 语义色

| 角色 | CSS Token | 色值 | 使用场景 |
|------|-----------|------|---------|
| 危险 | `--danger` | `#844` | 删除/卸载等危险操作文字 |
| 危险 Hover | `--danger-hover` | `#f44` | 危险操作 hover |
| 警告 | `--warn` / `--warning` | `#f0a020` | 实验性功能警告 |
| 成功 | `--success` | `#6fcf97` | 成功态 |

### 2.4 背景色

| 角色 | CSS Token | 色值 | 使用场景 |
|------|-----------|------|---------|
| 应用基色 | `--bg-app` | `#1e1e28` | 全局背景（html/body） |
| 卡片底 | `--card-bg` | `rgba(0, 0, 0, 0.5)` | `.lcard`、返回键、空状态 |
| 卡片 Hover | `--card-hover` | `rgba(255, 255, 255, 0.1)` | 列表行/折叠头 hover |
| 卡片 Active | `--card-active` | `rgba(255, 255, 255, 0.16)` | 列表行按下 |
| 场景底 | `--bg-scene` | `rgba(20, 20, 28, 0.88)` | 场景面板 |
| Toast 底 | `--bg-toast` | `rgba(0, 0, 0, 0.65)` | 通知 |

### 2.5 白色透明度层级（本项目结构色核心）

**这是本设计系统的骨架**——所有边框、分隔线、hover 态都从这 13 档中取，而非定义独立色值。

| Token | 值 | 典型用途 |
|-------|-----|---------|
| `--white-04` | `rgba(255,255,255,0.04)` | 极浅分隔 |
| `--white-05` | `rgba(255,255,255,0.05)` | 极浅分隔 |
| `--white-06` | `rgba(255,255,255,0.06)` | section-title 下边框、`--divider` |
| `--white-08` | `rgba(255,255,255,0.08)` | 卡片/返回键边框（最常用边框色） |
| `--white-10` | `rgba(255,255,255,0.1)` | 次边框 |
| `--white-12` | `rgba(255,255,255,0.12)` | 次边框 |
| `--white-16` | `rgba(255,255,255,0.16)` | hover 边框 |
| `--white-40` ~ `--white-85` | `0.4` ~ `0.85` | 文字/图标降级透明度（nav-tab 默认 `0.5`，hover `0.85`） |

### 2.6 Plaza 独立子域色（模型广场，勿与主色混用）

| 角色 | CSS Token | 色值 |
|------|-----------|------|
| Teal | `--plaza-teal-rgb` | `57, 197, 187` |
| 文字 | `--plaza-text-rgb` | `232, 246, 244` |

> Plaza 是独立全屏视图（`#webviewLayer`），拥有自己的 teal 强调色，与主 UI 的 accent 蓝**分域共存**，搬运时视为独立子系统。

---

## M3 — Typography Rules

### 3.1 字体族

```
'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC',
'Yu Gothic', 'Meiryo', system-ui, sans-serif
```
- 中西文混排，桌面端优先 `Segoe UI`，中文回退到 `Microsoft YaHei` / `PingFang SC`。
- 时间/数字使用 `font-variant-numeric: tabular-nums`（FPS 时钟、时间显示）。

### 3.2 字号层级（全部随 `--ui-scale` 缩放，`calc(Npx * var(--ui-scale))`）

| 层级 | CSS Token | 字号 | 用途 |
|------|-----------|------|------|
| 大标题 | `--font-title-lg` | 16px | 弹窗头部标题（`.slide-header`） |
| 标题 | `--font-title` | 14px | 标题 |
| 主体 | `--font-ui` | 13px | 列表行、正文 |
| 行标签（特例） | — | 16px | `.slide-label` 实际为 16px（非 font-ui） |
| 时间 | `--font-time` | 12px | 时间/数字、HUD |
| 辅助 | `--font-ui-sm` | 11px | 副文本、section-title |
| 微小 | `--font-ui-xs` | 10px | 标签、角标、nav-tab 文字 |
| 图标 | `--font-icon` | 17px | 菜单图标 |
| 导航图标 | `--font-nav` | 26px | 底部导航图标 |

> 注意：`.slide-label` 用 16px、`.slide-sublabel` 用 `--font-ui-sm`(11px)、`.section-title` 用 11px。搬运列表行时以「16px 主标签 + 11px 副标签」为准，而非统一 13px。

---

## M4 — Component Stylings

### 4.1 按钮 `.btn`
- 高度 30px，圆角 `--btn-radius` 6px，padding `6px 12px`，字号 `--font-ui`(13px)。
- **Primary** `.btn-primary`：`bg: var(--accent)`，`color: #fff`；hover `bg: var(--accent-hover)`；disabled `opacity: 0.4`。
- **Ghost** `.btn-ghost`：透明底 + `color: var(--text)`；hover `bg: var(--white-08)` + `color: #fff`。
- **Danger** `.btn-danger`：透明底 + `color: var(--danger)`；hover `bg: rgba(255,68,68,0.1)` + `color: var(--danger-hover)`。
- **Small** `.btn-sm`：字号 `--font-ui-sm`，高度 24px。
- **Icon-only** `.btn-icon`：宽 = 高度（30px），padding 0。

### 4.2 列表行 `.slide-item`
- 最小高度 38px，圆角 6px，行间距 2px，gap 8px。
- Default：透明底 + `color: var(--text)`。
- Hover：`background: var(--card-hover)`；Active：`var(--card-active)`。
- 聚焦 `.slide-focused`：`background: var(--card-hover)` + `outline: 1px solid var(--accent-dim)`。
- 结构：`[图标 21px] [主标签 16px] [sublabel 11px] [箭头]`。
- 变体：`danger`（红字）、`accent`（accent 字）。

### 4.3 卡片 `.lcard`
- 圆角 `--lcard-radius` 8px，`background: var(--card-bg)`，`border: 1px solid var(--white-08)`，margin 8px。

### 4.4 滑条 `.cs-bar`
- 轨道高 6px，圆角 3px；手柄 `.cs-thumb` 14px；填充 `.cs-fill` 用 accent 渐变。
- 独立滑块场景 `width: 100%`；颜色行内场景 `.clr-row .cs-bar { flex: 1 }`。

### 4.5 开关 `.toggle`
- 默认 36×20px；轨道 `--text-muted` 色，开启态 `--accent`；滑块白色 16px 圆点。
- Header 紧凑版 `.header-toggle`：30×16px，滑块 12px。

### 4.6 预设芯片 `.preset-chip`
- 高度 28px，圆角 6px，gap 6px；激活态 `.active` 用 accent 边框/背景。

### 4.7 模式按钮 `.mode-btn`
- 圆角 4px，padding `0.3em 0.7em`；激活态 `.active` 用 accent。

### 4.8 底部导航 `.nav-tab`
- 圆形按钮 48px，字号 26px 图标；默认 `color: var(--white-50)`；hover `var(--white-85)`；激活态 `color: var(--accent)` + `rgba(0,0,0,0.2)` 底。

### 4.9 弹窗容器 `#sceneOverlay`
- 圆角 `--overlay-radius` 14px，宽 `--popup-width` 280px，`max-height: 80vh`；显示态 `opacity:1 + scale(1)`，隐藏态 `opacity:0 + scale(0.85)`。
- 宽度 Modifier：model 280 / motion 320 / settings 340 / assistant 560。

---

## M5 — Layout Principles

### 5.1 间距基准
- 全局水平内边距 `--content-px` = **12px**（所有行/卡片/分区的左右 padding 基准）。
- 行内 gap 8px（`--slide-item-gap`），按钮内 gap 6px，芯片 gap 6px。
- 卡片 margin 8px，行间距 2px，分区标题下边框 `1px solid var(--white-06)`。

### 5.2 弹窗尺寸
| 面板 | 宽度 |
|------|------|
| 默认 popup | 280px |
| 场景 scene | 200px |
| 动作 motion | 320px |
| 设置 settings | 340px |
| AI 助手 assistant | min(560px, 92vw) |

### 5.3 面板三层分层（沿用 `docs/design.md`）
| 层 | 内容 | 可见性 |
|----|------|--------|
| 核心层 | 预设按钮、核心滑块、模式切换 | 默认展开 |
| 外观层 | 颜色选择、视觉属性 | 默认展开 |
| 高级层 | 低频参数 | 默认折叠 |

---

## M6 — Depth & Elevation

本项目**优先用「背景透明度层级」而非阴影**区分层级——这是深色玻璃 UI 的关键。

| 手段 | Token | 用途 |
|------|-------|------|
| 背景层级 | `--card-bg`(0.5) / `--card-hover`(0.1) / `--card-active`(0.16) | 卡片、hover、按下 |
| 边框层级 | `--white-06` ~ `--white-16` | 分隔与 hover 强调 |
| 玻璃模糊 | `backdrop-filter: blur(16px)` | 弹窗容器、广场全屏层 |
| 阴影（唯一） | `--shadow-lg: 0 4px 16px rgba(0,0,0,0.15)` | 浮出菜单、右键弹窗 |

**规则**：普通卡片/列表行不用阴影；只有「浮出层」（右键菜单、模态）才用 `--shadow-lg`。

---

## M7 — Do's and Don'ts

### ✅ 正确做法
- 用 `--white-*` 透明度层级构建 hover / 边框 / 分隔，不发明新灰。
- `accent` 蓝 `#4a6cf7` 作为**唯一**交互强调色（激活态、主按钮、聚焦环）。
- 背景用 `rgba(0,0,0,α)` 半透明 + `backdrop-filter: blur` 透出 3D 场景。
- 所有尺寸随 `--ui-scale` 缩放（`calc(Npx * var(--ui-scale))`），支持无障碍缩放。
- 数字/时间用 `tabular-nums`。
- Plaza 视图用 `--plaza-teal-rgb` teal 强调，与主 UI 分域。

### ❌ 错误做法
- 不要引入第二强调色（除 Plaza teal 外）——蓝色是唯一 accent。
- 不要用不透明的浅色表面/纯白卡片背景（会破坏「玻璃 HUD」气质）。
- 不要写死 px 字号/间距（绕过 `--ui-scale` 会破坏缩放）。
- 不要用 `#000` / `#fff` 硬色做边框或分隔（用 `rgba` 半透明层级）。
- 不要给普通列表行加阴影（层级靠透明度，阴影仅限浮出层）。
- 不要套用亮色主题假设（本系统单一深色主题）。

---

## M8 — Responsive Behavior

- **窄屏** `@media (max-width: 480px)`：popup 200px / scene 160px / motion 220px / settings 240px / assistant 92vw。
- **横屏限高** `@media (orientation: landscape) and (max-height: 500px)`：`#sceneOverlay` 的 `max-height` 改为 `calc(100vh - var(--overlay-bottom) - 8px)`，防面板顶出屏幕。
- **触屏** `@media (pointer: coarse)`：seek bar 触控热区扩至 ~44px（视觉高度不变）。
- **全局缩放** `--ui-scale`：所有尺寸 token 通过 `calc(Npx * var(--ui-scale))` 派生，缩放时整体联动。
- **动效开关** `--ui-animations`：过渡时长乘以该系数，置 0 可关闭动效。

---

## M9 — Agent Prompt Guide

### 快速颜色参考
- Accent：`#4a6cf7`（hover `#3a5ce7`，dim `rgba(74,108,247,0.2)`）
- 正文：`#e8edf5` / 次要 `#a0aac0` / 弱 `#7882a0`
- 危险：`#844`（hover `#f44`）/ 警告 `#f0a020` / 成功 `#6fcf97`
- 背景：`#1e1e28` / 卡片 `rgba(0,0,0,0.5)` / hover `rgba(255,255,255,0.1)`
- 边框：`rgba(255,255,255,0.08)`（最常用）

### 生成提示模板
```
请按以下 MikuMikuAR 视觉规范生成 UI：
- 主题：单一深色主题，背景 #1e1e28，半透明玻璃 + backdrop-blur
- 强调色：accent #4a6cf7（唯一），激活/主按钮/聚焦环
- 结构色：白色透明度层级 rgba(255,255,255,α)，边框默认 0.08，hover 0.1
- 卡片：bg rgba(0,0,0,0.5)，圆角 8px，border 1px rgba(255,255,255,0.08)
- 列表行：最小高 38px，圆角 6px，hover rgba(255,255,255,0.1)
- 字号：主标签 16px，副文本 11px，标题 16px，主体 13px
- 圆角：按钮 6px，卡片 8px，弹窗 14px，芯片 6px
- 阴影：仅浮出层用 0 4px 16px rgba(0,0,0,0.15)，普通卡片不用
- 禁止：第二强调色、纯白卡片、写死 px（用 --ui-scale 缩放）
```

---

## 附录：已知漂移（真相源 = app.css）

搬运时以 `app.css` 为准，以下 `docs/design.md` 示例已过时：

| 项目 | `docs/design.md` 示例 | `app.css` 真相源 |
|------|----------------------|-----------------|
| `.lcard` 圆角 | `12px` | `--lcard-radius: 8px` |
| `.lcard` 背景 | `rgba(255,255,255,0.06)` | `--card-bg: rgba(0,0,0,0.5)` |
| `.lcard` 边框 | `var(--white-08)` | 同（此项一致） |
| section-title 字号 | `11px` | 同（`--section-title-font-size`） |

> 结论：`docs/design.md` 的 `.lcard` CSS 示例已与真实 token 不一致，**视觉值一律以本文（引自 app.css）为准**。
