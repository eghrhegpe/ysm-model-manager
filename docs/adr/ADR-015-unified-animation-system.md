# ADR-015：前端统一动画系统设计决策

- **状态**：✅ 已采纳
- **实施状态**：查知识卡 [animation-system](../knowledge/animation-system.md)（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-03（初定，决策时间线 v1.7.6）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/`（动画相关 Web Components）/ `docs/UI-Design.md` §3 主题系统

> **规范条文已并入 `docs/UI-Design.md` §7.2**（统一 keyframe / stagger / 设计令牌 / 技术约束），写动画先查 UI-Design.md；本 ADR 仅保留决策依据与实施历史。

---

## 1. 背景（Context）

v1.7.6 之前，前端交互动画由各组件各自实现，缺乏统一设计令牌与受限的 keyframe 集合，导致以下可维护性与运行时问题：

- 各组件重复定义 `transform` / `opacity` 动画，位移像素、时长、缓动不统一，体验割裂；
- 部分组件用 `display: none/block` 做切换，破坏 CSS transition，导致跳帧（该问题已固化为治理规则，见 `docs/governance-rules.md` R4）；
- 虚拟滚动组件（模型树）上叠加 `animation-fill-mode: both` + `innerHTML` 替换，触发滚动闪烁（见 `docs/archive/bug-chronicle.md`）；
- 无障碍诉求：需要一个统一的 `.no-animations` 开关，供偏好减少动态效果的用户关闭全部动画。

本项目已有 4 套主题通过 CSS 变量切换（`UI-Design.md` §3），动画系统必须复用同一套设计令牌，避免硬编码颜色/圆角/过渡导致主题失效。

本文档将原有的「动画路线图」（`docs/frontend/animation-roadmap.md`，已于 2026-08-03 删除）升级为正式决策记录：路线图记录的是**已落地的实现清单**，其背后真正应被长期遵守的**约束与令牌定义**才是决策真相，故以 ADR 形式固化，原文件内容已全部并入本 ADR 以避免真相源分裂。

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
- 存量非规范动画（v1.7.6 前的散落实现）需随改随迁，迁移周期长；
- **`.no-animations` 改为全域零动画（2026-09 收敛）**：实现从「文档层逐类白名单 + shadow 各自
  `:host-context` 逐类登记」改为**双层通配**——文档层 `variables.css` 的 `.no-animations *`（含
  `::before/::after`）+ shadow 层 `utils/dom/css.ts` 的 `noAnimationsCSS` 片段。副作用：布局过渡
  （`#root` 的 `grid-template-columns`，即侧栏折叠）也一并即时化——这是 §2.4 约束 1「用户关闭时
  零动画」的字面执行；原「仅禁装饰性动效、保留布局过渡」的注释口径作废。白名单失效模式（新组件
  漏登记 ⇒ 开关静默失效；且 `.menu`/`.toast`/`.sm-*` 等条目住在 shadow 内本就是死规则）由
  `scripts/css-layer-check.ts` 检查 4 阻断堵住。

---

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
|------|------|
| ADR-005 / `docs/governance-rules.md` R4 | 本 ADR 的「禁止 `display` 切换」约束与之同源，本 ADR 将其在动画域具体化 |
| ADR-005 / `docs/governance-rules.md` R5 | 本 ADR §2.3 设计令牌复用同一主题变量体系（禁止硬编码颜色） |

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/frontend/animation-roadmap.md`（前身，已删除） | 原路线图全部内容已迁入本 ADR，原文件于 2026-08-03 删除 |
| `docs/UI-Design.md` | §3 主题系统，4 套主题 CSS 变量定义 |
| `docs/archive/bug-chronicle.md` | 虚拟滚动 + 动画闪烁事故记录，支撑约束 3 |
| ADR-005 | display 切换 / 硬编码颜色治理红线 |

---

*原路线图：`docs/frontend/animation-roadmap.md`，已升级为决策记录，原文件已于 2026-08-03 删除。*
