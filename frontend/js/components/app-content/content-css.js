import { btnBaseCSS } from "../../css/shared-styles.js";
export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--font-ui); font-size:var(--fs-base); line-height:1.4; background:var(--bg); }
/* ===== CSS 变量（标签/标记色） ===== */
:host { --tag-game:#4a9eff; --tag-game-bg:rgba(74,158,255,.13); --tag-vup:#ff6bb5; --tag-vup-bg:rgba(255,107,181,.13); --tag-oc:#a78bfa; --tag-oc-bg:rgba(167,139,250,.13); --tag-amber:#f9a826; --tag-amber-bg:rgba(249,168,38,.2); --accent-btn-bg:#7c83ff33; --accent-btn-color:#66d9ef; --accent-btn-border:#7c83ff55; --sidebar-w:200px; --diag-left-w:120px; --touch-min:44px; }
@keyframes dl-slide-up {
  from { opacity:0; transform:translateY(8px); max-height:0; padding:0 4px }
  to   { opacity:1; transform:translateY(0); max-height:30px; padding:2px 4px }
}
#dl-imported-list > div { animation:dl-slide-up .25s ease-out both; }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:var(--fs-lg); font-weight:600; color:var(--txt); padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:var(--surf); border:1px solid var(--bd); border-radius:12px; padding:16px; }
.stat-card .num { font-size:var(--fs-xl); font-weight:700; color:var(--accent); transition:transform .2s cubic-bezier(.34,1.56,.64,1); }
.stat-card .num.bump { transform:scale(1.15); }
.stat-card .label { font-size:var(--fs-base); color:var(--muted); margin-top:2px; }
.stat-card .sub { font-size:var(--fs-sm); color:var(--txt); margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:var(--fs-md); gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:var(--fs-xs); background:var(--tag-amber-bg); color:var(--tag-amber); padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout-wrap { flex:1; }
.repo-wrap { display:flex;flex-direction:column;flex:1;overflow:hidden; }
.repo-tabs { display:flex;gap:2px;padding:4px 12px 0;border-bottom:1px solid var(--bd);flex-shrink:0;overflow-x:auto;flex-wrap:nowrap; }
.repo-tab { padding:var(--pad-nav) 14px;border-radius:6px 6px 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:all .15s;white-space:nowrap;min-height:var(--touch-min); }
.repo-tab:hover { color:var(--txt);background:var(--hover); }
.repo-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
.repo-subtab { padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;font-size:var(--fs-tab);transition:all .12s; }
.repo-subtab:hover { color:var(--txt);background:var(--hover); }
.repo-subtab.active { background:var(--surf);color:var(--accent); }
.repo-tab-body { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-sidebar { width:var(--sidebar-w);flex:none; }
.ins-content { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-model-list .sec-title { font-size:var(--fs-sm);color:var(--muted);padding:4px 2px 2px;text-transform:uppercase;letter-spacing:.5px;margin-top:4px; }
.ins-model-list .row { display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:4px;font-size:var(--fs-md);transition:background .12s; }
.ins-model-list .row:hover { background:var(--hover); }
.ins-model-list .row .dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
.ins-model-list .row .rn { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag-author,.tag-work,.tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.ins-model-list .row.row-prefix .dot { opacity:0.35; }
.ins-model-list .row .status-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .link-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .sz { font-size:var(--fs-base);color:var(--muted); }
.repo-topbar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-wrap:nowrap;overflow-x:auto; }
.repo-title { font-size:var(--fs-md);font-weight:600;flex-shrink:0; }
.repo-bar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd); }
.repo-bar:empty { padding:0;border-bottom:none; }
.repo-bar-spacer { flex:1; }
.repo-bar-btn { padding:var(--pad-btn-tool) 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-btn-tool); }
.repo-bar-btn:hover { background:var(--hover);color:var(--txt); }
.repo-spacer { flex:1; }
.repo-btn { font-size:var(--fs-xs);padding:2px 8px; }

.repo-srch { width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; }
.repo-srch:focus { border-color:var(--accent); }
.repo-sort { padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-sm);cursor:pointer;margin-left:auto; }
.batch-dropdown { position:relative;display:inline-block; }
.batch-menu { position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);min-width:120px; }
.repo-footer { padding:3px 12px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--bd);flex-shrink:0; }
/* 设置页样式已移至 components.css（全局非 Shadow DOM 区域） */
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surf); border-radius:6px; margin-bottom:4px; font-size:var(--fs-md); }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--muted); }
/* 诊断页面：左栏按钮 + 右栏信息 */
/* ===== 统一按钮系统 .btn-base ===== */
${btnBaseCSS}

