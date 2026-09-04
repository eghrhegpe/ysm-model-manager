// ===== 诊断页(diag-*) + 性能(perf-*) + 日志(log-*) + 冲突(conflict-*) + 扫描(scan-*) + 工坊 GitHub（gh-* 全族）+ 二级菜单 + 模型列表行 + 队列状态 =====
// 注：设置页 .stg-* / .tab-body / .settings-group / .setting-row 已收口 content-stg.ts（并入 shadow）；
//     components.css 仅服务全局 document 层 dialogs（.dlg-*/.afv-*/.mc-pick-*/.br-* 等），不再含 stg/settings。
export const contentDiagCSS: string = `
/* ===== 诊断页面：左栏按钮 + 右栏信息 ===== */
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
.log-row .log-op { font-size:var(--fs-xs); padding:0 4px; border-radius:4px; background:color-mix(in srgb, var(--accent) 18%, transparent); color:var(--accent); flex-shrink:0; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }

.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:var(--status-error); }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }

/* ===== 诊断页动画 ===== */
@keyframes logRowIn { from { opacity:0; transform:translateX(-12px); } to { opacity:1; transform:translateX(0); } }
.log-row { animation: fadeSlideLeft .25s ease both; }
@keyframes conflictRowIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
.conflict-row, .conflict-ins { animation: conflictRowIn .3s ease both; }
@keyframes scanPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.15); } }
.btn-base.accent.scanning { animation: scanPulse 1s ease-in-out infinite; pointer-events:none; opacity:.7; }
@keyframes scanRadar {
  0%   { background: conic-gradient(from 0deg, transparent 0%, var(--accent) 10%, transparent 20%); }
  100% { background: conic-gradient(from 360deg, transparent 0%, var(--accent) 10%, transparent 20%); }
}
.scan-radar-wrap { position:relative; display:flex; align-items:center; justify-content:center; padding:24px; }
.scan-radar { width:80px; height:80px; border-radius:50%; border:2px solid var(--bd); animation: scanRadar 2s linear infinite; opacity:.5; }
.scan-radar-dot { position:absolute; width:8px; height:8px; border-radius:50%; background:var(--accent); animation: scanDot 2s linear infinite; }
@keyframes scanDot {
  0%   { top:4px; left:50%; transform:translateX(-50%); }
  25%  { top:50%; left:calc(100% - 4px); transform:translateY(-50%); }
  50%  { top:calc(100% - 4px); left:50%; transform:translateX(-50%); }
  75%  { top:50%; left:4px; transform:translateY(-50%); }
  100% { top:4px; left:50%; transform:translateX(-50%); }
}
:host-context(.no-animations) .log-row, :host-context(.no-animations) .conflict-row, :host-context(.no-animations) .conflict-ins { animation: none !important; }
:host-context(.no-animations) .btn-base.accent.scanning { animation: none !important; }

.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:var(--diag-left-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); padding:8px; gap:4px; background:var(--surf); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:var(--radius-md); border:none; background:transparent; color:var(--muted); font-size:var(--fs-md); cursor:pointer; font-family:inherit; transition:var(--tr-fast); width:100%; text-align:left; }
.diag-btn:hover { background:var(--hover); color:var(--txt); }
.diag-btn.active { background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); }
.diag-panel { animation: diagPanelIn .2s ease; }
@keyframes diagPanelIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
.diag-btn-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:var(--fs-md); }
.diag-log-fbtn { font-size:var(--fs-sm);padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer; }
.diag-log-fbtn:hover { background:var(--hover);color:var(--txt); }
.diag-log-fbtn.active { background:var(--accent); color:var(--bg); border-color:var(--accent); }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:var(--muted); }
.diag-stat-error { color: var(--status-error); }

/* ===== 性能面板（single-bench / gui-flow / perf-log） ===== */
.perf-section { font-size:var(--fs-sm); font-weight:600; color:var(--txt); display:flex; align-items:center; gap:6px; }
.perf-bar-row { display:flex; align-items:center; gap:8px; margin:2px 0; font-size:var(--fs-xs); }
.perf-bar-name { flex:0 0 118px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); }
.perf-bar-track { flex:1; height:12px; background:var(--surf); border:1px solid var(--bd); border-radius:6px; overflow:hidden; }
.perf-bar-fill { display:block; height:100%; background:var(--accent); border-radius:6px; }
.perf-bar-fill.perf-bar-warn { background: var(--warning, #e6b800); }
.perf-bar-fill.perf-bar-danger { background: var(--status-error); }
.perf-bar-val { flex:0 0 auto; min-width:130px; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.perf-bar-val.perf-bar-warn { color: var(--warning, #b8860b); }
.perf-bar-val.perf-bar-danger { color: var(--status-error); }
.perf-total { padding:6px 2px; font-size:var(--fs-base); font-weight:600; color:var(--txt); border-top:1px solid var(--bd); margin-top:8px; }
.perf-gui-stage { display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); color:var(--txt); padding:3px 2px; flex-wrap:wrap; }
.perf-gui-stage .perf-gui-status { font-size:var(--fs-base); }
.perf-gui-stage .perf-gui-name { font-weight:600; }
.perf-gui-stage .perf-gui-ms { flex:1; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
.perf-gui-desc { flex-basis:100%; display:block; font-size:var(--fs-xs); color:var(--muted); padding-left:10px; white-space:pre-wrap; }
.perf-gui-stage.perf-gui-fail { color: var(--status-error); }
.perf-gui-stage.perf-gui-fail .perf-gui-ms { color: var(--status-error); }
.perf-hist-card { border:1px solid var(--bd); border-radius:var(--radius-md); background:var(--surf); padding:6px 10px; margin:4px 0; animation: conflictRowIn .3s ease both; }
.perf-hist-head { display:block; font-size:var(--fs-sm); color:var(--txt); margin-bottom:2px; }
.perf-hist-head code { background:var(--bg); padding:0 4px; border-radius:3px; font-size:var(--fs-xs); }
.perf-hist-body { display:block; font-size:var(--fs-xs); color:var(--muted); white-space:pre-wrap; }
:host-context(.no-animations) .perf-hist-card { animation:none !important; }

/* ===== 加载剖析面板 ===== */
.perf-trace-meta { font-size:var(--fs-xs);color:var(--muted);word-break:break-all; }
.perf-gantt-wrap { padding:6px 2px; }
.perf-asset-grid { display:flex;flex-wrap:wrap;gap:4px 12px;padding:6px 2px;font-size:var(--fs-xs); }
.perf-asset-item { color:var(--txt);white-space:nowrap; }
.perf-badge-ok { color:var(--status-success);font-weight:600; }
.perf-badge-warn { color:var(--warning,#b8860b); }
.perf-tex-section { font-size:var(--fs-xs);color:var(--muted);padding:4px 2px;line-height:1.6; }
.perf-tex-row { display:flex;align-items:center;gap:6px;padding:1px 0; }
.perf-tex-name { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt); }
.perf-tex-size { color:var(--muted);font-size:var(--fs-xs);flex-shrink:0; }
.perf-ktx2-badge { font-size:8px;padding:0 3px;border-radius:3px;background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent);flex-shrink:0; }
.perf-tex-more { color:var(--muted);font-size:var(--fs-xs);padding:2px 0; }
.perf-no-data { color:var(--muted);font-size:var(--fs-sm);padding:12px 2px;text-align:center; }
.perf-no-hint { color:var(--muted);font-size:var(--fs-xs);padding:2px 2px 8px;text-align:center;opacity:.7; }
.perf-trace-hint { color:var(--muted);font-size:var(--fs-xs);padding:4px 2px 8px;text-align:center;opacity:.6;border-top:1px solid var(--bd);margin-top:6px; }

:host-context(.no-animations) #set-advanced-panel { animation: none !important; }

/* ===== 创意工坊 GitHub (gh-) ===== */
.gh-page { flex:1; display:flex; overflow:hidden; position:relative; }
.gh-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.gh-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
#gh-results { flex:1;display:flex;flex-direction:column;overflow:hidden; }
#gh-results-body { flex:1;overflow-y:auto;padding:0 12px 8px;will-change:scroll-position; }
.gh-search-wrap { padding:2px 0 6px; }
.gh-search { width:160px;padding:4px 8px;border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; }
.gh-search:focus { border-color:var(--accent); }
.gh-loading-placeholder { padding:24px;text-align:center;color:var(--muted);font-size:11px; }
.gh-initial-hint { color:var(--muted);font-size:10px;padding:12px 0;text-align:center; }
.gh-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px;will-change:scroll-position; }
.gh-card { display:flex; align-items:center; gap:var(--card-gap,8px); padding:var(--card-padding,7px 10px); border-radius:var(--radius-lg); border:1px solid var(--bd); background:var(--card); cursor:pointer; transition:var(--tr-normal), box-shadow var(--tr-normal); box-shadow:var(--card-shadow, none); transform:translateZ(0); animation:fadeSlideUp var(--tr-enter) both; }
.gh-card:hover { border-color:var(--accent); background:var(--hover); box-shadow:var(--card-shadow-hover, none); transform:translateY(-1px); }
.gh-card.active { border-color:var(--accent); background:var(--accent); color:var(--bg); box-shadow:var(--card-shadow-hover, none); }
.gh-card .name { font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--txt); font-family:var(--font-display); overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.gh-card .name + .meta { margin-top:1px; font-size:var(--fs-xs); color:var(--muted); }
.gh-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
.gh-card-icon { font-size:16px; width:24px; text-align:center; flex-shrink:0; transition:transform var(--tr-normal); }
.gh-card:hover .gh-card-icon { transform:rotate(-8deg) scale(1.1); }
.gh-card-body { flex:1; min-width:0; }
.gh-card-label { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-card.active .gh-card-label { color:var(--bg); }
.gh-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:0; }
.gh-card.active .gh-card-desc { color:var(--bg); }
.gh-card-external { width:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);cursor:pointer;border-left:1px solid var(--bd);transition:var(--tr-fast); }
.gh-card-external:hover { color:var(--accent);background:var(--hover); }
.gh-card.active .gh-card-external { border-left-color:var(--accent);color:var(--accent); }
.gh-section-title { font-size:var(--fs-md);font-weight:600;color:var(--txt);padding:8px 12px 4px; }
.gh-header { border-bottom:1px solid var(--bd);flex-shrink:0; }
.gh-header-top { display:flex;align-items:center;gap:8px;padding:8px 12px; }
.gh-header-repo { display:flex;align-items:center;gap:8px;padding:0 12px 8px; }
.gh-header-actions { display:flex;align-items:center;gap:8px;padding:0 12px 8px;position:relative; }
.gh-section-fill { flex:1; }
.gh-back-repo { font-size:var(--fs-sm);padding:2px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-family:inherit; }
.gh-back-repo:hover { background:var(--hover); }
.gh-btn-txt { border-color:transparent; }
.gh-repo-name { font-size:var(--fs-md);font-weight:600;color:var(--txt);flex:1; }
.gh-model-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 20px; font-size: var(--fs-xs); font-weight: 600; }
.gh-model-badge-total { background: var(--surf); color: var(--txt); }
.gh-model-badge-missing { background: color-mix(in srgb, var(--status-error) 12%, transparent); color: var(--status-error); }
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

/* 二级菜单 */
.gh-popup { position:fixed; z-index:var(--z-popover); background:var(--surf,#2a2a3c); border:1px solid var(--bd,#444); border-radius:var(--radius-lg); padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.35); min-width:140px; }
.gh-popup-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--radius-md); cursor:pointer; transition:background var(--tr-fast); }
.gh-popup-item:hover { background:var(--hover,#ffffff15); }
.gh-popup-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.gh-popup-label { font-size:var(--fs-base); color:var(--txt,#cdd6f4); }

/* 创作者列表（GitHub 侧栏） */
.gh-left-head { padding:4px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap; }
.gh-left-head-label { font-size:11px;font-weight:600;color:var(--muted); }
.gh-left-head-spacer { flex:1; }
.gh-left-foot { padding:4px 12px 8px;font-size:8px;color:var(--muted); }
.gh-creators-list { flex:1; overflow-y:auto; padding:6px 12px; display:flex; flex-direction:column; gap:4px; }
.gh-creator-card { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--radius-md); border:1px solid var(--bd); background:var(--surf); cursor:pointer; transition:var(--tr-fast); }
.gh-creator-card:hover { border-color:var(--accent); background:var(--hover); }
.gh-creator-icon { font-size:var(--fs-lg); width:22px; text-align:center; flex-shrink:0; }
.gh-creator-body { flex:1; min-width:0; }
.gh-creator-name { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-creator-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:1px; }
.gh-creator-action { font-size:var(--fs-base); color:var(--muted); flex-shrink:0; }

/* ===== 模型列表行 ===== */
.gh-empty { padding:12px; text-align:center; color:var(--muted); font-size:var(--fs-sm); }
.gh-row { display: grid; grid-template-columns: 1fr max-content max-content; gap: 8px; align-items: center; padding: 6px 10px; border-radius: var(--radius-md); margin-bottom: 2px; border-left: 3px solid transparent; font-size: var(--fs-sm); transition: background var(--tr-fast); }
.gh-row:hover { background: var(--hover); }
.gh-row-exists { border-left-color: var(--status-success); background: transparent; }
.gh-row-exists .gh-name { color: var(--muted); }
.gh-row-missing { border-left-color: var(--status-error); background: color-mix(in srgb, var(--status-error) 4%, transparent); }
.gh-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--txt); font-size: var(--fs-sm); }
.gh-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-md); border: 1px solid transparent; background: transparent; cursor: pointer; transition: var(--tr-fast); }
.gh-icon-btn:hover { background: var(--hover); border-color: var(--bd); }
.gh-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.gh-icon-btn .ws-icon { width: 14px; height: 14px; }
.gh-dl-btn { border-color: var(--accent); color: var(--accent); }
.gh-dl-btn:hover { background: var(--accent); color: var(--bg); }
.gh-dl-btn:disabled { border-color: var(--bd); color: var(--muted); }
.gh-cb { accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
.gh-badge { padding:2px 8px; border-radius:var(--radius-sm); font-size:var(--fs-sm); color:var(--status-success); flex-shrink:0; }
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

/* ===== 站点卡片分组标题 ===== */
.gh-section-title { font-size:var(--fs-xs); font-weight:600; color:var(--muted); padding:8px 8px 2px; }

/* ===== 站点视图 ===== */
.gh-scroll { flex:1; overflow-y:auto; }

.gh-section { padding:6px 12px 4px; display:flex; align-items:center; gap:4px; }
.gh-section-title-lg { font-size:var(--fs-sm); font-weight:600; color:var(--txt); }
.gh-section-sub { font-size:var(--fs-xs); color:var(--muted); }
.gh-preset-area { padding:8px 12px 4px; display:flex; gap:4px; flex-wrap:wrap; }
.gh-preset-btn { padding:2px 6px; border-radius:var(--radius-sm); border:1px solid var(--bd); background:var(--surf); color:var(--accent); cursor:pointer; font-size:var(--fs-xs); }
.gh-action-btn { padding:4px 12px; border-radius:var(--radius-md); border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-base); }
.gh-action-btn-accent { color:var(--accent); }
.gh-action-btn-muted { color:var(--muted); }
.gh-save-btn { padding:4px 14px; border-radius:var(--radius-md); border:none; background:var(--accent); color:var(--bg); cursor:pointer; font-size:var(--fs-base); }
.gh-hint-text { font-size:8px; color:var(--muted); padding:0 12px 4px; }

/* ===== 创作者编辑行（GitHub 侧栏编辑） ===== */
.gh-cr-row { display:flex; align-items:center; gap:3px; padding:4px 6px; border-radius:var(--radius-sm); border:1px solid var(--bd); font-size:var(--fs-sm); margin:1px 12px; }
.gh-cr-input { flex:2; min-width:30px; padding:2px 4px; border-radius:var(--radius-xs); border:1px solid transparent; background:transparent; font-size:var(--fs-sm); }
.gh-cr-input-name { color:var(--txt); }
.gh-cr-input-desc { color:var(--muted); font-size:var(--fs-xs); }
.gh-cr-input-type { flex:1; min-width:30px; padding:2px 4px; border-radius:var(--radius-xs); border:1px solid transparent; background:transparent; color:var(--accent); font-size:var(--fs-xs); text-align:center; }
.gh-cr-del { padding:1px 4px; border-radius:var(--radius-xs); border:1px solid transparent; background:transparent; color:var(--status-error); cursor:pointer; font-size:var(--fs-sm); }
.gh-cr-add-area { padding:4px 12px; }
.gh-cr-add { padding:2px 8px; border-radius:var(--radius-sm); border:1px dashed var(--bd); background:transparent; color:var(--accent); cursor:pointer; font-size:var(--fs-sm); width:100%; }

.gh-empty-site { flex:1; overflow-y:auto; padding:12px; color:var(--muted); font-size:var(--fs-sm); }
.gh-site-link { color:var(--accent); }

/* ===== 错误页 ===== */
.gh-error-page { padding:12px; text-align:center; }
.gh-error-msg { color:var(--muted); font-size:var(--fs-sm); line-height:1.6; }
.gh-error-hint { font-size:var(--fs-xs); opacity:.6; }
.gh-back-btn { padding:2px 8px; border-radius:var(--radius-sm); border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-sm); }

/* ===== 下载队列 ===== */
.gh-queue-icon { color:var(--accent); }
.gh-queue-error { padding:2px 0; font-size:var(--fs-sm); color:var(--status-error); }
.gh-queue-err-item { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-ellipsis { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-cancel { font-size:var(--fs-sm); color:var(--muted); }
.gh-progress-row { display:flex; align-items:center; gap:4px; }
.gh-progress-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-sm); }
.gh-progress-pct { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-progress-remain { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-cancel-btn { width:20px; height:20px; border-radius:50%; border:none; background:rgba(128,128,128,.15); color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:background var(--tr-normal); }
.gh-cancel-btn:hover { background:rgba(128,128,128,.3); }
.gh-progress-bar-wrap { margin-top:3px; height:4px; border-radius:2px; background:var(--bd); overflow:hidden; }
.gh-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width .2s; box-shadow:0 0 4px var(--accent); animation:breathe-subtle 4s ease-in-out infinite;will-change:filter,box-shadow; }
.gh-progress-pct.gh-progress-error { color:var(--status-error); }
.gh-progress-fill.gh-progress-fill-error { background:var(--status-error); }
.gh-progress-box { padding:24px 12px; text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }

/* ===== 诊断页去重 UI (diag-dedup) ===== */
.diag-msg { padding:12px;font-size:11px; }
.diag-msg-error { color:var(--status-error); }
.diag-msg-success { color:var(--status-success); }
.diag-msg-muted { color:var(--muted); }
.diag-dedup-summary { padding:10px 12px;font-size:11px;color:var(--txt);border-bottom:1px solid var(--bd); }
.diag-dedup-summary-hint { display:block;font-size:9px;color:var(--muted);margin-top:2px; }
.diag-dedup-rt { display:flex;align-items:center;gap:4px;padding:6px 12px 2px;font-size:10px;font-weight:600;color:var(--txt); }
.diag-dedup-rt-sep { flex:1;border-bottom:1px solid var(--bd);margin-left:6px; }
.diag-dedup-rt-count { font-size:9px;color:var(--muted);font-weight:400; }
.diag-dedup-group { margin:4px 12px;border:1px solid var(--bd);border-radius:var(--radius-lg);overflow:hidden; }
.diag-dedup-group-head { display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd); }
.diag-dedup-group-fill { flex:1; }
.diag-dedup-group-info { font-size:9px;color:var(--muted);font-weight:400; }
.diag-dedup-file { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background var(--tr-fast); }
.diag-dedup-file-default { background:var(--hover); }
.diag-dedup-file-name { flex:1;overflow:hidden;min-width:0; }
.diag-dedup-file-name-text { color:var(--txt);font-size:10px;cursor:pointer; }
.diag-dedup-file-ic { margin-right:3px; }
.diag-dedup-file-dir { display:block;font-size:8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.diag-dedup-file-size { font-size:9px;color:var(--muted);flex-shrink:0;margin-right:4px; }
.diag-dedup-file-date { font-size:8px;color:var(--muted);flex-shrink:0; }
.diag-dedup-recommend { font-size:8px;padding:0 4px;border-radius:var(--radius-xs);background:color-mix(in srgb, var(--status-success) 12%, transparent);color:var(--status-success); }
.diag-dedup-radio { flex-shrink:0;accent-color:var(--accent); }
.diag-dedup-keep-all { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:10px;cursor:pointer;transition:background var(--tr-fast);border-top:1px solid var(--bd); }
.diag-dedup-keep-all-label { color:var(--muted); }
.diag-dedup-actions { display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--bd); }
.diag-dedup-exec { flex:1;padding:7px 16px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--bg);cursor:pointer;font-size:11px;font-family:inherit; }
.diag-dedup-cancel { padding:7px 16px;border-radius:var(--radius-md);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;font-family:inherit; }

/* ===== 诊断页配置面板（conflicts.ts / dedup.ts / health.ts 渲染） =====
   这些类此前在 shadow 内无 CSS 规则，裸奔靠 UA 默认样式（WebView2 暗色不协调）；
   机检 css-layer-check 的 WARN 暴露后补显式样式（评审 2026-08-24 第 1 条盲区收口）。 */
.diag-config-item { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:var(--fs-sm); color:var(--txt); }
.diag-config-select, .diag-config-input { padding:var(--btn-padding-sm); border-radius:var(--radius-md); border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:var(--fs-sm); font-family:inherit; min-width:160px; }
.diag-config-select:focus, .diag-config-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.diag-sync-config { padding:8px 12px; border:1px solid var(--bd); border-radius:var(--radius-md); margin:4px 0; background:var(--surf); }
.diag-sync-resolve { margin-top:16px; padding:12px; background:var(--diag-stat-bg, var(--surf)); border-radius:8px; }
.diag-dedup-config { padding:8px 12px; }
.diag-warn { color:var(--status-warning, #e6b800); font-weight:600; }

/* P1 批次12:工坊行名称容器(community/render.ts nameWrap,gh-row 列1 内部 flex 容器) */
.gh-name-wrap { display:flex; align-items:center; gap:6px; min-width:0; }
`;
