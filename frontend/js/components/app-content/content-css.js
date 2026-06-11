export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--font-ui); font-size:var(--fs-base); background:var(--bg); }
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
.ptag { font-size:var(--fs-xs); background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout-wrap { flex:1; }
.repo-wrap { display:flex;flex-direction:column;flex:1;overflow:hidden; }
.repo-tabs { display:flex;gap:2px;padding:4px 12px 0;border-bottom:1px solid var(--bd);flex-shrink:0; }
.repo-tab { padding:6px 18px;border-radius:6px 6px 0 0;border:1px solid transparent;border-bottom:none;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-md);font-family:inherit;transition:all .12s; }
.repo-tab:hover { color:var(--txt);background:var(--hover); }
.repo-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd);margin-bottom:-1px; }
.repo-tab-body { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-sidebar { width:200px;flex:none; }
.ins-content { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-model-list .sec-title { font-size:var(--fs-sm);color:var(--muted);padding:4px 2px 2px;text-transform:uppercase;letter-spacing:.5px;margin-top:4px; }
.ins-model-list .row { display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:4px;font-size:var(--fs-md);transition:background .12s; }
.ins-model-list .row:hover { background:var(--hover); }
.ins-model-list .row .dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
.ins-model-list .row .rn { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.ins-model-list .row .rn .tag-author,.ins-model-list .row .rn .tag-work,.ins-model-list .row .rn .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.ins-model-list .row .rn .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.ins-model-list .row .rn .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.ins-model-list .row .rn .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.ins-model-list .row.row-prefix .dot { opacity:0.35; }
.ins-model-list .row .status-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .link-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .sz { font-size:var(--fs-base);color:var(--muted); }
.repo-topbar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-wrap:nowrap;overflow-x:auto; }
.repo-title { font-size:var(--fs-md);font-weight:600;flex-shrink:0; }
.repo-bar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd); }
.repo-bar:empty { padding:0;border-bottom:none; }
.repo-srch { width:140px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-sm);outline:none; }
.repo-bar-spacer { flex:1; }
.repo-bar-btn { padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-xs); }
.repo-bar-btn:hover { background:var(--hover);color:var(--txt); }
.repo-spacer { flex:1; }
.repo-btn { font-size:var(--fs-xs);padding:2px 8px; }

