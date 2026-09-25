// ===== <app-content> 基础层：host 变量 + 通用 keyframes + 骨架 + 通用卡片系统 + 工坊(ws-*)通用按钮类 =====
// CSS 自定义属性可穿透 Shadow DOM 边界，但 @keyframes 不能。<app-content> 是 Shadow DOM 组件
// （index.ts: adoptedStyleSheets=[appContentStyle]），document 层 components.css 定义的
// fadeSlideUp / fadeSlideLeft / fadeSlideDown / breathe-subtle 在 shadow 内不生效。
// 故这些 keyframes 必须在本 shadow 层本地重定义（见下方 contentLayoutCSS 内的 @keyframes 块），
// 引用它们的 .stg-card / .setting-row / .gh-card / .repo-tab / .recy-item 等规则才能产生动画。
// components.css 的全局副本仅服务 document 层光 DOM（dialog 等）。
import { btnBaseCSS, focusVisibleCSS, noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";
import { FADE_SLIDE_LEFT } from "@/views/css/keyframes.ts";

export const contentLayoutCSS: string = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--font-ui); font-size:var(--fs-base); line-height:1.4; background:var(--bg); }
/* ===== CSS 变量（标签/标记色/host 尺寸） ===== */
:host { --tag-game:#4a9eff; --tag-game-bg:rgba(74,158,255,.13); --tag-vup:#ff6bb5; --tag-vup-bg:rgba(255,107,181,.13); --tag-oc:#a78bfa; --tag-oc-bg:rgba(167,139,250,.13); --tag-amber:#f9a826; --tag-amber-bg:rgba(249,168,38,.2); --badge-jsd:#f9a826; --badge-jsd-bg:rgba(249,168,38,.12); --badge-api:#89b4fa; --badge-api-bg:rgba(137,180,250,.12); --badge-cdn:#94e2d5; --badge-cdn-bg:rgba(148,226,213,.12); --badge-ghapi:#cba6f7; --badge-ghapi-bg:rgba(203,166,247,.12); --sidebar-w:200px; --diag-left-w:120px; --touch-min:44px; }

/* ===== 通用 keyframes（跨域复用，集中在 layout 层，避免子域相互依赖） ===== */
@keyframes dl-slide-up {
  from { opacity:0; transform:translateY(8px); max-height:0; padding:0 var(--sp-1) }
  to   { opacity:1; transform:translateY(0); max-height:30px; padding:var(--btn-padding-xs)}
}
#dl-imported-list > div { animation:dl-slide-up .25s ease-out both; }
@keyframes pageIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; animation: pageIn .2s ease; }
@keyframes ring-spin { to{transform:rotate(360deg)} }
@keyframes detail-in { from{opacity:0;transform:scale(.92) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes fade-in { from{opacity:0} to{opacity:1} }
/* 以下 4 个 keyframes 为 components.css 全局副本的 shadow 本地化：
   document 层定义的 keyframes 不穿透 Shadow DOM 边界，shadow 内 .stg-card / .setting-row /
   .gh-card / .repo-tab / .recy-item 等引用的 fadeSlide* 与 breathe-subtle 必须在本层重定义。
   components.css 的全局副本仅服务 document 层光 DOM（dialog 等），两处定义并存但作用域不同。 */
/* 注意：以下本地化 keyframe 必须与 frontend/css/components.css 全局副本逐字节一致
   （translateY(6px)/translateY(-4px)/translateX(-8px)），否则 document 层 dialog 与
   shadow 内容会用同名不同参动画，造成观感分裂（见评审 2026-08-24 第 1 条）。
   fadeSlideLeft 已收敛到 @/views/css/keyframes.ts 单一事实源（与 sidebar 共享）。 */
@keyframes fadeSlideUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeSlideDown { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
${FADE_SLIDE_LEFT}
@keyframes breathe-subtle { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.18); } }

/* ===== 页头 & 段落标题（跨域通用） ===== */
/* 标题与内容同层入场：标题恒定 0ms 起播（class 内显式声明），卡片经内联 animation-delay
   从 0/60/120ms… 错峰起播——标题永不晚于其下方卡片，切 tab 观感连贯（无「标题先弹、内容再滑」割裂）。 */
.section-title { font-size:var(--fs-lg); font-weight:600; color:var(--txt); padding:16px 16px 16px; animation:fadeSlideUp var(--tr-enter) both; animation-delay:0ms; }

/* ===== 居中空态/加载态块（A 族唯一原语）=====
   形状 = 占满剩余空间 + 双向居中 + 竖排 + muted + 8px 间隙。
   消费方只放内容（可选 .big 大图标 + 文案 + 操作按钮），**不写布局意图、不内联、不复刻**。
   历史（2026-09 体检查出）：本类此前**零消费者**（死 CSS），而实例页把同一配方内联照抄了一份，
   还借用了 app-preview 的类名 .dp-placeholder——该类在 app-content 的 shadow 内根本无规则。
   刻意**不并**另两族（形状不同，硬并会造视觉回归）：
     - 居中提示行（padding + text-align:center + 小字号）：.gh-loading-placeholder / .perf-no-data / .gh-initial-hint
     - 左对齐小提示：.stg-hint / .stg-card-hint
   机检：css/content-css.test.ts「居中空态块只有本原语一个」 */
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:var(--fs-md); text-align:center; gap:8px; }
.placeholder-box .big { font-size:var(--fs-xl); }
/* 大面积留白变体（工坊站点空态等整页空场用；行内空态不加） */
.placeholder-box--roomy { padding:48px 20px; }

