// ===== preview Shadow CSS =====
export const previewCSS = `
:host {
  display: flex; flex-direction: column;
  background: #11111b;
  border-left: 1px solid rgba(255,255,255,.06);
  width: 200px;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
}
.tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.08); padding: 0; }
.tabs .tab {
  flex: 1; text-align: center; padding: 6px 0; cursor: pointer;
  font-size: 11px; color: #6c7086; transition: all .12s;
  border-bottom: 2px solid transparent;
}
.tabs .tab.active { color: #7c83ff; border-bottom-color: #7c83ff; }
.tabs .tab:hover { color: #cdd6f4; }
.content { padding: 12px; overflow-y: auto; flex: 1; }
h3 { font-size: 11px; font-weight: 600; color: #a6adc8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; }
.stat-row { font-size: 12px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
.stat-row .label { color: #6c7086; }
.stat-row .value { color: #fff; font-weight: 500; }
.stat-row .value.accent { color: #7c83ff; }
.divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 8px 0; }
.btn-group { display: flex; flex-direction: column; gap: 4px; }
.btn {
  padding: 6px 0; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08); background: transparent;
  color: #cdd6f4; cursor: pointer; font-size: 11px; font-family: inherit; transition: background .12s;
}
.btn:hover { background: #2a2a42; }
.btn.accent { background: #7c83ff33; color: #7c83ff; border-color: #7c83ff55; }
.btn.accent:hover { background: #7c83ff55; }
.btn.warn { background: #f9a82622; color: #f9a826; border-color: #f9a82655; }
.btn .tag { font-size: 7px; background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 4px; }
/* 日志条目 */
.log-entry {
  padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.04);
  font-size: 10px; color: #cdd6f4; display: flex; gap: 4px;
}
.log-entry .log-status { flex-shrink: 0; width: 48px; text-align: center; font-size: 9px; padding: 1px 0; border-radius: 2px; }
.log-status.success { color: #a6e3a1; background: #a6e3a122; }
.log-status.failed { color: #f38ba8; background: #f38ba822; }
.log-status.skipped { color: #f9a826; background: #f9a82622; }
.log-entry .log-msg { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-entry .log-time { font-size: 8px; color: #6c7086; flex-shrink: 0; }
/* 模型详情 */
.md-row { font-size: 12px; color: #cdd6f4; padding: 3px 0; display: flex; justify-content: space-between; }
.md-label { color: #6c7086; }
.md-value { color: #fff; font-weight: 500; }
.md-divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 8px 0; }
.err { font-size: 10px; color: #f38ba8; padding: 4px 0; }
`;
