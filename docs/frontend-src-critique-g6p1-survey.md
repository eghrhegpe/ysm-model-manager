# frontend-src 锐评 G6 / P1 勘察报告（2026-09-03）

> 配套 `docs/frontend-src-critique-status.md`（处置状态卡）。本文档为 G6/P1 两排期项的
> **数据化勘察结论**：P1 静态/动态占比盘点、G6 overlay 链类依赖清单与 Shadow DOM 迁移可行性收敛。
> 数据采集脚本见文末"方法"，为一次性只读分析，未改动任何源码。

## 1. 结论速览

| 项 | 结论 | 对处置的影响 |
|---|---|---|
| P1（137→139 处 cssText） | **静态 134 处（96.4%）、动态仅 5 处**——"大量动态插值不可静态化"的先前推断被数据推翻 | 静态为主、可迁率高，搬迁 ROI 上修；且**范式已有链内实证**（render.ts:20） |
| G6（overlay light DOM） | overlay 链 28 个类 token 的样式全部集中在 **2 个可 adoptedStyleSheets 的模块 + 1 个链内注入块**；5 个"无源 token"为无独立规则的语义锚点（内联样式随节点进 shadow 自动生效） | 样式层障碍远小于预期；真实迁移障碍收敛为**测试选择器 + 事件/焦点**，可独立立项 |

## 2. P1：style.cssText 静态/动态占比盘点

采集范围：`frontend/src/**/*.ts`（排除 .test./.d.ts），共 **139 处** `style.cssText`（锐评原文 137，实测 139——含语句内多次赋值）。
分类启发式：语句内含 `${}` 模板插值或引号串外变量拼接 → 动态；否则静态（纯字面量可类化）。

### 2.1 总量与区域分布

| 区域 | 总处 | 静态 | 动态 | 静态占比 |
|---|---|---|---|---|
| preview-3d/menu（菜单链） | 98 | 95 | 3 | 96.9% |
| 其余（adapters/views/ui） | 41 | 39 | 2 | 95.1% |
| **合计** | **139** | **134** | **5** | **96.4%** |

### 2.2 逐文件 Top（静态 ≥5）

| 文件 | 总处 | 静态 | 动态 |
|---|---|---|---|
| preview-3d/menu/cap-controls.ts | 38 | 35 | 3 |
| preview-3d/menu/roles.ts | 18 | 18 | 0 |
| preview-3d/menu/render.ts | 16 | 16 | 0 |
| preview-3d/menu/env.ts | 14 | 14 | 0 |
| preview-3d/adapters/vrm-bone-ui.ts | 7 | 6 | 1 |
| preview-3d/menu/switch.ts | 7 | 7 | 0 |
| views/app-preview/skeleton-fill-panel.ts | 6 | 5 | 1 |
| preview-3d/adapters/mount-preview-core.ts | 5 | 5 | 0 |
| preview-3d/menu/core.ts | 5 | 5 | 0 |
| preview-3d/adapters/camera-controls.ts | 4 | 4 | 0 |

### 2.3 动态 5 处定位（本不可静态化，迁移时豁免）

`cap-controls.ts` ×3（滑块进度/宽度百分比插值）、`vrm-bone-ui.ts` ×1、`skeleton-fill-panel.ts` ×1。

### 2.4 范式实证（重要）

`preview-3d/menu/render.ts:20` 注释自述：**"把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串"**
——render.ts 已实践 P1 目标形态：文件内建 `<style>` 注入（`document.createElement("style")` → `textContent` 类规则：
`.cap-section-header` / `.cap-section-arrow` / `.menu-divider` 等），构建器改用 className。P1 迁移 = 把该链内范式
推广为共享样式注入模块（对齐 installUiComponentsStyles 幂等注入模式），而非另造新机制。

### 2.5 P1 建议批次（供排期参考）

1. 首推 menu 区静态 95 处：cap-controls(35)+roles(18)+env(14)+switch(7)+core(5) 等 → 抽共享类；
2. 风险点：node-render 核心测试路径（render.ts/roles.ts）若有 cssText 断言需同步；迁移前先跑定向测试摸底；
3. 动态 5 处保持内联，不强行类化。

## 3. G6：overlay 链类依赖清单与迁移可行性

