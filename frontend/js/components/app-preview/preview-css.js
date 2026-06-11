// ===== preview Shadow CSS =====
export const previewCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--bg);
  border-left: 1px solid var(--bd);
  width: 200px;
  flex-shrink: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
}
.content { padding: 10px; overflow-y: auto; flex: 1; }
h3 { font-size: 11px; font-weight: 600; color: var(--txt); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
.dp-global-actions { margin-bottom: 4px; }
.dp-global-actions .btn { width: 100%; text-align: center; margin-bottom: 3px; }
.dp-placeholder { text-align: center; padding: 24px 0; color: var(--muted); }
.dp-placeholder .big-icon { font-size: 24px; margin-bottom: 8px; }
.dp-placeholder .dp-hint { font-size: 11px; }
.dp-header-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.dp-name { font-size: 13px; font-weight: 600; color: var(--txt); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-status { font-size: 10px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
.dp-cards { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.dp-card { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--bd); transition: background .12s; cursor:pointer; }
.dp-card:hover { background: var(--hover); }
.dp-card.green { border-left: 3px solid #a6e3a1; }
.dp-card.red { border-left: 3px solid #f38ba8; }
.dp-card.orange { border-left: 3px solid #f9a826; }
.dp-card-num { font-size: 18px; font-weight: 700; min-width: 28px; text-align: center; }
.dp-card.green .dp-card-num { color: #a6e3a1; }
.dp-card.red .dp-card-num { color: #f38ba8; }
.dp-card.orange .dp-card-num { color: #f9a826; }
.dp-card-label { font-size: 10px; color: var(--muted); flex: 1; }
.dp-card-action { flex-shrink: 0; }
.dp-card-action .btn { padding: 3px 6px; font-size: 9px; }
.dp-expand-icon { font-size: 8px; margin-left: 2px; transition: transform .15s; }
.dp-expand-icon.open { transform: rotate(90deg); }
.dp-detail { font-size: 10px; color: var(--txt); padding: 2px 4px; background: var(--surf); border-radius: 4px; flex:1; overflow-y:auto; min-height:0; margin-bottom:4px; }
.dp-detail-hidden { display:none; }
.dp-detail .dp-detail-item { padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-detail .dp-detail-item .tag-author,.dp-detail .dp-detail-item .tag-work,.dp-detail .dp-detail-item .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.dp-detail .dp-detail-item .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.dp-detail .dp-detail-item .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.dp-detail .dp-detail-item .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.dp-detail .dp-detail-empty { color: var(--muted); padding: 4px 0; text-align: center; }
.dp-section-title { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.dp-log-toggle { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 10px; font-family: inherit; padding: 0; }
.dp-log-toggle:hover { text-decoration: underline; }
.dp-log-list { max-height: 72px; overflow-y: auto; margin-bottom: 4px; }
.dp-log-footer { margin-top: 4px; }
.stat-row { font-size: 12px; color: var(--txt); padding: 3px 0; display: flex; justify-content: space-between; }
.divider { border: none; border-top: 1px solid var(--bd); margin: 6px 0; }
.btn { padding: 5px 0; border-radius: 6px; border: 1px solid var(--bd); background: transparent; color: var(--txt); cursor: pointer; font-size: 11px; font-family: inherit; transition: background .12s; }
.btn:hover { background: var(--hover); }
.btn.accent { background: #7c83ff33; color: var(--accent); border-color: #7c83ff55; }
.btn.accent:hover { background: #7c83ff55; }
.btn.warn { background: #f9a82622; color: #f9a826; border-color: #f9a82655; }
.log-entry { padding: 2px 0; font-size: 9px; color: var(--txt); display: flex; gap: 4px; white-space: nowrap; }
.log-entry .log-msg { flex: 1; word-break: break-all; }
.log-entry .log-time { font-size: 8px; color: var(--muted); flex-shrink: 0; }
.md-row { font-size: 12px; color: var(--txt); padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: var(--muted); }
.md-value { color: var(--txt); font-weight: 500; }
.md-divider { border: none; border-top: 1px solid var(--bd); margin: 8px 0; }
.err { font-size: 10px; color: #f38ba8; padding: 4px 0; }
.preview-thumb { margin-bottom: 10px; border-radius: 8px; overflow: hidden; background: var(--surf); border: 1px solid var(--bd); }
.preview-thumb img { display: block; width: 100%; height: auto; object-fit: cover; }
.dp-log-fbtn { font-size:var(--fs-xs);padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer; }
.dp-log-fbtn.active { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }
.dp-log-search { flex:1;font-size:var(--fs-xs);padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);min-width:0;margin-left:4px; }
.dp-log-empty { font-size:var(--fs-sm);color:#6c7086; }
.ysm-stat-label { display:inline-block;min-width:80px; }

/* === 骨骼预览区 === */
.ysm-btn { font-size:var(--fs-xs);padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;display:flex;align-items:center;gap:3px; }
.ysm-btn:hover { background:var(--hover); }
.ysm-hint { font-size:var(--fs-tiny);color:var(--muted); }
.ysm-canvas { width:100%;height:auto;border-radius:8px;background:rgba(0,0,0,.12);margin-bottom:6px; }
.ysm-grab { cursor:grab; }
.ysm-card { background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;margin-bottom:8px; }
.ysm-card-title { display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:var(--fs-sm);font-weight:600;color:var(--txt); }
.ysm-card-section { padding-left:8px;margin-bottom:5px; }
.ysm-card-section-label { font-size:var(--fs-tiny);color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px; }
.ysm-card-row { font-size:var(--fs-sm);color:var(--txt);line-height:1.6; }
.ysm-card-val { color:var(--accent);font-weight:600; }
.ysm-badge { font-size:var(--fs-tiny);padding:0 5px;border-radius:3px;background:rgba(124,131,255,0.25);color:var(--txt);margin-left:auto; }
.ysm-section-blue { border-left:2px solid #7c83ff; }
.ysm-section-green { border-left:2px solid #a6e3a1; }
.ysm-section-orange { border-left:2px solid #f9a826; }
.ysm-tab-row { display:flex;gap:2px;margin-bottom:6px; }
.ysm-tab { flex:1;font-size:var(--fs-sm);padding:3px 6px;border-radius:4px;border:1px solid var(--bd);cursor:pointer;text-align:center; }
.ysm-tab-active { background:var(--accent);color:#fff; }
.ysm-tab-inactive { background:var(--surf);color:var(--txt); }
.ysm-tab-row { display:flex;gap:2px;margin-bottom:6px; }
.ysm-export-row { display:flex;gap:6px;margin-top:4px;align-items:center; }
.ysm-export-btn { font-size:var(--fs-xs);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer; }
.ysm-export-btn:hover { background:var(--hover); }
.ysm-toggle-row { display:flex;align-items:center;gap:4px;margin-bottom:6px; }
.ysm-debug { font-size:var(--fs-xs);color:#ff6b6b;margin-top:2px;opacity:0.8; }
.ysm-loading-title { font-size:var(--fs-sm);font-weight:600;color:var(--muted);margin-bottom:4px; }
.ysm-loading-bar { height:60px;border-radius:6px;background:rgba(0,0,0,.08); }
.ysm-error-title { font-size:var(--fs-sm);font-weight:600;margin-bottom:4px; }
.ysm-error-body { font-size:var(--fs-xs);color:#888;padding:8px 0; }
.ysm-log-error { color:#f38ba8; }
`;
