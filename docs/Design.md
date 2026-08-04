# YSM 模型管理器 — Design.md

> 项目设计 DNA **与 UI 组件规范（唯一规范）**。AI 开发时以此文件为约束，保持 UI 一致性。
> 本文档分两层：
> - **设计系统（§1–§13）**：令牌与基础规范（色彩 / 字体 / 间距 / 圆角 / 动画 / 按钮 / Shadow DOM）。
> - **组件架构与契约（§14–§20）**：Web Components 技术基座、9 个组件的公开 API、类型化事件总线、键盘无障碍、命名与验收清单。
>
> 新增 UI / 组件前，先对照 §19 验收清单。改动文档后跑 `node scripts/link-checker.mjs` 验证引用。

---

## 1. 设计哲学

| 原则         | 说明                                           |
| ------------ | ---------------------------------------------- |
| **信息优先** | 功能 > 装饰。每个像素的存在都应该有理由        |
| **克制用色** | 彩色只用于表达状态（成功/失败/警告），不做装饰 |
| **一致性**   | 同样的组件在不同页面用同样的间距、圆角、字号   |
| **可扫描**   | 信息层级清晰，用户扫一眼就能找到关键信息       |

---

## 2. 布局系统

### 2.1 Grid 主布局

```
┌─────────────────────────────────────────┐
│              topbar (44px)               │
├────────┬──────────────────┬──────────────┤
│ sidebar│    main content   │   preview    │
│ 300px  │      1fr         │   240px      │
│        │                  │              │
│        │                  │              │
└────────┴──────────────────┴──────────────┘
```

- `grid-template-columns: var(--sidebar-width, 300px) 1fr var(--preview-width, 200px)`
- 侧栏可折叠（折叠时 0px），预览面板可折叠
- 过渡动画 `transition: grid-template-columns 0.18s ease`

### 2.2 导航栏（app-nav）

- 宽度 **160px**（固定）
- 每个导航项：图标 + 文字，hover 背景变亮
- 当前页有左侧高亮指示条（`--menu-indicator`）
- 无子导航，扁平结构

### 2.3 卡片

```css
.card {
  background: var(--card);
  border-radius: 10px; /* --r 变量 */
  border: 1px solid var(--bd);
  padding: 12px;
}
```

- 卡片内容区内部间距：**10–12px**
- 卡片之间的 gap：**8–12px**

---

## 3. 主题系统

> **当前实装 6 套主题 + `system` 别名**（以 `frontend/js/app-modules.ts:47` 的 `VALID` 为准）。
> `system` 不是独立 class，而是 mode 别名：运行时按 OS 偏好落到 `theme-cyber` / `theme-warm`（app-modules.ts:50–56）。
> 通过 body class 切换，**永不硬编码颜色值**。

| 主题     | 类名                  | 基调        | 适用场景     |
| -------- | --------------------- | ----------- | ------------ |
| 赛博霓虹 | `.theme-cyber`        | 深色        | 默认（推荐） |
| 温暖木纹 | `.theme-warm`         | 浅色/暖色   | 明亮环境     |
| 极简深邃 | `.theme-pro`          | 深色/高对比 | 专业向       |
| 樱粉     | `.theme-sakura`       | 浅色/樱色   | 柔和风格     |
| 海洋     | `.theme-ocean`        | 深色/蓝绿   | 冷静沉浸     |
| 薄荷     | `.theme-mint`         | 浅色/清新   | 明亮清新     |
| 跟随系统 | `.theme-system`(别名) | 自动        | 跟随 OS 明暗 |

> ⚠️ 历史文档曾列「原版深色 `.theme-default-dark`」，该 class **在代码中不存在**，已被上述 6 套取代（见 §14.6 漂移登记）。

### CSS 变量体系

```css
--bg:       /* 最底层背景 */ --surf: /* 表面背景（侧栏、顶栏） */
  --card: /* 卡片背景 */ --hover: /* hover 状态背景 */
  --act: /* active/选中状态背景 */
  --accent: /* 强调色（链接、选中、关键按钮） */ --txt: /* 主文字色 */
  --muted: /* 次要文字色 */ --bd: /* 边框色 */;
```

### 语义色

```css
--free:     /* 免费/成功/可用 */ --paid: /* 付费/错误/危险 */
  --sz-green: /* 文件大小 <1MB */ --sz-red: /* 文件大小 >3MB */
  --meta-author: /* 作者姓名 */ --meta-work: /* 作品相关 */
  --meta-date: /* 日期相关 */;
```

**关键规则**：语义色在浅色主题下用深色值，深色主题下用亮色值。永远不做 `color: #cdd6f4` 之类的硬编码。

---

## 4. 字体系统

### 字号变量（`--fs-*`）

| 变量        | 值               | 使用场景                       |
| ----------- | ---------------- | ------------------------------ |
| `--fs-tiny` | 7px（基准缩放）  | 热力图、极小水印、版权信息     |
| `--fs-xs`   | 10px（基准缩放） | 通用最小字号                   |
| `--fs-sm`   | 11px（基准缩放） | 通用小字号                     |
| `--fs-base` | 12px（基准缩放） | 正文、卡片标题、列表项主要文字 |
| `--fs-md`   | 13px（基准缩放） | 强调正文、区段小标题           |
| `--fs-lg`   | 14px（基准缩放） | 分组标题                       |
| `--fs-xl`   | 24px（基准缩放） | 数据统计数字、大号展示         |

### 语义化字号变量（按 UI 角色）

| 变量                 | 值               | 应用元素                        |
| -------------------- | ---------------- | ------------------------------- |
| `--fs-nav`           | 13px（基准缩放） | `.repo-tab` 导航主标签          |
| `--fs-tab`           | 12px（基准缩放） | `.repo-subtab` `.sm-tab` 子标签 |
| `--fs-filter`        | 11px（基准缩放） | `.sm-status-tab` 筛选标签       |
| `--fs-btn-primary`   | 12px（基准缩放） | `.hdr-btn` `.btn` 主要按钮      |
| `--fs-btn-secondary` | 11px（基准缩放） | `.sm-item-btn` 次要/行内按钮    |
| `--fs-btn-tool`      | 10px（基准缩放） | `.repo-bar-btn` 工具栏按钮      |

### 语义化间距变量（按 UI 角色）

| 变量                  | 值          | 应用元素                         |
| --------------------- | ----------- | -------------------------------- |
| `--pad-nav`           | 6px（缩放） | `.repo-tab` 导航主标签垂直内边距 |
| `--pad-tab`           | 5px（缩放） | 子标签垂直内边距                 |
| `--pad-filter`        | 4px（缩放） | 筛选标签垂直内边距               |
| `--pad-btn-primary`   | 5px（缩放） | 主要按钮垂直内边距               |
| `--pad-btn-secondary` | 4px（缩放） | 次要按钮垂直内边距               |
| `--pad-btn-tool`      | 3px（缩放） | 工具栏按钮垂直内边距             |

