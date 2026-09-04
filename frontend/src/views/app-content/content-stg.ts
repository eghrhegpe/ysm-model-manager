// ===== 设置页 + 通用 tab-body（从 frontend/css/components.css 迁入 shadow）=====
// 根因：components.css 仅经 index.html 全局 <link> 加载，<app-content> 用 Shadow DOM
// （adoptedStyleSheets=[contentCSS]），全局 link 被 shadow 边界阻断，导致 .stg-* / .tab-body
// 在 shadow 内零样式（基础设置页卡片/网格/标题/路径值裸奔，tab 无 flex 布局）。
// 本文件将 settings 独占样式 + 跨 tab 复用的 .tab-body 收口进 shadow 组合层。
// 注意：.dlg-* / .afv-* / .mc-pick-* / .br-* 等全局 document 层 dialogs 样式仍留 components.css。
export const contentStgCSS: string = `
/* ===== 设置页 ===== */
.stg-page {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.stg-title {
  margin-bottom: 8px;
}
.stg-group {
  margin-bottom: 12px;
}
.stg-val {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.stg-btn {
  font-size: 10px;
}
.stg-hint {
  font-size: 9px;
  color: var(--muted);
  padding: 2px 0 0 0;
}
.stg-sub-title {
  margin-top: 16px;
}
.stg-radio-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
}
.stg-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
}
.stg-hint-hidden {
  font-size: 9px;
  color: var(--muted);
  padding: 2px 0 0 0;
  display: none;
}
.stg-hint-warn {
  font-size: 9px;
  color: var(--status-error);
}
.stg-select {
  padding: var(--btn-padding-sm);
  border-radius: var(--btn-radius, 6px);
  border: 1px solid var(--bd);
  background: transparent;
  color: var(--txt);
  cursor: pointer;
  font-size: var(--fs-btn-tool);
  font-family: inherit;
  transition: var(--btn-transition);
  white-space: nowrap;
}
.stg-select:hover { background: var(--hover); }
.stg-select:focus { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.stg-ml-auto {
  margin-left: auto;
}

/* ===== 设置页卡片/路径样式（settings 独占） ===== */
.stg-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.stg-card { background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-lg); overflow:hidden; animation:fadeSlideUp var(--tr-enter) both; }
.stg-card-hdr { display:flex;align-items:center;gap:6px; padding:8px 12px; font-size:var(--fs-sm); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); background:var(--bg2,transparent); }
.stg-card-body { padding:8px 12px; }
.stg-path-val { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-size:var(--fs-sm); color:var(--txt); background:var(--bg); transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-val:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val.derived:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val.derived::before { content:"📁 "; }
.stg-card-hint { font-size:var(--fs-xs); color:var(--muted); margin-bottom:6px; }
.stg-card-acts { display:flex; gap:4px; }
.stg-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:6px; line-height:1.4; }
.stg-adv-reset { margin-left:auto; }
.stg-card-overridden { border-color:var(--accent); }
.stg-custom-badge { font-size:9px;color:var(--accent); }
.stg-path-picker { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-size:10px; color:var(--txt); background:var(--bg); transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-picker:hover { border-color:var(--accent); background:var(--hover); }
@keyframes advPanelIn { from { opacity:0; max-height:0; } to { opacity:1; max-height:600px; } }
@keyframes advPanelOut { from { opacity:1; max-height:600px; } to { opacity:0; max-height:0; } }
#set-advanced-panel { overflow:hidden; }
#set-advanced-panel.adv-open { animation: advPanelIn .25s ease forwards; }
#set-advanced-panel.adv-closing { animation: advPanelOut .2s ease forwards; }

/* ===== 通用 tab-body（跨设置/仓库/ins/gh/cr 各 tab 复用，归位 shadow） ===== */
.tab-body { flex:1;display:flex;flex-direction:column;overflow:hidden; }

/* ===== 设置页分组/行（从 content-diag.ts 收口；tpl-settings.ts 仍消费，属 settings 资产） ===== */
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surf); border-radius:var(--radius-md); margin-bottom:4px; font-size:var(--fs-md); animation:fadeSlideUp var(--tr-enter) both; }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--muted); }

/* ===== 设置页 tab 按钮（从 content-repo.ts 拆出，设置页资产不归仓库域托管） ===== */
/* 本地化 keyframe：shadow 内引用全局 fadeSlideDown 不生效（keyframes 不穿 shadow），故本地定义 stgTabIn */
.stg-tab { padding:var(--pad-nav) 14px;border-radius:var(--radius-md) var(--radius-md) 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:var(--tr-normal);white-space:nowrap;min-height:var(--touch-min);animation:stgTabIn var(--tr-enter) both; }
.stg-tab:hover { color:var(--txt);background:var(--hover); }
.stg-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
@keyframes stgTabIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

/* P1 批次12:3D 键位设置行(keymap.ts tdRenderKeymap row,#td-keymap-grid 内 flex 行) */
.stg-km-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:var(--fs-sm); }
`;
