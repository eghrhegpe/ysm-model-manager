// ===== 创作者域：标签/频道/卡片/详情浮层/编辑（.cr-* 全族；.ws-* 工坊类已归位 content-layout.ts） =====
export const contentCreatorCSS: string = `
/* ===== 创作者标签 (cr-tag) ===== */
.cr-tag { display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:0 5px;border-radius:var(--radius-xs);line-height:16px;font-weight:500;flex-shrink:0; }
.cr-tag-game { background:var(--tag-game-bg);color:var(--tag-game); }
.cr-tag-vup { background:var(--tag-vup-bg);color:var(--tag-vup); }
.cr-tag-oc { background:var(--tag-oc-bg);color:var(--tag-oc); }
.cr-tag-filter-row { display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap;align-items:center; }
.cr-tag-filter-btn { font-size:var(--fs-xs);padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:var(--tr-fast);animation:fadeSlideUp var(--tr-enter) both; }
.cr-tag-filter-btn:hover { border-color:var(--accent);color:var(--txt);background:var(--hover); }
.cr-tag-filter-btn.active { border-color:var(--accent);color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent); }

/* ===== 创作者频道 (cr-) ===== */
.cr-page { flex:1; display:flex; overflow:hidden; position:relative; }
.cr-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.cr-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.cr-scroll { flex:1; overflow-y:auto; padding:8px 12px; }

.cr-section { margin-bottom:8px; }
.cr-section-title-lg { font-size:13px;font-weight:600;color:var(--txt); }
.cr-section-sub { font-size:var(--fs-sm);color:var(--muted); }
.cr-action-btn { font-size:var(--fs-sm);padding:3px 8px;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;cursor:pointer;font-family:inherit;transition:var(--tr-fast); }
.cr-action-btn-muted { color:var(--muted);border-color:var(--bd); }
.cr-action-btn-muted:hover { background:var(--hover);color:var(--txt); }
.cr-action-btn-accent { color:var(--accent);border-color:var(--accent); }
.cr-action-btn-accent:hover { background:var(--accent);color:var(--bg); }

.cr-browse-repo { font-size:var(--fs-xs);padding:2px 6px;border-radius:var(--radius-sm);border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap; }
.cr-browse-repo:hover { background:var(--accent);color:var(--bg); }
.cr-edit-btn { font-size:var(--fs-xs);padding:2px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-edit-btn:hover { background:var(--hover);color:var(--txt); }
.cr-toggle { font-size:var(--fs-xs);padding:2px 8px;border-radius:var(--radius-md);border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap;transition:var(--tr-fast); }
.cr-toggle:hover { background:var(--accent);color:var(--bg); }
.cr-mode-switch { display:inline-flex;border:1px solid var(--bd);border-radius:6px 6px 0 0;border-bottom:none;overflow:hidden;cursor:pointer;margin-right:2px;flex-shrink:0;align-self:stretch;background:transparent;padding:0;appearance:none;-webkit-appearance:none;font:inherit;color:inherit; }
.cr-mode-opt { padding:2px 6px;font-size:10px;font-family:inherit;transition:var(--tr-fast);color:var(--muted);background:var(--bg);cursor:pointer;display:flex;align-items:center; }
.cr-mode-opt:hover { color:var(--txt);background:var(--hover); }
.cr-mode-opt.active { color:var(--accent);background:var(--surf);margin-bottom:-1px; }
.cr-mode-opt:first-child { border-right:1px solid var(--bd); }
.cr-browser-bar { display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surf);border-bottom:1px solid var(--bd);flex-shrink:0; }
.cr-back { padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.cr-back:hover { background:var(--hover); }
.cr-url { flex:1;font-size:var(--fs-sm);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

/* 创作者卡片：.cr-creator-card 基础（列表行） + .cr-creator-card--grid 网格变体（BEM 修饰符，替代后置 cascade 覆盖） */
.cr-creator-card { display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--bg);cursor:pointer;transition:var(--tr-fast); }
.cr-creator-card:hover { border-color:var(--accent);background:var(--hover); }
.cr-creator-icon { font-size:18px;width:28px;text-align:center;flex-shrink:0; }
.cr-creator-body { flex:1;min-width:0; }
.cr-creator-name { font-size:var(--fs-md);font-weight:600;color:var(--txt); }
.cr-creator-desc { font-size:var(--fs-xs);color:var(--muted);margin-top:1px; }
.cr-creator-action { font-size:var(--fs-md);color:var(--muted);flex-shrink:0; }

.cr-creator-grid {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  width:100%;
  padding:4px 0 8px;
}
/* 网格卡片变体：.cr-creator-card--grid —— 显式 BEM 修饰符，替代后置 cascade 覆盖 */
.cr-creator-card--grid {
  min-width:200px;max-width:280px;
  flex:1 1 200px;
  cursor:pointer;
  animation: fadeSlideUp var(--tr-enter) both;
  padding:12px 14px;
  border-radius:var(--radius-xl);
  border:1px solid var(--bd);
  background:var(--card);
  transition:var(--tr-normal);
  flex-direction:column;
  align-items:stretch;
  gap:6px;
  position:relative;
  overflow:hidden;
}
.cr-creator-card--grid:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:0 2px 12px rgba(0,0,0,.1);
  transform:translateY(-1px);
}
.cr-creator-card--grid:focus-visible {
  box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  outline:none;
}
.cr-creator-card--grid:hover .cr-card-tier-bar { opacity:1; }
.cr-creator-card--grid:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
/* 筛选隐藏态：淡出 + 折叠 */
.cr-creator-card--grid.cr-card-hidden {
  opacity:0;
  transform:scale(.95);
  max-height:0;
  min-height:0;
  padding:0 14px;
  margin:0;
  border-width:0;
  overflow:hidden;
  pointer-events:none;
  animation:none !important;
  transition:opacity .2s ease, transform .2s ease, max-height .2s ease, min-height .2s ease, padding .2s ease, margin .2s ease, border-width .2s ease;
}
/* tier 色条 */
.cr-card-tier-bar {
  position:absolute;top:0;left:0;right:0;height:2px;opacity:.6;transition:opacity var(--tr-normal);
}
.cr-creator-card--grid[data-tier="gold"] .cr-card-tier-bar { background:var(--sm-optional); }
.cr-creator-card--grid[data-tier="silver"] .cr-card-tier-bar { background:var(--muted); }
.cr-creator-card--grid[data-tier="gold"] .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),var(--sm-optional),transparent 60%,var(--sm-optional));
  box-shadow:0 0 6px color-mix(in srgb,var(--sm-optional) 40%,transparent);
}
.cr-creator-card--grid[data-tier="silver"] .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),var(--muted),transparent 60%,var(--muted));
  box-shadow:0 0 6px color-mix(in srgb,var(--muted) 25%,transparent);
}
.cr-creator-card--grid:not([data-tier]) .cr-avatar-ring {
  background:conic-gradient(from var(--grad-rot,0deg),var(--accent),transparent 60%,var(--accent));
  box-shadow:none;
}

/* 头像（跨域复用：.cr-avatar 亦在 gh-card 中用到） */
.cr-avatar { width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--muted);background:var(--surf);z-index:1;transition:all .25s ease; }
.cr-avatar-container { position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;width:28px;height:28px;margin:6px; }
.cr-avatar-ring { position:absolute;inset:-2px;border-radius:50%;pointer-events:none;transition:transform .4s ease; }
.cr-avatar-ring[data-spin]:hover { animation:ring-spin .8s linear infinite; }

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
  border:1px solid var(--bd);border-radius:var(--radius-lg);
  padding:0 5px;line-height:14px;
}
.cr-card-local-jump { cursor:pointer;transition:color var(--tr-fast),border-color var(--tr-fast); }
.cr-card-local-jump:hover { color:var(--accent);border-color:var(--accent); }
.cr-card-desc {
  font-size:var(--fs-xs);color:var(--muted);line-height:1.5;
  display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;min-height:0;
}
.cr-card-footer {
  display:flex;align-items:center;gap:4px;flex-wrap:wrap;
}
.cr-card-footer .cr-platform-badge {
  display:inline-flex;
  font-size:8px;padding:1px 5px;border-radius:var(--radius-xs);line-height:14px;
  background:var(--surf);color:var(--muted);border:1px solid var(--bd);gap:2px;
}
.cr-card-footer .cr-tag { font-size:9px;margin-left:auto; }
.cr-platform-badge { font-size:8px;padding:1px 4px;border-radius:2px;line-height:12px;display:inline-flex;align-items:center;gap:2px;background:var(--surf);color:var(--muted);border:1px solid var(--bd); }
.cr-card-search { cursor:pointer;font-size:11px;transition:transform var(--tr-normal);flex-shrink:0; }
.cr-card-search:hover { transform:scale(1.15); }
.cr-star-btn { cursor:pointer;font-size:11px;transition:transform var(--tr-normal);flex-shrink:0; }
.cr-star-btn:hover { transform:scale(1.15); }

/* ===== 预设搜索 ===== */
.cr-preset-area { display:flex;gap:6px;flex-wrap:wrap;padding:4px 0 12px; }
.cr-preset-icon { font-size:12px; }
.cr-preset-btn {
  font-size:var(--fs-sm);padding:4px 12px;border-radius:var(--radius-md);
  border:1px solid var(--bd);background:var(--surf);color:var(--txt);
  cursor:pointer;font-family:inherit;transition:var(--tr-fast);
  animation:fadeSlideUp var(--tr-enter) both;
}
.cr-preset-btn:hover { border-color:var(--accent);color:var(--accent);background:var(--hover); }
.cr-preset-btn:active { background:color-mix(in srgb, var(--accent) 15%, transparent); }

/* ===== 搜索输入 ===== */
.cr-search-input {
  flex:1;min-width:120px;max-width:180px;
  padding:4px 10px;border-radius:var(--radius-md);
  border:1px solid var(--bd);background:var(--bg);color:var(--txt);
  font-size:var(--fs-xs);font-family:inherit;outline:none;
  transition:border-color var(--tr-fast);
}
.cr-search-input:focus { border-color:var(--accent); }
.cr-search-input::placeholder { color:var(--muted);opacity:.6; }

/* ===== 工坊空状态 ===== */
.cr-empty-site {
  flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;
  padding:48px 20px;color:var(--muted);font-size:var(--fs-md);
  text-align:center;gap:8px;
}
/* ===== 编辑模式卡片（合并 base + override：cascade 后置覆盖，此处合并为单一块） ===== */
.cr-edit-card {
  padding:4px 8px 6px;
  border-radius:var(--radius-lg);
  border:1px solid var(--bd);
  background:var(--surf);
  margin:4px 12px;
  overflow:hidden;
  cursor:default;
  transition:box-shadow var(--tr-normal), border-color var(--tr-normal), margin-top var(--tr-normal), margin-bottom var(--tr-normal);
}
.cr-edit-card:hover { box-shadow:0 0 0 1px var(--accent); }
.cr-edit-card:active { cursor:grabbing; }
.cr-edit-card-head { display:flex; align-items:center; gap:4px; padding:6px 8px; border-bottom:1px solid var(--bd); background:var(--bg); }
.cr-edit-card-body { padding:4px 8px 6px; display:flex; flex-direction:column; gap:4px; }
.cr-edit-card-row { display:flex; align-items:center; gap:4px; margin:2px 0; }
.cr-edit-card-row select { flex:1; }
.cr-drag-handle { cursor:grab; color:var(--muted); font-size:14px; user-select:none; line-height:1; }
.cr-edit-card-avatar { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--surf); font-size:11px; flex-shrink:0; }
.cr-input {
  flex:1;min-width:60px;border:none;background:transparent;
  color:var(--txt);font-size:var(--fs-sm);font-family:inherit;outline:none;
}
.cr-input:focus { background:var(--surf); }
.cr-input-type { flex:1;height:auto;min-height:50px;padding:2px 4px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit; }
.cr-input-type:focus { border-color: var(--accent); }
.cr-input-desc { font-size: var(--fs-xs); }
.cr-input-role { width:auto;min-width:70px;padding:2px 4px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-xs);font-family:inherit; }
.cr-input-role:focus { border-color: var(--accent); }
.cr-btn-icon { font-size:12px;padding:0 4px;background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-btn-icon:hover { color:var(--txt); }
.cr-edit-label { font-size:10px;color:var(--muted);width:28px;flex-shrink:0; }
.cr-fetch-failed { color: var(--muted); cursor: default; }
.cr-add-area { padding:4px 0 12px; }
.cr-add-area button, .cr-add-preset {
  padding:4px 12px;border-radius:var(--radius-md);border:1px dashed var(--bd);
  background:transparent;color:var(--muted);cursor:pointer;
  font-size:var(--fs-sm);font-family:inherit;transition:var(--tr-fast);
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
  font-size:var(--fs-xs);padding:2px 10px;border-radius:var(--radius-xl);
  border:1px solid var(--bd);background:transparent;color:var(--muted);
  cursor:pointer;font-family:inherit;transition:var(--tr-fast);
  animation:fadeSlideUp var(--tr-enter) both;
}
.cr-tag-filter-btn:hover { border-color:var(--accent);color:var(--accent); }
.cr-tag-filter-btn.active { background:color-mix(in srgb, var(--accent) 18%, transparent);color:var(--accent);border-color:var(--accent); }
.cr-drop-zone {
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:12px 16px;margin:4px 0 8px;
  border:2px dashed var(--bd);border-radius:var(--radius-lg);
  color:var(--muted);font-size:var(--fs-xs);
  cursor:pointer;transition:all .2s;user-select:none;
}
.cr-drop-zone-active {
  border-color:var(--accent);color:var(--accent);background:var(--hover);
}
.cr-drop-icon { font-size:18px; }
.cr-drop-text { font-size:var(--fs-xs); }
.cr-fetch-btn, .cr-edit-btn, .cr-save-btn, .cr-cancel-btn {
  padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);
  background:transparent;color:var(--txt);cursor:pointer;
  font-size:var(--fs-xs);font-family:inherit;transition:var(--tr-fast);
}
.cr-fetch-btn:hover, .cr-edit-btn:hover, .cr-save-btn:hover, .cr-cancel-btn:hover { background:var(--hover); }
.cr-action-btn-accent { color:var(--accent);border-color:var(--accent); }
.cr-action-btn-accent:hover { background:var(--accent);color:var(--bg); }

.cr-section-fill { flex:1; }
.cr-section-wrap { flex-wrap:wrap; }

/* Drag states */
.cr-dragging { opacity: .4; }
.cr-drag-target { border-color: var(--accent); }
.cr-drag-before { margin-top: 8px; }
.cr-drag-after { margin-bottom: 8px; }

/* ===== 创作者详情浮层 (cr-detail) ===== */
.cr-detail-overlay { position:fixed;inset:0;z-index:var(--z-modal);background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;animation:fade-in .15s ease; }
.cr-detail-box { background:var(--bg);border:1px solid var(--bd);border-radius:var(--radius-xl);padding:20px;max-width:420px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:12px;animation:detail-in .2s ease; }
.cr-detail-box { position:relative; }
.cr-detail-header { display:flex;align-items:center;gap:10px; }
.cr-detail-name { font-size:16px;font-weight:700;color:var(--txt); }
.cr-detail-desc { font-size:var(--fs-sm);color:var(--muted);line-height:1.5;display:flex;flex-wrap:wrap;gap:4px;padding:0;background:transparent; }
.cr-detail-row { display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);color:var(--muted); }
.cr-detail-row .cr-tag { font-size:10px; }
.cr-detail-actions { display:flex;gap:6px;flex-wrap:wrap;margin-top:4px; }
.cr-detail-actions button { padding:5px 14px;border-radius:var(--radius-md);border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-sm);font-family:inherit;transition:var(--tr-fast); }

/* Overlay avatar sizes (overrides .cr-avatar base: 28px → 36px) */
.cr-detail-avatar-container { width:36px;height:36px;margin:0; }
.cr-detail-avatar-img { width:36px;height:36px;border-radius:50%;object-fit:cover; }
.cr-detail-avatar-text { width:36px;height:36px;font-size:16px; }

/* Name area */
.cr-detail-fill { flex:1;min-width:0; }
.cr-detail-name-row { display:flex;align-items:center;gap:6px; }
.cr-detail-identity { font-size:10px;color:var(--muted);margin-top:1px; }

/* Desc tags */
.cr-desc-tag { font-size:10px;padding:1px 7px;border-radius:var(--radius-sm);line-height:18px;background:var(--surf);color:var(--txt);opacity:.75;border:1px solid var(--bd); }

/* Local count card */
.cr-local-card { display:flex;align-items:center;gap:8px;background:var(--surf);border-radius:var(--radius-lg);padding:8px 10px;border:1px solid var(--bd); }
.cr-local-icon { font-size:13px; }
.cr-local-text { flex:1;font-size:var(--fs-sm);color:var(--txt); }

/* Platform row */
.cr-detail-row-platforms { gap:4px;flex-wrap:wrap; }
.cr-detail-platforms { display:flex;gap:4px;flex-wrap:wrap;margin-top:3px; }
.cr-detail-platforms .cr-platform-badge { background:var(--surf);color:var(--muted);border:none;padding:1px 8px;border-radius:var(--radius-sm);font-size:10px; }
.cr-detail-platforms .cr-platform-badge .ws-icon { width:10px;height:10px; }
.cr-detail-actions button:hover { border-color:var(--accent);background:var(--hover); }
.cr-detail-actions .primary { background:var(--accent);color:var(--bg);border-color:var(--accent); }
.cr-detail-actions .primary:hover { opacity:.85; }
.cr-detail-actions .secondary { background:transparent;color:var(--muted);border-color:transparent; }
.cr-detail-actions .secondary:hover { background:var(--hover);color:var(--txt); }
.cr-model-count { font-size:var(--fs-xs);color:var(--muted);display:inline-flex;align-items:center;gap:2px; }
.cr-detail-box .cr-star-btn { position:absolute;top:16px;right:16px;font-size:18px; }
.cr-local-btn { padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:background-color var(--tr-fast),color var(--tr-fast); }
.cr-local-btn:hover { background:var(--accent);color:var(--bg); }
.cr-local-count { font-size:var(--fs-xs);color:var(--muted);align-self:center; }

.cr-error-page .cr-back-repo { margin-bottom:12px; }
`;