所有语义字号/间距均通过 `--fs-scale` 统一缩放。修改时只需改对应角色的变量，不影响其他 UI 元素。

### 字重变量（`--fw-*`）

| 变量            | 值  | 用途           |
| --------------- | --- | -------------- |
| `--fw-normal`   | 400 | 正文           |
| `--fw-semibold` | 600 | 强调文字       |
| `--fw-bold`     | 700 | 标题、统计数字 |

### 字体栈变量（`--font-*`）

| 变量             | 字体栈                                                                | 用途                 |
| ---------------- | --------------------------------------------------------------------- | -------------------- |
| `--font-ui`      | `-apple-system, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif` | 所有 UI 文字         |
| `--font-display` | `'STKaiti','KaiTi','楷体', serif`                                     | 创作者名字等艺术场景 |

### 规则

- **所有 CSS 必须使用语义化 `var(--fs-*)` 变量，禁止硬编码 `font-size: Npx`**
  - 新增组件/元素时，从语义化变量表中选择最匹配的角色字号
  - 如果找不到匹配项，评估是新增语义变量还是使用基础变量（`--fs-sm`/`--fs-base`/`--fs-md`）
- 每个 Shadow DOM 组件的 `:host` 必须设置 `font-family: var(--font-ui); font-size: var(--fs-base)`
- 全局 `*` 选择器已设置默认字体/字号，组件只需覆盖有差异的部分
- 创作者名字等需要艺术字体的场景，使用类名 + `--font-display`，禁止内联 style

### 未来改进方向

- **`--fs-scale` 支持 `rem`**：当前 `--fs-base-size: 12px` + `--fs-scale: 0px` 使用 `calc(12px + var(--fs-scale))`，所有基础单位是 `px`，不响应浏览器默认字号设置（如用户设为 120%）。未来可改为 `--fs-base-size: 0.75rem`（等价 12px@16px） + `--fs-scale: 0rem`，使整体字号尊重浏览器基础设置。
- 改 `rem` 前需要全局审计所有 `calc()` 中的 `px` 值并同步迁移，建议在下次主题系统大改时一并完成。

---

## 5. 间距系统

| 层级 | 像素    | 用途                       |
| ---- | ------- | -------------------------- |
| 0    | 0       | 无间距                     |
| 1    | 4px     | 图标与文字之间、按钮内边距 |
| 2    | 6–8px   | 列表项间距、小元素间距     |
| 3    | 10–12px | 卡片内边距、段落间距       |
| 4    | 14–16px | 区块间距、大按钮边距       |
| 5    | 20–24px | 页面主间距                 |

**规则**：不要使用 3px、7px、9px 等非标准值。要么 4 的倍数，要么用上述层级。

---

## 6. 圆角系统

```css
--radius-xs: 3px;    /* 标签内小元素、进度条 */
--radius-sm: 4px;    /* 按钮、输入框、筛选标签 */
--radius-md: 6px;    /* 卡片、对话框、按钮组 */
--radius-lg: 8px;    /* 大卡片、弹出面板 */
--radius-xl: 10px;   /* 全局卡片默认（--r） */
--radius-pill: 20px; /* 药丸形徽章 */
```

- 所有 `border-radius` 必须使用 `--radius-*` 变量
- 禁止硬编码 `border-radius: Npx`

---

## 7. 动画/过渡

```css
--tr-fast: 0.12s ease;      /* 按钮 hover、微交互 */
--tr-normal: 0.15s ease;    /* 面板展开、卡片过渡 */
--tr-slow: 0.2s ease;       /* 页面切换、内容淡入 */
--tr-enter: 0.25s ease-out; /* 入场动画 */
```

```css
transition: background var(--tr-fast);        /* 按钮 hover */
transition: grid-template-columns var(--tr-normal); /* 布局变化 */
transition: opacity var(--tr-slow);           /* 淡入淡出 */
```

- 所有 `transition` 时长必须使用 `--tr-*` 变量
- 禁止硬编码 `transition: ... 0.15s`

- 所有 interactive 元素必须有 hover 过渡
- 不要用闪烁动画（除了加载骨架屏）
- 进度条用线性过渡

---

### 7.1 阴影系统

```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);    /* 轻微抬升 */
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.1);      /* 卡片默认 */
--shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.15);    /* 下拉菜单、弹出面板 */
--shadow-xl: 0 8px 32px rgba(0, 0, 0, 0.25);    /* 模态对话框 */
```

- 所有 `box-shadow` 必须使用 `--shadow-*` 变量
- 禁止硬编码 `box-shadow: 0 Npx ... rgba(0,0,0,...)`

---

### 7.2 入场动画系统

#### Keyframe（3 个统一 keyframe）

```css
@keyframes fadeSlideUp    { from { opacity:0; transform:translateY(6px) }  to { opacity:1; transform:translateY(0) } }
@keyframes fadeSlideLeft  { from { opacity:0; transform:translateX(-8px) } to { opacity:1; transform:translateX(0) } }
@keyframes fadeSlideDown  { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }
```

| keyframe | 方向 | 用途 |
|----------|------|------|
| `fadeSlideUp` | 向上 6px | 卡片、列表项、行、面板 |
| `fadeSlideLeft` | 向左 8px | 侧栏、嵌套菜单、日志行 |
| `fadeSlideDown` | 向下 4px | 顶栏 Tab |

#### Stagger 入场

**纯 CSS 方案**（父容器加 `.stagger-in` class）：
```css
.stagger-in > *:nth-child(1)  { animation-delay: 0ms }
.stagger-in > *:nth-child(2)  { animation-delay: 30ms }
.stagger-in > *:nth-child(n+11) { animation-delay: 300ms }
```

**JS 方案**（混杂子元素时使用）：
```js
import { stagger } from './utils/stagger.js';
style="animation-delay:${stagger(i)}ms"
```

#### 规则

- 新增动画**必须**使用 3 个统一 keyframe 之一
- Stagger 延迟**必须**使用 `stagger()` 工具函数或 `.stagger-in` CSS 类
- 禁止硬编码 `animation-delay: Nms`
- 禁止新增 `@keyframes`（除非现有 3 个无法满足）

#### 技术约束

1. 所有动画必须遵守 `.no-animations` 无障碍开关（用户关闭时零动画）
2. 优先使用 `transform` / `opacity`（GPU 合成层，不触发重排）
3. 禁止在虚拟滚动组件上使用 `height` / `max-height` 过渡（与 `innerHTML` 替换冲突，触发滚动闪烁，见 `docs/archive/bug-chronicle.md`）
4. Shadow DOM 组件的动画须在各自 `<style>` 内定义，不依赖全局样式

---

## 8. 按钮规范

