export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; background:var(--bg); }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:14px; font-weight:600; color:var(--txt); padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:var(--surf); border:1px solid var(--bd); border-radius:10px; padding:14px; }
.stat-card .num { font-size:24px; font-weight:700; color:var(--accent); }
.stat-card .label { font-size:11px; color:var(--muted); margin-top:2px; }
.stat-card .sub { font-size:10px; color:var(--txt); margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:12px; gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:9px; background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
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
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:12px; font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
`;
