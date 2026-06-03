// ===== app-content Shadow CSS =====
export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:-apple-system,sans-serif; background:#1e1e2e; }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:14px; font-weight:600; color:#fff; padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:#181825; border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; }
.stat-card .num { font-size:24px; font-weight:700; color:#7c83ff; }
.stat-card .label { font-size:11px; color:#6c7086; margin-top:2px; }
.stat-card .sub { font-size:10px; color:#a6adc8; margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#6c7086; font-size:12px; gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:9px; background:#f9a82633; color:#f9a826; padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout app-sidebar { width:280px; flex-shrink:0; }
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#181825; border-radius:6px; margin-bottom:4px; font-size:12px; }
.setting-row .label { color:#cdd6f4; }
.setting-row .value { color:#6c7086; }
`;
