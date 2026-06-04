// ===== preview Shadow CSS =====
export const previewCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--bg);
  border-left: 1px solid var(--bd);
  width: 200px;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
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
.dp-card { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--bd); transition: background .12s; }
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
.dp-detail { font-size: 10px; color: var(--txt); padding: 2px 4px; background: var(--surf); border-radius: 4px; flex:1; overflow-y:auto; min-height:0; }
.dp-detail .dp-detail-item { padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
`;