```css
/* 主按钮 — 用于核心操作 */
.btn-primary {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: var(--accent);
  color: var(--bg);
  font-size: 11px;
  cursor: pointer;
}

/* 次要按钮 — 边框样式 */
.btn-secondary {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: var(--bg);
  color: var(--txt);
  cursor: pointer;
  font-size: 11px;
}

/* 文字按钮 — 无边框，hover 显示背景 */
.btn-text {
  padding: 2px 6px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--txt);
  cursor: pointer;
  font-size: 11px;
}
```

**规则**：

- 按钮 hover 必加 `background: var(--hover)`
- 禁用状态加 `opacity: 0.4; cursor: not-allowed`
- 图标+文字按钮的 gap：**4px**
- 行内小按钮：`padding: 1px 4px; font-size: 9px`

---

## 9. Shadow DOM 样式规则

每个 Web Component 的样式写在独立的 `*-css.ts` 文件中（导出一个 CSS 字符串）。

### CSS 文件分配

| 文件             | 给谁用                             |
| ---------------- | ---------------------------------- |
| `variables.css`  | 全局 :root + 主题变量              |
| `layout.css`     | 主 grid 布局、顶栏、侧栏、预览面板 |
| `components.css` | 跨组件通用类（仅非 Shadow DOM）    |
| `content-css.ts` | `app-content` 的所有子组件样式     |
| `sidebar-css.ts` | `app-sidebar` 的所有子组件样式     |
| `preview-css.ts` | `app-preview` 的所有子组件样式     |
| `nav-css.ts`     | `app-nav` 样式                     |
| `tree-css.ts`    | `app-tree` 样式（实际位于 `components/app-tree-styles.ts`，见 §11 / §14.6） |

### Shadow DOM 样式注入机制

组件在构造函数里以 `adoptedStyleSheets` 注入（非 `<style>` 标签），实证：`app-content/index.ts:63-64`、`app-tree/index.ts:64-65`、`app-preview/index.ts:42-43`、`app-sidebar/index.ts:33-34`。

```ts
constructor() {
  super();
  this._root = this.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssString);          // cssString 来自 *-css.ts 模块级字符串
  this._root.adoptedStyleSheets = [sheet];
}
```

### Shadow DOM 通信原则

- **不要用 `document.getElementById` 查子组件的 Shadow DOM**（穿透不了）
- 跨组件通信用 `bus.on` / `bus.emit`（类型化，见 §16）
- 组件内部状态用 `_unsubs` 数组管理事件订阅，`disconnectedCallback` 清理（见 §14.4）

### Shadow DOM 共享样式

`shared-styles.ts` 导出可复用的 CSS 片段，供各 Shadow DOM 组件 import：

```ts
import { btnBaseCSS, focusVisibleCSS } from "../../css/shared-styles.js";
export const contentCSS = `... ${btnBaseCSS} ${focusVisibleCSS} ...`;
```

| 导出 | 用途 |
|------|------|
| `btnBaseCSS` | 统一按钮系统（`.btn-base` 全套变体） |
| `focusVisibleCSS` | 通用 `:focus-visible` 焦点环（所有交互元素） |

> 全仓 **无 `<slot>`、无 `::part()`、无 `exportparts`**（grep 零匹配）。组件间解耦完全依赖 bus 事件 + 模块级函数 + CSS 变量，不依赖槽/部件投射。

---

## 10. 色彩使用规则

### ✅ 必须用 CSS 变量

```css
/* ✓ 正确 */
color: var(--txt);
background: var(--bg);
border: 1px solid var(--bd);
```

### ❌ 禁止硬编码

```css
/* ✗ 错误 */
color: #cdd6f4;
background: rgba(0, 0, 0, 0.5);
```

### 例外（允许硬编码的场景）

- 渐变背景（`linear-gradient` 中的色值，须同时适配深浅主题）
- 临时调试用的 `console.log`（用完即删）
- `text-shadow` 救急（`rgba(0,0,0,.12)` 等通用值）

---

## 11. 组件命名与目录规范

> 源码已 TypeScript 化，文件扩展名为 **`.ts`**（AGENTS.md 早期写 `.js` 为历史遗留，以本规范为准）。

每个组件一个目录，约定子文件职责：

```
components/app-xxx/
  index.ts        — 生命周期编排（connectedCallback / disconnectedCallback / 渲染入口）
  tpl.ts          — HTML 模板字符串（布局骨架）
  render.ts       — 渲染逻辑（输入 → HTML）
  events.ts       — 事件绑定（bus / 原生事件）
  data.ts         — 数据逻辑（纯函数 / 模块级状态）
  xxx-css.ts      — Shadow DOM 样式字符串
  utils.ts        — 工具函数（可选）
```

**实际偏差（以源码为准）**：
- `app-content/` 下含 `community/` 子目录（`site-view.ts` / `settings.ts` / `diagnostics.ts`），为 app-content 的子页面模块。
- `app-tree` 的样式文件为 `components/app-tree-styles.ts`（位于 `components/` **根**，非 `app-tree/` 子目录），由 `app-tree/index.ts:64-65` 引用。
- `app-sidebar` 比规范更细：除 `index.ts` / `events.ts` / `sidebar-css.ts` 外，还有 `loader.ts`（loading:start/end）、`actions.ts`（推送/拉取动作）。
- `app-preview` 重构后子文件为 `preview-detail.ts` / `preview-litematic-*.ts` / `preview-skeleton.ts` / `preview-utils.ts` / `preview-wasm.ts`（旧 `events.ts`/`preview-actions.ts`/`preview-pack.ts` 已移除）。
- `features/` 与 `core/` 是 bus 事件的主要生产/消费层（见 §14.2、§16），组件目录只是其消费者之一。

---

## 12. 文档命名与归属规范

> 新建文档的命名与归属在此统一约定（`AGENTS.md` 硬约束的入口）。改完文档跑 `node scripts/link-checker.mjs` 验证引用。

### 命名规范（按目录）

| 目录 | 模式 | 示例 |
|------|------|------|
| `docs/adr/` | `ADR-NNN-kebab-case.md` | `ADR-005-frontend-governance-rules.md` |
| `docs/releases/` | `vX.Y.Z.md` / `vX.Y.Z-compare.md` | `v1.9.3.md` / `v1.5.8-compare.md` |
| `docs/guide/` | kebab-case | `import-model.md` / `3d-preview.md` |
| `docs/knowledge/` | snake_case | `go_ysm_parser.md` / `page_store.md` |
| `docs/novel/act-*/` | `NN-中文.md` | `01-裂隙初现.md` |
| `docs/archive/` | 原名冻结，不改名 | `bug-chronicle.md` |
| `docs/` 根 | kebab-case | `governance-rules.md` / `pitfalls.md` |

- 编号只允许给 ADR 与 novel 章节（ADR 一律走叫号脚本 `node scripts/new-adr.mjs "标题"`，禁止手写编号）。
- 历史例外（存量不改名，新文件勿效仿）：`Design.md`（PascalCase）、`guide/项目意义.md` / `guide/用户指南.md`（中文命名）。