.repo-srch { width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; }
.repo-srch:focus { border-color:var(--accent); }
.repo-sort { padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-sm);cursor:pointer;margin-left:auto; }
.batch-dropdown { position:relative;display:inline-block; }
.batch-menu { position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);min-width:120px; }
.hdr-btn { padding:4px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.repo-footer { padding:3px 12px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--bd);flex-shrink:0; }
.stg-page { flex:1;overflow-y:auto;padding:12px; }
.stg-title { margin-bottom:8px; }
.stg-sub-title { margin-top:16px; }
.stg-group { margin-bottom:12px; }
.stg-val { font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px; }
.stg-btn { font-size:var(--fs-sm); }
.stg-hint { font-size:var(--fs-xs);color:var(--muted,#6c7086);padding:2px 0 0 0; }
.stg-ml-auto { margin-left:auto; }
.stg-radio-row { display:flex;gap:8px;padding:4px 0; }
.stg-label { display:flex;align-items:center;gap:4px;font-size:var(--fs-base);cursor:pointer; }
.stg-hint-hidden { font-size:var(--fs-xs);color:var(--muted,#6c7086);padding:2px 0 0 0;display:none; }
.stg-hint-warn { font-size:var(--fs-xs);color:#e5534b; }
.stg-select { background:var(--bg,#1e1e2e);color:var(--txt,#cdd6f4);border:1px solid var(--bd,#444);border-radius:4px;padding:3px 6px;font-size:var(--fs-base);cursor:pointer; }
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surf); border-radius:6px; margin-bottom:4px; font-size:var(--fs-md); }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--muted); }
/* 诊断页面：左栏按钮 + 右栏信息 */
.hdr-btn { padding:4px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-base); font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
/* accent 按钮颜色 —— 不用 var(--accent)，adoptedStyleSheets 不继承文档 CSS 变量 */
.hdr-btn.accent { background:#7c83ff33; color:#66d9ef; border-color:#7c83ff55; }
:host-context(.theme-warm) .hdr-btn.accent { color:#8b4513; }
:host-context(.theme-pro) .hdr-btn.accent { color:#ffffff; }
.btn { padding:4px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-base); font-family:inherit; transition:background .12s; }
.btn:hover { background:var(--hover); }
.btn.accent { background:#7c83ff33; color:#66d9ef; border-color:#7c83ff55; }
:host-context(.theme-warm) .btn.accent { color:#8b4513; }
:host-context(.theme-pro) .btn.accent { color:#ffffff; }
.btn.accent:hover { background:#7c83ff55; }
.btn.danger { background:#e5534b22; color:#e5534b; border-color:#e5534b55; }
.btn.danger:hover { background:#e5534b44; }
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
.log-row .log-msg .tag-author,.log-row .log-msg .tag-work,.log-row .log-msg .tag-date,.recy-item .tag-author,.recy-item .tag-work,.recy-item .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.log-row .log-msg .tag-author, .recy-item .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.log-row .log-msg .tag-work, .recy-item .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.log-row .log-msg .tag-date, .recy-item .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:#f38ba8; }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }
.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:120px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); padding:8px; gap:4px; background:var(--surf); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:none; background:transparent; color:var(--muted); font-size:var(--fs-md); cursor:pointer; font-family:inherit; transition:all .12s; width:100%; text-align:left; }
.diag-btn:hover { background:var(--hover); color:var(--txt); }
.diag-btn.active { background:#7c83ff22; color:var(--accent); }
.diag-btn-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:13px; }
.diag-log-fbtn.active { background:var(--accent) !important; color:#fff !important; border-color:var(--accent) !important; }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:#6c7086; }

/* ===== 通用卡片系统（元老页原型 → 全项目复用） ===== */
@keyframes ring-fill { from { --pct:0; } to { --pct:100; } }
@property --pct { syntax:'<number>'; inherits:false; initial-value:0; }

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
  box-shadow:0 2px 8px rgba(0,0,0,.06);
  cursor:default;
  transition:transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s;
}
.rec-card:hover {
  transform:scale(1.02) translateY(-2px);
  box-shadow:0 4px 16px rgba(0,0,0,.12);
}
.rec-card .name { font-size:var(--fs-base); font-weight:600; color:var(--txt); margin-bottom:2px; }
.rec-card .hint { font-size:var(--fs-xs); color:var(--muted); margin-top:4px; }
.rec-card .actions { display:flex; gap:4px; margin-top:6px; }
.rec-card .actions button { font-size:var(--fs-xs); padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; transition:all .12s; }
.rec-card .actions button:hover { border-color:var(--accent); color:var(--accent); background:var(--hover); }
.health-ring { width:80px; height:80px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; position:relative; animation:ring-fill .8s ease-out both; }
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
/* ===== 创作者频道 (cr-) ===== */
.cr-page { flex:1; display:flex; overflow:hidden; position:relative; }
.cr-left { width:200px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
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
.cr-mode-opt { padding:6px 8px;font-size:var(--fs-md);font-family:inherit;transition:all .12s;color:var(--muted);background:var(--bg);cursor:pointer;display:flex;align-items:center; }
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

/* ===== 创意工坊 GitHub (gh-) ===== */
.gh-page { flex:1; display:flex; overflow:hidden; position:relative; }
.gh-left { width:200px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.gh-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.gh-card { display:flex; align-items:center; gap:var(--card-gap,8px); padding:var(--card-padding,7px 10px); border-radius:8px; border:1px solid var(--bd); background:var(--card); cursor:pointer; transition:all .15s ease; box-shadow:var(--card-shadow, none); }
.gh-card:hover { border-color:var(--accent); background:var(--hover); box-shadow:var(--card-shadow-hover, none); transform:translateY(-1px); }
.gh-card.active { border-color:var(--accent); background:var(--accent); color:#fff; box-shadow:var(--card-shadow-hover, none); }
.gh-card .name { font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--txt); font-family:var(--font-display); overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.gh-card .name + .meta { margin-top:1px; font-size:var(--fs-xs); color:var(--muted); }
.cr-avatar { width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#8b7355;background:#ede4cf;border:2px solid #d4c5a9;transition:all .25s ease; }
.cr-avatar-gold { border-color:#d4a017;box-shadow:0 0 6px rgba(212,160,23,.3); }
.cr-avatar-silver { border-color:#a8a8a8;box-shadow:0 0 4px rgba(168,168,168,.2); }
.gh-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
.gh-card:hover .cr-avatar-gold { border-color:#f0c030;box-shadow:0 0 12px rgba(212,160,23,.4); }
.gh-card:hover .cr-avatar-silver { border-color:#c0c0c0;box-shadow:0 0 8px rgba(168,168,168,.3); }
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
.gh-header-top { display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap; }
.gh-back-repo { font-size:var(--fs-sm);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-family:inherit; }
.gh-back-repo:hover { background:var(--hover); }
.gh-btn-txt { border-color:transparent; }
.gh-repo-name { font-size:var(--fs-md);font-weight:600;color:var(--txt);flex:1; }
.gh-model-count { font-size:var(--fs-sm);color:var(--muted); }
.gh-missing-count { font-size:var(--fs-sm);color:var(--free);font-weight:600; }
.gh-empty { padding:24px;text-align:center;color:var(--muted);font-size:var(--fs-base); }
.gh-filter-btn { font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit; }
.gh-filter-btn:hover { background:var(--hover);color:var(--txt); }
.gh-filter-dropdown { display:none;position:absolute;top:100%;right:0;z-index:10;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:100px;box-shadow:0 4px 12px rgba(0,0,0,.3); }
.gh-btn-sm { font-size:var(--fs-xs);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;cursor:pointer;font-family:inherit;transition:all .12s; }
.gh-btn-sm:hover { background:var(--hover); }
.gh-btn-muted { color:var(--muted); }
.gh-btn-muted:disabled { opacity:.4;cursor:not-allowed;pointer-events:none; }
.gh-dl-selected { color:var(--accent);border-color:var(--accent); }
.gh-dl-selected:hover { background:var(--accent);color:var(--bg); }

/* 旧名兼容（逐步废弃） */
.gh-page,.gh-left,.gh-right,.gh-right-inner,.gh-grid { }

/* 模型名高亮标签（复用 display.js renderDisplayName） */
.model-row .tag-author,.model-row .tag-work,.model-row .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.model-row .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.model-row .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.model-row .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }

/* 二级菜单 */
.gh-popup { position:fixed; z-index:9999; background:var(--surf,#2a2a3c); border:1px solid var(--bd,#444); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.35); min-width:140px; }
.gh-popup-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; cursor:pointer; transition:background .1s; }
.gh-popup-item:hover { background:var(--hover,#ffffff15); }
.gh-popup-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.gh-popup-label { font-size:var(--fs-base); color:var(--txt,#cdd6f4); }

/* 创作者列表 */
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
.gh-row { display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; border:1px solid var(--bd); font-size:var(--fs-base); margin-bottom:6px; transition:background .15s; box-shadow:0 1px 3px rgba(0,0,0,.06); cursor:default; }
.gh-row-exists { opacity:.6; background:rgba(166,227,161,.06); }
.gh-row-missing { background:rgba(243,139,168,.04); }
.gh-cb { cursor:pointer; flex-shrink:0; }
.gh-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); font-size:var(--fs-base); }
.gh-badge { padding:2px 8px; border-radius:4px; font-size:var(--fs-sm); color:var(--success,#4caf50); flex-shrink:0; }
.gh-row-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.gh-size { font-size:var(--fs-sm); color:var(--muted); }
.gh-dl-model { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; transition:all .15s; }
.gh-dl-model:hover { border-color:var(--accent); color:var(--accent); }

/* ===== 仓库头部（renderRepoHeaderHTML） ===== */
.gh-header { flex:1; overflow-y:auto; padding:0 12px; }
.gh-header > :last-child { padding-bottom:12px; }
.gh-header-top { padding:8px 0 4px; display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.gh-repo-name { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-model-count { font-size:var(--fs-xs); color:var(--muted); }
.gh-missing-count { font-size:var(--fs-xs); color:var(--accent); margin-left:auto; }
.gh-filter-dropdown { display:none; width:100%; padding:4px 0 2px; gap:4px; flex-wrap:wrap; }
.gh-queue-status { display:none; padding:4px 12px; background:var(--surf); border-bottom:1px solid var(--bd); font-size:var(--fs-sm); color:var(--txt); }
.gh-search { width:100%; box-sizing:border-box; padding:4px 8px; border-radius:6px; border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:var(--fs-sm); outline:none; }
.gh-dl-btn { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; transition:all .15s; }
.gh-dl-btn:hover { border-color:var(--accent); color:var(--accent); }
.gh-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-sm); }
.gh-btn-sm { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-xs); }
.gh-btn-accent { color:var(--accent); }
.gh-btn-txt { color:var(--txt); }
.gh-btn-muted { color:var(--muted); }
.gh-btn-muted[disabled],
.gh-btn-muted:disabled { opacity:.4; pointer-events:none; }
.link-badge { display:inline-block; padding:0 5px; border-radius:3px; font-size:var(--fs-xs); font-weight:600; }
.link-badge-raw { color:#a6e3a1; background:rgba(166,227,161,.12); }
.link-badge-jsd { color:#f9a826; background:rgba(249,168,38,.12); }
.link-badge-api { color:#89b4fa; background:rgba(137,180,250,.12); }
.link-badge-cdn { color:#94e2d5; background:rgba(148,226,213,.12); }
.link-badge-ghapi { color:#cba6f7; background:rgba(203,166,247,.12); }
.gh-header-top { padding:8px 0 4px; display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.gh-repo-name { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-model-count { font-size:var(--fs-xs); color:var(--muted); }
.gh-missing-count { font-size:var(--fs-xs); color:var(--accent); margin-left:auto; }
.gh-filter-dropdown { display:none; width:100%; padding:4px 0 2px; gap:4px; flex-wrap:wrap; }
.gh-queue-status { display:none; padding:4px 12px; background:var(--surf); border-bottom:1px solid var(--bd); font-size:var(--fs-sm); color:var(--txt); }
.gh-search { width:100%; box-sizing:border-box; padding:4px 8px; border-radius:6px; border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:var(--fs-sm); outline:none; }
.gh-dl-btn { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; transition:all .15s; }
.gh-dl-btn:hover { border-color:var(--accent); color:var(--accent); }
.gh-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-sm); }
.gh-btn-sm { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-xs); }
.gh-btn-accent { color:var(--accent); }
.gh-btn-txt { color:var(--txt); }
.gh-btn-muted { color:var(--muted); }
.gh-btn-muted[disabled],
.gh-btn-muted:disabled { opacity:.4; pointer-events:none; }

/* ===== 站点卡片分组标题 ===== */
.gh-section-title { font-size:var(--fs-xs); font-weight:600; color:var(--muted); padding:8px 8px 2px; }

/* ===== 站点视图 ===== */
.gh-scroll { flex:1; overflow-y:auto; }
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
.gh-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width .2s; box-shadow:0 0 4px var(--accent); }
.gh-progress-box { padding:24px 12px; text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }
`;
