// ===== 诊断页(diag-*) + 性能(perf-*) + 日志(log-*) + 冲突(conflict-*) + 扫描(scan-*) + 去重 UI + 诊断配置面板 =====
// 工坊 GitHub 族（gh-* 全族）已拆至 content-gh.ts（2026-09 锐评 P3 按页面域拆分）。
// 注：设置页 .stg-* / .tab-body / .settings-group / .setting-row 已收口 content-stg.ts（并入 shadow）；
//     components.css 仅服务全局 document 层 dialogs（.dlg-*/.afv-*/.mc-pick-*/.br-* 等），不再含 stg/settings。
export const contentDiagCSS: string = `
/* ===== 诊断页面：左栏按钮 + 右栏信息 ===== */
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
.log-row .log-op { font-size:var(--fs-xs); padding:0 4px; border-radius:var(--radius-sm); background:color-mix(in srgb, var(--accent) 18%, transparent); color:var(--accent); flex-shrink:0; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }

.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:var(--status-error); }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }

/* ===== 诊断页动画 ===== */
@keyframes logRowIn { from { opacity:0; transform:translateX(-12px); } to { opacity:1; transform:translateX(0); } }
.log-row { animation: fadeSlideLeft .25s ease both; }
@keyframes conflictRowIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
.conflict-row, .conflict-ins { animation: conflictRowIn .3s ease both; }
@keyframes scanPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.15); } }
.btn-base.accent.scanning { animation: scanPulse 1s ease-in-out infinite; pointer-events:none; opacity:.7; }
@keyframes scanRadar {
  0%   { background: conic-gradient(from 0deg, transparent 0%, var(--accent) 10%, transparent 20%); }
  100% { background: conic-gradient(from 360deg, transparent 0%, var(--accent) 10%, transparent 20%); }
}
.scan-radar-wrap { position:relative; display:flex; align-items:center; justify-content:center; padding:24px; }
.scan-radar { width:80px; height:80px; border-radius:50%; border:2px solid var(--bd); animation: scanRadar 2s linear infinite; opacity:.5; }
.scan-radar-dot { position:absolute; width:8px; height:8px; border-radius:50%; background:var(--accent); animation: scanDot 2s linear infinite; }
@keyframes scanDot {
  0%   { top:4px; left:50%; transform:translateX(-50%); }
  25%  { top:50%; left:calc(100% - 4px); transform:translateY(-50%); }
  50%  { top:calc(100% - 4px); left:50%; transform:translateX(-50%); }
  75%  { top:50%; left:4px; transform:translateY(-50%); }
  100% { top:4px; left:50%; transform:translateX(-50%); }
}

.diag-panel { animation: diagPanelIn .2s ease; }
@keyframes diagPanelIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
/* 日志面板工具栏：两行语义分组（2026-09-17 版面收口）。
   行1 = 视图切换（操作/运行时）+ 动作（刷新/复制/清空）；行2 = 状态筛选 + 搜索。
   立因：9 按钮 + 1 输入框挤单行时，flex:1 的 spacer 把「清空」（破坏性动作）与筛选 chips
   划成一组、却把刷新/复制推到行尾——视觉分组 ≠ 功能分组；且 spacer 自身会随
   flex-wrap 折行，窄宽下右侧动作组被挤散。分层后每行语义单一，行2 的搜索框
   可吃掉腾出的宽度。.diag-log-row 为布局类，由 content-diag-classes.test.ts 强制同步。 */
.diag-log-bar { display:flex; flex-direction:column; gap:4px; padding:4px 12px; border-bottom:1px solid var(--bd); flex-shrink:0; }
.diag-log-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.diag-log-bar-spacer { flex:1; }
.diag-log-subtabs { display:flex; gap:2px; }
.diag-sub-tab { padding:3px 10px; border-radius:var(--radius-sm); border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-sm); font-family:inherit; transition:var(--tr-fast); }
.diag-sub-tab:hover { background:var(--hover); color:var(--txt); }
.diag-sub-tab.active { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb, var(--accent) 18%, transparent); }
/* 筛选按钮：复用 .cr-tag-filter-btn 的规则（同 shadow 根 contentCSS，无需另立一份）。
   ⚠️ 本类三条规则曾在 ADR-258 重构中被误删（随 .diag-btn* 左栏残留清掉，但按钮仍在使用）
   → 裸渲染。现恢复为「复用 + 仅覆盖字号」，不再复制一份同构样式。 */
.diag-log-fbtn { font-size:var(--fs-sm); }
.diag-log-filter { display:flex; align-items:center; gap:4px; overflow:hidden; flex:1; min-width:0; }
.diag-log-filter input { flex:1; min-width:110px; max-width:320px; font-size:var(--fs-sm); padding:2px 8px; border-radius:var(--radius-sm); border:1px solid var(--bd); background:var(--bg); color:var(--txt); }
.diag-log-scroll { overflow-y:auto; flex:1; }
/* ADR-259：布局基线归 .tab-body（面板即 .tab-body）；.diag-panel 只留入场动画钩子（见上方 diagPanelIn） */
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:var(--muted); }
.diag-stat-error { color: var(--status-error); }
.perf-gui-est { font-size:var(--fs-micro); padding:0 4px; border-radius:var(--radius-xs); background:color-mix(in srgb, var(--warning, #b8860b) 20%, transparent); color:var(--warning, #b8860b); flex-shrink:0; }
/* 类型矩阵（ADR-262 D3）：表格 + 逐模型明细；未采集/阶段不符用 warning 色显式标注 */
.perf-matrix { width:100%; border-collapse:collapse; margin:6px 0; font-size:var(--fs-xs); color:var(--txt); }
.perf-matrix th, .perf-matrix td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--bd); }
.perf-matrix th { color:var(--muted); font-weight:600; }
.perf-matrix-id { color:var(--muted); font-size:var(--fs-micro); }
.perf-matrix-tag { font-size:var(--fs-micro); padding:0 4px; border-radius:var(--radius-xs); background:var(--surf); color:var(--muted); }
.perf-matrix-warn { color:var(--warning, #b8860b); }
.perf-matrix-models { display:flex; flex-direction:column; gap:2px; padding:2px 0; }
.perf-matrix-model { display:flex; align-items:center; gap:8px; font-size:var(--fs-xs); }
.perf-matrix-model-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); }
.perf-matrix-model-detail { color:var(--muted); font-variant-numeric:tabular-nums; flex-shrink:0; }

/* ===== 性能面板（single-bench / gui-flow / perf-log） ===== */
.perf-section { font-size:var(--fs-sm); font-weight:600; color:var(--txt); display:flex; align-items:center; gap:6px; }
.perf-bar-row { display:flex; align-items:center; gap:8px; margin:2px 0; font-size:var(--fs-xs); }
.perf-bar-name { flex:0 0 118px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); }
.perf-bar-track { flex:1; height:12px; background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-md); overflow:hidden; }
.perf-bar-fill { display:block; height:100%; background:var(--accent); border-radius:var(--radius-md); }
.perf-bar-fill.perf-bar-warn { background: var(--warning, #e6b800); }
.perf-bar-fill.perf-bar-danger { background: var(--status-error); }
.perf-bar-val { flex:0 0 auto; min-width:130px; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.perf-bar-val.perf-bar-warn { color: var(--warning, #b8860b); }
.perf-bar-val.perf-bar-danger { color: var(--status-error); }
/* 阶段运行归属徽标（ADR-262 D2）：single-bench 与 gui-flow 共用同一概念，同一类名 */
.perf-rt-tag { font-size:var(--fs-micro); padding:0 4px; border-radius:var(--radius-xs); background:color-mix(in srgb, var(--muted, #888) 18%, transparent); color:var(--muted); flex-shrink:0; }
/* 阶段样本统计（n / median / p95，ADR-262 D2）：等宽数字避免列跳动 */
.perf-stats { font-size:var(--fs-micro); color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; flex-shrink:0; }
.perf-total { padding:6px 2px; font-size:var(--fs-base); font-weight:600; color:var(--txt); border-top:1px solid var(--bd); margin-top:8px; }
/* 基准对比判决行（ADR-262 D8）：Go 给 base→now 与 delta，前端只映射配色/emoji */
.perf-bl-rows { margin:2px 0 0 0; }
.perf-bl-row { display:flex; align-items:center; gap:8px; padding:2px 2px; font-size:var(--fs-sm); color:var(--txt); border-bottom:1px dotted var(--bd); }
.perf-bl-row.perf-bar-danger { color:var(--status-error); font-weight:600; }
.perf-bl-row.perf-bar-warn { color:var(--warning, #b8860b); }
/* noise/new 不是「判退化」——压低权重，避免被误读成结论 */
.perf-bl-row.perf-bl-muted { color:var(--muted); }
.perf-bl-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.perf-bl-detail { flex:0 0 auto; font-variant-numeric:tabular-nums; color:var(--muted); }
.perf-bl-delta { flex:0 0 auto; min-width:96px; text-align:right; font-variant-numeric:tabular-nums; }
.perf-bl-mark { flex:0 0 auto; }
.perf-gui-stage { display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); color:var(--txt); padding:3px 2px; flex-wrap:wrap; }
.perf-gui-stage .perf-gui-status { font-size:var(--fs-base); }
.perf-gui-stage .perf-gui-name { font-weight:600; }
.perf-gui-stage .perf-gui-ms { flex:1; text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
.perf-gui-desc { flex-basis:100%; display:block; font-size:var(--fs-xs); color:var(--muted); padding-left:10px; white-space:pre-wrap; }
.perf-gui-stage.perf-gui-fail { color: var(--status-error); }
.perf-gui-stage.perf-gui-fail .perf-gui-ms { color: var(--status-error); }
.perf-hist-card { border:1px solid var(--bd); border-radius:var(--radius-md); background:var(--surf); padding:6px 10px; margin:4px 0; animation: conflictRowIn .3s ease both; }
.perf-hist-head { display:block; font-size:var(--fs-sm); color:var(--txt); margin-bottom:2px; }
.perf-hist-head code { background:var(--bg); padding:0 4px; border-radius:var(--radius-xs); font-size:var(--fs-xs); }
.perf-hist-body { display:block; font-size:var(--fs-xs); color:var(--muted); white-space:pre-wrap; }

/* ===== 加载剖析面板 ===== */
.perf-trace-meta { font-size:var(--fs-xs);color:var(--muted);word-break:break-all; }
.perf-gantt-wrap { padding:6px 2px; }
.perf-asset-grid { display:flex;flex-wrap:wrap;gap:4px 12px;padding:6px 2px;font-size:var(--fs-xs); }
.perf-asset-item { color:var(--txt);white-space:nowrap; }
.perf-badge-ok { color:var(--status-success);font-weight:600; }
.perf-badge-warn { color:var(--warning,#b8860b); }
.perf-tex-section { font-size:var(--fs-xs);color:var(--muted);padding:4px 2px;line-height:1.6; }
.perf-tex-row { display:flex;align-items:center;gap:6px;padding:1px 0; }
.perf-tex-name { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt); }
.perf-tex-size { color:var(--muted);font-size:var(--fs-xs);flex-shrink:0; }
.perf-ktx2-badge { font-size:var(--fs-micro);padding:0 3px;border-radius:var(--radius-xs);background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent);flex-shrink:0; }
.perf-tex-more { color:var(--muted);font-size:var(--fs-xs);padding:2px 0; }
.perf-no-data { color:var(--muted);font-size:var(--fs-sm);padding:12px 2px;text-align:center; }
.perf-no-hint { color:var(--muted);font-size:var(--fs-xs);padding:2px 2px 8px;text-align:center;opacity:.7; }
.perf-trace-hint { color:var(--muted);font-size:var(--fs-xs);padding:4px 2px 8px;text-align:center;opacity:.6;border-top:1px solid var(--bd);margin-top:6px; }

/* ===== 诊断页去重 UI (diag-dedup) ===== */
.diag-msg { padding:12px;font-size:var(--fs-sm); }
.diag-msg-error { color:var(--status-error); }
.diag-msg-success { color:var(--status-success); }
.diag-msg-muted { color:var(--muted); }
.diag-dedup-summary { padding:10px 12px;font-size:var(--fs-sm);color:var(--txt);border-bottom:1px solid var(--bd); }
.diag-dedup-summary-hint { display:block;font-size:var(--fs-micro);color:var(--muted);margin-top:2px; }
.diag-dedup-rt { display:flex;align-items:center;gap:4px;padding:6px 12px 2px;font-size:var(--fs-xs);font-weight:600;color:var(--txt); }
.diag-dedup-rt-sep { flex:1;border-bottom:1px solid var(--bd);margin-left:6px; }
.diag-dedup-rt-count { font-size:var(--fs-micro);color:var(--muted);font-weight:400; }
.diag-dedup-group { margin:4px 12px;border:1px solid var(--bd);border-radius:var(--radius-lg);overflow:hidden; }
.diag-dedup-group-head { display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:var(--fs-xs);font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd); }
.diag-dedup-group-fill { flex:1; }
.diag-dedup-group-info { font-size:var(--fs-micro);color:var(--muted);font-weight:400; }
.diag-dedup-file { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:var(--fs-xs);cursor:pointer;transition:background var(--tr-fast); }
.diag-dedup-file-default { background:var(--hover); }
.diag-dedup-file-name { flex:1;overflow:hidden;min-width:0; }
.diag-dedup-file-name-text { color:var(--txt);font-size:var(--fs-xs);cursor:pointer; }
.diag-dedup-file-ic { margin-right:3px; }
.diag-dedup-file-dir { display:block;font-size:var(--fs-micro);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.diag-dedup-file-size { font-size:var(--fs-micro);color:var(--muted);flex-shrink:0;margin-right:4px; }
.diag-dedup-file-date { font-size:var(--fs-micro);color:var(--muted);flex-shrink:0; }
.diag-dedup-recommend { font-size:var(--fs-micro);padding:0 4px;border-radius:var(--radius-xs);background:color-mix(in srgb, var(--status-success) 12%, transparent);color:var(--status-success); }
.diag-dedup-radio { flex-shrink:0;accent-color:var(--accent); }
.diag-dedup-keep-all { display:flex;align-items:center;gap:4px;padding:4px 8px;font-size:var(--fs-xs);cursor:pointer;transition:background var(--tr-fast);border-top:1px solid var(--bd); }
.diag-dedup-keep-all-label { color:var(--muted); }
.diag-dedup-actions { display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--bd); }
.diag-dedup-exec { flex:1;padding:7px 16px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--bg);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.diag-dedup-cancel { padding:7px 16px;border-radius:var(--radius-md);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }

/* ===== 诊断页配置面板（conflicts.ts / dedup.ts / health.ts 渲染） =====
   这些类此前在 shadow 内无 CSS 规则，裸奔靠 UA 默认样式（WebView2 暗色不协调）；
   机检 css-layer-check 的 WARN 暴露后补显式样式（评审 2026-08-24 第 1 条盲区收口）。 */
.diag-config-item { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:var(--fs-sm); color:var(--txt); }
.diag-config-select, .diag-config-input { padding:var(--btn-padding-sm); border-radius:var(--radius-md); border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:var(--fs-sm); font-family:inherit; min-width:160px; }
.diag-config-select:focus, .diag-config-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.diag-sync-config { padding:8px 12px; border:1px solid var(--bd); border-radius:var(--radius-md); margin:4px 0; background:var(--surf); }
.diag-sync-resolve { margin-top:16px; padding:12px; background:var(--diag-stat-bg, var(--surf)); border-radius:var(--radius-lg); }
.diag-dedup-config { padding:8px 12px; }
.diag-warn { color:var(--status-warning, #e6b800); font-weight:600; }

/* P1 批次12:工坊行名称容器(community/render.ts nameWrap,gh-row 列1 内部 flex 容器) → 已归位 content-gh.ts */
`;