/* ===== 旧按钮兼容层（逐步替换为 .btn-base 后删除） ===== */
.hdr-btn { padding:var(--pad-btn-primary) 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-btn-primary); font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.hdr-btn.accent { background:var(--accent-btn-bg); color:var(--accent-btn-color); border-color:var(--accent-btn-border); }
.btn { padding:var(--pad-btn-primary) 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-btn-primary); font-family:inherit; transition:background .12s; }
.btn:hover { background:var(--hover); }
.btn.accent { background:var(--accent-btn-bg); color:var(--accent-btn-color); border-color:var(--accent-btn-border); }
.btn.accent:hover { background: color-mix(in srgb, var(--accent) 33%, transparent); }
.btn.danger { background: color-mix(in srgb, var(--status-error) 13%, transparent); color: var(--status-error); border-color: color-mix(in srgb, var(--status-error) 33%, transparent); }
.btn.danger:hover { background: color-mix(in srgb, var(--status-error) 27%, transparent); }
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
/* tag-* 颜色已由通用 .tag-* 规则覆盖 */
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
/* 设置页卡片三栏网格 */
.stg-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.stg-card { background:var(--surf); border:1px solid var(--bd); border-radius:8px; overflow:hidden; }
.stg-card-hdr { display:flex;align-items:center;gap:6px; padding:8px 12px; font-size:var(--fs-sm); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); background:var(--bg2,transparent); }
.stg-card-body { padding:8px 12px; }
.stg-card-val { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:6px; cursor:pointer; font-size:var(--fs-sm); color:var(--txt); background:var(--bg); transition:border-color .12s, background .12s; width:100%; box-sizing:border-box; min-height:0; }
.stg-card-val:hover { border-color:var(--accent); background:var(--hover); }
.stg-card-val.derived:hover { border-color:var(--accent); background:var(--hover); }
.stg-card-val.derived::before { content:"📁 "; }
.stg-card-hint { font-size:var(--fs-xs); color:var(--muted); margin-bottom:6px; }
.stg-card-acts { display:flex; gap:4px; }
.stg-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:6px; line-height:1.4; }
.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:#f38ba8; }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }
.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:var(--diag-left-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); padding:8px; gap:4px; background:var(--surf); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:none; background:transparent; color:var(--muted); font-size:var(--fs-md); cursor:pointer; font-family:inherit; transition:all .12s; width:100%; text-align:left; }
.diag-btn:hover { background:var(--hover); color:var(--txt); }
.diag-btn.active { background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); }
.diag-btn-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:var(--fs-md); }
.diag-log-fbtn { font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer; }
.diag-log-fbtn:hover { background:var(--hover);color:var(--txt); }
.diag-log-fbtn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:var(--muted); }

/* ===== 通用卡片系统（元老页原型 → 全项目复用） ===== */
/* ring-fill 动画已废弃，health-ring 改用 breathe-subtle */

