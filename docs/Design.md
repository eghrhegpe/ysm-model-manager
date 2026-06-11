# YSM 模型管理器 — Design.md

> 项目设计 DNA。AI 开发时请以此文件为约束，保持 UI 一致性。

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

4 套主题，通过 CSS 变量切换，**永不硬编码颜色值**。

| 主题     | 类名                  | 基调        | 适用场景     |
| -------- | --------------------- | ----------- | ------------ |
| 赛博霓虹 | `.theme-cyber`        | 深色        | 默认（推荐） |
| 温暖木纹 | `.theme-warm`         | 浅色/暖色   | 明亮环境     |
| 极简深邃 | `.theme-pro`          | 深色/高对比 | 专业向       |
| 原版深色 | `.theme-default-dark` | 深色/中性   | 备选         |

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

## 4. 字号系统

| 用途                | 像素 | CSS               |
| ------------------- | ---- | ----------------- |
| 标题/强调           | 14px | `font-size: 14px` |
| 正文                | 12px | `font-size: 12px` |
| 辅助信息            | 11px | `font-size: 11px` |
| 标签/徽章           | 10px | `font-size: 10px` |
| 极小（仅数字/状态） | 9px  | `font-size: 9px`  |

**字体栈**：`-apple-system, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif`

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
--r: 10px; /* 卡片圆角（全局默认） */
.btn {
  border-radius: 6px;
} /* 按钮 */
.badge {
  border-radius: 12px;
} /* 徽章/标签 */
.tag {
  border-radius: 4px;
} /* 状态标签 */
```

- 卡片：**10px**（`--r` 变量）
- 按钮：**6px**
- 标签/徽章：**4–12px**（取决于高度）
- 输入框：**6px**
- 搜索栏：**6px**

---

## 7. 动画/过渡

```
transition: background 0.15s, color 0.15s;   /* 按钮 hover */
transition: grid-template-columns 0.18s ease; /* 布局变化 */
transition: opacity 0.2s;                     /* 淡入淡出 */
```

- 所有 interactive 元素必须有 hover 过渡（0.15s）
- 不要用闪烁动画（除了加载骨架屏）
- 进度条用线性过渡

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

每个 Web Component 的样式写在独立的 `*-css.js` 文件中（导出一个 CSS 字符串）。

### CSS 文件分配

| 文件             | 给谁用                             |
| ---------------- | ---------------------------------- |
| `variables.css`  | 全局 :root + 4 套主题变量          |
| `layout.css`     | 主 grid 布局、顶栏、侧栏、预览面板 |
| `components.css` | 跨组件通用类（仅非 Shadow DOM）    |
| `content-css.js` | `app-content` 的所有子组件样式     |
| `sidebar-css.js` | `app-sidebar` 的所有子组件样式     |
| `preview-css.js` | `app-preview` 的所有子组件样式     |
| `nav-css.js`     | `app-nav` 样式                     |
| `tree-css.js`    | `app-tree` 样式                    |

### Shadow DOM 通信原则

- **不要用 `document.getElementById` 查子组件的 Shadow DOM**（穿透不了）
- 跨组件通信用 `bus.on` / `bus.emit`
- 组件内部状态用 `_unsubs` 数组管理事件订阅，`disconnectedCallback` 清理

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

## 11. 组件命名规范

```
app-xxx/index.js     — 生命周期编排
app-xxx/tpl.js       — HTML 模板
app-xxx/render.js    — 渲染逻辑（输入→HTML）
app-xxx/events.js    — 事件绑定
app-xxx/data.js      — 数据逻辑（纯函数）
app-xxx/utils.js     — 工具函数（可选）
app-xxx/xxx-css.js   — Shadow DOM 样式
```

---

## 12. 参考

- 视频: [AI做的UI设计为什么总是很丑？3套解决方案](https://www.bilibili.com/video/BV1GpEs6gEgL/)
- 现有主题变量: `frontend/css/variables.css`
- 布局: `frontend/css/layout.css`
- 项目结构: `docs/architecture.md`
其他界面只是风格感不足，本身已经有卡片设计了，但这个界面是真的没啥设计感，
参考🎮整合包管理统一使用tab页当顶栏，然后给活跃创作者部分设计卡片样式？
