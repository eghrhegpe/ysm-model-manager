// ===== preview Shadow CSS =====
export const previewCSS: string = `
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
@keyframes previewIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
.content > * { animation: previewIn .2s ease; }
.no-animations .content > * { animation: none !important; }
h3 { font-size: var(--fs-base); font-weight: 600; color: var(--txt); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
.dp-placeholder { text-align: center; padding: 24px 0; color: var(--muted); }
.dp-placeholder .big-icon { font-size: var(--fs-xl); margin-bottom: 8px; }
.dp-placeholder .dp-hint { font-size: var(--fs-base); margin-bottom: 12px; }
.dp-placeholder .dp-hints { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.dp-placeholder .dp-hints span { font-size: var(--fs-xs); padding: 2px 8px; border-radius: var(--radius-sm); background: var(--surf); border: 1px solid var(--bd); color: var(--muted); }
.md-row { font-size: 12px; color: var(--txt); padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: var(--muted); }
.md-value { color: var(--txt); font-weight: 500; }
.md-divider { border: none; border-top: 1px solid var(--bd); margin: 8px 0; }
.err { font-size: var(--fs-sm); color: var(--status-error); padding: 4px 0; }
.preview-thumb { margin-bottom: 10px; border-radius:var(--radius-lg); overflow: hidden; background: var(--surf); border: 1px solid var(--bd); }
.preview-thumb img { display: block; width: 100%; height: auto; object-fit: cover; }
.ysm-stat-label { display:inline-block;min-width:80px; }

/* === 骨骼预览区 === */
.ysm-btn { font-size:var(--fs-xs);padding:1px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;display:flex;align-items:center;gap:3px; }
.ysm-btn:hover { background:var(--hover); }
.ysm-hint { font-size:var(--fs-tiny);color:var(--muted); }
.ysm-canvas { width:100%;height:auto;border-radius:var(--radius-lg);background:rgba(0,0,0,.12);margin-bottom:6px; }
.ysm-grab { cursor:grab; }
.ysm-card { background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:8px 10px;margin-bottom:8px; }
.ysm-card-title { display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:var(--fs-sm);font-weight:600;color:var(--txt); }
.ysm-card-section { padding-left:8px;margin-bottom:5px; }
.ysm-card-section-label { font-size:var(--fs-tiny);color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px; }
.ysm-card-row { font-size:var(--fs-sm);color:var(--txt);line-height:1.6; }
.ysm-tree-item { display:flex;align-items:center;gap:4px;padding-left:8px; }
.ysm-tree-icon { font-size:var(--fs-xs);flex-shrink:0;width:16px;text-align:center; }
.ysm-tree-arrow { color:var(--muted);margin:0 2px; }
.ysm-tree-unit { color:var(--muted);font-size:var(--fs-xs);margin-left:2px; }
.ysm-tree-size { color:var(--muted);font-size:8px;margin-left:auto; }
.ysm-card-val { color:var(--accent);font-weight:600; }
.ysm-badge { font-size:var(--fs-tiny);padding:0 5px;border-radius:var(--radius-xs);background:color-mix(in srgb, var(--accent) 25%, transparent);color:var(--txt);margin-left:auto; }
.ysm-section-blue { border-left:2px solid var(--accent); }
.ysm-section-green { border-left:2px solid var(--status-success); }
.ysm-section-orange { border-left:2px solid var(--sm-optional); }
.ysm-tab-row { display:flex;gap:2px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--bd); }
.ysm-tab { flex:1;font-size:var(--fs-sm);padding:3px 6px;border-radius:var(--radius-sm);border:1px solid var(--bd);cursor:pointer;text-align:center;transition:var(--tr-fast); }
.ysm-tab:hover { border-color:var(--accent); }
.ysm-tab-active { background:var(--accent);color:var(--bg); }
.ysm-tab-inactive { background:var(--surf);color:var(--txt); }
.ysm-export-row { display:flex;gap:6px;margin-top:4px;align-items:center; }
.ysm-export-btn { font-size:var(--fs-xs);padding:2px 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;transition:var(--tr-fast); }
.ysm-export-btn:hover { background:var(--hover); }
.ysm-export-btn:focus-visible { box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent);outline:none; }
.ysm-toggle-row { display:flex;align-items:center;gap:4px;margin-bottom:6px;margin-top:4px;padding:4px 6px;background:var(--surf);border-radius:var(--radius-sm);justify-content:flex-end; }
.ysm-debug { font-size:var(--fs-xs);color:#ff6b6b;margin-top:2px;opacity:0.8; }
.ysm-loading-title { font-size:var(--fs-sm);font-weight:600;color:var(--muted);margin-bottom:4px; }
.ysm-loading-bar { height:60px;border-radius:var(--radius-md);background:rgba(0,0,0,.08); }
.ysm-error-title { font-size:var(--fs-sm);font-weight:600;margin-bottom:4px; }
.ysm-error-body { font-size:var(--fs-xs);color:var(--muted);padding:8px 0; }
`;
