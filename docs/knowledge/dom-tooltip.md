---
kind: dom-tooltip
name: 悬浮提示 tooltip
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/tooltip.ts
auto_fields:
  symbols_with_lines:
    - attachTooltip
    - createTooltipManager
    - disposeTooltipCore
    - ensureTooltipStyles
    - promoteTitle
    - promoteTitleIfPresent
    - TooltipManager
    - TooltipOptions
    - YSW_TOOLTIP_CSS
  tests:
    - frontend/src/utils/dom/tooltip.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - tooltip、悬浮提示、hover 提示
  - title 气泡、3D 按钮
quick_risk_lines:
  - 3D 预览控制层（overlay/HUD/面板 FAB）按钮的「动作说明」型悬停提示走 dom/tooltip.ts 毛玻璃 tooltip，不用原生 title
pitfalls:
  - 3D overlay 里用原生 title → 延迟 ~1s、样式不可控；预览控制层一律经 tooltip.ts
  - tooltip 不监听跨 Shadow DOM → FAB 按钮无法接 tooltip；必须经 document.body 挂载
  - 原生 title 的合法性看语义——动作说明型走本组件，值/状态说明型（截断全文、禁用原因）原生 title 正当，别机械地把所有 title 都改掉
invariant_anchors:
  # 入口与单例（2026-10 补）：正文的「动作说明型提示走本组件」「同一时刻至多一个可见」两条
  # 契约此前**只散在散文、零机器锚**——本卡正文曾静默漂移（声称 9 处调用点，实测 0 处）
  # 而 check-knowledge-drift 看不见正文。升格为锚后入口失名即 ERROR（判据见
  # 知识卡 `redline_enforcement_grade` 的「正文断言锚化判据」节）。
  - frontend/src/utils/dom/tooltip.ts|attachTooltip
  - frontend/src/utils/dom/tooltip.ts|createTooltipManager
  # 可达性契约：aria-label 承担语义、title 仅作视觉提示——tooltip.ts 摘除原生 title 的落点
  - frontend/src/utils/dom/tooltip.ts|promoteTitle

use_when:
  - tooltip
  - 悬浮提示
  - hover 提示
  - title 气泡
  - 3D 按钮
status: active
---

# 悬浮提示 tooltip

## 概览

3D 预览控制层的自定义悬浮提示组件（单例 light DOM），替代原生 `title` 的迟缓黄气泡（~1s 延迟、样式不可控）。毛玻璃风格对齐 3D HUD（`fab.ts` `.ysm-3d-popup` 同族）；tooltip 节点挂 `document.body`，`position:fixed` + `getBoundingClientRect` 定位——监听器直接挂目标元素，**跨 Shadow DOM 边界可用**（预览面板内 FAB 也能接）。

## 核心职责

- **样式幂等注入**: `ensureTooltipStyles()` — id=`ysw-tooltip-styles` 注入 head 一次（模式同 `ensureFabStyles`）
- **悬停显示/离开隐藏**: 默认 350ms 延迟防扫过频闪；文案惰性 getter 在显示时刻求值（适配 i18n 运行时切换）
- **定位**: 目标上方水平居中、夹在视口内；上方放不下翻到下方；页面滚动捕获阶段统一隐藏（原生 title 同行为）
- **兜底**: MutationObserver 监听 body subtree——目标元素被移除 DOM（菜单整体重建，mouseleave 不触发）时自动隐藏；观察仅在 tooltip 可见期间挂载（`show` 时 observe、`hide` 时 disconnect），隐藏后即停，避免 subtree 全量观察常驻空转

## 对外 API / 入口

- `attachTooltip(el, getText: string | (() => string), opts?: { delayMs? }): () => void` — 返回 cleanup（摘除全部监听并隐藏）
- `promoteTitle(el)` — 元素原生 `title` 升级为自定义 tooltip：摘除 title 防双气泡、aria-label 缺失时补齐可达性
- `promoteTitleIfPresent(el | null)` — promoteTitle 的空值守卫版（querySelector 绑定点一行接入）
  ⚠️ **两者当前全仓零生产调用点**（2026-10 实测）：迁移只覆盖过 app-preview 详情卡 FAB，那批调用已随 ADR-253 D7 拆除。保留 API 供后续 hint 型迁移用——**不要因为「文档说有 9 处在用」而以为它们是热路径**。