/* 基础卡片 — 所有卡片的基础 */
.model-card {
  background:var(--card);
  border:1px solid var(--bd);
  border-radius:8px;
  padding:var(--card-padding,10px 12px);
  text-align:left;
  cursor:pointer;
  transition:all .15s ease;
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
  border-radius:8px;
  border:1px solid var(--bd);
  background:var(--card);
  text-align:left;
  cursor:pointer;
  transition:all .15s ease;
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
  border-radius:10px;
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
.rec-card .actions button { font-size:var(--fs-xs); padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; transition:all .12s; }
.rec-card .actions button:hover { border-color:var(--accent); color:var(--accent); background:var(--hover); }
.health-ring { width:80px; height:80px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; position:relative; }
.health-ring-inner { position:absolute; inset:6px; border-radius:50%; background:var(--bg); display:flex; align-items:center; justify-content:center; flex-direction:column; }
.health-tag { display:inline-block; padding:2px 10px; border-radius:10px; font-size:var(--fs-xs); font-weight:600; }
.health-tag.good { background:#a6e3a122; color:#a6e3a1; }
.health-tag.ok { background:#f9a82622; color:#f9a826; }
.health-tag.bad { background:#f38ba822; color:#f38ba8; }
.stat-pill { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:10px; background:var(--surf); border:1px solid var(--bd); font-size:var(--fs-xs); color:var(--muted); }

/* 热力图 */
.hm-wrap { padding:4px 0; }
.hm-month { font-size:7px; color:var(--muted); padding:0 0 2px 0; display:flex; gap:2px; }
.hm-month span { flex:1; text-align:center; }
.hm-grid { display:flex; gap:2px; }
.hm-col { display:flex; flex-direction:column; gap:2px; }
.hm-cell { width:10px; height:10px; border-radius:2px; background:var(--bd); }
.hm-cell.l1 { background:#0e4429; }
.hm-cell.l2 { background:#006d32; }
.hm-cell.l3 { background:#26a641; }
.hm-cell.l4 { background:#39d353; }
.hm-label { font-size:7px; color:var(--muted); padding-top:2px; display:flex; gap:2px; }
.hm-label span { flex:1; text-align:center; }
.hm-legend { display:flex; align-items:center; gap:2px; font-size:7px; color:var(--muted); justify-content:flex-end; }
/* ===== 创作者标签 (cr-tag) ===== */
.cr-tag { display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:0 5px;border-radius:3px;line-height:16px;font-weight:500;flex-shrink:0; }
.cr-tag-game { background:var(--tag-game-bg);color:var(--tag-game); }
.cr-tag-vup { background:var(--tag-vup-bg);color:var(--tag-vup); }
.cr-tag-oc { background:var(--tag-oc-bg);color:var(--tag-oc); }
.cr-tag-filter-row { display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap;align-items:center; }
.cr-tag-filter-btn { font-size:var(--fs-xs);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-tag-filter-btn:hover { border-color:var(--accent);color:var(--txt);background:var(--hover); }
.cr-tag-filter-btn.active { border-color:var(--accent);color:var(--accent);background:var(--accent);color:#fff; }
/* ===== 创作者频道 (cr-) ===== */
.cr-page { flex:1; display:flex; overflow:hidden; position:relative; }
.cr-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.cr-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.cr-scroll { flex:1; overflow-y:auto; padding:8px 12px; }
.cr-preset-area { display:flex; gap:6px; flex-wrap:wrap; padding:4px 0 12px; }
.cr-preset-btn { font-size:var(--fs-sm);padding:3px 10px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-preset-btn:hover { border-color:var(--accent);color:var(--accent);background:var(--hover); }
.cr-section { margin-bottom:8px; }
.cr-section-title-lg { font-size:13px;font-weight:600;color:var(--txt); }
.cr-section-sub { font-size:var(--fs-sm);color:var(--muted); }
.cr-action-btn { font-size:var(--fs-sm);padding:3px 8px;border-radius:4px;border:1px solid transparent;background:transparent;cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-action-btn-muted { color:var(--muted);border-color:var(--bd); }
.cr-action-btn-muted:hover { background:var(--hover);color:var(--txt); }
.cr-action-btn-accent { color:var(--accent);border-color:var(--accent); }
.cr-action-btn-accent:hover { background:var(--accent);color:var(--bg); }
.cr-creator-card { display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);cursor:pointer;transition:all .12s; }
.cr-creator-card:hover { border-color:var(--accent);background:var(--hover); }
.cr-creator-card.cr-has-repo { border-left:3px solid var(--accent); }
.cr-creator-icon { font-size:18px;width:28px;text-align:center;flex-shrink:0; }
.cr-creator-body { flex:1;min-width:0; }
.cr-creator-name { font-size:var(--fs-md);font-weight:600;color:var(--txt); }
.cr-creator-desc { font-size:var(--fs-xs);color:var(--muted);margin-top:1px; }
.cr-creator-action { font-size:var(--fs-md);color:var(--muted);flex-shrink:0; }
.cr-browse-repo { font-size:var(--fs-xs);padding:2px 6px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap; }
.cr-browse-repo:hover { background:var(--accent);color:var(--bg); }
.cr-edit-btn { font-size:var(--fs-xs);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-edit-btn:hover { background:var(--hover);color:var(--txt); }
.cr-toggle { font-size:var(--fs-xs);padding:2px 8px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .12s; }
.cr-toggle:hover { background:var(--accent);color:var(--bg); }
.cr-mode-switch { display:inline-flex;border:1px solid var(--bd);border-radius:6px 6px 0 0;border-bottom:none;overflow:hidden;cursor:pointer;margin-right:2px;flex-shrink:0;align-self:stretch; }
.cr-mode-opt { padding:2px 6px;font-size:10px;font-family:inherit;transition:all .12s;color:var(--muted);background:var(--bg);cursor:pointer;display:flex;align-items:center; }
.cr-mode-opt:hover { color:var(--txt);background:var(--hover); }
.cr-mode-opt.active { color:var(--accent);background:var(--surf);margin-bottom:-1px; }
.cr-mode-opt:first-child { border-right:1px solid var(--bd); }
.cr-browser-bar { display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surf);border-bottom:1px solid var(--bd);flex-shrink:0; }
.cr-back { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.cr-back:hover { background:var(--hover); }
.ws-back, .cr-back-btn, .cr-back-repo, .ws-btn, .ws-btn-txt,
.ws-back-repo { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.ws-back:hover, .cr-back-btn:hover, .cr-back-repo:hover, .ws-btn:hover, .ws-btn-txt:hover,
.ws-back-repo:hover { background:var(--hover); }
.cr-url { flex:1;font-size:var(--fs-sm);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.ws-open-btn, .cr-open-btn { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.ws-open-btn:hover, .cr-open-btn:hover { background:var(--hover); }
/* 工坊仓库页工具按钮 */
.btn-sm,.ws-btn-sm,.gh-btn-sm { padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:all .12s;white-space:nowrap; }
.btn-sm:hover,.ws-btn-sm:hover,.gh-btn-sm:hover { background:var(--hover); }
.ws-btn-muted { color:var(--muted); }
.ws-btn-muted:hover { color:var(--txt); }
.ws-btn-accent { color:var(--accent);border-color:#7c83ff55;background:#7c83ff22; }
.ws-btn-accent:hover { background:#7c83ff44; }
.ws-dl-selected[disabled], .ws-btn-sm[disabled], .btn-sm[disabled] { opacity:.4;cursor:default; }
.ws-dl-selected[disabled]:hover, .ws-btn-sm[disabled]:hover, .btn-sm[disabled]:hover { background:transparent; }
.ws-filter-btn { position:relative; }

/* ===== 创作者卡片网格 & 卡片本体 ===== */
.cr-creator-grid {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  width:100%;
  padding:4px 0 8px;
}
.cr-creator-card {
  min-width:200px;max-width:280px;
  flex:1 1 200px;
  cursor:pointer;
  animation:card-in .3s ease-out both;
  padding:12px 14px;
  border-radius:10px;
  border:1px solid var(--bd);
  background:var(--card);
  transition:all .15s ease;
  flex-direction:column;
  align-items:stretch;
  gap:6px;
  position:relative;
  overflow:hidden;
}
.cr-creator-card:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:0 2px 12px rgba(0,0,0,.1);
  transform:translateY(-1px);
}
.cr-creator-card:focus-visible {
  box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  outline:none;
}
.cr-creator-card:hover .cr-card-tier-bar { opacity:1; }
.cr-creator-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
/* tier 色条 */
.cr-card-tier-bar {
  position:absolute;top:0;left:0;right:0;height:2px;opacity:.6;transition:opacity .15s;
}
.cr-creator-card[data-tier="gold"] .cr-card-tier-bar { background:#D4A017; }
.cr-creator-card[data-tier="silver"] .cr-card-tier-bar { background:#9E9E9E; }
.cr-creator-card[data-tier="gold"] .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),#D4A017,transparent 60%,#D4A017);
  box-shadow:0 0 6px rgba(212,160,23,.4);
}
.cr-creator-card[data-tier="silver"] .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),#9E9E9E,transparent 60%,#9E9E9E);
  box-shadow:0 0 6px rgba(158,158,158,.25);
}
.cr-creator-card[data-tier=""] .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),#6B9FFF,transparent 60%,#6B9FFF);
  box-shadow:none;
}

/* 卡片头部：头像 + 名称行 */
.cr-card-header {
  display:flex;
  align-items:center;
  gap:8px;
}
.cr-card-header .cr-avatar-container {
  position:relative;
  width:32px;height:32px;
  flex-shrink:0;
  margin:0;
}
.cr-card-header .cr-avatar-ring {
  position:absolute;inset:-2px;
  border-radius:50%;
  pointer-events:none;
  transition:transform .4s ease;
  background:conic-gradient(from var(--grad-rot,0deg),#6B9FFF,transparent 60%,#6B9FFF);
}
.cr-card-header .cr-avatar-ring[data-spin]:hover { animation:ring-spin .8s linear infinite; }

/* 名称行 */
.cr-card-name-row {
  flex:1;min-width:0;
  display:flex;align-items:center;
  gap:4px;
}
.cr-card-name {
  font-size:var(--fs-md);
  font-weight:700;
  color:var(--txt);
  font-family:var(--font-display);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  flex:1;
}
.cr-card-local-count {
  font-size:9px;color:var(--muted);flex-shrink:0;
  border:1px solid var(--bd);border-radius:8px;
  padding:0 5px;line-height:14px;
}
/* 描述文本 */
.cr-card-desc {
  font-size:var(--fs-xs);color:var(--muted);line-height:1.5;
  display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;min-height:0;
}
/* 底部排 */
.cr-card-footer {
  display:flex;align-items:center;gap:4px;flex-wrap:wrap;
}
.cr-card-footer .cr-platform-badge {
  display:inline-flex;
  font-size:8px;padding:1px 5px;border-radius:3px;line-height:14px;
  background:var(--surf);color:var(--muted);border:1px solid var(--bd);gap:2px;
}
.cr-card-footer .cr-tag { font-size:9px;margin-left:auto; }
/* 仓库按钮 */
.cr-card-repo-btn {
  width:100%;margin-top:2px;
  padding:3px 0;border-radius:6px;
  border:1px solid var(--bd);
  background:transparent;color:var(--accent);
  cursor:pointer;font-size:var(--fs-xs);font-family:inherit;
  text-align:center;transition:all .12s;
}
.cr-card-repo-btn:hover {
  border-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 10%, transparent);
}

/* ===== 预设搜索 ===== */
.cr-preset-area { display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 12px; }
.cr-preset-btn {
  font-size:var(--fs-sm);padding:4px 12px;border-radius:6px;
  border:1px solid var(--bd);background:var(--surf);color:var(--txt);
  cursor:pointer;font-family:inherit;transition:all .12s;
}
.cr-preset-btn:hover { border-color:var(--accent);color:var(--accent);background:var(--hover); }
.cr-preset-btn:active { background:color-mix(in srgb, var(--accent) 15%, transparent); }

/* ===== 搜索输入 ===== */
.cr-search-input {
  flex:1;min-width:120px;max-width:180px;
  padding:4px 10px;border-radius:6px;
  border:1px solid var(--bd);background:var(--bg);color:var(--txt);
  font-size:var(--fs-xs);font-family:inherit;outline:none;
  transition:border-color .12s;
}
.cr-search-input:focus { border-color:var(--accent); }
.cr-search-input::placeholder { color:var(--muted);opacity:.6; }

/* ===== 工坊空状态 ===== */
.cr-empty-site {
  flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;
  padding:48px 20px;color:var(--muted);font-size:var(--fs-md);
  text-align:center;gap:8px;
}
.cr-empty-site .cr-site-link { color:var(--accent);font-size:var(--fs-sm); }

/* ===== 编辑模式卡片 ===== */
.cr-edit-card {
  padding:6px 10px;border-radius:8px;
  border:1px solid var(--bd);background:var(--card);
  margin-bottom:4px;transition:box-shadow .15s;
}
.cr-edit-card:hover { box-shadow:0 0 0 1px var(--accent); }
.cr-edit-card-head { display:flex;align-items:center;gap:6px; }
.cr-edit-card-body { padding-top:4px;display:flex;flex-direction:column;gap:4px; }
.cr-edit-card-row { display:flex;align-items:center;gap:4px; }
.cr-drag-handle { cursor:grab;color:var(--muted);font-size:14px;user-select:none; }
.cr-edit-card-avatar { font-size:16px;width:24px;text-align:center;flex-shrink:0; }
.cr-input {
  flex:1;min-width:60px;border:none;background:transparent;
  color:var(--txt);font-size:var(--fs-sm);font-family:inherit;outline:none;
}
.cr-input:focus { background:var(--surf); }
.cr-add-area { padding:4px 0 12px; }
.cr-add-area button, .cr-add-preset {
  padding:4px 12px;border-radius:6px;border:1px dashed var(--bd);
  background:transparent;color:var(--muted);cursor:pointer;
  font-size:var(--fs-sm);font-family:inherit;transition:all .12s;
}
.cr-add-area button:hover, .cr-add-preset:hover { border-color:var(--accent);color:var(--accent); }
.cr-section {
  display:flex;align-items:center;gap:6px;
  padding:8px 0 4px;
}
.cr-section-title-lg {
  font-size:var(--fs-md);font-weight:600;color:var(--txt);
}
.cr-section-sub { font-size:var(--fs-sm);color:var(--muted); }
.cr-tag-filter-row {
  display:flex;gap:4px;flex-wrap:wrap;padding-bottom:8px;
}
.cr-tag-filter-btn {
  font-size:var(--fs-xs);padding:2px 10px;border-radius:12px;
  border:1px solid var(--bd);background:transparent;color:var(--muted);
  cursor:pointer;font-family:inherit;transition:all .12s;
}
.cr-tag-filter-btn:hover { border-color:var(--accent);color:var(--accent); }
.cr-tag-filter-btn.active { background:var(--accent);color:#fff;border-color:var(--accent); }
.cr-drop-zone {
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:12px 16px;margin:4px 0 8px;
  border:2px dashed var(--bd);border-radius:8px;
  color:var(--muted);font-size:var(--fs-xs);
  cursor:pointer;transition:all .2s;user-select:none;
}
.cr-drop-zone-active {
  border-color:var(--accent);color:var(--accent);background:var(--hover);
}
.cr-drop-icon { font-size:18px; }
.cr-drop-text { font-size:var(--fs-xs); }
.cr-fetch-btn, .cr-edit-btn, .cr-save-btn, .cr-cancel-btn {
  padding:2px 8px;border-radius:4px;border:1px solid var(--bd);
  background:transparent;color:var(--txt);cursor:pointer;
  font-size:var(--fs-xs);font-family:inherit;transition:all .12s;
}
.cr-fetch-btn:hover, .cr-edit-btn:hover, .cr-save-btn:hover, .cr-cancel-btn:hover { background:var(--hover); }
.cr-action-btn-accent { color:var(--accent);border-color:var(--accent); }
.cr-action-btn-accent:hover { background:var(--accent);color:#fff; }

/* ===== 创意工坊 GitHub (gh-) ===== */
.gh-page { flex:1; display:flex; overflow:hidden; position:relative; }
.gh-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.gh-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
#gh-results { flex:1;display:flex;flex-direction:column;overflow:hidden; }
#gh-results-body { flex:1;overflow-y:auto;padding:0 12px 8px; }
.gh-search-wrap { padding:2px 0 6px; }
.gh-search { width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; }
.gh-search:focus { border-color:var(--accent); }
.gh-loading-placeholder { padding:24px;text-align:center;color:var(--muted);font-size:11px; }
.gh-initial-hint { color:var(--muted);font-size:10px;padding:12px 0;text-align:center; }
.gh-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.gh-card { display:flex; align-items:center; gap:var(--card-gap,8px); padding:var(--card-padding,7px 10px); border-radius:8px; border:1px solid var(--bd); background:var(--card); cursor:pointer; transition:all .15s ease; box-shadow:var(--card-shadow, none); transform:translateZ(0); contain:layout paint style; }
.gh-card:hover { border-color:var(--accent); background:var(--hover); box-shadow:var(--card-shadow-hover, none); margin-top:-1px; }
.gh-card.active { border-color:var(--accent); background:var(--accent); color:#fff; box-shadow:var(--card-shadow-hover, none); }
.gh-card .name { font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--txt); font-family:var(--font-display); overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.gh-card .name + .meta { margin-top:1px; font-size:var(--fs-xs); color:var(--muted); }
.cr-avatar { width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--muted);background:var(--surf);z-index:1;transition:all .25s ease; }
.cr-avatar-container { position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;width:28px;height:28px;margin:6px; }
.cr-avatar-ring { position:absolute;inset:-2px;border-radius:50%;pointer-events:none;transition:transform .4s ease; }
.cr-avatar-ring[data-spin]:hover { animation:ring-spin .8s linear infinite; }
@keyframes ring-spin { to{transform:rotate(360deg)} }
@keyframes card-in { from{opacity:0;transform:translateY(8px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
.health-ring { animation:breathe-subtle 4s ease-in-out infinite;will-change:filter; }

/* ===== 创作者详情浮层 (cr-detail) ===== */
.cr-detail-overlay { position:fixed;inset:0;z-index:var(--z-modal);background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;animation:fade-in .15s ease; }
.cr-detail-box { background:var(--bg);border:1px solid var(--bd);border-radius:12px;padding:20px;max-width:420px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:12px;animation:detail-in .2s ease; }
@keyframes detail-in { from{opacity:0;transform:scale(.92) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes fade-in { from{opacity:0} to{opacity:1} }
.cr-detail-header { display:flex;align-items:center;gap:10px; }
.cr-detail-name { font-size:16px;font-weight:700;color:var(--txt); }
.cr-detail-desc { font-size:var(--fs-sm);color:var(--muted);line-height:1.5;display:flex;flex-wrap:wrap;gap:4px;padding:0;background:transparent; }
.cr-detail-row { display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);color:var(--muted); }
.cr-detail-row .cr-tag { font-size:10px; }
.cr-detail-actions { display:flex;gap:6px;flex-wrap:wrap;margin-top:4px; }
.cr-detail-actions button { padding:5px 14px;border-radius:6px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-sm);font-family:inherit;transition:all .12s; }

/* Overlay avatar sizes (overrides .cr-avatar base: 28px → 36px) */
.cr-detail-avatar-container { width:36px;height:36px;margin:0; }
.cr-detail-avatar-img { width:36px;height:36px;border-radius:50%;object-fit:cover; }
.cr-detail-avatar-text { width:36px;height:36px;font-size:16px; }

/* Name area */
.cr-detail-fill { flex:1;min-width:0; }
.cr-detail-name-row { display:flex;align-items:center;gap:6px; }
.cr-detail-identity { font-size:10px;color:var(--muted);margin-top:1px; }

/* Desc tags */
.cr-desc-tag { font-size:10px;padding:1px 7px;border-radius:4px;line-height:18px;background:var(--surf);color:var(--txt);opacity:.75;border:1px solid var(--bd); }

/* Local count card */
.cr-local-card { display:flex;align-items:center;gap:8px;background:var(--surf);border-radius:8px;padding:8px 10px;border:1px solid var(--bd); }
.cr-local-icon { font-size:13px; }
.cr-local-text { flex:1;font-size:var(--fs-sm);color:var(--txt); }

/* Platform row */
.cr-detail-row-platforms { gap:4px;flex-wrap:wrap; }
.cr-detail-actions button:hover { border-color:var(--accent);background:var(--hover); }
.cr-detail-actions .primary { background:var(--accent);color:#fff;border-color:var(--accent); }
.cr-detail-actions .primary:hover { opacity:.85; }
.cr-model-count { font-size:var(--fs-xs);color:var(--muted);display:inline-flex;align-items:center;gap:2px; }
.cr-star-btn { cursor:pointer;font-size:11px;transition:transform .15s;flex-shrink:0; }
.cr-star-btn:hover { transform:scale(1.15); }
.cr-detail-box .cr-star-btn { font-size:18px; }
.cr-local-btn { padding:2px 8px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:background-color .12s,color .12s; }
.cr-local-btn:hover { background:var(--accent);color:#fff; }
.cr-platform-badge { font-size:8px;padding:1px 4px;border-radius:2px;line-height:12px;display:inline-flex;align-items:center;gap:2px;background:var(--surf);color:var(--muted);border:1px solid var(--bd); }
.gh-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
.gh-card-icon { font-size:16px; width:24px; text-align:center; flex-shrink:0; }
.gh-card-body { flex:1; min-width:0; }
.gh-card-label { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-card.active .gh-card-label { color:#fff; }
.gh-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:0; }
.gh-card.active .gh-card-desc { color:#fffd; }
.gh-card-external { width:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);cursor:pointer;border-left:1px solid var(--bd);transition:all .12s; }
.gh-card-external:hover { color:var(--accent);background:var(--hover); }
.gh-card.active .gh-card-external { border-left-color:var(--accent);color:var(--accent); }
.gh-section-title { font-size:var(--fs-md);font-weight:600;color:var(--txt);padding:8px 12px 4px; }
.gh-header { border-bottom:1px solid var(--bd);flex-shrink:0; }
.gh-header-top { display:flex;align-items:center;gap:8px;padding:8px 12px; }
.gh-header-repo { display:flex;align-items:center;gap:8px;padding:0 12px 8px; }
.gh-header-actions { display:flex;align-items:center;gap:8px;padding:0 12px 8px;position:relative; }
.gh-section-fill { flex:1; }
.gh-back-repo { font-size:var(--fs-sm);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-family:inherit; }
.gh-back-repo:hover { background:var(--hover); }
.gh-btn-txt { border-color:transparent; }
.gh-repo-name { font-size:var(--fs-md);font-weight:600;color:var(--txt);flex:1; }
.gh-model-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 20px; font-size: var(--fs-xs); font-weight: 600; }
.gh-model-badge-total { background: var(--surf); color: var(--txt); }
.gh-model-badge-missing { background: rgba(243,139,168,.12); color: var(--status-error); }
.gh-empty { padding:24px;text-align:center;color:var(--muted);font-size:var(--fs-base); }
/* toggle-missing 激活态 */
.gh-toggle-missing.active { border-color:var(--accent);color:var(--accent); }
/* .gh-btn-sm 已合并到 .btn-sm */
.gh-btn-muted { color:var(--muted); }
.gh-btn-muted:disabled { opacity:.4;cursor:not-allowed;pointer-events:none; }
.gh-btn-accent { color:var(--accent);border-color:var(--accent); }
.gh-btn-accent:hover { background:var(--accent);color:var(--bg); }
.gh-dl-selected { color:var(--accent);border-color:var(--accent); }
.gh-dl-selected:hover { background:var(--accent);color:var(--bg); }

/* ===== 模型名高亮标签（复用 display.js renderDisplayName） */
/* tag-* 颜色已由通用 .tag-* 规则覆盖 */

/* 二级菜单 */
.gh-popup { position:fixed; z-index:var(--z-popover); background:var(--surf,#2a2a3c); border:1px solid var(--bd,#444); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.35); min-width:140px; }
.gh-popup-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; cursor:pointer; transition:background .1s; }
.gh-popup-item:hover { background:var(--hover,#ffffff15); }
.gh-popup-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.gh-popup-label { font-size:var(--fs-base); color:var(--txt,#cdd6f4); }

/* 创作者列表 */
.gh-left-head { padding:4px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap; }
.gh-left-head-label { font-size:11px;font-weight:600;color:var(--muted); }
.gh-left-head-spacer { flex:1; }
.gh-left-foot { padding:4px 12px 8px;font-size:8px;color:var(--muted); }
.gh-creators-list { flex:1; overflow-y:auto; padding:6px 12px; display:flex; flex-direction:column; gap:4px; }
.gh-creator-card { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; border:1px solid var(--bd); background:var(--surf); cursor:pointer; transition:all .12s; }
.gh-creator-card:hover { border-color:var(--accent); background:var(--hover); }
.gh-creator-icon { font-size:var(--fs-lg); width:22px; text-align:center; flex-shrink:0; }
.gh-creator-body { flex:1; min-width:0; }
.gh-creator-name { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-creator-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:1px; }
.gh-creator-action { font-size:var(--fs-base); color:var(--muted); flex-shrink:0; }

/* ===== 模型列表行 ===== */
.gh-empty { padding:12px; text-align:center; color:var(--muted); font-size:var(--fs-sm); }
.gh-row { display: grid; grid-template-columns: 1fr max-content max-content; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 6px; margin-bottom: 2px; border-left: 3px solid transparent; font-size: var(--fs-sm); transition: background .12s; }
.gh-row:hover { background: var(--hover); }
.gh-row-exists { border-left-color: var(--status-success); background: transparent; }
.gh-row-exists .gh-name { color: var(--muted); }
.gh-row-missing { border-left-color: var(--status-error); background: rgba(243,139,168,.04); }
.gh-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--txt); font-size: var(--fs-sm); }
.gh-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: all .12s; }
.gh-icon-btn:hover { background: var(--hover); border-color: var(--bd); }
.gh-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.gh-icon-btn .ws-icon { width: 14px; height: 14px; }
.gh-dl-btn { border-color: var(--accent); color: var(--accent); }
.gh-dl-btn:hover { background: var(--accent); color: #fff; }
.gh-dl-btn:disabled { border-color: var(--bd); color: var(--muted); }
.gh-cb { accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
.gh-badge { padding:2px 8px; border-radius:4px; font-size:var(--fs-sm); color:var(--success,#4caf50); flex-shrink:0; }
.gh-size { font-size:var(--fs-sm); color:var(--muted); }
.gh-meta { display:flex; align-items:center; gap:6px; }
.gh-actions { display:flex; align-items:center; justify-content:flex-end; }
/* 队列状态条 */
#gh-queue-status { display:none; }
#gh-queue-status.show { display:block; }
/* 下载选中按钮状态 */
.gh-dl-selected:disabled { opacity:.4;pointer-events:none; }
.gh-dl-selected { opacity:1; }

/* ===== 仓库头部（renderRepoHeaderHTML） ===== */
.gh-header { flex:1; overflow-y:auto; padding:0 12px; }
.gh-header > :last-child { padding-bottom:12px; }
.link-badge { display:inline-block; padding:0 5px; border-radius:3px; font-size:var(--fs-xs); font-weight:600; }
.link-badge-raw { color:#a6e3a1; background:rgba(166,227,161,.12); }
.link-badge-jsd { color:#f9a826; background:rgba(249,168,38,.12); }
.link-badge-api { color:#89b4fa; background:rgba(137,180,250,.12); }
.link-badge-cdn { color:#94e2d5; background:rgba(148,226,213,.12); }
.link-badge-ghapi { color:#cba6f7; background:rgba(203,166,247,.12); }
/* ===== 站点卡片分组标题 ===== */
.gh-section-title { font-size:var(--fs-xs); font-weight:600; color:var(--muted); padding:8px 8px 2px; }

/* ===== 站点视图 ===== */
.gh-scroll { flex:1; overflow-y:auto; }

/* SVG icons */
.ws-icon { width:1em;height:1em;vertical-align:-.15em;fill:none;stroke:currentColor;flex-shrink:0; }
.ws-icon[fill] { fill:currentColor;stroke:none; }

.gh-section { padding:6px 12px 4px; display:flex; align-items:center; gap:4px; }
.gh-section-title-lg { font-size:var(--fs-sm); font-weight:600; color:var(--txt); }
.gh-section-sub { font-size:var(--fs-xs); color:var(--muted); }
.gh-preset-area { padding:8px 12px 4px; display:flex; gap:4px; flex-wrap:wrap; }
.gh-preset-btn { padding:2px 6px; border-radius:4px; border:1px solid var(--bd); background:var(--surf); color:var(--accent); cursor:pointer; font-size:var(--fs-xs); }
.gh-action-btn { padding:4px 12px; border-radius:6px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-base); }
.gh-action-btn-accent { color:var(--accent); }
.gh-action-btn-muted { color:var(--muted); }
.gh-save-btn { padding:4px 14px; border-radius:6px; border:none; background:var(--accent); color:#fff; cursor:pointer; font-size:var(--fs-base); }
.gh-hint-text { font-size:8px; color:var(--muted); padding:0 12px 4px; }

/* ===== 创作者编辑行 ===== */
.gh-cr-row { display:flex; align-items:center; gap:3px; padding:4px 6px; border-radius:4px; border:1px solid var(--bd); font-size:var(--fs-sm); margin:1px 12px; }
.gh-cr-input { flex:2; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; font-size:var(--fs-sm); }
.gh-cr-input-name { color:var(--txt); }
.gh-cr-input-desc { color:var(--muted); font-size:var(--fs-xs); }
.gh-cr-input-type { flex:1; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:var(--accent); font-size:var(--fs-xs); text-align:center; }
.gh-cr-del { padding:1px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:#e5534b; cursor:pointer; font-size:var(--fs-sm); }
.gh-cr-add-area { padding:4px 12px; }
.gh-cr-add { padding:2px 8px; border-radius:4px; border:1px dashed var(--bd); background:transparent; color:var(--accent); cursor:pointer; font-size:var(--fs-sm); width:100%; }
/* Drag states */
.cr-dragging { opacity: .4; }
.cr-drag-target { border-color: var(--accent); }
.cr-drag-before { margin-top: 8px; }
.cr-drag-after { margin-bottom: 8px; }

.cr-section-fill { flex:1; }

.cr-section-wrap { flex-wrap:wrap; }
.cr-preset-icon { font-size:12px; }
.stg-adv-reset { margin-left:auto; }
.cr-error-page .cr-back-repo { margin-bottom:12px; }

/* Edit card inputs */
.cr-input-type { flex:1;height:auto;min-height:50px;padding:2px 4px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit; }
.cr-input-desc { font-size: var(--fs-xs); }
.cr-input-type:focus { border-color: var(--accent); }

.cr-input-role { width:auto;min-width:70px;padding:2px 4px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit; }
.cr-input-role:focus { border-color: var(--accent); }

.cr-btn-icon { font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-btn-icon:hover { color:var(--txt); }

.cr-edit-label { font-size:10px;color:var(--muted);width:28px;flex-shrink:0; }

.cr-fetch-failed { color: var(--muted); cursor: default; }

/* ===== 创作者编辑卡片 ===== */
.cr-edit-card { margin:4px 12px; border-radius:8px; border:1px solid var(--bd); background:var(--surf); overflow:hidden; cursor:default; transition:box-shadow .15s,border-color .15s,margin-top .15s ease,margin-bottom .15s ease; }
.cr-edit-card:active { cursor:grabbing; }
.cr-edit-card-head { display:flex; align-items:center; gap:4px; padding:6px 8px; border-bottom:1px solid var(--bd); background:var(--bg); }
.cr-drag-handle { font-size:14px; color:var(--muted); cursor:grab; user-select:none; line-height:1; }
.cr-edit-card-avatar { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--surf); font-size:11px; flex-shrink:0; }
.cr-edit-card-body { padding:4px 8px 6px; }
.cr-edit-card-row { display:flex; align-items:center; gap:4px; margin:2px 0; }
.cr-edit-card-row select { flex:1; }
.gh-empty-site { flex:1; overflow-y:auto; padding:12px; color:var(--muted); font-size:var(--fs-sm); }
.gh-site-link { color:var(--accent); }

/* ===== 错误页 ===== */
.gh-error-page { padding:12px; text-align:center; }
.gh-error-msg { color:var(--muted); font-size:var(--fs-sm); line-height:1.6; }
.gh-error-hint { font-size:var(--fs-xs); opacity:.6; }
.gh-back-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-sm); }

/* ===== 下载队列 ===== */
.gh-queue-icon { color:var(--accent); }
.gh-queue-error { padding:2px 0; font-size:var(--fs-sm); color:#f38ba8; }
.gh-queue-err-item { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-ellipsis { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-cancel { font-size:var(--fs-sm); color:var(--muted); }
.gh-progress-row { display:flex; align-items:center; gap:4px; }
.gh-progress-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-sm); }
.gh-progress-pct { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-progress-remain { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-cancel-btn { width:20px; height:20px; border-radius:50%; border:none; background:rgba(128,128,128,.15); color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:background .15s; }
.gh-cancel-btn:hover { background:rgba(128,128,128,.3); }
.gh-progress-bar-wrap { margin-top:3px; height:4px; border-radius:2px; background:var(--bd); overflow:hidden; }
.gh-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width .2s; box-shadow:0 0 4px var(--accent); animation:breathe-subtle 4s ease-in-out infinite;will-change:filter,box-shadow; }
.gh-progress-pct.gh-progress-error { color:#f38ba8; }
.gh-progress-fill.gh-progress-fill-error { background:#f38ba8; }
.gh-progress-box { padding:24px 12px; text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }

/* ===== 诊断页去重 UI (diag-dedup) ===== */
.diag-msg { padding:12px;font-size:11px; }
.diag-msg-error { color:#f38ba8; }
.diag-msg-success { color:#a6e3a1; }
.diag-msg-muted { color:#6c7086; }
.diag-dedup-summary { padding:10px 12px;font-size:11px;color:var(--txt);border-bottom:1px solid var(--bd); }
.diag-dedup-summary-hint { display:block;font-size:9px;color:var(--muted);margin-top:2px; }
.diag-dedup-rt { display:flex;align-items:center;gap:4px;padding:6px 12px 2px;font-size:10px;font-weight:600;color:var(--txt); }
.diag-dedup-rt-sep { flex:1;border-bottom:1px solid var(--bd);margin-left:6px; }
.diag-dedup-rt-count { font-size:9px;color:var(--muted);font-weight:400; }
.diag-dedup-group { margin:4px 12px;border:1px solid var(--bd);border-radius:8px;overflow:hidden; }
.diag-dedup-group-head { display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd); }
.diag-dedup-group-fill { flex:1; }
.diag-dedup-group-info { font-size:9px;color:var(--muted);font-weight:400; }
.diag-dedup-file { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s; }
.diag-dedup-file-default { background:var(--hover); }
.diag-dedup-file-name { flex:1;overflow:hidden;min-width:0; }
.diag-dedup-file-name-text { color:var(--txt);font-size:10px;cursor:pointer; }
.diag-dedup-file-dir { display:block;font-size:8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.diag-dedup-file-size { font-size:9px;color:var(--muted);flex-shrink:0;margin-right:4px; }
.diag-dedup-file-date { font-size:8px;color:var(--muted);flex-shrink:0; }
.diag-dedup-recommend { font-size:8px;padding:0 4px;border-radius:3px;background:#a6e3a122;color:#a6e3a1; }
.diag-dedup-radio { flex-shrink:0;accent-color:var(--accent); }
.diag-dedup-keep-all { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background .1s;border-top:1px solid var(--bd); }
.diag-dedup-keep-all-label { color:var(--muted); }
.diag-dedup-actions { display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--bd); }
.diag-dedup-exec { flex:1;padding:7px 16px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:11px;font-family:inherit; }
.diag-dedup-cancel { padding:7px 16px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;font-family:inherit; }
/* Settings overridden card */
.stg-card-overridden { border-color:var(--accent); }
.stg-custom-badge { font-size:9px;color:var(--accent); }
.stg-path-text { font-size:10px;cursor:pointer; }

/* ===== 响应式 ===== */
@media (max-width:768px) {
  .cr-left,.gh-left,.ins-sidebar { width:100%; height:auto; border-right:none; flex-direction:row; flex-wrap:wrap; }
  .cr-scroll,.gh-grid,.diag-right { padding:4px 6px; }
  .diag-left { width:100%; border-right:none; flex-direction:row; flex-wrap:wrap; }
}
`;