### Frontmatter（VitePress 站点页）

`docs/guide/` 内的站点页必须带 frontmatter（ADR-022，VitePress 原生消费）：

```yaml
---
title: 页面标题
description: 一句话摘要
---
```

### 归属决策

| 文档性质 | 归属 |
|---------|------|
| 决策记录（为什么这么做） | `docs/adr/` |
| 规则条文 / 治理手册（允许/禁止做什么） | `docs/` 根 |
| 使用指南（面向用户） | `docs/guide/` |
| 模块知识卡（模块长啥样、去哪找） | `docs/knowledge/` |
| 版本发布记录 | `docs/releases/` |
| 历史痕迹 / 冻结设计 | `docs/archive/` |

---

## 13. UI 体验原则

> UI 改动的评判基准（决策依据与实施台账见 ADR-016）。改界面前先对照这 6 条：

| 原则 | 含义 |
|------|------|
| 引导式空状态 | 空状态须提供引导文案 + 占位装饰，而非裸图标 + 单行文字 |
| 导航与操作分离 | Tab（导航）独占一行，操作按钮（关闭/放大等）置于右上角 |
| 强反馈对比 | 选中/激活等状态必须有足够对比（背景增强 + 左侧高亮条），不可"看得见但看不清" |
| 主题令牌全主题可用 | 设计令牌（含 meta 文本色）在 6 套主题下均须满足可读性 |
| 图标化结构 | 结构树用图标 + CSS 缩进替代 ASCII 字符画 |
| 显式 3D 控制 | 3D 预览须提供显式控制（重置视角按钮 + 高对比网格线） |

---

## 14. 组件架构

> 本章定义技术基座与跨组件协作契约，是 §15/§16 的前置。所有结论以源码 `file:line` 为准（验证于 2026-08-04）。

### 14.1 技术基座：Web Components + Shadow DOM

- 前端为 **TypeScript 编译的原生 Web Components**，无前端框架（React/Vue 等）。
- 全部 9 个组件直接 `extends HTMLElement`（已逐一确认：`context-menu.ts:6`、`app-content/index.ts:46`、`app-toast.ts:10`、`app-sync-manager/index.ts:38`、`app-tree/index.ts:46`、`app-nav.ts:6`、`app-preview/index.ts:32`、`app-sidebar/index.ts:15`、`app-resource-manager/index.ts:66`）。
- **无共享基类 / Mixin**。唯一的"接口契约"是 `PreviewCtx`（`app-preview/preview-utils.ts:26`，`interface` 而非基类），`AppPreview` 实现它，仅向子模块暴露最小面（`_root` / `_loadPreviewImage` / `decodeYsmViaWasm` 等）。这是依赖倒置手法，不是继承体系。
- 样式注入统一用 `adoptedStyleSheets` + `CSSStyleSheet.replaceSync`（见 §9）。

### 14.2 跨组件通信：类型化事件总线

- 单例总线定义在 `frontend/js/bus.ts`，调用方 `import { bus }`。运行时挂在 `window.bus`（`bus.ts:173`），`setBus(mockBus)` 可替换（测试 / 入口层）。
- **类型契约（ADR-014 P1 渐进迁移）**：`BusEvents` 接口（`bus.ts:53-107`）将事件名映射到 payload 类型；`.ts` 调用方拼错事件名或 payload 形状错误 → **编译期报错**；`.js` 存量代码不受影响。
- `bus.on(event, fn)` 返回 **退订函数** `() => void`，必须在组件卸载时调用（见 §14.4）。
- 类型安全用法：

```ts
import { bus } from "../../bus";
// 订阅：返回 unsub 函数
const unsub = bus.on("toast:show", (p) => showToast(p.msg, p.type));
// 发射：payload 形状由 BusEvents 约束
bus.emit("toast:show", { msg: "已安装", type: "success" });
// 退订
unsub();
```

### 14.3 状态管理：模块级单例 + 总线

项目**未使用** Redux/Vuex。状态以「总线事件驱动 + 模块级可变单例」为主，组件尽量无状态：

| 状态 | 位置 | 说明 |
|------|------|------|
| 页面导航 | `core/page-store.ts` | `_currentPage` 模块级；`setCurrentPage(p)` → `bus.emit("nav:changed",{page})`；`<app-nav>` 额外写 `localStorage` |
| 树多选 | `app-tree/data.ts` | `selectState = { keys:Set, lastKey }` + `toggleSelect()`，跨节点共享 |
| 跨组件搜索手递 | `app-tree/index.ts:17,20` | `setPendingTreeSearch(name)` / `takePendingTreeSearch()`：app-content 写入、app-tree 挂载消费 |
| 资源类型缓存 | `app-resource-manager` 模块级 `STORE._config` | 订阅 `config:resource-types-changed` 后重置 |
| 同步选中类型 | `app-sync-manager` 模块级 `_lastSelectedType` | 记忆上次选中类型，供恢复 |
| 主题 / UI 偏好 | `app-modules.ts` `applyTheme` / `applyUIPrefs` | 写入 `:root` CSS 变量 + `localStorage` |

**原则**：持久化靠 `localStorage` + 窗口级 CSS 变量；跨组件数据流转走 bus，禁止模块间直接 import 可变单例改状态（除上表明确登记的单例）。

### 14.4 生命周期与资源清理约定（项目级事实标准）

1. **Shadow DOM 创建**：构造函数 `attachShadow({mode:"open"})` + `adoptedStyleSheets`（见 §9）。
2. **bus 订阅注册**：`connectedCallback` 内调用 `bus.on(...)`。
3. **退订存储**：单订阅存 `this._unsub`；多订阅存数组 `this._unsubs`（或 `_globalUnsubs`）。
4. **统一清理**：`disconnectedCallback` 中遍历数组逐个退订，并移除 window 级监听（如 `app-preview._cleanupModelListeners`，`index.ts:61-67`）。实证：`context-menu.ts:27`、`app-toast.ts:50`、`app-preview:61`、`app-tree:140`、`app-sidebar:298`、`app-sync-manager:124`、`app-content:102`、`app-resource-manager:87`。
5. **重复注册防护**：`app-resource-manager/index.ts:437` 用 `if (!customElements.get("app-resource-manager"))` 包裹 `customElements.define`。

**推荐范式（新增组件照抄）**：

```ts
connectedCallback() {
  this._unsubs.push(
    bus.on("stats:refresh", () => this.reload()),
    bus.on("model:select", (p) => this.show(p)),
  );
  window.addEventListener("resize", this._onResize);
}
disconnectedCallback() {
  this._unsubs.forEach((u) => u());
  this._unsubs = [];
  window.removeEventListener("resize", this._onResize);
}
```

#### 14.4.1 并发防护范式（审核周期沉淀）

审核周期（2026-08-04）检查了 20 个模块的异步模式，识别出 4 个已在全仓库扩散的统一范式：

