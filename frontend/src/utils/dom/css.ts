export const btnBaseCSS = `
.btn-base {
  padding: var(--btn-padding-md);
  border-radius: var(--btn-radius, 6px);
  border: 1px solid var(--bd);
  background: transparent;
  color: var(--txt);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  transition: var(--btn-transition);
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-base:hover { background: var(--hover); }
.btn-base:active { transform: scale(0.97); }
.btn-base:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline: none; }
.btn-base.sm { padding: var(--btn-padding-sm); font-size: var(--fs-btn-tool); }
.btn-base.lg { padding: var(--btn-padding-lg); font-size: var(--fs-btn-primary); }
.btn-base.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.btn-base.primary:hover { background: color-mix(in srgb, var(--accent) 88%, var(--bg)); }
.btn-base.danger { background: color-mix(in srgb, var(--status-error, #e5534b) 15%, transparent); color: var(--status-error, #e5534b); border-color: color-mix(in srgb, var(--status-error, #e5534b) 40%, transparent); }
.btn-base.danger:hover { background: color-mix(in srgb, var(--status-error, #e5534b) 30%, transparent); }
.btn-base.accent { background: var(--accent-btn-bg); color: var(--accent-btn-color); border-color: var(--accent-btn-border); }
.btn-base.accent:hover { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.btn-base.warn { background: color-mix(in srgb, var(--sm-optional) 13%, transparent); color: var(--sm-optional); border-color: color-mix(in srgb, var(--sm-optional) 33%, transparent); }
.btn-base.warn:hover { background: color-mix(in srgb, var(--sm-optional) 20%, transparent); }
.btn-base:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
`;

/* Shadow DOM 通用 focus-visible 规则（所有 button/input/select/textarea） */
export const focusVisibleCSS = `
:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline: none; }
`;

/**
 * `.ws-icon` SVG 图标规则（ADR-238 的**唯一**尺寸/着色出处）。
 *
 * ⚠️ 为什么必须每个 Shadow 根各自 adopt：CSS 规则不穿透 Shadow DOM 边界，
 * 只有自定义属性（var()）能。图标若在「没 adopt 本规则」的 shadow 根里渲染，
 * 就没有 `width:1em` 约束 → SVG 退回 viewBox 默认尺寸（24×24），在 12px 按钮里
 * 显得巨大（实测 app-preview 的 .pv-tab 一族即此症状）。
 *
 * 故凡渲染 `UI_ICONS` / workshop-icons 的 Web Component，其 adoptedStyleSheets
 * 必须含本串（`wsIconCSS`）。新增视图若用图标而忘了带它，图标会「裸奔」成大块。
 *
 * 尺寸取 `1em` + `currentColor` ⇒ 自动跟随字号与主题；实心图标由
 * `.ws-icon[fill]` 切换（fill 属性触发）。
 */
export const wsIconCSS = `
.ws-icon { width:1em; height:1em; vertical-align:-.15em; fill:none; stroke:currentColor; flex-shrink:0; }
.ws-icon[fill] { fill:currentColor; stroke:none; }
`;
