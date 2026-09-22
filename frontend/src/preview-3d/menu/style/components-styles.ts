// 🥉 ui-helpers 组件库样式（MikuMikuAR app.css 迁移产物；迁移脚本属 MikuMikuAR 上游，
// 本仓无再生管线——改样式直接手工编辑本字符串，并在 ui-components-styles.test.ts 补契约断言）。
// 消费方式：
//  - Shadow DOM 组件：root.adoptedStyleSheets = [componentsStyleSheet, ...others];
//  - 全局/light-DOM：installComponentsStyles() 会把样式注入 document.head 一次。

import { wsIconCSS } from "@/utils/dom/css.ts";

export const componentsCss = `/* ===== 🥉 ui-helpers 组件库样式（自 MikuMikuAR app.css 迁移，ADR 去桶化配套） ===== */
/* 专用 token 加 --uih- 命名空间以防与 ysm 全局主题冲突；撞色 token 已映射为 ysm 等价变量。 */
:root {
  /* 白色透明度三档（原 04/05/06/08/10/12/16/40 八档视觉难分辨，收敛为三档） */
  --uih-white-weak: rgba(255, 255, 255, 0.05);
  --uih-white-medium: rgba(255, 255, 255, 0.1);
  --uih-font-ui-sm: calc(11px + var(--fs-scale));
  --uih-font-lg: calc(16px + var(--fs-scale));
  /* 卡片不透明底：3D 菜单内滑块/分类行需实底遮挡底层网格（区别于玻璃卡背景）。 */
  --uih-card-bg: #12121e;
  --uih-slide-item-pad-y: 6px;
  --uih-content-px: 12px;
  --uih-slide-item-min-height: calc(38px + var(--fs-scale) * 1);
  --uih-cs-label-font-size: calc(15px + var(--fs-scale));
  --uih-font-ui: calc(13px + var(--fs-scale));
  --uih-card-hover: rgba(255, 255, 255, 0.1);
  --uih-card-active: rgba(255, 255, 255, 0.16);
  --uih-accent-dim: rgba(74, 108, 247, 0.2);
  --uih-slide-icon-size: calc(21px + var(--fs-scale) * 1.2);
  --uih-font-title: calc(14px + var(--fs-scale));
  --uih-font-ui-xs: calc(10px + var(--fs-scale));
  --uih-preset-chip-height: calc(28px + var(--fs-scale) * 1);
  --uih-preset-chip-icon-size: calc(14px + var(--fs-scale) * 1.2);
  --uih-collapsible-icon-size: calc(21px + var(--fs-scale) * 1.2);
}

/* ===== .ws-icon（UI_ICONS SVG 的尺寸/着色唯一出处，ADR-238）=====
 * 3D overlay 是本串最主要（也是唯一）的 shadow 根 adopt 方；图标只能吃 shadow 内可达的规则。
 * 漏带后果不是「巨块」而是 **0×0 彻底不可见**——.slide-icon 是 flex 容器，无 width:1em 的
 * SVG 自动尺寸为 0（2026-09-16 实测 computed fill=rgb(0,0,0) / stroke=none / box=0x0）。
 * 与 utils/dom/css.ts|wsIconCSS、全局 css/components.css 副本同源，勿就地改写规则本体。 */
${wsIconCSS}
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
    background: rgba(255, 255, 255, 0.4) !important;
}

/* Icon fallback (shown when Iconify icon fails to load) */
.cs-icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius:var(--radius-sm);
    /* 3D 深色玻璃场景主题无关，用本文件 --uih-* 域（原 --accent-dim/--text-dim 为文档主题变量，
       全仓无定义且与 3D 深底语义不符——2026-09 悬空引用收敛归位） */
    background: var(--uih-white-medium);
    color: rgba(255, 255, 255, 0.85);
    font-size:var(--fs-sm);
    font-weight: 600;
    flex-shrink: 0;
}

/* Toggle row layout (replaces inline styles in addToggleRow) */
.toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: var(--uih-slide-item-pad-y) var(--uih-content-px);
    min-height: var(--uih-slide-item-min-height);
    margin-bottom: 2px;
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
    gap: 8px;
    padding: var(--uih-slide-item-pad-y) var(--uih-content-px);
    cursor: pointer;
    transition:var(--tr-fast);
    font-size: var(--uih-font-ui);
    color: var(--txt);
    line-height: 1.4;
    min-height: var(--uih-slide-item-min-height);
    border-radius:var(--radius-md);
    margin-bottom: 2px;
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
    background: var(--uih-white-medium);
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
    font-size: var(--uih-font-lg);
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
    font-size: calc(12px + var(--fs-scale));
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
    background: var(--uih-white-weak);
    transition:var(--tr-normal);
    flex-shrink: 0;
    user-select: none;
}

.slide-add-btn:hover {
    background: var(--uih-white-medium);
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
    padding: 0.3em 0.7em;
    line-height: 1.3;
    border-radius:var(--radius-sm);
    border: 1px solid var(--uih-white-medium);
    background: transparent;
    color: var(--txt);
    cursor: pointer;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.mode-btn:hover {
    background: var(--uih-white-medium);
    border-color: var(--uih-white-medium);
}

.mode-btn:active {
    background: var(--uih-white-medium);
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
    padding: var(--btn-padding-filter);
    height: var(--uih-preset-chip-height);
    border-radius:var(--radius-md);
    border: 1px solid var(--uih-white-medium);
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
    background: var(--uih-white-medium);
    border-color: var(--uih-white-medium);
    color: var(--txt);
}

.preset-chip:active {
    transform: scale(0.96);
    background: var(--uih-white-medium);
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
    background: var(--uih-white-medium);
    opacity: 0.85;
}

.preset-chip.badge:hover,
.preset-chip.badge:active {
    background: var(--uih-white-medium);
    border-color: var(--uih-white-medium);
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
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px var(--uih-content-px) 10px;
}

/* ===== Section 分区标题 ===== */
.section-title {
    font-size: calc(11px + var(--fs-scale));
    color: var(--txt);
    padding: 8px var(--uih-content-px) 4px;
    border-bottom: 1px solid var(--uih-white-weak);
    margin-bottom: 2px;
    letter-spacing: 0.3px;
}

/* ===== Collapsible 通用折叠组件 ===== */
.collapsible-wrapper {
    margin-bottom: 2px;
}

.collapsible-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px var(--uih-content-px);
    cursor: pointer;
    user-select: none;
    border-radius:var(--radius-md);
    transition:var(--tr-fast);
    min-height: calc(38px + var(--fs-scale) * 1);
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
    font-size: var(--uih-font-lg);
}

.collapsible-arrow {
    font-size: calc(12px + var(--fs-scale) * 1);
    color: var(--txt);
    transition: transform var(--tr-normal);
    flex-shrink: 0;
}

.collapsible-panel {
    overflow: hidden;
    max-height: 0;
    /* 折叠展开动画：0.3s ease 比 --tr-normal(0.15s) 慢一倍——面板 max-height 过渡需更从容；
       --tr-enter(0.25s ease-out) 缓动不同，替换会静默改变观感。三档令牌均表达不了，
       故按 UI-Design.md §7 走同行豁免。 */
    transition: max-height 0.3s ease, opacity 0.25s ease; /* tr-exempt: 折叠面板需慢速从容展开，现有一档无 0.3s ease */
    opacity: 0;
}

.collapsible-panel.open {
    opacity: 1;
}

.collapsible-inner {
    padding: 2px 0 4px;
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
    background: var(--uih-white-weak);
    border: 1px solid var(--uih-white-medium);
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
    min-height: auto;
}

.collapsible-header.collapsible-mat:hover {
    background: var(--uih-white-medium);
    color: var(--txt);
    border-color: var(--uih-white-medium);
}

.collapsible-header.collapsible-mat:active {
    background: var(--uih-white-medium);
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
    border-top: 1px solid var(--uih-white-weak);
}

.collapsible-panel.mat-slider-panel.open {
    opacity: 1;
}

.cs-row {
    padding: 8px var(--uih-content-px) 6px;
    cursor: pointer;
    transition:var(--tr-fast);
    user-select: none;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-radius:var(--radius-md);
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
    gap: 10px;
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
    height: 6px;
    background: var(--uih-white-medium);
    border-radius: var(--radius-xs);
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
    border-radius: var(--radius-xs) var(--radius-xs) 0 0;
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
    border-radius: var(--radius-xs);
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
    border-radius: var(--radius-xs);
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
    border-radius: var(--radius-xs) var(--radius-xs) 0 0;
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
    /* 滑块手柄 2px 宽：--radius-xs(3px) 经 CSS 收缩规则（半径 > 宽/半即按比例限定）
       实际渲染为 1px，与硬编码 1px 逐像素一致，故走令牌无视觉差异。 */
    border-radius: var(--radius-xs);
    transform: translateX(-50%);
    pointer-events: none;
    transition: left 0.06s linear;
}

/* Slider dropdown panel (collapsed by default) */
.mat-slider-panel {
    margin-top: 6px;
    padding: 6px 0 0;
    border-top: 1px solid var(--uih-white-weak);
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
    background: var(--uih-white-weak);
    border: 1px solid var(--uih-white-weak);
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
    border: 1px solid var(--uih-white-medium);
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
    padding:var(--btn-padding-md);
    border-radius:var(--radius-md);
    font-size:var(--fs-base);
}

.diag-model-chips .preset-chip {
    font-size: var(--uih-font-ui-xs);
    padding:var(--btn-padding-tool-lg);
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