| 范式 | 适用场景 | 模板代码 | 出处 |
|------|----------|----------|------|
| **`_busy` + `try/finally`** | 按钮点击类异步操作，防止连点重叠触发 | `if (this._busy) return; this._busy = true; try { ... } finally { this._busy = false; }` | app-tree / app-sidebar / import-queue / app-preview |
| **generation counter** | 多个 await 后写共享 DOM 的初始化/刷新，丢弃过期响应 | `const gen = ++this._loadGen;` + await 后 `if (gen !== this._loadGen) return;` | recycle-bin / oldest-models / preview-detail（`_detailGen`）/ app-resource-manager（`_initGen`） |
| **单例槽位** | 弹窗类，防止连点叠加/双执行 | `registerDlg(overlay, cancelClose)` — 先结算旧弹窗再登记新的 | modal.ts（`_activeOverlay` / `_closeActive`） |
| **先移除再绑定** | window/document 级监听，防止切页累积 | `if (this._prevHandler) window.removeEventListener(...);` 再绑新 handler | preview-skeleton 拖拽 / app-content preview resize / handler-dnd document 监听 |

**判断原则**：
- 按钮/导入/推送等"用户点一次执行一次"的操作 → `_busy` + `finally`
- 多个 await 后写共享 DOM 的初始化 → generation counter
- 弹窗/对话框 → `registerDlg` 单例槽位
- 全局监听（window/document） → 先移除再绑定 + disconnectedCallback 清理

### 14.5 代码分割与注册入口

入口 `frontend/js/app-modules.ts`：

- **静态 import**（首屏即用）：`app-nav` / `context-menu` / `app-toast`。
- **动态 `import()` 懒加载**（与 `customElements.define` 配对）：`app-tree` / `app-sidebar` / `app-content` / `app-resource-manager` / `app-sync-manager`。
- `?dev=1` 时启用 DevTools。

### 14.6 已知架构漂移（登记，勿效仿 / 待修）

| # | 漂移点 | 现状 | 处置 |
|---|--------|------|------|
| D1 | **主题数过期** | Design.md 旧版列 4 主题（含不存在的 `.theme-default-dark`）；实装 6 主题 + `system`（app-modules.ts:47） | 本文 §3 已修正；删除 `--theme-default-dark` 引用 |
| D2 | ~~**`app-preview` 残留 `mode` 属性**~~ | ✅ **不成立（已核销）**：全库 grep `mode="model"` 零匹配，`app-content/tpl.ts` 现已只生成 `<app-preview id="app-preview" style="...">`。原登记基于过期快照 | 无需处置 |
| D3 | ~~**`app-resource-manager` 走 DOM 事件而非 bus**~~ | ✅ **已修复**：`app-resource-manager/index.ts` 的 `_toast()` 改为直接 `bus.emit("toast:show", {msg,type,duration})`；同步删除 `features/resource-packs.ts` 中的 DOM 事件桥接（原 :26-43），`initResourcePacks` 保留空清理函数以兼容调用契约 | 已闭环 |
| D4 | ~~**`app-tree` 的 `root` 非响应式**~~ | ✅ **已修复**：新增 `static observedAttributes = ["root"]` 与 `attributeChangedCallback`，变更后 `_load()` + `_renderTree()`；以 `_ready` 标志位隔离首次挂载，避免与 `connectedCallback` 重复加载 | 已闭环 |
| D5 | **AGENTS.md 目录规范偏差** | 扩展名 `.js`→`.ts`；`tree-styles.ts` 位置；`app-content/community/` 子目录未记载 | 以本文 §11 / §14.2 为准 |
| D6 | **部分 bus 事件仅订阅无发射** | `tree:set-search` / `filter:results` / `entry:toggle` / `entries:dedup` 在 `BusEvents` 中有定义、有订阅方，但未定位到发射方 | 补全发射或移出契约 |

---

## 15. 组件 API 规范

> 9 个已注册自定义元素的**公开契约**。内部 `_xxx` 字段 / 私有方法不对外。

### 15.0 全景表

| 标签 | 文件 | 角色 | observedAttributes | 关键 bus 事件（订阅→发射） |
|------|------|------|--------------------|----------------------------|
| `<app-nav>` | `components/app-nav.ts` | 主导航 + 主题切换 | 无 | 订阅 `nav:changed`；发射 `nav:change` |
| `<app-content>` | `components/app-content/index.ts` | 主内容编排器 | 无 | 订阅 `nav:change`/`repo:*`/`package:selected`；发射 `nav:changed`/`repo:rtype-changed`/`toast:show` |
| `<app-sidebar>` | `components/app-sidebar/index.ts` | 实例整合包侧栏 | `rtype` | 订阅 `stats:refresh`/`repo:rtype-changed`；发射 `sync:download:missing`/`toast:show`/`tree:reload` |
| `<app-tree>` | `components/app-tree/index.ts` | 资源/文件树 | 无（`root` 命令式读） | 订阅 `filter:results`/`tree:set-search`/`bus-handlers` 多事件；发射 `model:select`/`ctx:show`/`stats:refresh` |
| `<app-preview>` | `components/app-preview/index.ts` | 模型/资源预览详情 | 无 | 仅订阅 `model:select` |
| `<app-resource-manager>` | `components/app-resource-manager/index.ts` | 资源类型/包管理列表 | `rtype`,`instance` | 订阅 `config:resource-types-changed`；反馈走 `bus.emit("toast:show")` |
| `<app-sync-manager>` | `components/app-sync-manager/index.ts` | 单实例同步管理 | `instance`,`default-type` | 订阅 `stats:refresh`；发射 `repo:rtype-changed`/`toast:show` |
| `<app-toast>` | `components/app-toast.ts` | 全局通知条 | 无 | 仅订阅 `toast:show` |
| `<context-menu>` | `components/context-menu.ts` | 右键/弹出菜单层 | 无 | 仅订阅 `menu:show` |

### 15.1 `<app-nav>`

- **角色**：顶部/侧边主导航栏；渲染页面切换项（repository / instances / workshop / github / diagnostics / settings），持久化当前页到 `localStorage`，支持主题切换。
- **observedAttributes**：无。
- **公共属性/方法**：无对外（内部 `_current`、`_unsub`）。
- **bus**：
  - 发射 `nav:change`（`app-nav.ts:34,130`），payload `{page}`。
  - 订阅 `nav:changed`（`app-nav.ts:17`）→ 设 `_current` + 写 `localStorage`。
- **DOM 事件**：无。**插槽/部件**：无。

### 15.2 `<app-content>`

- **角色**：主内容区编排器。按当前页渲染 repository / instances / workshop / github / diagnostics / settings 子视图，并挂载 `<app-tree>`、`<app-preview>`、`<app-sidebar>`、`<app-sync-manager>`。
- **observedAttributes**：无。
- **公共属性/方法**：无对外（内部 `_root`/`_current`/`_unsubs`）。
- **bus**：
  - 订阅 `nav:change`（:71 → 同步 `nav:changed` + 重渲染）、`repo:switch-tab`（:84）、`repo:search-creator`（:91）、`package:selected`（:232）、`avatar:refresh`（:666）。
  - 发射 `nav:changed`（:79）、`nav:change`（:95）、`repo:rtype-changed`（:277）、`toast:show`（:581/587/602/608）。
