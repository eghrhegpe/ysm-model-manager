# ADR-015：前端统一动画系统设计决策

- **状态**：✅ 已采纳
- **日期**：2026-08-03（初定，决策时间线 v1.7.6）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/`（动画相关 Web Components）/ `docs/Design.md` §3 主题系统 / `docs/animations.md` / 前身 `docs/frontend/animation-roadmap.md`

---

## 1. 背景（Context）

v1.7.6 之前，前端交互动画由各组件各自实现，缺乏统一设计令牌与受限的 keyframe 集合，导致以下可维护性与运行时问题：

- 各组件重复定义 `transform` / `opacity` 动画，位移像素、时长、缓动不统一，体验割裂；
- 部分组件用 `display: none/block` 做切换，破坏 CSS transition，导致跳帧（该问题已在 ADR-005 §2.4 固化为治理红线）；
- 虚拟滚动组件（模型树）上叠加 `animation-fill-mode: both` + `innerHTML` 替换，触发滚动闪烁（见 `docs/architecture/bug-chronicle.md`）；
- 无障碍诉求：需要一个统一的 `.no-animations` 开关，供偏好减少动态效果的用户关闭全部动画。

本项目已有 4 套主题通过 CSS 变量切换（`Design.md` §3），动画系统必须复用同一套设计令牌，避免硬编码颜色/圆角/过渡导致主题失效。

本文档将原有的「动画路线图」（`docs/frontend/animation-roadmap.md`）升级为正式决策记录：路线图记录的是**已落地的实现清单**，其背后真正应被长期遵守的**约束与令牌定义**才是决策真相，故以 ADR 形式固化，原文件降级为重定向 stub 以避免真相源分裂。

---

## 2. 决策（Decision）

**决策**：确立**统一动画系统**——以 3 个固定 keyframe + 通用 stagger 工具 + 设计令牌为核心，并附加 6 条技术约束，作为所有前端交互动画的**唯一实现规范**。

### 2.1 统一 Keyframe（仅 3 个）

| keyframe | 方向 | 位移 | 用途 |
|----------|------|------|------|
| `fadeSlideUp` | 向上 | 6px | 卡片、列表项、行、面板入场 |
| `fadeSlideLeft` | 向左 | 8px | 侧栏、嵌套菜单、日志行入场 |
| `fadeSlideDown` | 向下 | 4px | 顶栏 Tab 入场 |

新增动画**必须**复用上述 3 个 keyframe 之一，禁止为单一场景新定义 keyframe。

### 2.2 通用 Stagger

交错入场统一通过以下两种方式之一实现，禁止在组件内手写逐元素 `animation-delay`：

```css
/* 方式 A：父容器加 class="stagger-in"，子元素自动 stagger（最多 11 级） */
.stagger-in > *:nth-child(1)  { animation-delay: 0ms }
.stagger-in > *:nth-child(2)  { animation-delay: 30ms }
/* ... */
```

```js
// 方式 B：JS 工具函数
import { stagger } from './utils/stagger.js';
el.style.animationDelay = `${stagger(i)}ms`;
```

### 2.3 设计令牌

动画所用视觉参数一律取自 CSS 变量（主题系统），不得硬编码：

| 类别 | 变量 |
|------|------|
| 圆角 | `--radius-xs/sm/md/lg/xl/pill` |
| 过渡 | `--tr-fast/normal/slow/enter` |
| 阴影 | `--shadow-sm/md/lg/xl` |
| 按钮 | `--accent-btn-bg/color/border` |

### 2.4 技术约束（强制）

1. 所有动画必须遵守 `.no-animations` 无障碍开关（用户关闭时零动画）；
2. 优先使用 `transform` / `opacity`（GPU 合成层，不触发重排）；
3. 禁止在虚拟滚动组件上使用 `height` / `max-height` 过渡（与 `innerHTML` 替换冲突，触发闪烁）；
4. Shadow DOM 组件的动画须在各自 `<style>` 内定义，不依赖全局样式；
5. 新增动画统一使用 §2.1 的 3 个 keyframe 之一；
6. Stagger 延迟统一使用 `stagger()` 工具函数或 `.stagger-in` CSS 类。

---

## 3. 后果（Consequences）

### 正面
- 全站动画体验一致，位移/时长/缓动统一，消除割裂感；
- 复用 GPU 合成属性（`transform`/`opacity`），避免重排卡顿；
- 通过 `.no-animations` 满足无障碍（prefers-reduced-motion）诉求；
- 设计令牌与 4 套主题联动，深色/浅色主题下动画视觉一致；
- 约束与令牌定义以 ADR 固化，成为新增动画的单一事实来源。

### 负面 / 已知例外
- **模型树文件夹展开子行**：原计划的淡入动画**已禁用**——`animation-fill-mode: both` 叠加虚拟滚动 `innerHTML` 替换会导致滚动闪烁（`bug-chronicle.md` 记录），属 §2.4 约束 3 的直接后果，非遗漏；
- 约束 4 要求 Shadow DOM 组件各自定义动画，对组件库有少量重复样板成本；
- 存量非规范动画（v1.7.6 前的散落实现）需随改随迁，迁移周期长。

### 实施状态（v1.7.6 已全部落地）

| 优先级 | 项目 | 状态 |
|--------|------|------|
| P0 | 对话框入场/退场动画 | ✅ |
| P0 | 按钮 `:active` scale 反馈 | ✅ |
| P1 | 页面切换淡入 | ✅ |
| P1 | 模型树文件夹展开子行淡入 | ⚠️ 已禁用（见 §负面） |
| P1 | 预览面板内容过渡 | ✅ |
| P2 | 创作者频道卡片筛选淡出 | ✅ |
| P2 | 导入队列项目滑入 | ✅ |
| P2 | 设置页高级面板展开/折叠 | ✅ |
| P2 | 同步管理器标签切换过渡 | ✅ |
| P3 | 回收站项目动画 | ✅ |
| P3 | 资源管理器详情过渡 | ✅ |
| P3 | GitHub 仓库卡片交错入场 | ✅ |
| P3 | 诊断页面板切换交叉淡入 | ✅ |
| P3 | 批量重命名预览列表脉冲 | ✅ |
| P3 | 导航侧栏激活指示器滑动 | ✅ |
| 新增 | 一级 Tab 淡入+微下移（`fadeSlideDown`） | ✅ |
| 新增 | 二级菜单 淡入+微右移（`fadeSlideLeft`） | ✅ |
| 新增 | GitHub 仓库卡片 stagger + hover 上浮 + 图标旋转 | ✅ |
| 新增 | 预设搜索词 / 筛选标签 stagger 入场 | ✅ |
| 新增 | 设置页卡片 stagger 入场 | ✅ |
| 新增 | 关于页区块 stagger 入场 | ✅ |

---

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
|------|------|
| ADR-005 §2.4 | 本 ADR 的「禁止 `display` 切换」约束与之同源，本 ADR 将其在动画域具体化 |
| ADR-005 §2.5 | 本 ADR §2.3 设计令牌复用同一主题变量体系 |

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/frontend/animation-roadmap.md`（前身） | 原路线图全部内容已迁入本 ADR，原文件改为重定向 stub |
| `docs/Design.md` | §3 主题系统，4 套主题 CSS 变量定义 |
| `docs/architecture/bug-chronicle.md` | 虚拟滚动 + 动画闪烁事故记录，支撑约束 3 |
| `docs/animations.md` | 动画实现细节补充 |
| ADR-005 | display 切换 / 硬编码颜色治理红线 |

---

*原路线图：`docs/frontend/animation-roadmap.md`，已升级为决策记录并保留重定向 stub。*
