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
 * 展开方式：display:none 起步，由 **utils/dom/dropdown.ts 控制器** click 展开
 * （JS 改内联 style.display，内联优先级高于本串的 display:none，可正常开关）。
 * 原 hover 展开串（`.dd-wrap:hover .dd-menu`）已于 ADR-238 无障碍统一中退役——
 * 触屏生产形态（Android/viewer）下 hover 语义不成立，键盘更是完全打不开菜单；
 * 「hover + JS 控制」互斥打架的历史问题随之整体消解。
 *
 * 尺寸/阴影等字面量已收敛为默认值；消费方如需局部差异，在各自 stylesheet 里追加
 * 更高优先级的选择器（如 `.dd-wrap .dd-menu { min-width:160px }`）覆盖，勿再回内联。
 */
export const dropdownBaseCSS = `
.dd-wrap { position:relative;display:inline-block; }
/* 下拉指示符 ▾ = 结构性 affordance，单源在此（CSS 生成），**不进 i18n 值**：
   曾以「作者 ▾」「批量 ▾」「⋮ 更多 ▾」形式混入三语 locale，翻译侧要抄箭头、
   想统一箭头样式也无处落笔；here 一处生成，所有 .dd-wrap 触发器（app-tree 三下拉 +
   sidebar push/pull）自动获得，且随主题字号缩放。.dd-menu 内菜单项非直接子元素，不受影响 */
.dd-wrap > button::after { content:"▾"; margin-left:.3em; font-size:.9em; opacity:.65; }
.dd-menu {
  position:absolute;top:100%;left:0;z-index:100;
  background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-md);
  padding:var(--sp-1);box-shadow:0 4px 12px rgba(0,0,0,.3);
  display:none;min-width:130px;max-height:220px;overflow-y:auto;
}
.dd-item {
  display:block;width:100%;padding:var(--btn-padding-std);border:none;background:transparent;
  color:var(--txt);cursor:pointer;font-size:var(--fs-btn-secondary);
  text-align:left;border-radius:var(--radius-sm);
}
.dd-item:hover { background:var(--hover); }
`;
/**
 * 元数据标签（`.tag-author` / `.tag-work` / `.tag-date`）——模型名后缀的作者/作品/日期色标。
 *
 * 是什么：app-tree（`.fh` 行 / `.fl` 行）与 app-content 仓库页（`content-repo.ts`）
 * 各有一份**逐值同构**的实现（同 padding / 同 --radius-xs / 同 0.9em / 同 text-shadow）。
 * 本串收敛那三份重复，供各 shadow 根 adopt。
 *
 * ⚠️ 各自 adopt 机制（同 `wsIconCSS` / `dropdownBaseCSS`）：漏带即标签「裸奔」——
 * 无色标、无背景、无圆角。
 *
 * 配色：`--meta-*` 三色由主题定义（六主题各不同），此处只消费。
 * date 混色比例统一 **12%**（与 author/work 一致）；app-tree 侧历史为 20%，
 * 2026-09 收敛时统一——如需树内更醒目，消费方在自己的 stylesheet 里用更高优先级覆盖。
 *
 * 产出方：`utils/model-name/display.ts` 的 renderDisplayName（`[作者]`/`【作品】`/日期段）；
 * 消费方：app-tree（.fh/.fl 行）、content-repo（仓库页）、app-preview（摘要页）——
 * 三个 shadow 根各自 adopt。新增渲染 .tag-* 的视图若漏带，标签会无色标/无背景。
 */
export const metaTagCSS = `
.tag-author,.tag-work,.tag-date { display:inline-block;padding:0 var(--sp-1);border-radius:var(--radius-xs);font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
`;
/**
 * 通用 tab 按钮外观基类（ADR-307 D1）。设置页 `.stg-tab` 与仓库页 `.repo-tab` 的
 * 18 个布局/外观属性 + `:hover` + `.active` 逐字段同构,抽此基类去重——改 tab 外观只动一处。
 *
 * ⚠️ 本串**不含 `animation`**：动画 keyframe 由各消费方自挂(`.stg-tab`→`stgTabIn`、
 * `.repo-tab`→`fadeSlideDown`),因为设置页在 ShadowRoot 内只能引用 shadow 本地 keyframe,
 * 仓库页在 light DOM 用全局 keyframe,两作用域的 keyframe 名不能合并(强加同名会令其中一侧
 * 静默失效)。故 keyframe 名保留两份、各作用域自管,本串只承载与动画无关的外观。
 *
 * 消费方:content-stg.ts(`.stg-tab`)与 content-repo.ts(`.repo-tab`),各在自身 stylesheet 拼
 * `${tabBtnCSS}` 后,`.stg-tab`/`.repo-tab` 仅追加 `animation:` 即可。
 */
export const tabBtnCSS = `
.tab-btn {
  padding:var(--pad-nav) 14px;border-radius:var(--radius-md) var(--radius-md) 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:var(--tr-normal);white-space:nowrap;min-height:var(--touch-min);
}
.tab-btn:hover { color:var(--txt);background:var(--hover); }
.tab-btn.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
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
