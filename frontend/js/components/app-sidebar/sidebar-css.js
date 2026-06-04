// ===== sidebar Shadow CSS =====
export const sidebarCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--bg);
  border-right: 1px solid var(--bd);
  flex: 1;
  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12px;
}
.header { padding: 10px 12px; border-bottom: 1px solid var(--bd); }
.header-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.header-label { font-size: 12px; font-weight: 600; color: var(--txt); text-transform: uppercase; letter-spacing: .5px; flex: 1; }
.header-stat { font-size: 11px; color: var(--muted); }
.search-input {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: var(--surf);
  color: var(--txt); font-size: 12px; outline: none; font-family: inherit;
}
.search-input::placeholder { color: var(--muted); }
.list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.vc {
  background: var(--surf); border: 1px solid var(--bd);
  border-radius: 8px; margin-bottom: 6px; overflow: hidden;
}
.vc-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  cursor: pointer; transition: background .12s;
}
.vc-header:hover { background: var(--hover); }
.vc-header .arrow { font-size: 8px; color: var(--muted); transition: transform .15s; width: 10px; }
.vc-header .arrow.open { transform: rotate(90deg); }
.vc-header .name { flex: 1; font-size: 13px; font-weight: 600; color: var(--txt); }
.vc-header .tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
.vc-header .tag.green { background: #a6e3a122; color: #a6e3a1; }
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
.vc-body .row.row-prefix .dot { opacity:0.35; }
.vc-body .row .status-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .link-icon { font-size: 10px; margin-right: 4px; flex-shrink: 0; }
.vc-body .row .sz { font-size: 11px; color: var(--muted); }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; gap: 10px; font-size: 11px; color: var(--muted); margin-bottom: 6px; }
.footer-btn {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: 11px; font-family: inherit;
  text-align: center; transition: background .12s;
}
.footer-btn:hover { background: var(--hover); }
`;