- **子组件**：`<app-tree root="...">`（:271/tpl.ts:30）、`<app-preview>`（tpl.ts:38）、`<app-sidebar class="ins-sidebar">`（tpl.ts:52）、`<app-sync-manager instance="...">`（:238-242，动态 import 懒加载）。
- **DOM 事件**：无。**插槽/部件**：无。

### 15.3 `<app-sidebar>`

- **角色**：实例整合包侧边栏；按 `rtype` 展示实例卡片，提供勾选推送/拉取、同步选择。
- **observedAttributes**：`["rtype"]`（:16 getter；:38 `attributeChangedCallback`）。
- **公共属性**：`rtype`（反射属性）。内部 `_instances`/`_unsubs`/`_cardCleanup`。
- **公共方法**：无对外。
- **bus**：
  - 订阅 `stats:refresh`（:55，防抖重载）、`repo:rtype-changed`（:63）、`sync:download:done`（:181）。
  - 发射 `sync:download:missing`（:192，`{instanceName,rtype,token}`）、`toast:show`（多处）、`stats:refresh`（:244）、`tree:reload`（:245）。
  - 辅助模块 `events.ts` 发射 `package:selected`；`loader.ts` 发射 `loading:start`/`loading:end`；`actions.ts` 发射 `toast:show`/`stats:refresh`。
- **DOM 事件**：无。**插槽/部件**：无。

### 15.4 `<app-tree>`

- **角色**：资源/文件树；支持多选、搜索、类型过滤、右键菜单、实例操作。
- **observedAttributes**：**`root`**（资源类型根）。首次挂载由 `connectedCallback` 读取；挂载后变更走 `attributeChangedCallback` → `_load()` + `_renderTree()`，以 `_ready` 标志避免重复加载（D4 已闭环）。
- **公共属性**：`root`（消费属性，非 observed）。
- **公共方法（模块级导出，跨组件契约）**：`setPendingTreeSearch(name)`（:17）、`takePendingTreeSearch()`（:20）—— app-content 写入、app-tree 挂载消费。
- **bus**：
  - 订阅 `filter:results`（:99）、`tree:set-search`（:111），以及 `bus-handlers.ts` 大量：`entry:toggle`/`dir:select-repo`/`entries:dedup`/`recycle:open`/`batch:*`/`dir:*`/`tree:reload`。
  - 发射（经 `events.ts`/`bus-handlers.ts`/`toolbar-events.ts`/`instance-actions.ts`）：`model:select`、`ctx:show`、`sync:toggle:status`、`toast:show`、`stats:refresh`、`tree:reload`、`nav:change` 等。
- **DOM 事件**：内部对搜索框派发 `input`（实现细节）。**插槽/部件**：无。

### 15.5 `<app-preview>`

- **角色**：模型/资源预览详情区；订阅 `model:select` 渲染 YSM 模型 / 资源包 / Litematic / ShaderPack / 整合包目录详情。
- **observedAttributes**：**无**（历史 `mode` 属性已移除，调用方亦已清理）。
- **公共方法（实现 `PreviewCtx`）**：`decodeYsmViaWasm(modelPath)`（:123）、`_loadPreviewImage`（:79）。其余为私有。
- **bus**：仅订阅 `model:select`（:51），payload `{path, isDir?}`。
- **DOM 事件**：无。**插槽/部件**：无。详情渲染委托 `preview-detail.ts` 等模块函数操作 `this._root`。

### 15.6 `<app-resource-manager>`

- **角色**：资源类型/资源包管理列表；按 `rtype`/`instance` 过滤，提供搜索、详情。由 `features/resource-packs.ts` 渲染（非 app-content 直接挂载）。
- **observedAttributes**：`["rtype","instance"]`（:67 getter；:91 `attributeChangedCallback`）。
- **公共属性**：`rtype`、`instance`（反射属性）。
- **公共方法**：无对外。
- **bus**：仅订阅 `config:resource-types-changed`（:46，模块级）→ 重置并重新初始化。**不发射 bus 事件**。
- **DOM 事件**：**无**。内部 `_toast()` 统一 `bus.emit("toast:show", {msg,type,duration})`（D3 已闭环，不再派发游离 DOM 事件）。
- **插槽/部件**：无。

### 15.7 `<app-sync-manager>`

- **角色**：单实例同步管理器（推送/拉取缺失文件）；按 `instance` 加载项，按 `default-type`/选中类型过滤。
- **observedAttributes**：`["instance","default-type"]`（:39 getter；:65 `attributeChangedCallback`）。
- **公共属性**：`instance`、`default-type`（反射属性）。内部 `_allItems`/`_selectedType`/`_unsubs`/`_lastSelectedType`。
- **公共方法**：无对外。
- **bus**：
  - 订阅 `stats:refresh`（:101）→ 重载+渲染。
  - 发射 `repo:rtype-changed`（:316）、`toast:show`（:352/357/371/376）、`stats:refresh`（:355/374）。
- **DOM 事件**：无。**插槽/部件**：无。

### 15.8 `<app-toast>`

- **角色**：全局轻量通知条容器；订阅 `toast:show` 堆叠显示（最多 5 条，超时自动移除）。
- **observedAttributes**：无。
- **公共方法**：`show(msg, undoCallback?, duration?, type?, clickCallback?)`（`bus.on("toast:show")` 回调内调用，:45）。仅由 bus 驱动。
- **bus**：仅订阅 `toast:show`，payload `ToastPayload {msg, duration?, type?, click?, undo?}`（bus.ts:7）。
- **DOM 事件**：无。**插槽/部件**：无。类型 class：`warn`/`success`/`error`/`info`。

### 15.9 `<context-menu>`

- **角色**：通用右键/弹出菜单层；订阅 `menu:show` 在 (x,y) 渲染 `MenuItem[]`，点击/ESC/外部点击关闭。
- **observedAttributes**：无。
- **公共方法**：`show(x,y,items)`（:88）、`hide()`（:134）。亦由 bus `menu:show` 驱动（:19）。
- **bus**：仅订阅 `menu:show`，payload `{x,y,items:MenuItem[]}`（bus.ts:68）。
- **DOM 事件**：无。**插槽/部件**：无。`MenuItem` 类型见 bus.ts:18。

---

## 16. 事件总线契约

> 权威来源：`frontend/js/bus.ts` 的 `BusEvents` 接口（:53-107）。新增事件必须先在此登记类型，再使用。

### 16.1 事件名 → payload 登记表