/* ===== 仓库外壳骨架（.repo-layout / .repo-left / .repo-wrap）——所有 repo-wrap 页共用 ===== */
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
/* 仅仓库页使用：面板组（tab 面板落位处）与预览面板、拖拽柄并排 */
.repo-left { flex:1; display:flex; flex-direction:column; min-width:0; }
.preview-resize-handle { width:4px; cursor:col-resize; background:transparent; transition:background var(--tr-fast); flex-shrink:0; }

/* ===== 统一按钮系统 .btn-base（utils/dom/css.ts 注入） ===== */
${btnBaseCSS}
${focusVisibleCSS}

/* ===== .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts）
   本域任一动效元素均被通配符 * 覆盖，故不再逐类登记 :host-context 选择器。
   桥置于 layout 叶（内容基础层），聚合层 content-css.ts 被哨兵测试锁为 7 叶纯拼接。 */
${noAnimationsCSS}

/* ===== 通用卡片系统（元老页原型 → 全项目复用） ===== */
/* ring-fill 动画已废弃，health-ring 改用 breathe-subtle */

/* 紧凑卡片 — 网格布局（2列/3列） */
.model-card-sm {
  padding:var(--card-padding);
  border-radius:var(--radius-card);
  border:1px solid var(--bd);
  background:var(--card);
  text-align:left;
  cursor:pointer;
  transition:var(--tr-normal);
  box-shadow:var(--card-shadow, none);
}
.model-card-sm:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:var(--card-shadow-hover, none);
}
.model-card-sm .name {
  font-size:var(--fs-base);
  font-weight:600;
  color:var(--txt);
  font-family:var(--font-display);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.model-card-sm .meta {
  font-size:var(--fs-xs);
  color:var(--muted);
  margin-top:2px;
  display:flex;
  gap:6px;
}

.health-ring { width:80px; height:80px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:calc(16px + var(--fs-scale)); font-weight:700; position:relative; }
.health-ring { animation:breathe-subtle 4s ease-in-out infinite;will-change:filter; }
.health-ring-inner { position:absolute; inset:6px; border-radius:50%; background:var(--bg); display:flex; align-items:center; justify-content:center; flex-direction:column; }
.health-tag { display:inline-block; padding:2px 10px; border-radius:var(--radius-xl); font-size:var(--fs-xs); font-weight:600; }
.health-tag.good { background:color-mix(in srgb, var(--status-success) 12%, transparent); color:var(--status-success); }
.health-tag.ok { background:color-mix(in srgb, var(--sm-optional) 12%, transparent); color:var(--sm-optional); }
.health-tag.bad { background:color-mix(in srgb, var(--status-error) 12%, transparent); color:var(--status-error); }

/* SVG icons（跨域复用）——规则本体已上收到 @/utils/dom/css.ts 的 wsIconCSS
   （ADR-238： icons sweeper 之外的每个 shadow 根都要 adopt 它，见下方插值） */
${wsIconCSS}

/* ===== 工坊（workshop）通用工具按钮类（归位自 content-creator.ts，跨 creator/gh 复用） ===== */
.ws-back, .ws-btn-txt { padding:var(--btn-padding-std);border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.ws-back:hover, .ws-btn-txt:hover { background:var(--hover); }
.ws-open-btn { padding:var(--btn-padding-std);border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.ws-open-btn:hover { background:var(--hover); }

/* ===== 工坊页布局（2026-09 自 tpl.ts workshopHTML 行内收编——结构在代码、样式在 CSS）===== */
.ws-right { width:100%; } /* .cr-right 已供 flex 三件套（flex:1/column/overflow），行内只多 width:100% */
.ws-search-view { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ws-search-results { flex:1;overflow-y:auto;padding:0 var(--sp-3) var(--sp-2); }
.ws-browser { display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg); } /* 显隐由 JS 内联 style.display 切换（workshop-site-opener），内联优先于本类默认 none */
.ws-browser-bar { display:flex;align-items:center;gap:6px;padding:var(--sp-vh-pane);border-bottom:1px solid var(--bd);flex-shrink:0; } /* 原死类名：模板在用、CSS 无规则 → 顺手补上（2026-09 体检） */
.ws-iframe { flex:1;border:none;background:var(--bg); }
.ws-blocked { display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:var(--fs-base); } /* 同 .ws-browser：显隐走 JS 内联 */
.ws-toolbar { display:flex;gap:6px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd);flex-shrink:0; }
`;
