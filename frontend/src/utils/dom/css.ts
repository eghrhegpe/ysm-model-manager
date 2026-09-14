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

/**
 * `.no-animations` 在 Shadow DOM 内的通配桥（ADR-015 §2.4 约束 1：用户关闭时零动画）。
 *
 * ⚠️ 为什么必须每个 Shadow 根各自 adopt：`.no-animations` 类挂在 `documentElement`
 * （见 `views/app-content/settings/ui-prefs.ts`），而 `frontend/css/variables.css` 的
 * 文档层通配 `.no-animations *` **不穿透 Shadow 边界**——CSS 规则不可穿透，只有自定义
 * 属性（var()）能。历史实现是文档层逐类白名单（`.no-animations .menu` / `.toast` /
 * `.sm-*` …），这些类住在 shadow 内部，选择器永远匹配不到，属恒死规则：开关在
 * app-toast / context-menu / app-sidebar / app-content 上静默失效（2026-09 核实）。
 *
 * 故凡自带动画或过渡的 Web Component，其 shadow 根样式必须含本串。与 `wsIconCSS`
 * 同一套「各自 adopt，漏带即失效」的机制——区别是本项有闸：
 * `scripts/css-layer-check.ts` 检查 4 对「shadow 域有 animation/transition 却无桥」
 * 报 ERROR 阻断，新增视图漏带会在 pre-push 被拦下。
 *
 * `:host-context()` 命中宿主祖先链上的 `.no-animations`，`*` 覆盖 shadow 树内全部元素
 * 与伪元素，故**无需再逐类登记**——这是「不再有假开关」的关键。
 */
export const noAnimationsCSS = `
:host-context(.no-animations),
:host-context(.no-animations) *,
:host-context(.no-animations) *::before,
:host-context(.no-animations) *::after {
  animation: none !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
`;
