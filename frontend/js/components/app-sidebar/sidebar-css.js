// ===== sidebar Shadow CSS =====
export const sidebarCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--surf);
  border-right: 1px solid var(--bd);
  flex: 1;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
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
.vc-header .name { flex: 1; font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: var(--fs-xs); padding: 1px 4px; border-radius: 3px; min-width:16px;text-align:center; }
.vc-header .tag.green { background: #6bb86b22; color: #6bb86b; }
.vc-header .tag.red { background: #f38ba822; color: #f38ba8; }
.vc-header .tag.orange { background: #f9a82622; color: #f9a826; }
.vc-hdr-row1 .chk { flex-shrink:0; margin:0; cursor:pointer; }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--fs-base) - 2px); color: var(--muted); margin-bottom: 6px; }
.footer-btn {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: calc(var(--fs-base) - 2px); font-family: var(--font-ui);
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
