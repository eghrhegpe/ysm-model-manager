// ===== <app-content> 基础层：host 变量 + 通用 keyframes + 骨架 + 通用卡片系统 + 工坊(ws-*)通用按钮类 =====
// CSS 自定义属性可穿透 Shadow DOM 边界，但 @keyframes 不能。<app-content> 是 Shadow DOM 组件
// （index.ts: adoptedStyleSheets=[appContentStyle]），document 层 components.css 定义的
// fadeSlideUp / fadeSlideLeft / fadeSlideDown / breathe-subtle 在 shadow 内不生效。
// 故这些 keyframes 必须在本 shadow 层本地重定义（见下方 contentLayoutCSS 内的 @keyframes 块），
// 引用它们的 .stg-card / .setting-row / .gh-card / .repo-tab / .recy-item 等规则才能产生动画。
// components.css 的全局副本仅服务 document 层光 DOM（dialog 等）。
import { btnBaseCSS, focusVisibleCSS } from "../../utils/dom/css.ts";

export const contentLayoutCSS: string = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--font-ui); font-size:var(--fs-base); line-height:1.4; background:var(--bg); }
/* ===== CSS 变量（标签/标记色/热力图色/host 尺寸） ===== */
:host { --tag-game:#4a9eff; --tag-game-bg:rgba(74,158,255,.13); --tag-vup:#ff6bb5; --tag-vup-bg:rgba(255,107,181,.13); --tag-oc:#a78bfa; --tag-oc-bg:rgba(167,139,250,.13); --tag-amber:#f9a826; --tag-amber-bg:rgba(249,168,38,.2); --badge-jsd:#f9a826; --badge-jsd-bg:rgba(249,168,38,.12); --badge-api:#89b4fa; --badge-api-bg:rgba(137,180,250,.12); --badge-cdn:#94e2d5; --badge-cdn-bg:rgba(148,226,213,.12); --badge-ghapi:#cba6f7; --badge-ghapi-bg:rgba(203,166,247,.12); --hm-0:#161b22; --hm-1:#0e4429; --hm-2:#006d32; --hm-3:#26a641; --hm-4:#39d353; --sidebar-w:200px; --diag-left-w:120px; --touch-min:44px; }

/* ===== 通用 keyframes（跨域复用，集中在 layout 层，避免子域相互依赖） ===== */
@keyframes dl-slide-up {
  from { opacity:0; transform:translateY(8px); max-height:0; padding:0 4px }
  to   { opacity:1; transform:translateY(0); max-height:30px; padding:2px 4px }
}
#dl-imported-list > div { animation:dl-slide-up .25s ease-out both; }
@keyframes pageIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; animation: pageIn .2s ease; }
:host-context(.no-animations) .page { animation: none !important; }
@keyframes ring-spin { to{transform:rotate(360deg)} }
@keyframes card-in { from{opacity:0;transform:translateY(8px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
@keyframes detail-in { from{opacity:0;transform:scale(.92) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes fade-in { from{opacity:0} to{opacity:1} }
/* 以下 4 个 keyframes 为 components.css 全局副本的 shadow 本地化：
   document 层定义的 keyframes 不穿透 Shadow DOM 边界，shadow 内 .stg-card / .setting-row /
   .gh-card / .repo-tab / .recy-item / .rm-* 等引用的 fadeSlide*/breathe-subtle 必须在本层重定义。
   components.css 的全局副本仅服务 document 层光 DOM（dialog 等），两处定义并存但作用域不同。 */
/* 注意：以下 4 个本地化 keyframe 必须与 frontend/css/components.css 全局副本逐字节一致
   （translateY(6px)/translateY(-4px)/translateX(-8px)），否则 document 层 dialog 与
   shadow 内容会用同名不同参动画，造成观感分裂（见评审 2026-08-24 第 1 条）。 */
@keyframes fadeSlideUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeSlideDown { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeSlideLeft { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
@keyframes breathe-subtle { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.18); } }

/* ===== 页头 & 段落标题（跨域通用） ===== */
.section-title { font-size:var(--fs-lg); font-weight:600; color:var(--txt); padding:16px 16px 8px; }
.stat-card { flex:1; background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-xl); padding:16px; }
.stat-card .num { font-size:var(--fs-xl); font-weight:700; color:var(--accent); transition:transform .2s cubic-bezier(.34,1.56,.64,1); }
.stat-card .num.bump { transform:scale(1.15); }
.stat-card .label { font-size:var(--fs-base); color:var(--muted); margin-top:2px; }
.stat-card .sub { font-size:var(--fs-sm); color:var(--txt); margin-top:6px; }

.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:var(--fs-md); gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:var(--fs-xs); background:var(--tag-amber-bg); color:var(--tag-amber); padding:2px 8px; border-radius:var(--radius-sm); }

.repo-layout-wrap { flex:1; }

/* ===== 仓库外壳骨架（.repo-layout / .repo-wrap）——所有 repo-wrap 页共用 ===== */
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }

/* ===== 统一按钮系统 .btn-base（utils/dom/css.ts 注入） ===== */
${btnBaseCSS}
${focusVisibleCSS}

/* ===== 旧按钮兼容层 ===== */
/* .hdr-btn 已删除：app-tree/app-tree-styles.ts 有独立定义且 tpl 已改用 .btn-base（见其 L41 注释），content-layout 内为死代码 */
/* .btn 裸类兼容层已删除：设置页 3 处遗留（web-repo-auth-btn / set-advanced-toggle / stg-adv-reset）均已迁移至 .btn-base，统一按钮系统见 utils/dom/css.ts */

/* ===== 通用卡片系统（元老页原型 → 全项目复用） ===== */
/* ring-fill 动画已废弃，health-ring 改用 breathe-subtle */

/* 基础卡片 — 所有卡片的基础 */
.model-card {
  background:var(--card);
  border:1px solid var(--bd);
  border-radius:var(--radius-lg);
  padding:var(--card-padding,10px 12px);
  text-align:left;
  cursor:pointer;
  transition:var(--tr-normal);
  box-shadow:var(--card-shadow, none);
}
.model-card:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:var(--card-shadow-hover, none);
}
.model-card .name {
  font-size:var(--fs-base);
  font-weight:600;
  color:var(--txt);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.model-card .meta {
  font-size:var(--fs-xs);
  color:var(--muted);
  margin-top:2px;
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}

/* 紧凑卡片 — 网格布局（2列/3列） */
.model-card-sm {
  padding:var(--card-padding,6px 10px);
  border-radius:var(--radius-lg);
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

/* 推荐卡片 — 带悬浮动效 */
.rec-card {
  background:var(--surf);
  border:1px solid var(--bd);
  border-radius:var(--radius-xl);
  padding:14px 16px;
  text-align:left;
  min-width:200px;
  cursor:default;
  transition:transform .25s cubic-bezier(.34,1.56,.64,1);
}
.rec-card:hover {
  transform:scale(1.02) translateY(-2px);
}
.rec-card .name { font-size:var(--fs-base); font-weight:600; color:var(--txt); margin-bottom:2px; }
.rec-card .hint { font-size:var(--fs-xs); color:var(--muted); margin-top:4px; }
.rec-card .actions { display:flex; gap:4px; margin-top:6px; }
.rec-card .actions button { font-size:var(--fs-xs); padding:2px 8px; border-radius:var(--radius-sm); border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; transition:var(--tr-fast); }
.rec-card .actions button:hover { border-color:var(--accent); color:var(--accent); background:var(--hover); }

.health-ring { width:80px; height:80px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; position:relative; }
.health-ring { animation:breathe-subtle 4s ease-in-out infinite;will-change:filter; }
.health-ring-inner { position:absolute; inset:6px; border-radius:50%; background:var(--bg); display:flex; align-items:center; justify-content:center; flex-direction:column; }
.health-tag { display:inline-block; padding:2px 10px; border-radius:var(--radius-xl); font-size:var(--fs-xs); font-weight:600; }
.health-tag.good { background:color-mix(in srgb, var(--status-success) 12%, transparent); color:var(--status-success); }
.health-tag.ok { background:color-mix(in srgb, var(--sm-optional) 12%, transparent); color:var(--sm-optional); }
.health-tag.bad { background:color-mix(in srgb, var(--status-error) 12%, transparent); color:var(--status-error); }
.stat-pill { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:var(--radius-xl); background:var(--surf); border:1px solid var(--bd); font-size:var(--fs-xs); color:var(--muted); }

/* 通用工具按钮（repo/gh/workshop 三处共享的 .btn-sm 家族） */
.btn-sm,.ws-btn-sm,.gh-btn-sm { padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:var(--tr-fast);white-space:nowrap; }
.btn-sm:hover,.ws-btn-sm:hover,.gh-btn-sm:hover { background:var(--hover); }
.btn-sm[disabled] { opacity:.4;cursor:default; }
.btn-sm[disabled]:hover { background:transparent; }

/* SVG icons（跨域复用） */
.ws-icon { width:1em;height:1em;vertical-align:-.15em;fill:none;stroke:currentColor;flex-shrink:0; }
.ws-icon[fill] { fill:currentColor;stroke:none; }

/* ===== 工坊（workshop）通用工具按钮类（归位自 content-creator.ts，跨 creator/gh 复用） ===== */
.ws-btn-muted { color:var(--muted); }
.ws-btn-muted:hover { color:var(--txt); }
.ws-btn-accent { color:var(--accent);border-color:color-mix(in srgb, var(--accent) 33%, transparent);background:color-mix(in srgb, var(--accent) 13%, transparent); }
.ws-btn-accent:hover { background:color-mix(in srgb, var(--accent) 25%, transparent); }
.ws-dl-selected[disabled], .ws-btn-sm[disabled] { opacity:.4;cursor:default; }
.ws-dl-selected[disabled]:hover, .ws-btn-sm[disabled]:hover { background:transparent; }
.ws-filter-btn { position:relative; }
.ws-back, .cr-back-btn, .cr-back-repo, .ws-btn, .ws-btn-txt,
.ws-back-repo { padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.ws-back:hover, .cr-back-btn:hover, .cr-back-repo:hover, .ws-btn:hover, .ws-btn-txt:hover,
.ws-back-repo:hover { background:var(--hover); }
.ws-open-btn { padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.ws-open-btn:hover { background:var(--hover); }
`;
