// ===== app-tree 样式（独立文件，避免 JS 热更新时重编译 CSS） =====
import {
  btnBaseCSS,
  dropdownBaseCSS,
  dropdownHoverCSS,
  focusVisibleCSS,
  metaTagCSS,
  noAnimationsCSS,
  wsIconCSS,
} from "@/utils/dom/css.ts";
export const treeCSS: string = `
:host {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.hdr { padding: 6px 12px; border-bottom: 1px solid var(--bd); }
.hdr-row { display:flex; align-items:center; gap:4px; }
.hdr-row + .hdr-row { margin-top:4px; }
.hdr-search-row { margin-bottom:2px; }
.hdr-search-row .srch-inp { width:100%; }
.hdr-btn-row { justify-content:flex-start; flex-wrap:wrap; }
.hdr-label { font-size:var(--fs-base);font-weight:600;color:var(--txt);flex-shrink:0; }
.hdr-spacer { flex:1; }
.repo-bar-btn { padding:var(--pad-btn-tool) 8px;border-radius:var(--radius-sm);border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-btn-tool); } /* 工具栏命令按钮 = txt（对齐 .btn-base 正典） */
.repo-bar-btn:hover { background:var(--hover); }
/* 高级筛选面板 */
.adv-filter { border-top:1px solid var(--bd);padding:6px 8px 4px;background:var(--surf); }
.adv-filter-row { display:flex;align-items:center;gap:4px;flex-wrap:wrap; }
.adv-filter-row label { font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;margin-left:6px; }
.adv-filter-row label:first-child { margin-left:0; }
.af-inp { width:56px;padding:2px 4px;font-size:var(--fs-xs);border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg);color:var(--txt);font-family:inherit; }
.af-inp::placeholder { color:var(--muted);font-size:var(--fs-micro); }
.af-sep { font-size:var(--fs-xs);color:var(--muted); }
/* ===== 元数据标签（.tag-author/.tag-work/.tag-date）共享串 =====
   与 content-repo / app-preview 同源，防三份同构实现漂移；
   .fh/.fl 的域内排布规则在下方各自追加 */
${metaTagCSS}
/* ===== 统一按钮系统 .btn-base ===== */
${btnBaseCSS}
/* P2 修复：内联 focusVisibleCSS——Shadow DOM 内通用 :focus-visible 焦点环，
   覆盖 srch-inp/sort-sel 等显式 outline:none 的输入控件（键盘聚焦可见性，a11y） */
${focusVisibleCSS}
/* flash 反馈样式（feedback.ts 全局原语）：实际使用点为 .dd-item（sel-all 全选）/ .btn-base（btn-view-mode 视图切换） */
.dd-item.flash { background: color-mix(in srgb, var(--status-success) 20%, transparent); border-color: color-mix(in srgb, var(--status-success) 33%, transparent); }
.btn-base.flash { background: color-mix(in srgb, var(--status-success) 20%, transparent); border-color: color-mix(in srgb, var(--status-success) 33%, transparent); }
/* 下拉容器基础 + hover 展开（共享 dropdownBase/dropdownHoverCSS，见 utils/dom/css.ts）；
   .dd-item.flash 保留在上方为本视图 feedback 特化，不随共享以维持无动画观感 */
${dropdownBaseCSS}${dropdownHoverCSS}
.batch-dropdown { position: relative; }
.batch-menu { position: absolute; top: 100%; left: 0; z-index: 100; background: var(--card); border: 1px solid var(--bd); border-radius:var(--radius-md); padding:var(--pad-btn-tool); min-width: 120px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.batch-item { display: block; width: 100%; text-align: left; padding: 4px 10px; border: none; border-radius:var(--radius-sm); margin-bottom: 1px; font-size: var(--fs-sm); color: var(--txt); cursor: pointer; background: transparent; font-family: inherit; }
.batch-item:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
.srch-row { display: flex; align-items: center; gap: 6px; }
.srch-inp { flex: 1; padding: 5px 8px; border-radius:var(--radius-md); border: 1px solid var(--bd); background: var(--surf); color: var(--txt); font-size: var(--fs-base); outline: none; font-family: inherit; }
.srch-inp::placeholder { color: var(--muted); }
.sort-sel { padding: 5px 6px; border-radius: var(--radius-sm); border: 1px solid var(--bd); background: var(--surf); color: var(--txt); font-size: var(--fs-sm); outline: none; font-family: inherit; cursor: pointer; }
.tag { font-size: var(--fs-xs); background: color-mix(in srgb, var(--sm-optional) 20%, transparent); color: var(--sm-optional); padding: 0 var(--sp-1); border-radius:var(--radius-xs); margin-left: 2px; }
.list { flex: 1; overflow-y: auto; padding: 6px 0; position: relative; }
/* 拖拽导入提示条（底部固定，始终可见） */
.tree-drop-hint {
  display: none;
  align-items: center;
  gap: 6px;
  padding:var(--btn-padding-filter-lg);
  font-size:var(--fs-sm);
  color: var(--muted);
  border-top: 1px dashed var(--bd);
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  user-select: none;
}
.tree-drop-hint .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: .4; flex-shrink: 0; }
/* 虚拟滚动外层容器 */
.vs-wrap { box-sizing: border-box; }
.empty { text-align: center; padding: 40px 16px; font-size:var(--fs-base); color: var(--muted); line-height: 1.8; }
.empty .big { font-size: 36px; margin-bottom: 8px; }
/* 网格模式行高（受卡片密度驱动：--tree-row-grid，与 render.ts rowHeightGrid 同源）——
   固定 height 取代原来的 padding 撑高，杜绝「CSS 实际高度 ≠ 虚拟滚动假定行高」错位 */
.fh { display: flex; align-items: center; gap: 4px; height: var(--tree-row-grid, 28px); padding: 0 var(--sp-1); box-sizing: border-box; border-radius: 0; cursor: pointer; font-size: var(--fs-base); transition: background var(--tr-fast); border-left: 2px solid transparent; }
.fh:hover { background: var(--hover); }
.fh.has-items { border-left-color: color-mix(in srgb, var(--status-success) 40%, transparent); }
.fh .ar { font-size: var(--fs-sm); color: var(--muted); width: 12px; flex-shrink: 0; text-align: center; transition: transform var(--tr-fast); }
.fh .ar.open { transform: rotate(90deg); }
.fh .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--txt); }
/* .tag-author/.tag-work/.tag-date 的外观与色标全部由共享 metaTagCSS 承载（本串在下方插值）；
   本处不再另立 scoped 基础规则（旧 .fh .nm .tag-* 的 base 行与 metaTagCSS L115 逐值相同，
   已冗余删除）。域特有仅剩 .tag-ext（扩展名灰标）与 .nm mark 高亮。 */
.fh .nm mark { background: color-mix(in srgb, var(--sm-optional) 27%, transparent); color: var(--sm-optional); border-radius: 2px; padding: 0 2px; }
.fh.locked { opacity: .5; }
.fh.locked .nm { color: var(--muted); }
.fl { display: flex; align-items: center; gap: 6px; height: var(--tree-row-grid, 28px); padding: 0 var(--sp-1); box-sizing: border-box; border-radius:var(--radius-sm); font-size: var(--fs-base); transition: all var(--tr-normal); cursor: default; user-select: none; -webkit-user-select: none; }
.fl:hover { background: var(--hover); }
.fl.flash { background: color-mix(in srgb, var(--status-success) 13%, transparent); }
.fl-list.flash { background: color-mix(in srgb, var(--status-success) 13%, transparent); }
.fl.selected { background: color-mix(in srgb, var(--accent) 28%, transparent); border-left: 3px solid var(--accent); padding-left: 1px; }
.fl.selected:hover { background: color-mix(in srgb, var(--accent) 38%, transparent); }
.fh.selected { background: color-mix(in srgb, var(--accent) 28%, transparent); border-left: 3px solid var(--accent); padding-left: 1px; }
/* 紧凑列表模式行高（受卡片密度驱动：--tree-row-list，与 render.ts rowHeightList 同源）——
   与网格模式同理固定 height + border-box，保证 CSS 实际高度恒等于虚拟滚动假定行高 */
.fl-list { display: flex; align-items: center; gap: 6px; height: var(--tree-row-list, 24px); padding: 0 var(--sp-1); box-sizing: border-box; border-radius:var(--radius-sm); font-size: var(--fs-sm); cursor: default; user-select: none; -webkit-user-select: none; transition: background var(--tr-fast); }
.fl-list:hover { background: var(--hover); }
.fl-list.selected { background: color-mix(in srgb, var(--accent) 28%, transparent); border-left: 3px solid var(--accent); padding-left: 1px; }
.fl-list.ban { opacity: .55; }
.fh-list { display: flex; align-items: center; gap: 4px; height: var(--tree-row-list, 24px); padding: 0 var(--sp-1); box-sizing: border-box; border-radius: 0; cursor: pointer; font-size: var(--fs-sm); transition: background var(--tr-fast); border-left: 2px solid transparent; }
.fh-list:hover { background: var(--hover); }
.fh-list.locked { opacity: .5; }
.fl-list .ck, .fh-list .ck { width: 22px; height: 12px; border-radius:var(--radius-md); background: var(--muted); cursor: pointer; flex-shrink: 0; position: relative; transition: background var(--tr-normal); font-size: 0; line-height: 0; }
.fl-list .ck::after, .fh-list .ck::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--txt); transition: left var(--tr-normal); }
.fl-list .ck.on, .fh-list .ck.on { background: var(--status-success); }
.fl-list .ck.on::after, .fh-list .ck.on::after { left: 12px; }
.fh-list .ck.partial { background: var(--sm-optional); }
.fh-list .ck.partial::after { left: 7px; }
.fl-list .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family:var(--font-mono); }
.fh-list .ar { font-size: var(--fs-sm); color: var(--muted); width: 12px; flex-shrink: 0; text-align: center; transition: transform var(--tr-fast); }
.fh-list .ar.open { transform: rotate(90deg); }
.fh-list .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--txt); }
.fh-list .nm mark { background: color-mix(in srgb, var(--sm-optional) 27%, transparent); color: var(--sm-optional); border-radius: 2px; padding: 0 2px; }
.fl-list .sz { font-size: var(--fs-xs); white-space: nowrap; flex-shrink: 0; font-family:var(--font-mono); }
.fl-list .sz.sz-green { color: var(--size-ok,#a6e3a1); }
.fl-list .sz.sz-red { color: var(--size-large,#f38ba8); }
.fl-list .sz:not(.sz-green):not(.sz-red) { color: var(--muted); }
.fl-list .ficon { font-size: var(--fs-sm); flex-shrink: 0; }
.fl .ck, .fh .ck { width: 22px; height: 12px; border-radius:var(--radius-md); background: var(--muted); cursor: pointer; flex-shrink: 0; position: relative; transition: background var(--tr-normal); font-size: 0; line-height: 0; }
.fl .ck::after, .fh .ck::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--txt); transition: left var(--tr-normal); }
.fl .ck.on, .fh .ck.on { background: var(--status-success); }
.fl .ck.on::after, .fh .ck.on::after { left: 12px; }
.fh .ck.partial { background: var(--sm-optional); }
.fh .ck.partial::after { left: 7px; }
.fl .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family:var(--font-mono); }
/* .fl 与 .fh 同：.tag-author/.tag-work/.tag-date 外观与色标走共享 metaTagCSS（本串在下方插值），
   原 .nm-tag/.nm-bracket 别名选择器为死代码（renderDisplayName 只产出 .tag-*），2026-09 删除；
   scoped base 行同 .fh 侧冗余删除。域特有仅剩 .tag-ext（扩展名灰标）。 */
.fl .nm .tag-ext { color: var(--muted); font-size: 0.85em; }
.fl .nm.ysm { color: var(--txt); }
.fl .sz { font-size: var(--fs-xs); white-space: nowrap; flex-shrink: 0; font-family:var(--font-mono); text-shadow:0 1px 2px rgba(0,0,0,.12); }
.fl .sz.sz-green { color: var(--size-ok,#a6e3a1); }
.fl .sz.sz-red { color: var(--size-large,#f38ba8); }
.fl .sz:not(.sz-green):not(.sz-red) { color: var(--muted); }
.fl .dt { font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; flex-shrink: 0; font-family:var(--font-mono); }
/* 悬停快捷操作 */
.hover-actions { display: none; gap: 2px; flex-shrink: 0; align-items: center; }
.fl:hover .hover-actions { display: flex; }
.ha-btn { font-size: var(--fs-sm); padding: 1px 3px; border-radius:var(--radius-xs); cursor: pointer; opacity: .6; transition: all var(--tr-fast); }
.ha-btn:hover { opacity: 1; background: var(--hover); }
.ficon { font-size: var(--fs-sm); }
.tag-dot { font-size:var(--fs-micro); margin-right: 2px; opacity: .7; vertical-align: middle; }
.ftr { padding: 8px 12px; border-top: 1px solid var(--bd); display: flex; gap: 6px; align-items: center; }
.ftr .stat { font-size: var(--fs-sm); color: var(--muted); margin-right: auto; }
.type-bar { padding:2px 12px;gap:4px;display:flex;align-items:center;border-bottom:1px solid var(--bd); }

/* SVG 图标尺寸/着色（ADR-238 单一出处，跨 shadow 共享） */
${wsIconCSS}

/* .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts）
   取代原逐类 :host-context(.no-animations) .fl/.fh（本域仍有多处
   transition，且通配桥覆盖未来新增动效——无需再逐类登记）。 */
${noAnimationsCSS}
`;
