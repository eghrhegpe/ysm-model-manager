import { tabBtnCSS } from "@/utils/dom/css.ts";

// ===== 设置页 + 通用 tab-body（从 frontend/css/components.css 迁入 shadow）=====
// 根因：components.css 仅经 index.html 全局 <link> 加载，<app-content> 用 Shadow DOM
// （adoptedStyleSheets=[contentCSS]），全局 link 被 shadow 边界阻断，导致 .stg-* / .tab-body
// 在 shadow 内零样式（设置页卡片/网格/标题/路径值裸奔，tab 无 flex 布局）。
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
/* 2026-10 锐评第九轮：本段曾并存 11 条零消费者规则（.stg-group / .stg-val / .stg-hint /
   .stg-hint-hidden / .stg-hint-warn / .stg-radio-row / .stg-sub-title / .stg-ml-auto /
   .stg-grid-2 / .stg-card-hint / .stg-card-acts）——逐个 grep 全仓（模板 + JS 引用）实证
   无消费者后删除；其中 .stg-grid-2 还被 content-css.test.ts 反向上了测试保险（已同批撤除）。
   保留者均有实证消费者：.stg-desc（正文段落）/ .stg-hint-block（控件附属说明）/.stg-btn（关于页）。 */
.stg-btn {
  font-size:var(--fs-xs);
}
/* .stg-desc：设置页「正文段落」原语（用于节级导语 / 卡片正文）。
   立类因：内联 'font-size:var(--fs-sm);color:var(--muted);line-height:1.7' 配方曾在 4 处复制
   （解析 tab 导语 + 关于页三张卡）——无单一来源，且裸 div 拿不到入场动画。
   只管排版，不带 margin/动画：作为顶层条目时应包进 .settings-group（供 12px 下间距 + 入场动画），
   在卡片内则直接用作正文（不重复动画——卡已入场）。 */
.stg-desc {
  font-size: var(--fs-sm);
  color: var(--muted);
  line-height: 1.7;
}
/* .stg-hint-block：select 下方「按当前值切换显隐」的说明块（init.ts|applyHintVisibility 切
   display，本类只管排版、不带显隐）。立类因：lm-hint-* / mirror-hint-* 的
   'font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2)' 曾 6 处内联复制且两族
   漂移（line-height 一有一无）。与 .stg-desc 分立：desc 是节级正文（无 padding、1.7 行高），
   hint-block 是控件附属说明（padding 与控件顶齐、1.5 行高）。 */
