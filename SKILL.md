# YSM 模型管理器 — AI 开发技能手册

## 项目概览

YSM 模型管理器是一个 Minecraft YSM 模组的模型管理工具，使用 Wails v2（Go 后端 + 原生前端）构建。

**技术栈**：
- 后端：Go + Wails v2
- 前端：原生 HTML/CSS/JS + Web Components + Shadow DOM
- 3D 预览：Three.js
- 构建：Vite 3.x

---

## 必读文档（按优先级）

1. `.github/copilot-instructions.md` — 战斗手册
2. `docs/architecture.md` — 项目架构
3. `docs/Design.md` — 设计规范（CSS 变量、布局、颜色）
4. `docs/release-notes/` — 最新发版说明
5. `AGENTS.md` — AI 代理入职指南

---

## CSS 变量系统

### 颜色变量
```css
--bg:       最底层背景
--surf:     表面背景（侧栏、顶栏）
--card:     卡片背景
--hover:    hover 状态背景
--accent:   强调色（链接、选中、CTA）
--txt:      主文字色
--muted:    次要文字色
--bd:       边框色
```

### 语义色
```css
--status-success:  成功/免费
--status-error:    错误/付费
--sm-optional:     可选/警告
--meta-author:     作者标签色
--meta-work:       作品标签色
--meta-date:       日期标签色
```

### 圆角系统
```css
--radius-xs: 3px    /* 进度条、小标签 */
--radius-sm: 4px    /* 按钮、输入框 */
--radius-md: 6px    /* 卡片、对话框 */
--radius-lg: 8px    /* 大卡片、面板 */
--radius-xl: 10px   /* 全局默认 */
--radius-pill: 20px /* 药丸形 */
```

### 过渡时长
```css
--tr-fast: 0.12s ease    /* 按钮 hover、微交互 */
--tr-normal: 0.15s ease  /* 面板展开、布局变化 */
--tr-slow: 0.2s ease     /* 页面切换、内容淡入 */
--tr-enter: 0.25s ease-out /* 入场动画 */
```

### 阴影层级
```css
--shadow-sm: 0 1px 3px rgba(0,0,0,.06)   /* 轻微 */
--shadow-md: 0 2px 8px rgba(0,0,0,.1)    /* 卡片 */
--shadow-lg: 0 4px 16px rgba(0,0,0,.15)  /* 菜单 */
--shadow-xl: 0 8px 32px rgba(0,0,0,.25)  /* 模态框 */
```

---

## 主题系统

### 6 套主题
| 主题 | 类名 | 色调 | accent |
|------|------|------|--------|
| 赛博霓虹 | `.theme-cyber` | 紫调暗色 | `#9575cd` |
| 深海探秘 | `.theme-ocean` | 蓝调暗色 | `#5c6bc0` |
| 极简深邃 | `.theme-pro` | 暖橙暗色 | `#ff8a65` |
| 温暖木纹 | `.theme-warm` | 棕调亮色 | `#8b4513` |
| 樱花物语 | `.theme-sakura` | 粉调亮色 | `#d81b60` |
| 薄荷物语 | `.theme-mint` | 绿调亮色 | `#4db6ac` |

### 主题规则
- 所有颜色必须用 `var(--xxx)` 变量
- 禁止硬编码 `color: #xxx`
- `color-scheme` 已在 `layout.css` 中按主题设置
- `body { transition: background-color 0.3s, color 0.3s }` 实现主题切换过渡

---

## 动画系统

### 3 个统一 Keyframe
```css
@keyframes fadeSlideUp    { from { opacity:0; transform:translateY(6px) } }
@keyframes fadeSlideLeft  { from { opacity:0; transform:translateX(-8px) } }
@keyframes fadeSlideDown  { from { opacity:0; transform:translateY(-4px) } }
```

### Stagger 工具
```js
import { stagger } from './utils/stagger.js';
style="animation-delay:${stagger(i)}ms"  // 默认 30ms/项，最大 300ms
```

```css
/* 纯净父容器加 .stagger-in class，子元素自动 stagger */
.stagger-in > *:nth-child(1) { animation-delay: 0ms; }
.stagger-in > *:nth-child(2) { animation-delay: 30ms; }
/* ...最多 11 级 */
```

### 动画禁忌
- **虚拟滚动列表不要用 CSS animation**（`innerHTML` 替换会重新触发）
- `animation-fill-mode: both` 在频繁重建 DOM 时会闪烁
- 新增动画必须用 3 个统一 keyframe 之一
- 所有动画必须遵守 `.no-animations` 无障碍开关

---

## 按钮系统

### 统一按钮类
```html
<button class="btn-base">默认</button>
<button class="btn-base sm">小号</button>
<button class="btn-base lg">大号</button>
<button class="btn-base primary">主要</button>
<button class="btn-base danger">危险</button>
<button class="btn-base accent">强调</button>
```

### 选中态按钮（半透明 accent）
```css
.active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  border-color: var(--accent);
}
```

---

## Shadow DOM 样式

### 共享样式导入
```js
import { btnBaseCSS, focusVisibleCSS } from "../../css/shared-styles.js";
export const myCSS = `... ${btnBaseCSS} ${focusVisibleCSS} ...`;
```

### CSS 文件分配
| 文件 | 用途 |
|------|------|
| `variables.css` | 全局变量 + 主题 |
| `layout.css` | Grid 布局 + color-scheme |
| `components.css` | 跨组件通用类 |
| `content-css.js` | `app-content` 子组件 |
| `sidebar-css.js` | `app-sidebar` |
| `preview-css.js` | `app-preview` |
| `shared-styles.js` | Shadow DOM 共享样式 |

---

## 硬编码清理规则

### 必须替换为变量
| 硬编码 | 替换为 |
|--------|--------|
| `color: #fff` | `var(--bg)` |
| `color: #f38ba8` | `var(--status-error)` |
| `color: #a6e3a1` | `var(--status-success)` |
| `color: #6c7086` | `var(--muted)` |
| `border-radius: 4px` | `var(--radius-sm)` |
| `transition: ... .12s` | `var(--tr-fast)` |
| `box-shadow: 0 4px ...` | `var(--shadow-lg)` |

### 允许硬编码
- 主题卡片预览圆点（域特定颜色）
- 热力图渐变色
- `color-mix()` 中的辅助色值

---

## 构建命令

```powershell
# 前端构建
cd frontend && npx vite build

# Go 后端构建
go build ./go/...
```

---

## 已知陷阱

1. **虚拟滚动 + CSS animation = 闪烁**：`animation-fill-mode: both` 在 `innerHTML` 替换时会保留初始 `opacity:0`
2. **原生 `<select>` 在 Windows 上难主题化**：需要 `color-scheme` + `!important`
3. **Shadow DOM 内的 `:focus-visible`**：全局规则不生效，需导入 `focusVisibleCSS`
4. **`contain: layout paint style`**：在滚动容器上会导致重绘问题
5. **`--accent-btn-bg` 变量**：必须在三个主题中都定义，否则 `.btn-base.accent` 会回退到错误颜色