| 事件名 | payload 类型 | 域 |
|--------|--------------|-----|
| `nav:change` | `{page:string}` | 导航 |
| `nav:changed` | `{page:string}` | 导航 |
| `toast:show` | `ToastPayload` | 反馈 |
| `stats:refresh` | `void` | 统计/树刷新 |
| `tree:reload` | `void` | 统计/树刷新 |
| `tree:set-search` | `string` | 统计/树刷新 |
| `avatar:refresh` | `{author:string; dataUri:string}` | 模型/选择 |
| `model:select` | `{path:string; isDir?:boolean}` | 模型/选择 |
| `package:selected` | `{name:string; rtype?:string}` | 模型/选择 |
| `menu:show` | `{x:number; y:number; items:MenuItem[]}` | 菜单/上下文 |
| `ctx:show` | `CtxShowPayload` | 菜单/上下文 |
| `repo:switch-tab` | `{tab:string}` | 仓库/同步 |
| `repo:rtype-changed` | `string` | 仓库/同步 |
| `repo:search-creator` | `string` | 仓库/同步 |
| `sync:toggle:status` | `void` | 仓库/同步 |
| `sync:download:missing` | `{instanceName?:string; rtype?:string; token?:string}` | 仓库/同步 |
| `sync:download:done` | `{token?:string; instanceName?:string}` | 仓库/同步 |
| `instance:export-list` | `{name:string; rtype?:string}` | 实例操作 |
| `instance:clear` | `{name:string; rtype?:string}` | 实例操作 |
| `instance:install` | `{name:string; rtype?:string}` | 实例操作 |
| `instance:sync` | `{name:string; rtype?:string}` | 实例操作 |
| `import:pending-changed` | `{count:number}` | 导入/拖拽 |
| `import:pending-files` | `Array<{name:string; file:File}>` | 导入/拖拽 |
| `dnd:lock-changed` | `{locked:boolean}` | 导入/拖拽 |
| `config:updated` | `void` | 配置 |
| `config:resource-types-changed` | `void` | 配置 |
| `batch:rename` | `{paths:string[]}` | 批量/目录 |
| `batch:enable-all` | `void` | 批量/目录 |
| `batch:disable-all` | `void` | 批量/目录 |
| `batch:enable` | `{dir:string}` | 批量/目录 |
| `batch:disable` | `{dir:string}` | 批量/目录 |
| `dir:rename` | `{dir:string}` | 批量/目录 |
| `dir:recycle` | `{dir:string}` | 批量/目录 |
| `dir:mkdir` | `{dir:string}` | 批量/目录 |
| `dir:batch-rename` | `{dir:string}` | 批量/目录 |
| `dir:select-repo` | `void` | 批量/目录 |
| `loading:start` | `void` | 加载/杂项 |
| `loading:end` | `void` | 加载/杂项 |
| `recycle:open` | `void` | 加载/杂项 |
| `filter:results` | `Array<{path:string}>` | 加载/杂项 |
| `entry:toggle` | `{path:string}` | 加载/杂项 |
| `entries:dedup` | `void` | 加载/杂项 |

> `ToastPayload`/`MenuItem`/`NavPagePayload`/`ModelSelectPayload`/`CtxShowPayload` 定义见 bus.ts:7-48。`mmd:sync-variant-folder` 仅在 `BusEvents` 声明、源码未命中发射，按 D6 处理。

### 16.2 关键数据流（典型链路）

- **页面切换**：`<app-nav>` `bus.emit("nav:change")` → `<app-content>` 订阅 → `bus.emit("nav:changed")` → `page-store`/`app-nav` 同步 + 重渲染。
- **模型选中预览**：`<app-tree>` `bus.emit("model:select",{path})` → `<app-preview>` 订阅渲染详情。
- **同步缺失文件**：`<app-sidebar>` `bus.emit("sync:download:missing")` → `handler-sync` 处理 → `bus.emit("sync:download:done")` → `<app-sidebar>` 局部刷新。
- **资源类型变更**：settings 改 `config` → `bus.emit("config:resource-types-changed")` → `<app-resource-manager>` 重置。

---

## 17. 键盘导航与无障碍

> 设计原则参考 MikuMikuAR `design.md` §键盘导航与无障碍，但**以 YSM 当前实装为准**。当前 YSM 尚未建立集中式键盘导航框架（🟡 部分覆盖），以下为**强制标准 + 现状**。新增交互组件必须遵守。

### 17.1 设计原则

1. **键盘等价**：所有可通过鼠标触发的交互，必须能通过键盘触发。
2. **焦点可见**：聚焦状态必须使用 `:focus-visible` 或项目级高亮类，不得隐藏焦点环（统一用 `shared-styles.ts` 的 `focusVisibleCSS`）。
3. **语义正确**：可交互元素尽量用原生语义标签；不得已用 `div`/`span` 时，必须补 `role`、`tabIndex`、`aria-*`。
4. **不抢键**：内嵌控件（输入框、原生按钮）获得焦点时，优先使用自身键盘语义。
5. **可关闭**：所有弹出层（context-menu、toast）必须支持 `ESC` 或外部点击关闭。

### 17.2 现状与强制项

| 能力 | 现状 | 要求 |
|------|------|------|
| 焦点环 | `focusVisibleCSS` 已提供，组件应引入 | ✅ 所有交互元素接入 |
| 右键菜单关闭 | `<context-menu>` 已支持 ESC + 外部点击（context-menu.ts） | ✅ 保持 |
| 树搜索框 | 原生 `<input>` 可聚焦、可输入 | ✅ 保持 |
| 列表/树 Arrow 导航 | ❌ 未建立集中式框架 | 🟡 **新增列表/树必须接入键盘上下移动 + Enter 激活**（参考 MikuMikuAR `createKeyboardNav` 范式，用 `rovingTabIndex` + `wrap`） |
| 全局导航栈 | ❌ 无（YSM 为扁平单页，无需弹层栈） | — 不适用 |

**判断流（新增面板）**：
```
你的组件创建了可交互元素？
  ├─ 是 → 用原生 <button>/<input>/<a>？
  │        ├─ 是 → ✅ 原生语义自动获得键盘支持
  │        └─ 否（自定义 div 行/卡片）→ ⚠️ 必须补 role+tabIndex+键盘 handler 或接入导航工具
  └─ 否 → ✅ 无需处理
```

### 17.3 焦点生命周期

- **面板打开**：焦点应落到首个可交互元素；无交互元素则焦点归容器。
- **面板关闭**：焦点应回落到触发元素或前序焦点（框架不自动处理时需手动归还）。
- **输入框/搜索框**：获得焦点时不触发外层导航；`Escape`/`Tab` 退出后恢复。

### 17.4 文字选中与行点击共存

- 全局已取消 `user-select: none`，UI 文字默认可选中复制。
- 仅交互控件（行容器、菜单头、滑块行）保留 `user-select: none` 防误触。
- 行点击须内置选中文字守卫：若用户正在选中文字（`window.getSelection()?.toString()` 非空），不触发行点击（参考 MikuMikuAR `slideRow` 守卫范式）。

