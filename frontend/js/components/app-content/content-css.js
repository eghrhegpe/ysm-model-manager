export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; background:var(--bg); }
@keyframes dl-slide-up {
  from { opacity:0; transform:translateY(8px); max-height:0; padding:0 4px }
  to   { opacity:1; transform:translateY(0); max-height:30px; padding:2px 4px }
}
#dl-imported-list > div { animation:dl-slide-up .25s ease-out both; }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:14px; font-weight:600; color:var(--txt); padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:var(--surf); border:1px solid var(--bd); border-radius:10px; padding:14px; }
.stat-card .num { font-size:24px; font-weight:700; color:var(--accent); transition:transform .2s cubic-bezier(.34,1.56,.64,1); }
.stat-card .num.bump { transform:scale(1.15); }
.stat-card .label { font-size:11px; color:var(--muted); margin-top:2px; }
.stat-card .sub { font-size:10px; color:var(--txt); margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:12px; gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:9px; background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout-wrap { flex:1; }
.repo-wrap { display:flex;flex-direction:column;flex:1;overflow:hidden; }
.repo-topbar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-wrap:nowrap;overflow-x:auto; }
.repo-title { font-size:12px;font-weight:600;flex-shrink:0; }
.repo-bar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd); }
.repo-bar:empty { padding:0;border-bottom:none; }
.repo-srch { width:140px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:10px;outline:none; }
.repo-bar-spacer { flex:1; }
.repo-bar-btn { padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px; }
.repo-bar-btn:hover { background:var(--hover);color:var(--txt); }
.repo-spacer { flex:1; }
.repo-btn { font-size:9px;padding:2px 8px; }

