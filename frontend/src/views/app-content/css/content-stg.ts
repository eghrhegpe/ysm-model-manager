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
/* 顶部不垫：上方 .repo-tabs 已有下边框分隔，再垫 16px 会与首个
   .section-title 自带的 padding-top:16px 叠加成 32px 悬空（同类“双间距”坑）。
   左右 20px 与上下不得混用——.settings-group 对齐后内容左边距 = 20+12 = 32px。 */
  padding: 0 20px 16px;
}
/* .stg-title：仅作「设置页节标题」标记，不再提供 margin-bottom——
   标题下间距单一来源 = .section-title 的 padding-bottom（现 16px）。
   历史 bug：本条曾写 margin-bottom:8px，与 .section-title 的 padding-bottom:8px 叠加成 16px
   （padding 与 margin 不折叠），两个旋钮管同一件事、改一个不生效——
   现统一由 .section-title 供 16px，视觉与旧叠加值一致但只剩一个旋钮。
   全仓 9 处用法均写作 class="section-title stg-title"，无单独使用，故删除安全。 */
.stg-title {
  /* 间距归 .section-title，勿在此加 margin */
}
.stg-group {
  margin-bottom: 12px;
}
.stg-val {
  font-size:var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.stg-btn {
  font-size:var(--fs-xs);
}
.stg-hint {
  font-size:var(--fs-micro);
  color: var(--muted);
  padding: 2px 0 0 0;
}
/* .stg-desc：设置页「正文段落」原语（比 .stg-hint 大一号、行高更松，用于节级导语 / 卡片正文）。
   立类因：内联 'font-size:var(--fs-sm);color:var(--muted);line-height:1.7' 配方曾在 4 处复制
   （解析 tab 导语 + 关于页三张卡）——无单一来源，且裸 div 拿不到入场动画。
   只管排版，不带 margin/动画：作为顶层条目时应包进 .settings-group（供 12px 下间距 + 入场动画），
   在卡片内则直接用作正文（不重复动画——卡已入场）。 */
.stg-desc {
  font-size: var(--fs-sm);
  color: var(--muted);
  line-height: 1.7;
}
/* ⚠️ 已废弃（勿用）：与 .section-title 叠加得 32px 双重上间距。
   .section-title 自带 padding-top:16px，再叠 margin-top:16px = 双份。
   设置页改用 .section-title 单供间距（A 式）；无标题组用 .stg-section（B 式）。
   历史：本类曾用于「字体与布局」「3D 预览」「鸣谢」三处，均有双间距 bug。 */
.stg-sub-title {
  margin-top: 0;
}
.stg-radio-row {
  display: flex;
  gap: 8px;
  padding: var(--sp-1) 0;
}
.stg-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size:var(--fs-sm);
  cursor: pointer;
}
.stg-hint-hidden {
  font-size:var(--fs-micro);
  color: var(--muted);
  padding: 2px 0 0 0;
  display: none;
}
.stg-hint-warn {
  font-size:var(--fs-micro);
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
/* 设置页「组」间距契约（两种组，各取其一的间距来源，勿叠加）：
     A. 带标题的组 → 标题行用 .section-title（自带 padding:16px 16px 16px）撑开上方空白；
     B. 无标题的组 → 容器自身挂 .stg-section（margin-top:16px）。
   卡片自带 card-hdr 的组（如「行为与动画」+「启动默认页」）走 B。
   历史坑：界面上 tab 的两卡组曾直接吐裸 .stg-grid，与上方行组零间距——
   因为空白一直由 .section-title 的 padding 隐式提供，一旦不挂标题就没间隔了。 */
.stg-section { margin-top: 16px; }
.stg-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
/* 2 列变体：两张卡并排（如「行为与动画」+「启动默认页」） */
.stg-grid-2 { grid-template-columns: repeat(2, 1fr); }
.stg-card { background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-card); overflow:hidden; animation:fadeSlideUp var(--tr-enter) both; } /* 审计 P1-2：卡片圆角收口 --radius-card */
.stg-card-hdr { display:flex;align-items:center;gap:6px; padding:var(--sp-vh-pane); font-size:var(--fs-sm); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); background:var(--surf); }
.stg-card-body { padding:var(--sp-vh-pane); }
.stg-path-val { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-size:var(--fs-sm); color:var(--txt); background:var(--bg); transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-val:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val.derived:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val.derived::before { content:"📁 "; }
.stg-card-hint { font-size:var(--fs-xs); color:var(--muted); margin-bottom:6px; }
.stg-card-acts { display:flex; gap:4px; }
.stg-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:6px; line-height:1.4; }
.stg-adv-reset { margin-left:auto; }
.stg-card-overridden { border-color:var(--accent); }
.stg-custom-badge { font-size:var(--fs-micro);color:var(--accent); }
.stg-path-picker { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-size:var(--fs-xs); color:var(--txt); background:var(--bg); transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-picker:hover { border-color:var(--accent); background:var(--hover); }
@keyframes advPanelIn { from { opacity:0; max-height:0; } to { opacity:1; max-height:600px; } }
@keyframes advPanelOut { from { opacity:1; max-height:600px; } to { opacity:0; max-height:0; } }
#set-advanced-panel { overflow:hidden; }
#set-advanced-panel.adv-open { animation: advPanelIn .25s ease forwards; }
#set-advanced-panel.adv-closing { animation: advPanelOut .2s ease forwards; }

/* ===== 通用 tab-body（跨设置/仓库/ins/gh/cr 各 tab 复用，归位 shadow） ===== */
.tab-body { flex:1;display:flex;flex-direction:column;overflow:hidden; }

/* ===== 设置页分组/行（从 content-diag.ts 收口；tpl-settings.ts 仍消费，属 settings 资产） =====
   .settings-group = 行组声式单元（对照 .stg-card 是卡片单元）：
   与卡片同口径——间距/动画由类宣告，内联只留每处不同的 animation-delay。
   历史：本类曾只有 padding:0 16px，垂直间距靠每处手写内联 margin-bottom:12px（7 份副本）。 */
/* 与卡片同宽对齐：不加左右 padding，由 .setting-row 自身 padding 提供内缩。
   历史：本类曾写 padding:0 16px，于是行组内容比同屏 .stg-card 多缩进 16px，
   而它明明已被当单行卡片用——左右边缘与卡片/标题参差不齐。 */
.settings-group { margin-bottom:12px; animation:fadeSlideUp var(--tr-enter) both; }
/* 行组后紧跟节标题（A 式）时，行组不再出 margin——
   否则 12px(margin) + 16px(padding) 不折叠 = 28px 双间距。
   margin 与 padding 不相叠，只能靠选择器消掉其中一份；此处保留标题的 padding-top。
   （与上面的左右 padding 无关：本条管垂直间距。） */
.settings-group:has(+ .section-title) { margin-bottom: 0; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:var(--sp-vh-pane); background:var(--surf); border-radius:var(--radius-md); margin-bottom:4px; font-size:var(--fs-md); animation:fadeSlideUp var(--tr-enter) both; }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--txt); } /* 值 = 正文（与 .td-camspeed-val 同口径）；.meta 仍 muted */

/* ===== 设置页 tab 按钮（从 content-repo.ts 拆出，设置页资产不归仓库域托管） ===== */
/* 本地化 keyframe：shadow 内引用全局 fadeSlideDown 不生效（keyframes 不穿 shadow），故本地定义 stgTabIn */
.stg-tab { padding:var(--pad-nav) 14px;border-radius:var(--radius-md) var(--radius-md) 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:var(--tr-normal);white-space:nowrap;min-height:var(--touch-min);animation:stgTabIn var(--tr-enter) both; }
.stg-tab:hover { color:var(--txt);background:var(--hover); }
.stg-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
@keyframes stgTabIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

`;