## 与其他子系统关系

- `fab.ts` `createIconButton`：`opts.title` 走本组件（不设原生 title），aria-label 承担可达性——topBar 全部图标按钮（✕ 关闭 / ◀▶ 面板切换 / 📷 截图 / ⟲ 重置等）自动获得 tooltip
- `preview-menu/core.ts`：➕追加到场景 / ●设为焦点 / ⚙模型工具 / 角色路径 4 处由 `.title=` 改 `attachTooltip`
- `preview-3d/menu/panels/roles-views.ts`：组件行/追加按钮 2 处 `attachTooltip`（**丢弃返回值**——见下方「cleanup 丢弃」）
- 底部 dock 导航按钮（`preview-dock-navbtn`）**不接**——常显文字标签，tooltip 冗余

## 原生 title 的适用边界（2026-10 实测校准）

⚠️ **旧口径「禁止用原生 title」 overstated 了，已收窄为局部规则**（原文声称 app-preview 面板 FAB「共 9 处 promoteTitleIfPresent」——该描述**从不存在于当前源码树**：`promoteTitleIfPresent` 全仓零生产调用点，最后一批调用者是 `detail-3d/detail/maid-3d/skeleton`，已被 `98b1b0574`「ADR-253 D7 删除详情卡 3D 入口 FAB」拆掉；卡片描述是迁移当时的快照，之后无人更新）。

实测全仓 `.title =` 共 21 处（9 模块），其中**多数属正当用法**，判据是「悬停要传达什么」：

| 类型 | 判据 | 处置 | 例 |
|------|------|------|-----|
| **hint 型** | 提示「按钮做什么」——动作说明，与控件外观/上下文无关 | 3D overlay 内 → 走本组件；其余区视一致性 | `skeleton.ts` 全窗预览、`slide-menu.ts` 返回/关闭 |
| **信息型** | 提示「这个值是什么」——截断全文 / 禁用的具体原因，内容**无法**在控件内表达 | **原生 title 正当**（本组件只做动作提示，承载不了动态值；且这类信息本就有 inert 语义，不该抢焦点） | `app-sidebar/events.ts` 完整 MC 路径（按钮只显示末两段）、`perf.ts` 输入框禁用原因、`cap-controls.ts` 后处理未启用原因 |

**判据一句话**：动作说明 → 本组件；值/状态说明 → 原生 title 不违规。新增 hint 型提示时按上表判，勿机械「见 title 就改」。

## cleanup 丢弃（已知小项，非泄漏）

`attachTooltip` 返回 cleanup，契约是「元素离文档时调用」。实测三个生产调用点（`fab.ts|createIconButton`、`roles-views.ts` 两处）**丢弃返回值**，后果经探针量化（2026-10 happy-dom 实测）：

- 元素级监听（`mouseenter`/`mouseleave`/`blur`）挂在目标元素自身上 → 元素被 GC 时随之消失，**无 DOM 泄漏**；tooltip 节点是单例（`ensureTooltipEl` 复用），也**不累积**
- 唯一残留：`ensureScrollHandler()` 的 `scrollRef` 计数只增不减 → `document` 级 capture 阶段 `scroll` 监听**挂一次后不再摘除**（`scrollRef === 0` 门只让它挂一次，故**有界、非累积**）；该 handler 自身有 `if (st.timer !== null || st.target) hide()` 守卫，空转成本可忽略
- 既有逃生阀：`dispose()` 内 `while (scrollRef > 0) decrementScrollRef()` 会把残留一并归零

**判断：不值得为它做跨模块重构**（引入 per-view cleanup 收集器要改预览菜单引擎的视图装配协议，收益仅一个常驻监听）。真要收口，动机应是「调用点静默丢弃 cleanup 与『本就没 cleanup』在源码上无法区分」这个**可读性**问题，而非泄漏。


## 不变量

- 单例：同一时刻至多一个 tooltip 可见（模块级 `st` 状态）
- z-index = `calc(var(--z-fullscreen, 9999) + 1)`，恒在 3D overlay 之上
- `pointer-events:none`，tooltip 本体永不挡交互
- 文案空字符串不显示；延迟触发前元素脱离 DOM 则放弃显示

## 相关

- [dom-fab](./dom-fab.md) — createIconButton 工厂（title 行为本组件承接）
- [app_preview](./app-preview.md) — 预览面板 FAB 所在组件
