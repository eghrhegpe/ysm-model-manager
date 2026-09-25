// ===== 工坊 GitHub 族 CSS（gh-* 全族：页面布局/模型列表行/仓库头部/
// 下载队列）。2026-09 自 content-diag.ts 按页面域拆分（锐评 P3）：
// diag 与 gh 是两个页面域，原文跨界混居导致 26KB 单文件两头维护。
// 2026-09 锐评复核：原「创作者列表（GitHub 侧栏）」「创作者编辑行」两块 `.gh-creator-*` /
// `.gh-cr-*` 全族已无生产者（GitHub 侧栏早已改仓库卡网格），随锐评 P1-6 删除。
export const contentGhCSS: string = `
/* ===== 创意工坊 GitHub (gh-) ===== */
.gh-page { flex:1; display:flex; overflow:hidden; position:relative; }
.gh-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.gh-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
#gh-results { flex:1;display:flex;flex-direction:column;overflow:hidden; }
#gh-results-body { flex:1;overflow-y:auto;padding:0 12px 8px;will-change:scroll-position; }
.gh-search-wrap { padding:2px 0 6px; }
.gh-search { width:160px;padding:var(--sp-vh-cell);border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; } /* 语义收口：搜索输入框非按钮，归容器档 */
.gh-search:focus { border-color:var(--accent); }
.gh-loading-placeholder { padding:var(--sp-5);text-align:center;color:var(--muted);font-size:var(--fs-sm); }
.gh-initial-hint { color:var(--muted);font-size:var(--fs-xs);padding:12px 0;text-align:center; }
.gh-grid { flex:1; overflow-y:auto; padding:var(--sp-vh-cell); display:flex; flex-direction:column; gap:4px;will-change:scroll-position; }
.gh-card { display:flex; align-items:center; gap:var(--card-gap); padding:var(--card-padding); border-radius:var(--radius-card); border:1px solid var(--bd); background:var(--card); cursor:pointer; transition:var(--tr-normal), box-shadow var(--tr-normal); box-shadow:var(--card-shadow, none); transform:translateZ(0); animation:fadeSlideUp var(--tr-enter) both; } /* 审计 P1-2/P1-3：卡片圆角收口 --radius-card，删 --card-padding 手抄回退 */
.gh-card:hover { border-color:var(--accent); background:var(--hover); box-shadow:var(--card-shadow-hover, none); transform:translateY(-1px); }
.gh-card.active { border-color:var(--accent); background:var(--accent); color:var(--bg); box-shadow:var(--card-shadow-hover, none); }
.gh-card .name { font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--txt); font-family:var(--font-display); overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.gh-card .name + .meta { margin-top:1px; font-size:var(--fs-xs); color:var(--muted); }
.gh-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
.gh-card-body { flex:1; min-width:0; }
.gh-header { border-bottom:1px solid var(--bd);flex-shrink:0; }
.gh-header-top { display:flex;align-items:center;gap:8px;padding:var(--sp-vh-pane); }
.gh-header-repo { display:flex;align-items:center;gap:8px;padding:0 12px 8px; }
.gh-header-actions { display:flex;align-items:center;gap:8px;padding:0 12px 8px;position:relative; }
.gh-section-fill { flex:1; }
.gh-back-repo { font-size:var(--fs-sm);padding:var(--btn-padding-sm);border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-family:inherit; }
.gh-back-repo:hover { background:var(--hover); }
.gh-repo-name { font-size:var(--fs-md);font-weight:600;color:var(--txt);flex:1; }
.gh-model-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius:var(--radius-pill); font-size: var(--fs-xs); font-weight: 600; }
.gh-model-badge-total { background: var(--surf); color: var(--txt); }
.gh-model-badge-missing { background: color-mix(in srgb, var(--status-error) 12%, transparent); color: var(--status-error); }
/* toggle-missing 激活态 */
.gh-toggle-missing.active { border-color:var(--accent);color:var(--accent); }
.gh-dl-selected { color:var(--accent);border-color:var(--accent); }
.gh-dl-selected:hover { background:var(--accent);color:var(--bg); }

/* 站点侧栏头部（gh-left-head 系列与 gh-left-foot 仍在用） */
.gh-left-head { padding:4px 12px 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap; }
.gh-left-head-label { font-size:var(--fs-sm);font-weight:600;color:var(--muted); }
.gh-left-head-spacer { flex:1; }
.gh-left-foot { padding:4px 12px 8px;font-size:var(--fs-micro);color:var(--muted); }

/* ===== 模型列表行 ===== */
.gh-empty { padding:var(--sp-3); text-align:center; color:var(--muted); font-size:var(--fs-sm); }
.gh-row { display: grid; grid-template-columns: 1fr max-content max-content; gap: 8px; align-items: center; padding:var(--sp-vh-btn); border-radius: var(--radius-md); margin-bottom: 2px; border-left: 3px solid transparent; font-size: var(--fs-sm); transition: background var(--tr-fast); }
.gh-row:hover { background: var(--hover); }
.gh-row-exists { border-left-color: var(--status-success); background: transparent; }
.gh-row-exists .gh-name { color: var(--txt); } /* 列表主名 = 正文级（规范 §层级口径）；同文件 :141 已按此修正错误正文，此处同类漂移一并收口 */
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
.gh-badge { padding:var(--btn-padding-tool-lg); border-radius:var(--radius-sm); font-size:var(--fs-sm); color:var(--status-success); flex-shrink:0; }
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

/* ===== 下载队列 ===== */
.gh-queue-icon { color:var(--accent); }
.gh-queue-error { padding:var(--pad-v-2); font-size:var(--fs-sm); color:var(--status-error); }
.gh-queue-err-item { font-size:var(--fs-xs); color:var(--muted); padding:0 var(--sp-1); }
.gh-queue-ellipsis { font-size:var(--fs-xs); color:var(--muted); padding:0 var(--sp-1); }
.gh-queue-cancel { font-size:var(--fs-sm); color:var(--muted); }
.gh-progress-row { display:flex; align-items:center; gap:4px; }
.gh-progress-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-sm); }
.gh-progress-pct { font-size:var(--fs-xs); color:var(--txt); flex-shrink:0; } /* 百分比 = 读数（error 变体下条覆盖） */
.gh-progress-remain { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-progress-bar-wrap { margin-top:3px; height:4px; border-radius:var(--radius-xs); background:var(--bd); overflow:hidden; }
.gh-progress-fill { height:100%; width:0%; border-radius:var(--radius-xs); background:var(--accent); transition:width 0.06s linear; box-shadow:0 0 4px var(--accent); animation:breathe-subtle 4s ease-in-out infinite;will-change:filter,box-shadow; }
.gh-progress-pct.gh-progress-error { color:var(--status-error); }
.gh-progress-fill.gh-progress-fill-error { background:var(--status-error); }
.gh-progress-box { padding:var(--sp-vh-block); text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }
.gh-name-wrap { display:flex; align-items:center; gap:6px; min-width:0; }
`;
/* P1 批次12:工坊行名称容器(community/render.ts nameWrap,gh-row 列1 内部 flex 容器) */
