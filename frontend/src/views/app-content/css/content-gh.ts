// ===== 工坊 GitHub 族 CSS（gh-* 全族：页面布局/模型列表行/仓库头部/站点视图/
// 创作者编辑行/错误页/下载队列）。2026-09 自 content-diag.ts 按页面域拆分（锐评 P3）：
// diag 与 gh 是两个页面域，原文跨界混居导致 26KB 单文件两头维护。
export const contentGhCSS: string = `
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
.gh-loading-placeholder { padding:24px;text-align:center;color:var(--muted);font-size:var(--fs-sm); }
.gh-initial-hint { color:var(--muted);font-size:var(--fs-xs);padding:12px 0;text-align:center; }
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
.gh-card-external { width:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:var(--fs-md);color:var(--muted);cursor:pointer;border-left:1px solid var(--bd);transition:var(--tr-fast); }
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
.gh-model-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius:var(--radius-pill); font-size: var(--fs-xs); font-weight: 600; }
.gh-model-badge-total { background: var(--surf); color: var(--txt); }
.gh-model-badge-missing { background: color-mix(in srgb, var(--status-error) 12%, transparent); color: var(--status-error); }
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
.gh-left-head-label { font-size:var(--fs-sm);font-weight:600;color:var(--muted); }
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
.gh-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width 0.06s linear; box-shadow:0 0 4px var(--accent); animation:breathe-subtle 4s ease-in-out infinite;will-change:filter,box-shadow; }
.gh-progress-pct.gh-progress-error { color:var(--status-error); }
.gh-progress-fill.gh-progress-fill-error { background:var(--status-error); }
.gh-progress-box { padding:24px 12px; text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }
.gh-name-wrap { display:flex; align-items:center; gap:6px; min-width:0; }
`;
/* P1 批次12:工坊行名称容器(community/render.ts nameWrap,gh-row 列1 内部 flex 容器) */
