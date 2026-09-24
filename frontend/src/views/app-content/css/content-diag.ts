// ===== 诊断页(diag-*) + 性能(perf-*) + 日志(log-*) + 冲突(conflict-*) + 扫描(scan-*) + 去重 UI + 诊断配置面板 =====
// 工坊 GitHub 族（gh-* 全族）已拆至 content-gh.ts（2026-09 锐评 P3 按页面域拆分）。
// 注：设置页 .stg-* / .tab-body / .settings-group / .setting-row 已收口 content-stg.ts（并入 shadow）；
//     components.css 仅服务全局 document 层 dialogs（.dlg-*/.afv-*/.mc-pick-*/.br-* 等），不再含 stg/settings。
export const contentDiagCSS: string = `
/* ===== 诊断页面：左栏按钮 + 右栏信息 ===== */
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
/* 状态色（ADR-238 收债，2026-09-18）：状态图标从 emoji 自带色迁到 SVG currentColor 后，
   颜色由本行 class 按状态驱动——成功绿/失败红/警告黄走 --status-* 语义变量；
   debug/skip 属次级信息用 muted，fatal 复用 error 红（级别差由图标形状区分）。 */
.log-row .log-status.success { color:var(--status-success); }
.log-row .log-status.failed, .log-row .log-status.error, .log-row .log-status.fatal { color:var(--status-error); }
.log-row .log-status.warn { color:var(--status-warning); } /* 审计 P2-6：删 --status-warning 冗余回退（6 主题已定义） */
.log-row .log-status.debug, .log-row .log-status.skipped { color:var(--muted); }
/* ADR-289：运行时日志按推断 Level 出 class。info 中性（不抢眼，运行时大量是正常流水），
   unknown = 无 Level 字段的旧数据/兜底，与 muted 同档。 */
.log-row .log-status.info { color:var(--txt); }
.log-row .log-status.unknown { color:var(--muted); }
.log-row .log-op { font-size:var(--fs-xs); padding:0 var(--sp-1); border-radius:var(--radius-sm); background:color-mix(in srgb, var(--accent) 18%, transparent); color:var(--accent); flex-shrink:0; }
/* 运行时日志 tag 徽标（ADR-289）：Go 捕获层提取的行首方括号前缀，与 .log-op 同范式
   （操作日志出 Operation、运行时日志出 Tag，两者都是「这条日志属于哪个子系统」）。 */
.log-row .log-tag { font-size:var(--fs-xs); padding:0 var(--sp-1); margin-right:4px; border-radius:var(--radius-sm); background:color-mix(in srgb, var(--muted) 22%, transparent); color:var(--muted); flex-shrink:0; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
/* 行内复制按钮：此前无规则 → 每个日志行里都是一个 UA 默认灰底描边按钮，与暗色主题格格不入 */
.log-row .log-copy { background:transparent; border:none; color:var(--muted); cursor:pointer; padding:0 var(--sp-1); line-height:1; flex-shrink:0; }
.log-row .log-copy:hover { color:var(--accent); }

.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:var(--status-error); }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }

/* ===== 诊断页动画 ===== */
@keyframes logRowIn { from { opacity:0; transform:translateX(-12px); } to { opacity:1; transform:translateX(0); } }
.log-row { animation: fadeSlideLeft .25s ease both; }
@keyframes conflictRowIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
.conflict-row, .conflict-ins { animation: conflictRowIn .3s ease both; }
@keyframes scanRadar {
  0%   { background: conic-gradient(from 0deg, transparent 0%, var(--accent) 10%, transparent 20%); }
  100% { background: conic-gradient(from 360deg, transparent 0%, var(--accent) 10%, transparent 20%); }
}
.scan-radar-wrap { position:relative; display:flex; align-items:center; justify-content:center; padding:var(--sp-5); }
.scan-radar { width:80px; height:80px; border-radius:50%; border:2px solid var(--bd); animation: scanRadar 2s linear infinite; opacity:.5; }
.scan-radar-dot { position:absolute; width:8px; height:8px; border-radius:50%; background:var(--accent); animation: scanDot 2s linear infinite; }
@keyframes scanDot {
  0%   { top:4px; left:50%; transform:translateX(-50%); }
  25%  { top:50%; left:calc(100% - 4px); transform:translateY(-50%); }
  50%  { top:calc(100% - 4px); left:50%; transform:translateX(-50%); }
  75%  { top:50%; left:4px; transform:translateY(-50%); }
  100% { top:4px; left:50%; transform:translateX(-50%); }
}

/* ADR-259 + 2026-09-25 版面收口：.diag-panel 既是入场动画钩子，也是**三 tab 唯一的留白来源**。
   此前留白由各组容器内 padding 各自负责（bench 的 .diag-pane 是 8px 12px，logs / audit 无），
   于是同一条子 pill 行在三个 tab 里左边缘分别落在 22px / 10px / 10px——切 tab 横跳 12px。
   现在收成：面板 .diag-panel 出留白 → .diag-pane 出纵向分区（零 padding）→ 全页同一起跑线。 */
.diag-panel { padding:var(--sp-vh-pane); min-height:0; animation: diagPanelIn .2s ease; }
@keyframes diagPanelIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
/* 日志工具栏的两行语义分组（2026-09-17 版面收口，搜索框 2026-09-28 上移）：
   行1 = 搜索框 + 动作（刷新/复制/清空）；行2 = 状态筛选 chips + 操作类型下拉。
   演进：9 按钮 + 1 输入框挤单行时，flex:1 的 spacer 把「清空」（破坏性动作）与筛选 chips
   划成一组、却把刷新/复制推到行尾——视觉分组 ≠ 功能分组；且 spacer 自身会随
   flex-wrap 折行，窄宽下右侧动作组被挤散。
   2026-09-25：工具栏类沿用全页统一词汇 .diag-bar / .diag-bar-row（见下方三件套区），
   原 .diag-log-bar / .diag-log-row / .diag-log-bar-spacer 退役——.diag-log-row 与既有的
   .diag-bar-row **逐字相同**，留着就是两份真相。 */
/* 组内二级导航（ADR-300 §2.2）：renderSubBar 产出的 pill 行——全页唯一的「页内再分屏」形态。
   gap 2px→4px（2026-09-25）：pill 带 1px 描边，2px 下相邻边框近乎连体；取同页筛选 chips
  （.diag-log-filter）的 gap:4px 同档。
   子分区容器不再另立门户（原 .diag-sub-pane）→ 并入 .diag-pane（见下方三件套区）。 */
.diag-sub-bar { display:flex; align-items:center; gap:var(--sp-1); padding:var(--btn-padding-std); flex-shrink:0; flex-wrap:wrap; }
.diag-sub-tab { padding:var(--btn-padding-std); border-radius:var(--radius-sm); border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-sm); font-family:inherit; transition:var(--tr-fast); }
.diag-sub-tab:hover { background:var(--hover); color:var(--txt); }
.diag-sub-tab.active { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb, var(--accent) 18%, transparent); }
/* 筛选按钮：基础/hover/active 三条规则归 content-creator.ts 的共享选择器
   （.cr-tag-filter-btn, .diag-log-fbtn 同 shadow 根 contentCSS，本文件不再复制），
   本处仅覆盖字号为 --fs-sm（筛选按钮比创作者标签筛选稍大，见 .diag-sub-tab 同档）。
   ⚠️ 本类三条规则曾在 ADR-258 重构中被误删（随 .diag-btn* 左栏残留清掉，但按钮仍在使用）
   → 裸渲染；3f0389c70 在 content-creator.ts 恢复共享规则 + 本处保留字号覆盖。 */
.diag-log-fbtn { font-size:var(--fs-sm); }
.diag-log-filter { display:flex; align-items:center; gap:4px; overflow:hidden; flex:1; min-width:0; }
/* 搜索框（2026-09-28 上移行1 后由 .diag-log-search 接管）：flex:1 吃掉子 tab 与动作组
   之间的空档，max-width 封顶避免把动作组挤太远；缩窄时 min-width 保证仍可输入。 */
.diag-log-search { flex:1; min-width:110px; max-width:320px; font-size:var(--fs-sm); padding:var(--btn-padding-tool-lg); border-radius:var(--radius-sm); border:1px solid var(--bd); background:var(--bg); color:var(--txt); }
/* 操作类型下拉（2026-09-28 纵向筛选）：与状态 chips 同排、与搜索框同款度量；
   max-width 封顶防长标签（「全部操作」多语）把 chips 挤走，margin-left:auto 推到行尾与 chips 分离。 */
.diag-log-op-filter { font-size:var(--fs-sm); padding:var(--btn-padding-xs); border-radius:var(--radius-sm); border:1px solid var(--bd); background:var(--bg); color:var(--txt); max-width:150px; margin-left:auto; }
/* ADR-259：布局基线归 .tab-body（面板即 .tab-body）；.diag-panel 除入场动画钩子外，
   2026-09-25 起兼作三 tab 的唯一留白来源（见上方 .diag-panel 规则处注释）。 */
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:var(--pad-v-2); display:flex; justify-content:space-between; }
.diag-stat { padding:var(--sp-3); font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:var(--muted); }
.diag-stat-error { color: var(--status-error); }
.perf-gui-est { font-size:var(--fs-micro); padding:0 var(--sp-1); border-radius:var(--radius-xs); background:color-mix(in srgb, var(--status-warning) 20%, transparent); color:var(--status-warning); flex-shrink:0; }
/* 类型矩阵（ADR-262 D3）：表格 + 逐模型明细；未采集/阶段不符用 warning 色显式标注 */
.perf-matrix { width:100%; border-collapse:collapse; margin:6px 0; font-size:var(--fs-xs); color:var(--txt); }
.perf-matrix th, .perf-matrix td { text-align:left; padding:var(--sp-vh-cell); border-bottom:1px solid var(--bd); }
.perf-matrix th { color:var(--muted); font-weight:600; }
.perf-matrix-id { color:var(--muted); font-size:var(--fs-micro); }
.perf-matrix-tag { font-size:var(--fs-micro); padding:0 var(--sp-1); border-radius:var(--radius-xs); background:var(--surf); color:var(--muted); }
.perf-matrix-warn { color:var(--status-warning); }
.perf-matrix-models { display:flex; flex-direction:column; gap:2px; padding:var(--pad-v-2); }
.perf-matrix-model { display:flex; align-items:center; gap:8px; font-size:var(--fs-xs); }
.perf-matrix-model-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); font-family:var(--font-mono); }
.perf-matrix-model-detail { color:var(--muted); font-variant-numeric:tabular-nums; flex-shrink:0; font-family:var(--font-mono); }

/* ===== 诊断页通用布局词典（2026-09-21 由 .perf-* 泛化，ADR-288；2026-09-25 收口为唯一词汇）=====
   全页三 tab 共用同一副骨架，逐层只做一件事：
     .diag-panel   = 面板本体（.tab-body 的面板类）—— **唯一留白来源**（padding）
     .diag-pane    = 纵向分区（pill 行 + 常驻栏 + 结果区）—— **自身不滚动**（overflow:hidden）
     .diag-bar     = 常驻控制栏（border-bottom + flex-shrink:0）
     .diag-bar-row = 栏内语义行（flex-wrap）
     .diag-bar-hint= 栏内说明行（独占一行，弱化）
     .diag-result  = 结果区 —— **唯一滚动**（flex:1 + min-height:0 + overflow-y:auto）
   2026-09-25 收口动机（三条，均可实证）：
    ① .diag-pane 原自带 overflow-y:auto，而常驻栏正是它的子元素 → 内容一多，宣称「常驻」
      的控制栏照样滚出视野；滚动职责收给 .diag-result 后「常驻」才名副其实。
    ② .diag-sub-pane（audit / logs-trace 用）与 .diag-pane（bench 用）是同义两份，只差一个
      padding——正是那 12px 把基准组的 pill 行推到 22px（另两组 10px）。现二合一，
      padding 上交 .diag-panel。
    ③ .diag-log-row 与 .diag-bar-row 逐字相同，一并退役（老名字见上方日志工具栏注释）。
   历史：这几个类 2026-09 之前**无任何规则**（类名空头支票），控件靠 UA 默认 inline 流换行，
   分组不可见、窄屏折行语义全散；当时按日志工具栏已验证的范式补的规则。
   ⚠️ 新布局一律抄这几个类；tpl 里出现的类必须在 shadow 层有规则（css-layer-check 判定域自推导）。 */
.diag-pane { flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; overflow:hidden; }
.diag-bar { display:flex; flex-direction:column; gap:4px; padding:0 0 6px; border-bottom:1px solid var(--bd); flex-shrink:0; }
.diag-bar-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.diag-bar-row > input[type="text"] { flex:1; min-width:180px; }
.diag-bar-spacer { flex:1; }
/* 提示行：.diag-bar-row 是 flex 容器，flex-basis:100% 让说明文字独占一行，
   与栏内控件行同语义但无交互权重（不可点、不截断 title）。 */
.diag-bar-hint { flex-basis:100%; color:var(--muted); font-size:var(--fs-xs); line-height:1.4; }
/* 结果区 = 唯一滚动容器。min-height:0 不可省：column flex 子项默认 min-height:auto，
   内容再长也不收缩，滚动条会被顶到 .tab-body 上——届时「常驻栏」又会跟着滚。 */
.diag-result { flex:1; min-height:0; overflow-y:auto; }
/* ADR-278 §2.4：基准模式显隐走 class，与查看器降级的 inline display:none 分工不冲突（inline 胜过 class） */
.perf-mode-off { display: none; }

/* ===== 性能面板（single-bench / concurrent / scan-bench / perf-log） ===== */
.perf-section { font-size:var(--fs-sm); font-weight:600; color:var(--txt); display:flex; align-items:center; gap:6px; }
/* CLI 信封耗时徽标：量的是命令本身，非本页渲染——弱化样式，不与区段标题抢视觉权重 */
.perf-section-ms { display:inline-flex; align-items:center; gap:2px; font-size:var(--fs-xs); font-weight:400; color:var(--muted); }
.perf-bar-row { display:flex; align-items:center; gap:8px; margin:2px 0; font-size:var(--fs-xs); }
.perf-bar-name { flex:0 0 118px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); }
.perf-bar-track { flex:1; height:12px; background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-md); overflow:hidden; }
.perf-bar-fill { display:block; height:100%; background:var(--accent); border-radius:var(--radius-md); }
.perf-bar-fill.perf-bar-warn { background: var(--status-warning); }
.perf-bar-fill.perf-bar-danger { background: var(--status-error); }
.perf-bar-val { flex:0 0 auto; min-width:130px; text-align:right; color:var(--txt); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } /* 测量值 = 面板产出正文（warn/danger 变体下条覆盖） */
.perf-bar-val.perf-bar-warn { color: var(--status-warning); }
.perf-bar-val.perf-bar-danger { color: var(--status-error); }
/* 阶段运行归属徽标（ADR-262 D2）：single-bench / concurrent / scan-bench 共用同一概念，同一类名 */
.perf-rt-tag { font-size:var(--fs-micro); padding:0 var(--sp-1); border-radius:var(--radius-xs); background:color-mix(in srgb, var(--muted, #888) 18%, transparent); color:var(--muted); flex-shrink:0; }
/* 阶段样本统计（n / median / p95，ADR-262 D2）：等宽数字避免列跳动 */
.perf-stats { font-size:var(--fs-micro); color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; flex-shrink:0; }
.perf-total { padding:var(--sp-vh-perf); font-size:var(--fs-base); font-weight:600; color:var(--txt); border-top:1px solid var(--bd); margin-top:8px; }
/* 基准对比判决行（ADR-262 D8）：Go 给 base→now 与 delta，前端只映射配色/emoji */
.perf-bl-rows { margin:2px 0 0 0; }
.perf-bl-row { display:flex; align-items:center; gap:8px; padding:2px 2px; font-size:var(--fs-sm); color:var(--txt); border-bottom:1px dotted var(--bd); }
.perf-bl-row.perf-bar-danger { color:var(--status-error); font-weight:600; }
.perf-bl-row.perf-bar-warn { color:var(--status-warning); }
/* noise/new 不是「判退化」——压低权重，避免被误读成结论 */
.perf-bl-row.perf-bl-muted { color:var(--muted); }
.perf-bl-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.perf-bl-detail { flex:0 0 auto; font-variant-numeric:tabular-nums; color:var(--muted); }
.perf-bl-delta { flex:0 0 auto; min-width:96px; text-align:right; font-variant-numeric:tabular-nums; }
.perf-bl-mark { flex:0 0 auto; }
/* 并发基准（ADR-262 D5）：加速比与判决 token 由 Go 给出，前端只映射配色 */
.perf-conc { display:flex; flex-direction:column; }
.perf-conc-params { color:var(--muted); font-size:var(--fs-xs); padding:0 2px 4px 2px; }
.perf-conc-row, .perf-conc-filerow { display:flex; align-items:center; gap:8px; padding:3px 2px; font-size:var(--fs-sm); color:var(--txt); border-bottom:1px dotted var(--bd); flex-wrap:wrap; }
.perf-conc-serial { font-weight:600; }
.perf-conc-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.perf-conc-ms { flex:0 0 auto; min-width:88px; text-align:right; font-variant-numeric:tabular-nums; }
.perf-conc-speedup { flex:0 0 auto; min-width:64px; text-align:right; font-variant-numeric:tabular-nums; }
.perf-conc-detail { flex:0 0 auto; color:var(--muted); font-variant-numeric:tabular-nums; }
.perf-conc-verdict { flex:0 0 auto; min-width:72px; }
.perf-conc-good { color:var(--status-success); }
.perf-conc-warn { color:var(--status-warning); }
.perf-conc-bad { color:var(--status-error); }
/* 扫描引擎对照（ADR-262 D3）：实测行与未采集行必须视觉可分——0ms 假象的源头就是两者长得一样 */
.perf-sb-table td { vertical-align:top; }
.perf-sb-engine { font-weight:600; }
.perf-sb-ms { font-variant-numeric:tabular-nums; }
.perf-sb-ok { color:var(--status-success); }
.perf-sb-skip { color:var(--status-warning); }
.perf-sb-reason { color:var(--muted); font-size:var(--fs-micro); }
.perf-sb-skipped { color:var(--muted); font-size:var(--fs-micro); margin-top:2px; }
.perf-sb-parity { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:4px 2px; font-size:var(--fs-sm); }
.perf-sb-parity-label { font-weight:600; }
.perf-sb-parity-ok { color:var(--status-success); font-weight:600; }
.perf-sb-parity-warn { color:var(--status-warning); font-weight:600; }
.perf-sb-parity-bad { color:var(--status-error); font-weight:600; }
.perf-sb-diff { font-size:var(--fs-xs); color:var(--muted); word-break:break-all; padding-left:10px; }
.perf-hist-card { border:1px solid var(--bd); border-radius:var(--radius-card); background:var(--surf); padding:var(--sp-vh-btn); margin:4px 0; animation: conflictRowIn .3s ease both; } /* 审计 P1-2：卡片圆角收口 --radius-card */
.perf-hist-head { display:block; font-size:var(--fs-sm); color:var(--txt); margin-bottom:2px; }
.perf-hist-head code { background:var(--bg); padding:0 var(--sp-1); border-radius:var(--radius-xs); font-size:var(--fs-xs); }
.perf-hist-body { display:block; font-size:var(--fs-xs); color:var(--muted); white-space:pre-wrap; }

/* ===== 加载剖析面板 ===== */
.perf-trace-meta { font-size:var(--fs-xs);color:var(--muted);word-break:break-all; }
.perf-gantt-wrap { padding:var(--sp-vh-perf); }
.perf-asset-grid { display:flex;flex-wrap:wrap;gap:4px 12px;padding:var(--sp-vh-perf);font-size:var(--fs-xs); }
.perf-asset-item { color:var(--txt);white-space:nowrap; }
.perf-badge-ok { color:var(--status-success);font-weight:600; }
.perf-badge-warn { color:var(--status-warning); }
.perf-tex-section { font-size:var(--fs-xs);color:var(--muted);padding:4px 2px;line-height:1.6; }
.perf-tex-row { display:flex;align-items:center;gap:6px;padding:var(--pad-v-1); }
.perf-tex-name { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt); }
.perf-tex-size { color:var(--muted);font-size:var(--fs-xs);flex-shrink:0; }
.perf-ktx2-badge { font-size:var(--fs-micro);padding:0 3px;border-radius:var(--radius-xs);background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent);flex-shrink:0; }
.perf-tex-more { color:var(--muted);font-size:var(--fs-xs);padding:var(--pad-v-2); }
.perf-no-data { color:var(--muted);font-size:var(--fs-sm);padding:12px 2px;text-align:center; }
.perf-no-hint { color:var(--muted);font-size:var(--fs-xs);padding:2px 2px 8px;text-align:center;opacity:.7; }
.perf-trace-hint { color:var(--muted);font-size:var(--fs-xs);padding:4px 2px 8px;text-align:center;opacity:.6;border-top:1px solid var(--bd);margin-top:6px; }

/* ===== 诊断页去重 UI (diag-dedup) ===== */
.diag-msg { padding:var(--sp-3);font-size:var(--fs-sm); }
.diag-msg-error { color:var(--status-error); }
.diag-msg-success { color:var(--status-success); }
.diag-msg-muted { color:var(--muted); }
.diag-dedup-summary { padding:var(--sp-vh-pane);font-size:var(--fs-sm);color:var(--txt);border-bottom:1px solid var(--bd); }
.diag-dedup-summary-hint { display:block;font-size:var(--fs-micro);color:var(--muted);margin-top:2px; }
.diag-dedup-rt { display:flex;align-items:center;gap:4px;padding:6px 12px 2px;font-size:var(--fs-xs);font-weight:600;color:var(--txt); }
.diag-dedup-rt-sep { flex:1;border-bottom:1px solid var(--bd);margin-left:6px; }
.diag-dedup-rt-count { font-size:var(--fs-micro);color:var(--muted);font-weight:400; }
.diag-dedup-group { margin:4px 12px;border:1px solid var(--bd);border-radius:var(--radius-card);overflow:hidden; } /* 审计 P1-2：卡片圆角收口 --radius-card */
.diag-dedup-group-head { display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:var(--fs-xs);font-weight:600;color:var(--txt);background:var(--surf);border-bottom:1px solid var(--bd); }
.diag-dedup-group-fill { flex:1; }
.diag-dedup-group-info { font-size:var(--fs-micro);color:var(--muted);font-weight:400; }
.diag-dedup-file { display:flex;align-items:center;gap:4px;padding:var(--sp-vh-cell);font-size:var(--fs-xs);cursor:pointer;transition:background var(--tr-fast); }
.diag-dedup-file-default { background:var(--hover); }
.diag-dedup-file-name { flex:1;overflow:hidden;min-width:0; }
.diag-dedup-file-name-text { color:var(--txt);font-size:var(--fs-xs);cursor:pointer; }
.diag-dedup-file-ic { margin-right:3px; }
.diag-dedup-file-dir { display:block;font-size:var(--fs-micro);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.diag-dedup-file-size { font-size:var(--fs-micro);color:var(--muted);flex-shrink:0;margin-right:4px; }
.diag-dedup-file-date { font-size:var(--fs-micro);color:var(--muted);flex-shrink:0; }
.diag-dedup-recommend { font-size:var(--fs-micro);padding:0 var(--sp-1);border-radius:var(--radius-xs);background:color-mix(in srgb, var(--status-success) 12%, transparent);color:var(--status-success); }
.diag-dedup-radio { flex-shrink:0;accent-color:var(--accent); }
.diag-dedup-keep-all { display:flex;align-items:center;gap:4px;padding:var(--sp-vh-cell);font-size:var(--fs-xs);cursor:pointer;transition:background var(--tr-fast);border-top:1px solid var(--bd); }
.diag-dedup-keep-all-label { color:var(--muted); }
.diag-dedup-actions { display:flex;gap:6px;padding:var(--sp-vh-pane);border-top:1px solid var(--bd); }
.diag-dedup-exec { flex:1;padding:7px 16px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--bg);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.diag-dedup-cancel { padding:7px 16px;border-radius:var(--radius-md);border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }

/* ===== 诊断页配置面板（conflicts.ts / dedup.ts / health.ts 渲染） =====
   这些类此前在 shadow 内无 CSS 规则，裸奔靠 UA 默认样式（WebView2 暗色不协调）；
   机检 css-layer-check 的 WARN 暴露后补显式样式（评审 2026-08-24 第 1 条盲区收口）。 */
.diag-config-item { display:flex; align-items:center; gap:8px; padding:var(--sp-vh-hdr); font-size:var(--fs-sm); color:var(--txt); }
.diag-config-select, .diag-config-input { padding:var(--btn-padding-sm); border-radius:var(--radius-md); border:1px solid var(--bd); background:var(--bg); color:var(--txt); font-size:var(--fs-sm); font-family:inherit; min-width:160px; }
.diag-config-select:focus, .diag-config-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
/* .diag-sync-config 规则已随 ADR-288 删除：同步冲突的参数面板不再是「点按钮后渲染的卡片」，
   而是常驻 .diag-bar（选择器 + 按钮直接排在栏内）——旧卡片类失去生产者，规则一并退场。 */
.diag-sync-resolve { margin-top:16px; padding:var(--sp-3); background:var(--surf); border-radius:var(--radius-lg); }
.diag-dedup-config { padding:var(--sp-vh-pane); }
.diag-warn { color:var(--status-warning); font-weight:600; } /* 审计 P2-6：删 --status-warning 冗余回退（6 主题已定义） */

/* P1 批次12:工坊行名称容器(community/render.ts nameWrap,gh-row 列1 内部 flex 容器) → 已归位 content-gh.ts */
`;