---

## 18. Web Component 命名规范

### 18.1 标签名

- 全小写 kebab-case；顶层组件 `app-` 前缀（`app-content` / `app-tree` / `app-sidebar` …）。
- 通用层（`context-menu`）可无 `app-` 前缀，但须全局唯一且不与原生标签冲突。

### 18.2 属性（attributes）

- kebab-case；仅"需要由 HTML / 外部反射控制"的属性进 `observedAttributes`。
- **命令式 `getAttribute` 仅用于挂载期只读参数**；若需运行时响应变化，必须进 `observedAttributes` + `attributeChangedCallback`（`app-tree` 的 `root` 即为范例）。
- 禁止裸 `data-*` 传递结构化数据；结构化数据走属性解析或 `bus`/`property`。

### 18.3 属性名 vs 内部状态

- 反射属性：提供 `get/set` 配 `observedAttributes`（如 `app-sidebar.rtype`）。
- 非反射内部状态：模块级或 `this._xxx`，禁止暴露为公共字段。

### 18.4 方法

- camelCase；公开方法语义明确、有 JSDoc；内部方法 `_` 前缀。
- 跨模块暴露最小化面（参考 `PreviewCtx` 接口仅暴露 4 个方法）。

### 18.5 事件

- **bus 事件**：kebab-case + 域名前缀，语义分组（`nav:` / `repo:` / `sync:` / `tree:` / `batch:` / `dir:` / `config:` / `instance:` / `import:`）。新增事件先在 `bus.ts` 的 `BusEvents` 登记类型（§16.1）。
- **DOM `CustomEvent`**：默认走 bus；仅当事件确需穿透 Shadow DOM 边界且局部消费时才用 `CustomEvent({bubbles:true, composed:true})`。⚠️ 历史上 `app-resource-manager` 曾派发游离 `toast` DOM 事件（D3，已修复）——反馈一律用 `bus.emit("toast:show")`。
- **禁止** `window.__*` 全局隐式状态 / 事件（AGENTS.md 红线）。

### 18.6 目录结构（修正 AGENTS.md）

见 §11。要点：`.ts` 扩展名；`app-xxx/index.ts` + `tpl.ts` + `render.ts` + `events.ts` + `data.ts` + `xxx-css.ts`；`app-tree-styles.ts` 在 `components/` 根；`app-content/community/` 为子页面模块。

---

## 19. UI 设计验收 Checklist

新增/修改 UI 或组件前，逐项确认：

**设计令牌**
- [ ] 所有颜色用 `var(--*)`；无 `#hex` / `rgba()` 硬编码（§10）。
- [ ] 字号用 `var(--fs-*)`；间距用 §5 层级（4 的倍数）；圆角用 `var(--radius-*)`；过渡用 `var(--tr-*)`；阴影用 `var(--shadow-*)`。
- [ ] 语义色在 6 套主题下均满足可读性（§3、§13）。
- [ ] 动画只用 3 个统一 keyframe + `stagger()`，遵守 `.no-animations` 开关（§7.2）。

**组件契约**
- [ ] 样式经 `adoptedStyleSheets` 注入，不依赖全局样式（§9）。
- [ ] `connectedCallback` 注册 bus 订阅进 `_unsubs`；`disconnectedCallback` 遍历退订 + 移除 window 监听（§14.4）。
- [ ] 反射属性进 `observedAttributes`；命令式 `getAttribute` 不用于需响应变化的属性（§18.2，规避 D4）。
- [ ] 跨组件数据走 `bus`，无 `window.__*` 全局隐式状态（§14.2、§18.5）。
- [ ] 新增 bus 事件已在 `bus.ts` 的 `BusEvents` 登记类型（§16.1）。
- [ ] 反馈统一 `bus.emit("toast:show", ...)`，不发游离 DOM `toast` 事件（规避 D3）。
- [ ] 关键交互元素带 `data-testid`（前缀命名空间，如 `tree-file`/`tree-toggle`），展示元素不必（§19.1）。

**键盘与无障碍**
- [ ] 所有可点击元素可 `Tab`/方向键聚焦，焦点可见（`focusVisibleCSS`）。
- [ ] `Enter`/`Space` 触发按钮、折叠头、行操作。
- [ ] 自定义列表（非原生标签）接入键盘导航并释放资源；或改用原生语义标签。
- [ ] 弹出层（菜单/toast）支持 `ESC`/外部点击关闭。
- [ ] 长文本可选中复制，行点击有选中文字守卫（§17.4）。

**命名与文档**
- [ ] 标签 kebab-case + `app-` 前缀；方法 camelCase；bus 事件带域名前缀（§18）。
- [ ] 改动文档后跑 `node scripts/link-checker.mjs` 验证引用。
- [ ] 偏离 §14.6 漂移登记的新代码，先修漂移再落地。

### 19.1 测试钩子（data-testid）规范

G-1 抗脆弱测试基础设施（ADR-035）——测试断言稳定语义而非易变实现（CSS 类/文案/DOM 结构）。

- **命名**：`<域>-<角色>` kebab-case 前缀命名空间（`tree-file`/`tree-toggle`/`sync-push`）；同域多实例用前缀匹配 `[data-testid^="tree-file"]`。
- **必须加**：测试要操作的可交互元素（按钮/开关/列表行/输入）；纯展示元素不必（减少噪音）。
- **禁止**：把 testid 当 CSS 选择器（样式走 class）；testid 值含空格或大小写混排。
- **契约守护**：关键 testid 由 `tests/*.mjs` 契约断言存在（删除 → 契约红，防钩子静默失效）。
- **状态断言**：交互后状态经组件暴露的可查询值（DEV 钩子/事件流）断言，不解析 DOM 结构（ADR-035 G-1 隔壁实证）。

---

## 20. 参考

- 视频: [AI做的UI设计为什么总是很丑？3套解决方案](https://www.bilibili.com/video/BV1GpEs6gEgL/)
- 主题变量与实装主题列表: `frontend/js/app-modules.ts`（VALID 数组 :47）
- 类型化事件总线契约: `frontend/js/bus.ts`（`BusEvents` :53-107）
- 全局 CSS 变量: `frontend/css/variables.css` / `layout.css` / `components.css` / `transitions.css`
- 共享样式片段: `frontend/js/css/shared-styles.ts`（`btnBaseCSS` / `focusVisibleCSS`）
- 组件注册入口: `frontend/js/app-modules.ts`
- 组件源码: `frontend/js/widgets/*`（9 个自定义元素，详见 §15）
- 页面状态: `frontend/js/core/page-store.ts`
- 架构快照（历史）: `docs/archive/architecture.md`（已冻结；当前架构以 ADR + 源码为准）
- 参考范式: MikuMikuAR `docs/design.md`（UI 组件规范，键盘导航/无障碍章节来源）