.repo-srch { width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px;outline:none;flex-shrink:0; }
.repo-srch:focus { border-color:var(--accent); }
.repo-sort { padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:10px;cursor:pointer;margin-left:auto; }
.batch-dropdown { position:relative;display:inline-block; }
.batch-menu { position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);min-width:120px; }
.hdr-btn { padding:4px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:11px;font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.repo-footer { padding:3px 12px;font-size:9px;color:var(--muted);border-top:1px solid var(--bd);flex-shrink:0; }
.stg-page { flex:1;overflow-y:auto;padding:12px; }
.stg-title { margin-bottom:8px; }
.stg-sub-title { margin-top:16px; }
.stg-group { margin-bottom:12px; }
.stg-val { font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px; }
.stg-btn { font-size:10px; }
.stg-hint { font-size:9px;color:var(--muted,#6c7086);padding:2px 0 0 0; }
.stg-ml-auto { margin-left:auto; }
.stg-radio-row { display:flex;gap:8px;padding:4px 0; }
.stg-label { display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer; }
.stg-hint-hidden { font-size:9px;color:var(--muted,#6c7086);padding:2px 0 0 0;display:none; }
.stg-hint-warn { font-size:9px;color:#e5534b; }
.stg-select { background:var(--bg,#1e1e2e);color:var(--txt,#cdd6f4);border:1px solid var(--bd,#444);border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer; }
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surf); border-radius:6px; margin-bottom:4px; font-size:12px; }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--muted); }
/* 诊断页面：左栏按钮 + 右栏信息 */
.hdr-btn { padding:4px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:11px; font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.hdr-btn.accent { background:#7c83ff33; color:var(--accent); border-color:#7c83ff55; }
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:11px; align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:10px; width:20px; text-align:center; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
.log-row .log-msg .tag-author,.log-row .log-msg .tag-work,.log-row .log-msg .tag-date,.recy-item .tag-author,.recy-item .tag-work,.recy-item .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.log-row .log-msg .tag-author, .recy-item .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.log-row .log-msg .tag-work, .recy-item .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.log-row .log-msg .tag-date, .recy-item .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.log-row .log-time { font-size:9px; color:var(--muted); flex-shrink:0; }
.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:11px; color:var(--txt); }
.conflict-name { color:#f38ba8; }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:10px; color:var(--txt); }
.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:120px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); padding:8px; gap:4px; background:var(--surf); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:none; background:transparent; color:var(--muted); font-size:12px; cursor:pointer; font-family:inherit; transition:all .12s; width:100%; text-align:left; }
.diag-btn:hover { background:var(--hover); color:var(--txt); }
.diag-btn.active { background:#7c83ff22; color:var(--accent); }
.diag-btn-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:13px; }
.diag-log-fbtn.active { background:var(--accent) !important; color:#fff !important; border-color:var(--accent) !important; }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:12px; font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:12px; color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:11px; display:block; text-align:center; }
.diag-stat-muted { color:#6c7086; }

/* 创意工坊 */
.ws-page { flex:1; display:flex; overflow:hidden; position:relative; }
.ws-left { width:200px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.ws-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.ws-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.ws-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.ws-card { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:6px; border:1px solid var(--bd); background:var(--bg); cursor:pointer; transition:all .12s; }
.ws-card:hover { border-color:var(--accent); background:var(--hover); }
.ws-card.active { border-color:var(--accent); background:var(--accent); color:#fff; }
.ws-card-icon { font-size:16px; width:24px; text-align:center; flex-shrink:0; }
.ws-card-body { flex:1; min-width:0; }
.ws-card-label { font-size:11px; font-weight:600; color:var(--txt); }
.ws-card.active .ws-card-label { color:#fff; }
.ws-card-desc { font-size:9px; color:var(--muted); margin-top:0; }
.ws-card.active .ws-card-desc { color:#fffd; }
.ws-browser-bar { display:flex; align-items:center; gap:8px; padding:6px 12px; background:var(--surf); border-bottom:1px solid var(--bd); flex-shrink:0; }
.ws-back { padding:4px 10px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:11px; font-family:inherit; }
.ws-back:hover { background:var(--hover); }
.ws-url { flex:1; font-size:10px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ws-open-btn { padding:4px 10px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--accent); cursor:pointer; font-size:10px; font-family:inherit; }
.ws-open-btn:hover { background:var(--hover); }

/* 模型名高亮标签（复用 display.js renderDisplayName） */
.model-row .tag-author,.model-row .tag-work,.model-row .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.model-row .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.model-row .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.model-row .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }

/* 二级菜单 */
.ws-popup { position:fixed; z-index:9999; background:var(--surf,#2a2a3c); border:1px solid var(--bd,#444); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.35); min-width:140px; }
.ws-popup-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; cursor:pointer; transition:background .1s; }
.ws-popup-item:hover { background:var(--hover,#ffffff15); }
.ws-popup-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }
.ws-popup-label { font-size:11px; color:var(--txt,#cdd6f4); }

/* 创作者列表 */
.ws-creators-list { flex:1; overflow-y:auto; padding:6px 12px; display:flex; flex-direction:column; gap:4px; }
.ws-creator-card { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; border:1px solid var(--bd); background:var(--surf); cursor:pointer; transition:all .12s; }
.ws-creator-card:hover { border-color:var(--accent); background:var(--hover); }
.ws-creator-icon { font-size:14px; width:22px; text-align:center; flex-shrink:0; }
.ws-creator-body { flex:1; min-width:0; }
.ws-creator-name { font-size:11px; font-weight:600; color:var(--txt); }
.ws-creator-desc { font-size:9px; color:var(--muted); margin-top:1px; }
.ws-creator-action { font-size:11px; color:var(--muted); flex-shrink:0; }

/* ===== 模型列表行 ===== */
.ws-empty { padding:12px; text-align:center; color:var(--muted); font-size:10px; }
.ws-row { display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; border:1px solid var(--bd); font-size:11px; margin-bottom:6px; transition:background .15s; box-shadow:0 1px 3px rgba(0,0,0,.06); cursor:default; }
.ws-row-exists { opacity:.6; background:rgba(166,227,161,.06); }
.ws-row-missing { background:rgba(243,139,168,.04); }
.ws-cb { cursor:pointer; flex-shrink:0; }
.ws-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); font-size:11px; }
.ws-badge { padding:2px 8px; border-radius:4px; font-size:10px; color:var(--success,#4caf50); flex-shrink:0; }
.ws-row-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.ws-size { font-size:10px; color:var(--muted); }
.ws-dl-model { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:11px; flex-shrink:0; transition:all .15s; }
.ws-dl-model:hover { border-color:var(--accent); color:var(--accent); }

/* ===== 仓库头部（renderRepoHeaderHTML） ===== */
.ws-header { flex:1; overflow-y:auto; padding:0 12px; }
.ws-header > :last-child { padding-bottom:12px; }
.ws-header-top { padding:8px 0 4px; display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.ws-repo-name { font-size:11px; font-weight:600; color:var(--txt); }
.ws-model-count { font-size:9px; color:var(--muted); }
.ws-missing-count { font-size:9px; color:var(--accent); margin-left:auto; }
.ws-filter-dropdown { display:none; width:100%; padding:4px 0 2px; gap:4px; flex-wrap:wrap; }
.ws-queue-status { display:none; padding:4px 12px; background:var(--surf); border-bottom:1px solid var(--bd); font-size:10px; color:var(--txt); }
.ws-search { width:100%; box-sizing:border-box; padding:4px 8px; border-radius:6px; border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:10px; outline:none; }
.ws-dl-btn { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:11px; flex-shrink:0; transition:all .15s; }
.ws-dl-btn:hover { border-color:var(--accent); color:var(--accent); }
.ws-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:10px; }
.ws-btn-sm { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:9px; }
.ws-btn-accent { color:var(--accent); }
.ws-btn-txt { color:var(--txt); }
.ws-btn-muted { color:var(--muted); }
.ws-btn-muted[disabled],
.ws-btn-muted:disabled { opacity:.4; pointer-events:none; }
.link-badge { display:inline-block; padding:0 5px; border-radius:3px; font-size:9px; font-weight:600; }
.link-badge-raw { color:#a6e3a1; background:rgba(166,227,161,.12); }
.link-badge-jsd { color:#f9a826; background:rgba(249,168,38,.12); }
.link-badge-api { color:#89b4fa; background:rgba(137,180,250,.12); }
.link-badge-cdn { color:#94e2d5; background:rgba(148,226,213,.12); }
.link-badge-ghapi { color:#cba6f7; background:rgba(203,166,247,.12); }
.ws-header-top { padding:8px 0 4px; display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.ws-repo-name { font-size:11px; font-weight:600; color:var(--txt); }
.ws-model-count { font-size:9px; color:var(--muted); }
.ws-missing-count { font-size:9px; color:var(--accent); margin-left:auto; }
.ws-filter-dropdown { display:none; width:100%; padding:4px 0 2px; gap:4px; flex-wrap:wrap; }
.ws-queue-status { display:none; padding:4px 12px; background:var(--surf); border-bottom:1px solid var(--bd); font-size:10px; color:var(--txt); }
.ws-search { width:100%; box-sizing:border-box; padding:4px 8px; border-radius:6px; border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:10px; outline:none; }
.ws-dl-btn { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:11px; flex-shrink:0; transition:all .15s; }
.ws-dl-btn:hover { border-color:var(--accent); color:var(--accent); }
.ws-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:10px; }
.ws-btn-sm { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:9px; }
.ws-btn-accent { color:var(--accent); }
.ws-btn-txt { color:var(--txt); }
.ws-btn-muted { color:var(--muted); }
.ws-btn-muted[disabled],
.ws-btn-muted:disabled { opacity:.4; pointer-events:none; }

/* ===== 站点卡片分组标题 ===== */
.ws-section-title { font-size:9px; font-weight:600; color:var(--muted); padding:8px 8px 2px; }

/* ===== 站点视图 ===== */
.ws-scroll { flex:1; overflow-y:auto; }
.ws-section { padding:6px 12px 4px; display:flex; align-items:center; gap:4px; }
.ws-section-title-lg { font-size:10px; font-weight:600; color:var(--txt); }
.ws-section-sub { font-size:9px; color:var(--muted); }
.ws-preset-area { padding:8px 12px 4px; display:flex; gap:4px; flex-wrap:wrap; }
.ws-preset-btn { padding:2px 6px; border-radius:4px; border:1px solid var(--bd); background:var(--surf); color:var(--accent); cursor:pointer; font-size:9px; }
.ws-action-btn { padding:4px 12px; border-radius:6px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:11px; }
.ws-action-btn-accent { color:var(--accent); }
.ws-action-btn-muted { color:var(--muted); }
.ws-save-btn { padding:4px 14px; border-radius:6px; border:none; background:var(--accent); color:#fff; cursor:pointer; font-size:11px; }
.ws-hint-text { font-size:8px; color:var(--muted); padding:0 12px 4px; }

/* ===== 创作者编辑行 ===== */
.ws-cr-row { display:flex; align-items:center; gap:3px; padding:4px 6px; border-radius:4px; border:1px solid var(--bd); font-size:10px; margin:1px 12px; }
.ws-cr-input { flex:2; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; font-size:10px; }
.ws-cr-input-name { color:var(--txt); }
.ws-cr-input-desc { color:var(--muted); font-size:9px; }
.ws-cr-input-type { flex:1; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:var(--accent); font-size:9px; text-align:center; }
.ws-cr-del { padding:1px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:#e5534b; cursor:pointer; font-size:10px; }
.ws-cr-add-area { padding:4px 12px; }
.ws-cr-add { padding:2px 8px; border-radius:4px; border:1px dashed var(--bd); background:transparent; color:var(--accent); cursor:pointer; font-size:10px; width:100%; }
.ws-empty-site { flex:1; overflow-y:auto; padding:12px; color:var(--muted); font-size:10px; }
.ws-site-link { color:var(--accent); }

/* ===== 错误页 ===== */
.ws-error-page { padding:12px; text-align:center; }
.ws-error-msg { color:var(--muted); font-size:10px; line-height:1.6; }
.ws-error-hint { font-size:9px; opacity:.6; }
.ws-back-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:10px; }

/* ===== 下载队列 ===== */
.ws-queue-icon { color:var(--accent); }
.ws-queue-error { padding:2px 0; font-size:10px; color:#f38ba8; }
.ws-queue-err-item { font-size:9px; color:var(--muted); padding:0 4px; }
.ws-queue-ellipsis { font-size:9px; color:var(--muted); padding:0 4px; }
.ws-queue-cancel { font-size:10px; color:var(--muted); }
.ws-progress-row { display:flex; align-items:center; gap:4px; }
.ws-progress-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
.ws-progress-pct { font-size:9px; color:var(--muted); flex-shrink:0; }
.ws-progress-remain { font-size:9px; color:var(--muted); flex-shrink:0; }
.ws-cancel-btn { width:20px; height:20px; border-radius:50%; border:none; background:rgba(128,128,128,.15); color:var(--muted); cursor:pointer; font-size:11px; flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:background .15s; }
.ws-cancel-btn:hover { background:rgba(128,128,128,.3); }
.ws-progress-bar-wrap { margin-top:3px; height:4px; border-radius:2px; background:var(--bd); overflow:hidden; }
.ws-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width .2s; box-shadow:0 0 4px var(--accent); }
.ws-progress-box { padding:24px 12px; text-align:center; }
.ws-progress-label { font-size:10px; color:var(--muted); margin-bottom:8px; }
`;
