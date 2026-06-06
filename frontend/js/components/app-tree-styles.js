// ===== app-tree 样式（独立文件，避免 JS 热更新时重编译 CSS） =====
export const treeCSS = `
:host {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.hdr { padding: 10px 12px; border-bottom: 1px solid var(--bd); }
.hdr-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.hdr-label { font-size: 12px; font-weight: 600; color: var(--txt); flex: 1; }
.hdr-btn { padding: 3px 8px; border-radius: 4px; border: 1px solid var(--bd); background: transparent; color: var(--txt); cursor: pointer; font-size: 10px; font-family: inherit; transition: all .2s; }
.hdr-btn:hover { background: var(--hover); }
.hdr-btn.accent { background: #7c83ff33; color: var(--accent); border-color: #7c83ff55; }
.hdr-btn.accent:hover { background: #7c83ff55; }
.hdr-btn.flash { background: #a6e3a133; border-color: #a6e3a155; }
.batch-dropdown { position: relative; }
.batch-menu { position: absolute; top: 100%; left: 0; z-index: 100; background: var(--card); border: 1px solid var(--bd); border-radius: 6px; padding: 3px; min-width: 120px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.batch-item { display: block; width: 100%; text-align: left; padding: 4px 10px; border: none; border-radius: 4px; margin-bottom: 1px; font-size: 10px; color: var(--txt); cursor: pointer; background: transparent; font-family: inherit; }
.batch-item:hover { background: #7c83ff33; color: var(--accent); }
.srch-row { display: flex; align-items: center; gap: 6px; }
.srch-inp { flex: 1; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--bd); background: var(--surf); color: var(--txt); font-size: 11px; outline: none; font-family: inherit; }
.srch-inp::placeholder { color: var(--muted); }
.sort-sel { padding: 5px 6px; border-radius: 5px; border: 1px solid var(--bd); background: var(--surf); color: var(--txt); font-size: 10px; outline: none; font-family: inherit; cursor: pointer; }
.tag { font-size: 7px; background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 2px; }
.list { flex: 1; overflow-y: auto; padding: 6px 8px; }
.empty { text-align: center; padding: 40px 16px; font-size: 12px; color: var(--muted); line-height: 1.8; }
.empty .big { font-size: 36px; margin-bottom: 8px; }
.fh { display: flex; align-items: center; gap: 4px; padding: 3px 4px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background .12s; border-left: 2px solid transparent; }
.fh:hover { background: var(--hover); }
.fh.has-items { border-left-color: #a6e3a166; }
.fh .ar { font-size: 10px; color: var(--muted); width: 12px; flex-shrink: 0; text-align: center; }
.fh .ar.open { transform: rotate(90deg); }
.fh .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--txt); }
.fh .nm .tag-author { color: var(--meta-author, #66d9ef); }
.fh .nm .tag-work { color: var(--meta-work, #bd93f9); }
.fh .nm .tag-date { color: var(--meta-date, #f1fa8c); font-size: 0.9em; }
.fh .nm mark { background: #f9a82644; color: #f9a826; border-radius: 2px; padding: 0 2px; }
.fh.locked { opacity: .5; }
.fh.locked .nm { color: var(--muted); }
.ch { padding-left: 16px; border-left: 1px dashed var(--bd); margin-left: 6px; }
.fl { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 4px; font-size: 11px; transition: all .15s; cursor: default; }
.fl:hover { background: var(--hover); }
.fl .ck, .fh .ck { width: 22px; height: 12px; border-radius: 6px; background: var(--muted); cursor: pointer; flex-shrink: 0; position: relative; transition: background .15s; font-size: 0; line-height: 0; }
.fl .ck::after, .fh .ck::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--txt); transition: left .15s; }
.fl .ck.on, .fh .ck.on { background: #a6e3a1; }
.fl .ck.on::after, .fh .ck.on::after { left: 12px; }
.fh .ck.partial { background: #f9a826; }
.fh .ck.partial::after { left: 7px; }
.fl .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl .nm .nm-tag, .fl .nm .tag-author { color: var(--meta-author, #66d9ef); }
.fl .nm .nm-bracket, .fl .nm .tag-work { color: var(--meta-work, #bd93f9); }
.fl .nm .tag-date { color: var(--meta-date, #f1fa8c); font-size: 0.9em; }
.fl .nm .tag-ext { color: var(--muted); font-size: 0.85em; }
.fl .nm.ysm { color: var(--txt); }
.fl .sz { font-size: 9px; white-space: nowrap; flex-shrink: 0; }
.fl .sz.sz-green { color: #a6e3a1; }
.fl .sz.sz-red { color: #f38ba8; }
.fl .sz:not(.sz-green):not(.sz-red) { color: var(--muted); }
.fl .dt { font-size: 9px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }
/* 悬停快捷操作 */
.hover-actions { display: none; gap: 2px; flex-shrink: 0; align-items: center; }
.fl:hover .hover-actions { display: flex; }
.ha-btn { font-size: 10px; padding: 1px 3px; border-radius: 3px; cursor: pointer; opacity: .6; transition: all .12s; }
.ha-btn:hover { opacity: 1; background: var(--hover); }
.ficon { font-size: 10px; }
.ftr { padding: 8px 12px; border-top: 1px solid var(--bd); display: flex; gap: 6px; align-items: center; }
.ftr .stat { font-size: 10px; color: var(--muted); margin-right: auto; }
`;
