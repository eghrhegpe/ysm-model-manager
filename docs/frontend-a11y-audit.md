# 前端无障碍普及率调查报告

> 调查日期：2026 年・范围：`frontend/src/**`（1001 个 TS 源文件）
> 一句话结论：**基础设施已成体系，普及率却只有约三分之一**——关键入口（树、tab、模态框、下拉、菜单）已是高质量实装并有契约测试，但大量业务视图（尤其 diagnostics 面板、settings、sync-manager、app-preview 的大部分分支）尚未接入，且**全仓没有任何自动化无障碍门禁**守卫。

---

## 1. 已量化的覆盖数据

### 1.1 承载 HTML 的 UI 文件分层覆盖率

以「文件中含 HTML 模板/动态 DOM（`<button>/<input>/<div>/<nav>…`）」界定 UI 承载文件，共 88 个；含任意无障碍标记（`aria-*`/`role`/`tabindex`/`sr-only`/`focus()`/`keydown`）者 28 个，**覆盖率 32%（28/88）**。

| 层 | 含 HTML 文件数 | 含 a11y 标记 | 覆盖率 |
|---|---|---|---|
| views | 60 | ~20 | ~33% |
| features | 6 | 3 | 50% |
| preview-3d | 18 | ~4 | ~22% |
| utils/dom・icon・html | ~10 | 5 | ~50% |

> 注：上述「利用率」是**有无标记**的粗扫描。若改用「无 a11y 标记」口径反查，缺口文件共 **63/88**（见 §3 清单）。

### 1.2 键盘可达性（精确匹配）

| 维度 | 文件数 |
|---|---|
| `addEventListener(keydown/keyup/keypress)` 处理 | 26 |
| Escape 关闭处理（`e.key==='Escape'` 等） | 11 |
| `.focus()` 显式焦点管理 | 34 |

### 1.3 原生语义 vs 手写 div

| 类别 | 文件数 |
|---|---|
| 含 `<button>` | 37 |
| 含 `<input>` | 15 |
| 含 `<select>` | 11 |
| 含 `<a href>` | 7 |
| `role="button"`（div 冒充按钮） | 1 |
| `role="menuitem"`（菜单项） | 2 |

> 项目大量优先用原生标签（这是好迹象），div 冒充交互元素仅零星几处（nav、tpl、sync-flow、context-menu 等，均已补 role+tabindex）。

### 1.4 语言与文档层

- `frontend/index.html`：`<html lang="zh-CN">` ✅
- 文档层已有完整规范与历史：`docs/UI-Design.md §17 键盘导航与无障碍`（强制标准+现状表）、`docs/knowledge/*` 记录了 a11y 专项推进（ADR-238 下拉无障碍、ADR-298 工具栏下拉统一、ADR-300 tab 轴、刀⑰–⑱ preview-3d a11y 收口、`focus-restore`/`tabs-a11y` 原语）。
- **无集中式键盘框架、无自动 a11y 检测工具**：`package.json` 无 `axe/pa11y/eslint-a11y/jest-axe`，`scripts/` 无 a11y 门禁脚本。

---

## 2. 高覆盖区（已实装且质量高）

以下是最值得肯定的部分——不是零散贴 aria 标签，而是**成体系的语义实现 + 契约测试**：

| 区域 | 实装 |
|---|---|
| 文件树 `<app-tree>` | `role="tree"`+`role="treeitem"`+`aria-level/aria-selected`，Arrow 上下导航 + Enter 激活（`index.ts`/`row-tpl*.ts`，`index.extra.test.ts` 有回归守卫）|
| Tab 栏 `tabs-a11y.ts` | WAI-ARIA Tabs 原语：tablist/tab/aria-selected、roving tabindex、↑↓ 键盘、`refresh()` 动态重挂，被 init-pages / workshop-tabs / tabs-shell 复用；`role=tab` 残留扫描为 0  |
| 模态框 `utils/dom/modal-*` | 统一 tabIndex/focus 管理，配套 `trap-focus-across-shadow.ts`（跨 Shadow Tab 循环）+ `focus-restore.ts`（记触发元素/还焦点三件套）|
| 下拉 `utils/dom/dropdown.ts`+ADR-298 | `aria-expanded`/`aria-haspopup`，hover 展开退役 → trigger click 展开 |
| 3D 菜单 `slide-menu` | roving tabindex、↑↓ 循环、Enter/Space 激活、Escape 关闭、Home/End、焦点记忆+输入阻断栈（笔迹见 `ui-slide-menu.md` 知识卡）|
| 3D 预览 | `canvas` 焦点问题已修（`ysm-adapter.ts` 注释），`aria-label` 覆盖 FAB，zoom overlay 焦点归还 |
| 全局 | `role="status" aria-live="polite"` 的 toast 容器、`.no-animations`（prefers-reduced-motion）开关 11 文件接入、`focusVisibleCSS` 焦点环（shared-styles）|
| 上下文菜单 | Enter/Space 激活显式接管（WCAG 注脚）、Escape/外部点击关闭 |

