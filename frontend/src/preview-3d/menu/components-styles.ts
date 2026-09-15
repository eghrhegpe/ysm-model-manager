// 🥉 ui-helpers 组件库样式（MikuMikuAR app.css 迁移产物；迁移脚本属 MikuMikuAR 上游，
// 本仓无再生管线——改样式直接手工编辑本字符串，并在 ui-components-styles.test.ts 补契约断言）。
// 消费方式：
//  - Shadow DOM 组件：root.adoptedStyleSheets = [componentsStyleSheet, ...others];
//  - 全局/light-DOM：installComponentsStyles() 会把样式注入 document.head 一次。

export const componentsCss = `/* ===== 🥉 ui-helpers 组件库样式（自 MikuMikuAR app.css 迁移，ADR 去桶化配套） ===== */
/* 专用 token 加 --uih- 命名空间以防与 ysm 全局主题冲突；撞色 token 已映射为 ysm 等价变量。 */
:root {
  --uih-font-ui-sm: 11px;
  --uih-white-40: rgba(255, 255, 255, 0.4);
  --uih-toggle-row-gap: 8px;
  --uih-slide-item-pad-y: 6px;
  --uih-content-px: 12px;
  --uih-slide-item-min-height: 38px;
  --uih-toggle-row-margin-bottom: 2px;
  --uih-cs-label-font-size: 15px;
  --uih-slide-item-gap: 8px;
  --uih-slide-item-pad-x: var(--uih-content-px);
  --uih-font-ui: 13px;
  --uih-slide-item-radius: 6px;
  --uih-slide-item-margin-bottom: 2px;
  --uih-card-hover: rgba(255, 255, 255, 0.1);
  --uih-card-active: rgba(255, 255, 255, 0.16);
  --uih-accent-dim: rgba(74, 108, 247, 0.2);
  --uih-slide-icon-size: 21px;
  --uih-white-08: rgba(255, 255, 255, 0.08);
  --uih-font-time: 12px;
  --uih-font-title: 14px;
  --uih-font-ui-xs: 10px;
  --uih-white-04: rgba(255, 255, 255, 0.04);
  --uih-white-12: rgba(255, 255, 255, 0.12);
  --uih-mode-btn-pad-y: 0.3em;
  --uih-mode-btn-pad-x: 0.7em;
  --uih-mode-btn-radius: 4px;
  --uih-white-16: rgba(255, 255, 255, 0.16);
  --uih-preset-chip-pad-y: 4px;
  --uih-preset-chip-pad-x: 12px;
  --uih-preset-chip-height: 28px;
  --uih-preset-chip-radius: 6px;
  --uih-preset-chip-icon-size: 14px;
  --uih-preset-chip-gap: 6px;
  --uih-preset-chip-group-pad: 6px var(--uih-content-px)
        10px;
  --uih-section-title-font-size: 11px;
  --uih-section-title-pad-y: 8px;
  --uih-section-title-pad-x: var(--uih-content-px);
  --uih-section-title-pad-bottom: 4px;
  --uih-section-title-border-bottom: 1px solid var(--uih-white-06);
  --uih-section-title-margin-bottom: 2px;
  --uih-section-title-letter-spacing: 0.3px;
  --uih-collapsible-header-gap: 8px;
  --uih-collapsible-header-pad-y: 6px;
  --uih-collapsible-header-pad-x: var(--uih-content-px);
  --uih-collapsible-header-radius: 6px;
  --uih-collapsible-header-min-height: 38px;
  --uih-collapsible-icon-size: 21px;
  --uih-collapsible-arrow-size: 12px;
  --uih-collapsible-panel-transition: max-height 0.3s ease, opacity 0.25s ease;
  --uih-collapsible-inner-pad: 2px 0 4px;
  --uih-white-05: rgba(255, 255, 255, 0.05);
  --uih-white-10: rgba(255, 255, 255, 0.1);
  --uih-white-06: rgba(255, 255, 255, 0.06);
  --uih-cs-row-pad-y: 8px;
  --uih-cs-row-pad-x: var(--uih-content-px);
  --uih-cs-row-pad-bottom: 6px;
  --uih-cs-row-min-height: 44px;
  --uih-cs-row-radius: 6px;
  --uih-cs-top-gap: 10px;
  --uih-cs-bar-height: 6px;
  --uih-cs-bar-radius: 3px;
  --uih-card-bg: #12121e;
}

/* 危险文字统一样式 */
.danger-text {
    color: var(--status-error);
}

.danger-text:hover {
    color: var(--status-error);
}

.accent-text {
    color: var(--accent);
}

/* 空状态行 — 灰色、不可点击 */
.slide-item-muted {
    opacity: 0.5;
    font-size: var(--uih-font-ui-sm);
    cursor: default;
}

.slide-item-muted:hover {
    background: transparent;
}

/* 危险操作按钮（红色） */
.slide-act-danger {
    color: var(--status-error);
}

.slide-act-danger:hover {
    color: var(--status-error);
}

/* 开关 (toggle) */
.toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 36px;
    height: 20px;
    cursor: pointer;
}

.toggle input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle .slider {
    position: absolute;
    inset: 0;
    background: var(--muted);
    border-radius:var(--radius-xl);
    transition:var(--tr-normal);
}

.toggle .slider::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 2px;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    transition:var(--tr-normal);
}

.toggle input:checked + .slider {
    background: var(--accent);
}

.toggle input:checked + .slider::before {
    transform: translateX(16px);
}

/* Header toggle — 嵌入 collapsible-header 的紧凑 toggle */
.toggle.header-toggle {
    width: 30px;
    height: 16px;
    flex-shrink: 0;
    margin: 0 4px;
}

.toggle.header-toggle .slider::before {
    width: 12px;
    height: 12px;
}

.toggle.header-toggle input:checked + .slider::before {
    transform: translateX(14px);
}

/* Disabled toggle (e.g. WebGL 2.0 required) */
.toggle.header-toggle.toggle-disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.toggle.header-toggle.toggle-disabled .slider {
    background: var(--uih-white-40) !important;
}

/* Icon fallback (shown when Iconify icon fails to load) */
.cs-icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius:var(--radius-sm);
    background: var(--accent-dim, rgba(255, 255, 255, 0.12));
    color: var(--text-dim, #aaa);
    font-size:var(--fs-sm);
    font-weight: 600;
    flex-shrink: 0;
}

/* Toggle row layout (replaces inline styles in addToggleRow) */
.toggle-row {
    display: flex;
    align-items: center;
    gap: var(--uih-toggle-row-gap);
    padding: var(--uih-slide-item-pad-y) var(--uih-content-px);
    min-height: var(--uih-slide-item-min-height);
    margin-bottom: var(--uih-toggle-row-margin-bottom);
    justify-content: space-between;
    cursor: pointer;
}

.toggle-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

.toggle-label {
    font-size: var(--uih-cs-label-font-size);
    color: var(--txt);
}

/* renderCustom 内容区域：背景由调用方自行决定，避免与外层卡片容器双重叠加 */
.slide-list.render-card {
    flex: 1;
}

.slide-list.render-card .cs-row {
    margin-left: 0;
    margin-right: 0;
}

.slide-item {
    display: flex;
    align-items: center;
    gap: var(--uih-slide-item-gap);
    padding: var(--uih-slide-item-pad-y) var(--uih-slide-item-pad-x);
    cursor: pointer;
    transition:var(--tr-fast);
    font-size: var(--uih-font-ui);
    color: var(--txt);
    line-height: 1.4;
    min-height: var(--uih-slide-item-min-height);
    border-radius: var(--uih-slide-item-radius);
    margin-bottom: var(--uih-slide-item-margin-bottom);
}

.slide-item:hover {
    background: var(--uih-card-hover);
}

.slide-item:active {
    background: var(--uih-card-active);
}

.slide-item.slide-focused,
.collapsible-header.slide-focused {
    background: var(--uih-card-hover);
    outline: 1px solid var(--uih-accent-dim);
    outline-offset: -1px;
}

.slide-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--txt);
}

.slide-icon iconify-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    font-size: var(--uih-slide-icon-size);
    display: block;
}

/* 统一左侧行为区按钮：复用 .slide-icon 尺寸（21px）的透明可点击按钮，
   保持 radio 指示图标视觉一致；非 22px 盒装 .slide-add-btn。 */
.slide-lead-btn {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius:var(--radius-sm);
    transition:var(--tr-fast);
}

.slide-lead-btn:hover {
    background: var(--uih-white-08);
}

.slide-lead-btn iconify-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    font-size: var(--uih-slide-icon-size);
    display: block;
}

.slide-label {
    flex: 1;
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 16px;
}

.slide-label.wrap-2 {
    white-space: normal;
    word-break: break-all;
    flex-shrink: 1;
    overflow: visible;
    text-overflow: unset;
    line-height: 1.2;
}

.slide-sublabel {
    font-size: var(--uih-font-ui-sm);
    color: var(--txt);
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
}

.slide-sublabel-inline {
    margin-left: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
}

.slide-arrow {
    color: var(--txt);
    font-size: var(--uih-font-time);
    flex-shrink: 0;
    margin-left: 4px;
}

/* Field label/value — 键值字段行（替代 inline style） */
.field-label {
    flex: none !important;
    color: var(--muted) !important;
}

.field-value {
    text-align: right;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size:var(--fs-sm);
    color: var(--txt);
}

/* key-value 字段行（addFieldRow）：纯展示信息，无需 38px 触控热区，压缩为紧凑行 */
.field-row {
    min-height: 24px;
    padding-top: 2px;
    padding-bottom: 2px;
    margin-bottom: 0;
    cursor: default;
}

.field-row:hover {
    background: transparent;
}

/* 隐藏左侧空图标占位后，将值推至行尾右对齐 */
.field-row .field-value {
    margin-left: auto;
}

/* 基本信息区：响应式信息卡网格（auto-fill，窄屏 2 列、宽屏自动加列） */
.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px;
}

.info-card {
    background: rgba(255, 255, 255, 0.06);
    border: 0.5px solid rgba(255, 255, 255, 0.1);
    border-radius:var(--radius-md);
    padding: 6px 8px;
    min-width: 0;
    overflow: hidden;
}

.info-card--wide {
    grid-column: 1 / -1;
}

.info-card-label {
    font-size:var(--fs-md);
    color: var(--muted);
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.info-card-value {
    font-size: var(--uih-font-title);
    font-weight: 600;
    color: var(--txt);
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.info-card-sub {
    font-size: var(--uih-font-ui-xs);
    color: var(--muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.slide-add-btn {
    cursor: pointer;
    margin-left: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius:var(--radius-sm);
    font-size: var(--uih-font-ui);
    background: var(--uih-white-04);
    transition:var(--tr-normal);
    flex-shrink: 0;
    user-select: none;
}

.slide-add-btn:hover {
    background: var(--uih-white-12);
}

/* 修复：trailing/del 按钮内的 iconify 图标需显式尺寸，否则回退 1em(≈--font-ui)
 * 在 22px 盒内显得又小又空；与左侧 .slide-lead-btn 21px 对齐。 */
.slide-add-btn iconify-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    font-size: var(--uih-slide-icon-size);
    display: block;
}

/* Mode selection buttons (shadow type, sky mode, etc.) */
.mode-btn {
    font-size: var(--uih-font-ui);
    padding: var(--uih-mode-btn-pad-y) var(--uih-mode-btn-pad-x);
    line-height: 1.3;
    border-radius: var(--uih-mode-btn-radius);
    border: 1px solid var(--uih-white-08);
    background: transparent;
    color: var(--txt);
    cursor: pointer;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.mode-btn:hover {
    background: var(--uih-white-08);
    border-color: var(--uih-white-16);
}

.mode-btn:active {
    background: var(--uih-white-16);
}

.mode-btn.active {
    background: var(--accent);
    border-color: var(--accent);
}

.mode-btn.active:hover {
    background: var(--accent);
    filter: brightness(1.15);
}

/* ===== Compact Slider (zone-click bar) ===== */
.preset-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: var(--uih-preset-chip-pad-y) var(--uih-preset-chip-pad-x);
    height: var(--uih-preset-chip-height);
    border-radius: var(--uih-preset-chip-radius);
    border: 1px solid var(--uih-white-08);
    background: transparent;
    color: var(--txt);
    font-size: var(--uih-font-ui-sm);
    cursor: pointer;
    transition:var(--tr-normal);
    white-space: nowrap;
    user-select: none;
    line-height: 1;
}

.preset-chip:hover {
    background: var(--uih-white-08);
    border-color: var(--uih-white-16);
    color: var(--txt);
}

.preset-chip:active {
    transform: scale(0.96);
    background: var(--uih-white-12);
}

.preset-chip.active {
    border-color: var(--accent);
    background: var(--uih-accent-dim);
    color: var(--accent);
}

/* 危险动作按钮（清除全部等破坏性操作）— 红底强调 */
.preset-chip.danger {
    background: var(--status-error);
    border-color: var(--status-error);
    color: #fff;
}

.preset-chip.danger:hover {
    background: var(--status-error);
    border-color: var(--status-error);
    color: #fff;
    filter: brightness(1.1);
}

/* 只读标签（程序化激活徽标等）— 不可点击 */
.preset-chip.badge {
    cursor: default;
    background: var(--uih-white-08);
    opacity: 0.85;
}

.preset-chip.badge:hover,
.preset-chip.badge:active {
    background: var(--uih-white-08);
    border-color: var(--uih-white-08);
    color: var(--txt);
    transform: none;
}

.preset-chip.wrap-2 {
    white-space: normal;
    height: auto;
    min-height: var(--uih-preset-chip-height);
    line-height: 1.2;
    max-width: 140px;
    text-align: left;
    justify-content: flex-start;
}

.preset-chip iconify-icon {
    width: var(--uih-preset-chip-icon-size);
    height: var(--uih-preset-chip-icon-size);
    font-size: var(--uih-preset-chip-icon-size);
    display: block;
}

.preset-group {
    display: flex;
    gap: var(--uih-preset-chip-gap);
    flex-wrap: wrap;
    padding: var(--uih-preset-chip-group-pad);
}

/* ===== Section 分区标题 ===== */
.section-title {
    font-size: var(--uih-section-title-font-size);
    color: var(--txt);
    padding: var(--uih-section-title-pad-y) var(--uih-section-title-pad-x) var(--uih-section-title-pad-bottom);
    border-bottom: var(--uih-section-title-border-bottom);
    margin-bottom: var(--uih-section-title-margin-bottom);
    letter-spacing: var(--uih-section-title-letter-spacing);
}

/* ===== Collapsible 通用折叠组件 ===== */
.collapsible-wrapper {
    margin-bottom: 2px;
}

.collapsible-header {
    display: flex;
    align-items: center;
    gap: var(--uih-collapsible-header-gap);
    padding: var(--uih-collapsible-header-pad-y) var(--uih-collapsible-header-pad-x);
    cursor: pointer;
    user-select: none;
    border-radius: var(--uih-collapsible-header-radius);
    transition:var(--tr-fast);
    min-height: var(--uih-collapsible-header-min-height);
}

.collapsible-header:hover {
    background: var(--uih-card-hover);
}

.collapsible-header:active {
    background: var(--uih-card-active);
}

.collapsible-icon {
    width: var(--uih-collapsible-icon-size);
    height: var(--uih-collapsible-icon-size);
    flex-shrink: 0;
    color: var(--txt);
    display: flex;
    align-items: center;
    justify-content: center;
}

.collapsible-icon iconify-icon {
    width: var(--uih-collapsible-icon-size);
    height: var(--uih-collapsible-icon-size);
    font-size: var(--uih-collapsible-icon-size);
    display: block;
}

.collapsible-label {
    flex: 1;
    font-size: var(--uih-cs-label-font-size);
    color: var(--txt);
}

/* 折叠头 + toggle-row 字体放大，与 cs-row 的 15px 区分 */
.collapsible-header .collapsible-label,
.toggle-label {
    font-size: 16px;
}

.collapsible-arrow {
    font-size: var(--uih-collapsible-arrow-size);
    color: var(--txt);
    transition: transform var(--tr-normal);
    flex-shrink: 0;
}

.collapsible-panel {
    overflow: hidden;
    max-height: 0;
    transition: var(--uih-collapsible-panel-transition);
    opacity: 0;
}

.collapsible-panel.open {
    opacity: 1;
}

.collapsible-inner {
    padding: var(--uih-collapsible-inner-pad);
}

/* Collapsible — mat variant（材质分类用，灰色小按钮风格） */
.collapsible-header.collapsible-mat {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 10px;
    margin-top: 6px;
    border-radius:var(--radius-md);
    font-size: var(--uih-font-ui-sm);
    color: var(--muted);
    background: var(--uih-white-05);
    border: 1px solid var(--uih-white-08);
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
    min-height: auto;
}

.collapsible-header.collapsible-mat:hover {
    background: var(--uih-white-10);
    color: var(--txt);
    border-color: var(--uih-white-12);
}

.collapsible-header.collapsible-mat:active {
    background: var(--uih-white-16);
}

.collapsible-header.collapsible-mat .collapsible-icon {
    width: auto;
    height: auto;
    color: inherit;
}

.collapsible-header.collapsible-mat .collapsible-icon iconify-icon {
    width: var(--uih-font-ui-sm);
    height: var(--uih-font-ui-sm);
    font-size: var(--uih-font-ui-sm);
}

.collapsible-header.collapsible-mat .collapsible-label {
    flex: 0 0 auto;
    font-size: inherit;
    color: inherit;
}

.collapsible-header.collapsible-mat .collapsible-arrow {
    font-size: var(--uih-font-ui-xs);
    margin-left: 2px;
}

.collapsible-panel.mat-slider-panel {
    margin-top: 6px;
    padding: 6px 0 0;
    border-top: 1px solid var(--uih-white-06);
}

.collapsible-panel.mat-slider-panel.open {
    opacity: 1;
}

.cs-row {
    padding: var(--uih-cs-row-pad-y) var(--uih-cs-row-pad-x) var(--uih-cs-row-pad-bottom);
    cursor: pointer;
    transition:var(--tr-fast);
    user-select: none;
    min-height: var(--uih-cs-row-min-height);
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-radius: var(--uih-cs-row-radius);
}

.cs-row:hover {
    background: var(--uih-card-hover);
}

.cs-row:active {
    background: var(--uih-card-active);
}

.cs-top {
    display: flex;
    align-items: center;
    gap: var(--uih-cs-top-gap);
    margin-bottom: 4px;
}

.cs-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    flex-shrink: 0;
    color: var(--txt);
}

.cs-icon iconify-icon {
    width: var(--uih-slide-icon-size);
    height: var(--uih-slide-icon-size);
    font-size: var(--uih-slide-icon-size);
    display: block;
}

.cs-label {
    flex: 1;
    font-size: var(--uih-cs-label-font-size);
    color: var(--txt);
}

.cs-value {
    font-size: var(--uih-font-title);
    color: var(--txt);
    font-variant-numeric: tabular-nums;
}

/* standalone / cs-row column: explicit width fills parent */
.cs-bar {
    width: 100%;
    height: var(--uih-cs-bar-height);
    background: var(--uih-white-12);
    border-radius: var(--uih-cs-bar-radius);
    overflow: visible;
    position: relative;
    cursor: pointer;
    box-shadow:
        inset 0 1px 2px rgba(0, 0, 0, 0.3),
        0 0 0 1px rgba(255, 255, 255, 0.06);
}

/* clr-row flex context: bar fills remaining inline space */
.clr-row .cs-bar {
    flex: 1;
    width: auto;
}

.cs-bar::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 50%;
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.08), transparent);
    border-radius: var(--uih-cs-bar-radius) var(--uih-cs-bar-radius) 0 0;
    pointer-events: none;
}

.cs-bar::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: repeating-linear-gradient(
        90deg,
        transparent,
        transparent 4px,
        rgba(255, 255, 255, 0.04) 4px,
        rgba(255, 255, 255, 0.04) 5px
    );
    border-radius: var(--uih-cs-bar-radius);
    pointer-events: none;
}

.cs-bar:focus-visible {
    /* box-shadow 提供键盘焦点视觉指示，优先级高于全局 :focus-visible outline */
    box-shadow:
        inset 0 1px 2px rgba(0, 0, 0, 0.3),
        0 0 0 2px var(--accent),
        0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
}

.cs-fill {
    height: 100%;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 80%, transparent), var(--accent));
    border-radius: var(--uih-cs-bar-radius);
    transition: width 0.06s linear;
    pointer-events: none;
    position: relative;
    overflow: hidden;
}

.cs-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 50%;
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.3), transparent);
    border-radius: var(--uih-cs-bar-radius) var(--uih-cs-bar-radius) 0 0;
}

.cs-fill::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
    animation: csShimmer 2s infinite;
}

.cs-thumb {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--accent);
    border-radius: 1px;
    transform: translateX(-50%);
    pointer-events: none;
    transition: left 0.06s linear;
}

/* Slider dropdown panel (collapsed by default) */
.mat-slider-panel {
    margin-top: 6px;
    padding: 6px 0 0;
    border-top: 1px solid var(--uih-white-06);
}

/* Batch category slider context */
.mat-cat-slider .cs-row {
    background: var(--uih-card-bg);
}

.mat-cat-slider .cs-row:hover {
    background: var(--uih-card-hover);
}

/* Per-material slider context */
.mat-mat-slider .cs-row {
    background: var(--uih-white-04);
    border: 1px solid var(--uih-white-06);
}

.mat-mat-slider .cs-row:hover {
    background: var(--uih-card-hover);
}

/* ===== Color Picker ===== */
.clr-block {
    padding: 0 var(--uih-content-px) 10px;
}

.clr-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.clr-title {
    font-size: var(--uih-font-title);
    color: var(--txt);
}

.clr-swatch {
    width: 18px;
    height: 18px;
    border-radius:var(--radius-sm);
    border: 1px solid var(--uih-white-08);
    flex-shrink: 0;
}

.clr-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
}

.clr-channel {
    font-size: var(--uih-font-ui-sm);
    font-weight: 600;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
}

.clr-value {
    font-size: var(--uih-font-ui-sm);
    color: var(--txt);
    width: 28px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* ===== Vector3 Slider ===== */
.vec3-block {
    padding: 0 var(--uih-content-px) 10px;
}

.vec3-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.vec3-title {
    font-size: var(--uih-font-title);
    color: var(--txt);
}

.vec3-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
}

.vec3-axis {
    font-size: var(--uih-font-ui-sm);
    font-weight: 600;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
}

.vec3-value {
    font-size: var(--uih-font-ui-sm);
    color: var(--txt);
    width: 36px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* Shadow type selector */
.type-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.type-label {
    font-size: var(--uih-font-ui-sm);
    color: var(--muted);
    width: 60px;
}


/* 下拉选择框 */
.setting-select {
    flex: 1;
    padding: 4px 8px;
    border-radius:var(--radius-md);
    font-size:var(--fs-base);
}

.diag-model-chips .preset-chip {
    font-size: var(--uih-font-ui-xs);
    padding: 2px 8px;
}
`;

// 顶层初始化包：happy-dom/vitest 等无 CSSStyleSheet 的环境 import 即崩，会连带所有 import 本库的模块测试失败。
// 样式注入（installComponentsStyles）走 style 标签，不依赖 _sheet，失败仅影响 shadow 组件。
// 脚手架由 style-install.ts 统一提供，勿在此手写 try/catch + _sheet + _installed 三件套。
import { createInstallableStyles } from "./style-install.ts";

const { sheet: componentsStyleSheet, install: installComponentsStyles } = createInstallableStyles(
  componentsCss,
  "data-ui-helpers",
  "ui-components",
);

export { componentsStyleSheet, installComponentsStyles };