采集范围：overlay 整链 DOM 构建器（menu/*.ts 11 文件 + mount-preview-core.ts + ui/ui-slide-menu.ts + ui/ui-helpers.ts）。
共提取 **28 个唯一类 token**（17 处应用最多的为 slide-item/slide-label，属 🥉 行组件类）。

### 3.1 token 定义源归属（三类）

| 归属 | token 数 | token 明细 |
|---|---|---|
| ① 可 adoptedStyleSheets 的样式模块（ui-components-styles.ts / ui-slide-menu-styles.ts） | 18 | slide-item, slide-label, slide-icon, slide-sublabel, slide-list, slide-menu, slide-viewport, slide-header, slide-back, slide-title, slide-panel, menu-wrapper, render-card, field-row, field-label, field-value, section-title, setting-select |
| ② 链内 `<style>` 注入块（render.ts 自建样式注入，同 P1 范式） | 3 | cap-section-header, cap-section-arrow, menu-divider |
| ③ 无独立 CSS 规则的**语义锚点类**（样式靠内联 cssText 或 ui 模块组合类） | 5 | cap-section, cap-section-body, ysm-preview-menu, ysm-preview-menu-row, preview-view-container |

另有 2 个 dock 类（preview-dock-nav / preview-dock-navbtn）定义于 `utils/dom/fab.ts` 的样式串——属 dock 导航自身注入，
非菜单链样式依赖。

### 3.2 关键裁定

- **样式层迁移障碍远小于预期**：①类已在两个**可整体 adoptedStyleSheets** 的模块中（消费方式注释自证
  "Shadow DOM 组件：root.adoptedStyleSheets = [...]"）；②类随 render.ts 注入块——shadow 化时把该注入块
  改挂 shadow root 或并入 adopted sheet 即可；③类无规则，且其视觉完全来自**内联 style.cssText**
  （如 mount-preview-core 的 viewContainer 同设 className + style.cssText）——内联样式随节点进入 shadow root
  **自动生效**，不受影响。
- 全仓无 .css 文件、无 css import：样式 100% 走 JS 注入（installUiComponentsStyles / installSlideMenuStyles /
  render.ts 注入块），shadow 化只需把这几处注入目标从 document.head 改为 shadow root，无需搬运大样式面。
- 结构性定位：全站 UI 组件（app-content/nav/preview/sidebar/tree/toast/context-menu）均 attachShadow，
  唯独 `#ysm-overlay-3d`（mount-preview-core.ts:351-374）挂 document.body light DOM + 链内 slide 菜单无 shadow。

### 3.3 G6 真实迁移障碍（收敛后清单）

1. **测试选择器**：`app-tree/index.ts:296` 以 `document.getElementById(PREVIEW_OVERLAY_ID)` 守卫（host 保留 id 即可兼容）；
   测试查询 util `scope()` **优先 container.shadowRoot**——doc 级查询需改传 host；e2e 真实选择器需 shadow 穿透；
2. **事件/焦点**：trapFocusAcrossShadow 已具备跨 shadow 能力（注释自证防御性设计），overlay aria 属性移到 host；
3. **样式注入目标迁移**：上述 3 类注入点 document.head → shadow root（或 adoptedStyleSheets）。

## 4. 对处置状态卡的修正

- P1 行"机械搬迁面大 / 大量动态插值"→ 修正为：**静态 96.4%，动态仅 5 处**，范式有链内实证（render.ts:20），搬迁 ROI 上修；
- G6 行"前置=菜单全局类依赖清单"→ 收敛为：**类依赖已盘点完毕（本文档 §3）**，前置改为"选择器/事件迁移清单"，
  样式层障碍已排除，可进入独立立项设计。

## 5. 方法

- 一次性 Node 只读脚本：遍历 src/**/*.ts → ①对每处 `style.cssText` 语句做引号/模板串状态机切段，
  动态判定=`${}` 或引号外变量拼接（启发式，139 处为语句级计数，可能略异于行级 137）；②对 overlay 链文件提取
  `className=`/`classList.*(` 字面量 token → 全仓（排除链内）搜 `.token` 选择器定位定义源；
- 定义源③（无规则锚点类）经全仓 `.token{`/组合选择器复查 + 关键文件人工核读确认；
- 数据快照：2026-09-03 23:47（HEAD `de15199e` 之后）。采集脚本为临时件，未入库。