---

## 3. 缺口清单（63 个含 HTML 但无 a11y 标记的文件）

### 3.1 按目录聚类

| 目录 | 缺口文件数 | 典型文件 |
|---|---|---|
| `views/app-content/diagnostics/*` | 15 | conflicts / health / logs / perf-* / status-row / dedup-* |
| `views/app-preview/*` | 8 | detail / index / skeleton / mai-3d / mmd-3d / vrm-3d / card-shell / empty-3d |
| `preview-3d/adapters/*` | 6 | fbx / litematic / pack-model / vrm 等 3D 数据适配器（多为渲染管线，非交互，优先级低）|
| `views/app-content/settings/*` | 4 | path-cards / stg-card / tpl-settings* |
| `views/app-content/site/*`+tpl* | 4 | drag / init-github / tpl* / tpl-oldest |
| `features/community/*` | 3 | download-queue-web / render / show-repo-models |
| `views/app-tree/*` | 3 | toolbar-events / toolbar-menus / toolbar-search（toolbar 内下拉/输入框）|
| `views/app-sync-manager/*` | 3 | index / renderer / tpl |
| `views/app-sidebar/*` | 2 | launcher-detect / render |
| `preview-3d/menu/*` 等其余 | ~8 | env 面板 / preview-loading / menu-styles |

### 3.2 值得注意的具体缺口

- **diagnostics 全家桶（15 文件）**是最大空白：perf 基准、并发测试、trace/trend 面板含大量按钮/表格/复选，若给扫描用/测试用户操作，键盘不可达。
- **settings 4 文件**：设置页作为可配置界面，表单控件 label 关联薄弱（全仓 `<label>` 仅 11 文件、`aria-labelledby` 仅 2 文件）。
- **app-preview 8 文件**：3D 查看器分支大量用 div/span 承载交互（虽然 slide-menu 主路径已 a11y）。
- **聚焦环基座对外一致性**：`focus-visible` 仅 6 文件、`:focus` 15 文件——大量自定义交互行未走统一 `focusVisibleCSS`。

### 3.3 已知遗留（文档已自行登记，非本次新发现）

- `docs/knowledge/app_content_diagnostics.md`：诊断页**子 pill 无 role=tab / 无方向键**（嵌套 tablist 反模式 + 键盘可达性欠账），「待全站 a11y 专项」。
- `docs/knowledge/ui-slide-menu.md + utils-dom.md`：2026-08-29 a11y 审查登记的边界测试盲区。
- `docs/UI-Design.md §17.2`：表格「列表/树 Arrow 导航 ❌ 未建立集中式框架」——**此项与现况不符**（app-tree 已实现 Arrow 导航），文档待更新。

---

## 4. 结论与建议

### 结论
1. **普及率约三成**（含 HTML 文件 32% 有 a11y 标记；63/88 无），但**新增代码已受规范约束**——近期的 a11y 收口都落在关键入口并配了契约测试，缺口集中在低交互/数据类视图。
2. **无自动化防线** = 最大结构性风险：整个 a11y 靠人工审查 + ADR/知识卡登记，`doctor`/pre-push 门禁不扫 a11y；一旦回归（如砍掉某 aria 属性）无人拦截。

### 建议（按投入产出排序）
1. **加自动化门禁（最值）**：引入 axe-core（`@axe-core/playwright` 或 `jest-axe`）对主路径（app-tree / tab 栏 / settings / diagnostics）跑静态或 e2e 扫描，把「普及率」从人工盘点变成 CI 常量。Shadow DOM 可用 `axe-core` 的 shadow 支持或逐 shadow root 注入。
2. **优先补齐三类高价值缺口**：diagnostics（工具页）、settings 表单（label 关联）、toolbar 下拉/搜索。
3. **统一 focus-visible**：把散落的 `:focus` 换成 `focusVisibleCSS`（`shared-styles.ts` 既有基座）。
4. **小修文档**：UI-Design §17.2 的「未建立集中式框架」行更新为已部分落地；ADR-300 登记的诊断页 tab 遗留可并入专项。

> 本次为只读调查，未改任何源码；如需推进其中任意建议（尤其 1 号自动化门禁），可作为独立任务继续。