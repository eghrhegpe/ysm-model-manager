# ADR-149：modal.ts 内联样式外提为弹窗类（dialogs.css）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/dom/dialogs/modal.ts`、`frontend/css/components.css`、`frontend/css/dialogs.css`（新增）、`frontend/index.html`

---

## 1. 背景（Context）

`frontend/src/utils/dom/dialogs/modal.ts` 是统一模态弹窗框架（modalPrompt / modalSelect / modalConfirm / modalProgress / modalPicker），承载五类弹窗。源码中存在大量**内联 `style` 属性**（字段框、footer、标题、进度条、picker 行等），与设计系统 `dlg-*` 类（集中在全局 `css/components.css`）割裂：

- 内联样式散落于 `innerHTML` 模板字符串与 `createElement + cssText`，可读性差、难以复用与主题统一；
- 与「长治久安」原则相悖——弹窗样式应作为独立「卡片」治理，而非与组件样式混居 `components.css`。

目标：将**静态装饰样式**外提为语义化 `dlg-*` 类，落到独立 `dialogs.css`，使 modal.ts 回归「结构 + 类」的清晰形态。

**外提边界（关键原则）**：仅外提**编译期可确定的静态属性**；以下**动态值必须保留 inline**（运行时按调用参数或安全策略计算，无法静态化）：

- `box.style.width = width`（modalXxx 的 `width` 选项，逐调用动态）；
- `fill.style.width`（进度条百分比，逐 `update` 动态写入）；
- picker 行 `hint` 的 `color`（经 `safeHintColor()` 白名单校验后的动态安全色，防 CSS 注入）。

## 2. 决策（Decision）

1. **落点**：新建 `frontend/css/dialogs.css`，专放 modal.ts 外提的弹窗类；在 `frontend/index.html` 的 `components.css` `<link>` **之后**追加 `css/dialogs.css`（plain `<link>` 由 vite 正常打包，零构建风险）。
2. **命名**：沿用 `dlg-` 前缀，新增语义类：
   - `dlg-field`（prompt/select 字段框：全宽、内边距 6px 8px、字号 12px、圆角 5px、`box-sizing:border-box`）
   - `dlg-title-flush`（标题 `margin:0` 覆盖，区别于 `components.css` 的 `dlg-title` margin-bottom）
   - `dlg-footer-flush`（footer `padding:0` 覆盖，保留 `dlg-footer` 的 border-top）
   - `dlg-msg`（confirm 消息区：字号 11px、行高 1.5、预包装、max-height 55vh 滚动）
   - `dlg-gap-lg`（box 子项间距 10px，替代 `box.style.gap`）
   - `dlg-prog-pct` / `dlg-prog-track` / `dlg-prog-fill`（进度条三段）
   - `dlg-pick-list` / `dlg-pick-row` / `dlg-pick-meta` / `dlg-pick-sub` / `dlg-pick-hint` / `dlg-pick-subtitle` / `dlg-pick-cancel-wrap`（picker 富列表）
3. **不改** `components.css` 既有 `dlg-*` 规则，避免影响 rename / tag-editor / adv-filter 等复用方。
4. **测试**：TDD 先行——`modal.test.ts` 新增回归块，断言外提后元素**持有新类**且**静态属性不再以内联 style 出现**；`modalPicker` 此前无测试，一并补齐。

## 3. 后果（Consequences）

- **正面**：modal.ts 模板回归「结构 + 类」，可读性、可维护性、主题一致性提升；弹窗样式独立成「卡片」便于治理与复用。
- **负面 / 风险**：全局 CSS 增加一张表（dialogs.css）；`dlg-title-flush` / `dlg-footer-flush` 为覆盖类，依赖加载顺序位于 `components.css` 之后（index.html 已保证）。
- **已知遗留**：`components.css` 中既有 `dlg-*` 与 `dialogs.css` 分两张表，长期可考虑按「框架级 / 业务级」进一步分层，本期不动。

## 4. 数据溯源

- 来源：`modal.ts` 内联 `style` 审计（行 148–149、209–216、280–301、349–356、409–419、428、572–588）→ 结果：静态属性外提至 `dialogs.css` 对应 `dlg-*` 类，动态值保留 inline。
- 来源：`components.css` 既有 `dlg-*` 规则（行 69–350）→ 结果：仅新增类、不改动既有规则，复用方零影响。

<!-- 文件名: modal-ts-dialogs-css.md → 实际文件 ADR-149-modal-ts-dialogs-css.md -->
