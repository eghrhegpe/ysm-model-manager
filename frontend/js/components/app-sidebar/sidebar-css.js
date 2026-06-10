// ===== sidebar Shadow CSS =====
export const sidebarCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--surf);
  border-right: 1px solid var(--bd);
  flex: 1;
  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
}
.list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.vc {
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
}
.vc-header {
  padding: 5px 10px; cursor: pointer; transition: background .12s;
}
.vc-header:hover { background: var(--hover); }
.vc-header.active { background: #7c83ff33; border-left: 3px solid var(--accent); padding-left: 7px; box-shadow: inset 0 0 8px rgba(124,131,255,.08); }
.vc-hdr-row1 { display: flex; align-items: center; }
.vc-hdr-row2 { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.vc-header .name { flex: 1; font-size: 12px; font-weight: 600; color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
.vc-header .tag.green { background: #6bb86b22; color: #6bb86b; }
.vc-header .tag.red { background: #f38ba822; color: #f38ba8; }
.vc-header .tag.orange { background: #f9a82622; color: #f9a826; }
.vc-body { padding: 2px 10px 8px; }
.vc-body .sec-title { font-size: 10px; color: var(--muted); padding: 4px 2px 2px; text-transform: uppercase; letter-spacing: .5px; }
.vc-body .row {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px;
  border-radius: 4px; font-size: 12px; transition: background .12s;
}
.vc-body .row:hover { background: var(--hover); }
.vc-body .row .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.vc-body .row .rn { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-body .row .rn .tag-author,.vc-body .row .rn .tag-work,.vc-body .row .rn .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.vc-body .row .rn .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.vc-body .row .rn .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.vc-body .row .rn .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.vc-body .row.row-prefix .dot { opacity:0.35; }
.vc-body .row .status-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .link-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .sz { font-size: 11px; color: var(--muted); }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); margin-bottom: 6px; }
.footer-btn {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: 11px; font-family: inherit;
  text-align: center; transition: background .12s;
}
.footer-btn:hover { background: var(--hover); }
/* 骨架屏 */
.sk-item { padding: 10px; margin-bottom: 6px; border-radius: 8px; border: 1px solid var(--bd); background: var(--surf); }
.sk-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bd) 25%, var(--hover) 50%, var(--bd) 75%); background-size: 200% 100%; animation: sk-shimmer 1.5s infinite; margin-bottom: 6px; }
.sk-w80 { width: 80%; }
.sk-w40 { width: 40%; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;
