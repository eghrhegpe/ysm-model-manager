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
 * 下拉容器基础样式（`.dd-wrap` / `.dd-menu` / `.dd-item`）。
 *
 * 是什么：app-tree（工具栏 batch/more）与 app-sidebar（push/pull）各有一份同构的
 * 下拉视觉，app-tree 走样式表单 `app-tree-styles.ts`，app-sidebar 曾**全内联**在
 * `tpl.ts`（每处手写 `style="display:none;position:absolute;..."` 且借 .dd-item 当
 * 事件委托选择器）。本串收敛那份重复，供两个 shadow 根各自 adopt。
 *
 * ⚠️ 任一个 shadow 根若渲染 `.dd-*` 却漏带本串，菜单会「裸奔」：外观全失（无边框/
 * 圆角/阴影），`display:none` 也不生效 → 菜单常驻可见。与 `wsIconCSS` 同一套「各自
 * adopt，漏带即失效」机制。
 *
 * 展开方式默认 `display:none`，由消费方决定交互：
 *   - 需要 hover 展开 → 追加 `dropdownHoverCSS`（`.dd-wrap:hover .dd-menu`）；
 *   - 需要 click 展开 → JS 改 `style.display`（内联优先级高于本串的 display:none，
 *     可正常覆写开关）。
 * 两套互斥可选，避免「hover + JS 控制」打架（js 侧 closeAll 会压不过 hover）。
 *
 * 尺寸/阴影等字面量已收敛为默认值；消费方如需局部差异，在各自 stylesheet 里追加
 * 更高优先级的选择器（如 `.dd-wrap .dd-menu { min-width:160px }`）覆盖，勿再回内联。
 */
export const dropdownBaseCSS = `
.dd-wrap { position:relative;display:inline-block; }
.dd-menu {
  position:absolute;top:100%;left:0;z-index:100;
  background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-md);
  padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);
  display:none;min-width:130px;max-height:220px;overflow-y:auto;
}
.dd-item {
  display:block;width:100%;padding:4px 10px;border:none;background:transparent;
  color:var(--txt);cursor:pointer;font-size:var(--fs-btn-secondary);
  text-align:left;border-radius:var(--radius-sm);
}
.dd-item:hover { background:var(--hover); }
`;

/** hover 展开增强（`.dd-wrap:hover` 时显示菜单）。与 JS click 展开互斥，勿混用。 */
export const dropdownHoverCSS = `
.dd-wrap:hover .dd-menu { display:block; }
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