.stg-hint-block {
  font-size: var(--fs-sm);
  color: var(--muted);
  padding: var(--pad-v-2);
  line-height: 1.5;
}
.stg-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size:var(--fs-sm);
  cursor: pointer;
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
  max-width: 100%;
}
.stg-select:hover { background: var(--hover); }
.stg-select:focus { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
/* .stg-select-block：卡片体内「块级下拉」配方（占满卡片宽 + 与下方说明留一档间距）。
   立类因（2026-10 锐评第七轮）：width:100% + margin-bottom:6px 曾在 5 处内联复制
   （镜像源/链接模式/字号/字体/密度），且字号卡那一处漂成 4px——同 .stg-hint-block 收 6 处
   内联配方债同款病，只是当时只收了 hint 一族。行内下拉（语言/自动主题/启动默认页/旋转模式）
   不再写 width:auto：.stg-select 本就无宽度声明，select 默认 intrinsic，该内联是零效果噪音。 */
.stg-select-block { width: 100%; margin-bottom: 6px; }

/* ===== 设置页卡片/路径样式（settings 独占） ===== */
/* 设置页「组」间距契约（两种组，各取其一的间距来源，勿叠加）：
     A. 带标题的组 → 标题行用 .section-title（自带 padding:16px 16px 16px）撑开上方空白；
     B. 无标题的组 → 容器自身挂 .stg-section（margin-top:16px）。
   卡片自带 card-hdr 的组（如「行为与动画」或「启动默认页」）走 B。
   历史坑：界面上 tab 的两卡组曾直接吐裸 .stg-grid，与上方行组零间距——
   因为空白一直由 .section-title 的 padding 隐式提供，一旦不挂标题就没间隔了。 */
.stg-section { margin-top: 16px; }
.stg-details { margin-top:16px; border:1px solid var(--bd); border-radius:var(--radius-card); background:var(--surf); overflow:hidden; }
.stg-details-summary { display:flex; align-items:center; gap:var(--sp-icon-text); padding:var(--sp-vh-pane); cursor:pointer; list-style:none; color:var(--txt); font-size:var(--fs-sm); font-weight:600; user-select:none; }
.stg-details-summary::-webkit-details-marker { display:none; }
.stg-details-summary::after { content:"+"; margin-left:auto; color:var(--muted); font-size:var(--fs-lg); line-height:1; }
.stg-details[open] > .stg-details-summary::after { content:"−"; }
.stg-details-summary:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.stg-details-body { padding:0 var(--sp-vh-pane) var(--sp-vh-pane); }
.stg-details-body > .settings-group:first-child,
.stg-details-body > .section-title:first-child { margin-top:0; padding-top:0; }
.stg-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap:10px; }
.stg-grid > * { min-width:0; }
.stg-keymap-grid { width:100%; grid-template-columns:repeat(auto-fit, minmax(min(220px, 100%), 1fr)); }
.stg-keybind-button { min-width:64px; width:auto; flex:0 0 auto; border:1px solid var(--bd); background:var(--bg); }
.stg-keybind-button:hover { border-color:var(--accent); background:var(--hover); }
.stg-keybind-button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.stg-card { background:var(--surf); border:1px solid var(--bd); border-radius:var(--radius-card); overflow:hidden; animation:fadeSlideUp var(--tr-enter) both; min-width:0; } /* 审计 P1-2：卡片圆角收口 --radius-card */
.stg-card-hdr { display:flex;align-items:center;gap:6px; flex-wrap:wrap; padding:var(--sp-vh-pane); font-size:var(--fs-sm); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); background:var(--surf); min-width:0; }
.stg-card-body { padding:var(--sp-vh-pane); min-width:0; }
.stg-path-val { appearance:none; display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-family:inherit; font-size:var(--fs-sm); color:var(--txt); background:var(--bg); text-align:left; transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-val:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.stg-path-val.derived:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-val.derived::before { content:"📁 "; }
.stg-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:6px; line-height:1.4; }
.stg-adv-reset { margin-left:auto; }
.stg-card-overridden { border-color:var(--accent); }
.stg-custom-badge { font-size:var(--fs-micro);color:var(--accent); }
.stg-path-picker { appearance:none; display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:var(--radius-md); cursor:pointer; font-family:inherit; font-size:var(--fs-xs); color:var(--txt); background:var(--bg); text-align:left; transition:border-color var(--tr-fast), background var(--tr-fast); width:100%; box-sizing:border-box; min-height:0; }
.stg-path-picker:hover { border-color:var(--accent); background:var(--hover); }
.stg-path-picker:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
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
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:var(--sp-vh-pane); background:var(--surf); border-radius:var(--radius-md); margin-bottom:4px; font-size:var(--fs-md); animation:fadeSlideUp var(--tr-enter) both; min-width:0; }
/* 键位项独立于通用设置行：避免标签和按钮共享厚重卡片背景。 */
.stg-keybind-row { margin-bottom:0; background:transparent; border:1px solid var(--bd); border-radius:var(--radius-md); }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--txt); } /* 值 = 正文（与 .td-camspeed-val 同口径）；.meta 仍 muted */

/* ===== 设置页 tab 按钮（外观基类见 utils/dom/css.ts 的 tabBtnCSS，ADR-307 D1 去重） ===== */
/* 仅挂动画：shadow 内只能引用本地 keyframe（keyframes 不穿 shadow），故 stgTabIn 留本文件；
   布局/外观/hover/active 由 .tab-btn 基类统一承载，仓库页 .repo-tab 同享，改外观只动一处。 */
${tabBtnCSS}
.stg-tab { animation:stgTabIn var(--tr-enter) both; }
@keyframes stgTabIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

`;
