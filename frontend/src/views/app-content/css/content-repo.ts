// ===== 仓库/实例/站点页骨架 + 资历最深页 + 通用标签 =====
// 注：原「热力图」13 条死 CSS 规则已于 838a9bb2f 删除（勿在此注释点名类前缀——
// extractClasses 会读到注释文本致已删类「复活」为已定义，削弱死 CSS 信号）；
// 资历最深页的热力图样式实际由 tpl-oldest.ts 的柱状图内联承载。
import { metaTagCSS } from "@/utils/dom/css.ts";

export const contentRepoCSS: string = `
${metaTagCSS}
.repo-wrap { display:flex;flex-direction:column;flex:1;overflow:hidden; }
.repo-tabs { display:flex;gap:2px;padding:4px 12px 0;border-bottom:1px solid var(--bd);flex-shrink:0;overflow-x:auto;flex-wrap:nowrap; }
.repo-tab { padding:var(--pad-nav) 14px;border-radius:var(--radius-md) var(--radius-md) 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:var(--tr-normal);white-space:nowrap;min-height:var(--touch-min);animation:fadeSlideDown var(--tr-enter) both; }
.repo-tab:hover { color:var(--txt);background:var(--hover); }
.repo-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
.ins-sidebar { width:var(--sidebar-w);flex:none; }
.ins-content { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-model-list .sec-title { font-size:var(--fs-sm);color:var(--muted);padding:4px 2px 2px;text-transform:uppercase;letter-spacing:.5px;margin-top:4px; }
.ins-model-list .row { display:flex;align-items:center;gap:6px;padding:var(--btn-padding-sm);border-radius:var(--radius-sm);font-size:var(--fs-md);transition:background var(--tr-fast); }
.ins-model-list .row:hover { background:var(--hover); }
.ins-model-list .row .dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
.ins-model-list .row .rn { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.ins-model-list .row.row-prefix .dot { opacity:0.35; }
.ins-model-list .row .status-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .link-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .sz { font-size:var(--fs-base);color:var(--muted); }

.repo-topbar { display:flex;align-items:center;gap:4px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd);flex-wrap:nowrap;overflow-x:auto; }
.repo-title { font-size:var(--fs-md);font-weight:600;flex-shrink:0; }
.repo-bar { display:flex;align-items:center;gap:4px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd); }
.repo-bar:empty { padding:0;border-bottom:none; }
.repo-bar-spacer { flex:1; }
.repo-bar-btn { padding:var(--pad-btn-tool) 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-btn-tool);transition:var(--tr-fast); } /* 工具栏命令按钮 = txt（对齐 .btn-base 正典） */
.repo-bar-btn:hover { background:var(--hover); }
.repo-spacer { flex:1; }
.repo-btn { font-size:var(--fs-xs);padding:var(--btn-padding-tool-lg); }
.repo-srch { width:160px;padding:var(--btn-padding-md);border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0;transition:var(--tr-fast); }
.repo-srch:focus { border-color:var(--accent); }
.repo-sort { padding:var(--btn-padding-sm);border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-sm);cursor:pointer;margin-left:auto;transition:var(--tr-fast); }
.repo-sort:hover { border-color:var(--accent);background:var(--hover); }
.batch-dropdown { position:relative;display:inline-block; }
.batch-menu { position:absolute;top:100%;left:0;z-index:var(--z-popover);background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-md);padding:var(--sp-1);box-shadow:var(--shadow-md);min-width:120px; } /* 审计 P2-2/P2-4：box-shadow 走 --shadow-md，z-index 走 --z-popover */
.repo-footer { padding:3px 12px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--bd);flex-shrink:0; }
/* 通用标签（作者/作品/日期）外观由共享 metaTagCSS 承载（utils/dom/css.ts）——
   原三行本地实现已删，避免与 app-tree 侧第三份同构实现漂移。
   模型名高亮复用 display.js renderDisplayName */
.link-badge { display:inline-block; padding:0 var(--sp-1); border-radius:var(--radius-xs); font-size:var(--fs-xs); font-weight:600; }
.link-badge-raw { color:var(--status-success); background:color-mix(in srgb,var(--status-success) 12%,transparent); }
.link-badge-jsd { color:var(--badge-jsd); background:var(--badge-jsd-bg); }
.link-badge-api { color:var(--badge-api); background:var(--badge-api-bg); }
.link-badge-cdn { color:var(--badge-cdn); background:var(--badge-cdn-bg); }
.link-badge-ghapi { color:var(--badge-ghapi); background:var(--badge-ghapi-bg); }

/* ===== 资历最深页专用样式 ===== */
.oldest-page { display:flex; flex-direction:column; gap:16px; padding:var(--sp-4); overflow-y:auto; height:100%; }
.oldest-stats-bar { display:inline-flex; align-items:center; gap:12px; background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-lg); padding:8px 14px; flex-wrap:wrap; align-self:flex-start; }
.oldest-health-box { display:flex; align-items:center; gap:8px; }
.oldest-health-label { font-size:var(--fs-sm); color:var(--muted); white-space:nowrap; }
.oldest-health-ring { width:28px; height:28px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.oldest-health-ring-inner { width:22px; height:22px; border-radius:50%; background:var(--surf); display:flex; align-items:center; justify-content:center; }
.oldest-health-ring-num { font-size:var(--fs-sm); font-weight:700; color:var(--txt); }
.oldest-stats-divider { width:1px; height:20px; background:var(--bd); flex-shrink:0; }
.oldest-stats-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.oldest-stat-pill { padding:3px 10px; border:1px solid var(--bd); border-radius:var(--radius-xl); font-size:var(--fs-sm); color:var(--txt); background:var(--bg); white-space:nowrap; }
.oldest-section { background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-xl); padding:12px 14px; }
.oldest-section-title { font-size:var(--fs-md); font-weight:600; color:var(--txt); margin-bottom:8px; letter-spacing:.3px; }
.oldest-section-title-sm { font-size:var(--fs-sm); font-weight:600; color:var(--txt); margin-bottom:4px; letter-spacing:.3px; }
.oldest-cards-row { display:flex; flex-wrap:wrap; gap:6px; width:100%; }
.oldest-card-name { font-size:var(--fs-sm); font-weight:600; color:var(--txt); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-all; }
.oldest-card-meta { font-size:var(--fs-xs); color:var(--muted); margin-top:2px; display:flex; gap:6px; flex-wrap:wrap; }
.pick-card { background:var(--card); border:1px solid var(--bd); border-left:3px solid var(--accent); border-radius:var(--radius-card); padding:var(--card-padding); text-align:left; cursor:pointer; transition:var(--tr-normal); flex:1; min-width:140px; max-width:200px; } /* 审计 P1-2/P1-3：卡片圆角收口 --radius-card，删 --card-padding 手抄回退 */
.pick-card:hover { border-color:var(--accent); background:var(--hover); }
.pick-card .name { font-size:var(--fs-md); font-weight:600; color:var(--txt); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pick-card .meta { font-size:var(--fs-sm); color:var(--muted); margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; }

`;
