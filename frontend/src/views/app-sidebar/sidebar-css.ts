// ===== sidebar Shadow CSS =====
import { btnBaseCSS, dropdownBaseCSS, noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";
import { FADE_SLIDE_LEFT } from "@/views/css/keyframes.ts";
export const sidebarCSS: string = `
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
.instance-card {
  background: var(--bg); border: 1px solid var(--bd);
  border-radius:var(--radius-md); margin-bottom: var(--card-gap, 4px); overflow: hidden;
}
/* 拖拽导入悬停态：虚线框提示「拖到此卡片可直接推送到该整合包」 */
.instance-card.dnd-over { border: 1px dashed var(--accent, #89b4fa); box-shadow: 0 0 0 1px var(--accent, #89b4fa) inset; }
/* 卡片内边距/间距走密度变量（--card-padding 水平档 10px/14px、--card-gap 4px/10px，
   由 ui-prefs.ts 统一注入）；.active 的 padding-left 需补偿 3px 指示边框，
   故同样基于 --card-padding 的水平分量派生，避免密度切换后选中态文字错位 */
.instance-card-header {
  padding: var(--card-padding); cursor: pointer; transition: background var(--tr-fast);
} /* 审计 P1-3：删 --card-padding 手抄回退（真值 6px 10px，:29 的选中态 padding-left 补偿仍基于 --card-pad-x） */
.instance-card-header:hover { background: var(--hover); }
/* 高亮对齐导航栏选中态口径：--hover 淡底（与文件树悬停同口径，亮色主题不加深）+ 指示边框，文字保持 --txt */
.instance-card-header.active { background: var(--hover); border-left: 3px solid var(--accent); padding-left: max(0px, calc(var(--card-pad-x, 10px) - 3px)); }
.instance-card-header.active .name { color: var(--txt); }
/* 涟漪选中效果：与选中底同口径（--hover），避免 accent 强调色。
 * opacity 0.4s 为**有意**不经 --tr-* 令牌：水波扩散需缓慢浮现（0.4s 长于令牌最长档
 * --tr-enter 0.25s），套 0.15s 会退化成「闪一下」而失去涟漪感。 */
.instance-card-header { position: relative; overflow: hidden; }
.instance-card-header::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%), var(--hover) 0%, transparent 70%); opacity: 0; transition: opacity 0.4s; /* tr-exempt: 涟漪需缓慢浮现，0.15s 会退化成闪一下 */ pointer-events: none; }
.instance-card-header.ripple::after { opacity: 0.12; }
/* 交错瀑布流入场动画 */
.instance-card { animation: fadeSlideLeft .35s cubic-bezier(.34,1.56,.64,1) both; }
.card-name-row { display: flex; align-items: center; }
.card-status-row { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.instance-card-header .name { flex: 1; font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: var(--fs-xs); padding: var(--pad-v-1) var(--sp-1); border-radius:var(--radius-xs); min-width:16px;text-align:center; }
.instance-card-header .tag.green { background: color-mix(in srgb, var(--status-success) 13%, transparent); color: var(--status-success); }
.instance-card-header .tag.red { background: color-mix(in srgb, var(--status-error) 13%, transparent); color: var(--status-error); }
.instance-card-header .tag.orange { background: color-mix(in srgb, var(--sm-optional) 13%, transparent); color: var(--sm-optional); }
.card-name-row .chk { flex-shrink:0; margin:0; cursor:pointer; }
/* 资源包计数锚点：📦 收口为可定位/可样式化的语义节点（aria-hidden 不参与朗读，数值由内部 chip 承载） */
.pkg-icon { flex-shrink: 0; line-height: 1; }
.instance-card-pkg-count { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.footer { padding:var(--sp-vh-pane); border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--fs-base) - 2px); color: var(--muted); margin-bottom: 6px; }
/* ===== 统一按钮系统 .btn-base ===== */
${btnBaseCSS}

.footer-btn {
  width: 100%; padding: var(--btn-padding-md); border-radius:var(--radius-md);
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: calc(var(--fs-base) - 2px); font-family: var(--font-ui);
  text-align: center; transition: background var(--tr-fast);
}
.footer-btn:hover { background: var(--hover); }
/* 骨架屏 */
.sk-item { padding: var(--sp-3); margin-bottom: 6px; border-radius:var(--radius-lg); border: 1px solid var(--bd); background: var(--surf); }
.sk-line { height: 12px; border-radius:var(--radius-md); background: linear-gradient(90deg, var(--bd) 25%, var(--hover) 50%, var(--bd) 75%); background-size: 200% 100%; animation: sk-shimmer 1.5s infinite; margin-bottom: 6px; }
.sk-w80 { width: 80%; }
.sk-w40 { width: 40%; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
/* 本地化 fadeSlideLeft：.instance-card (L30) 引用，document 层 components.css 定义的同名 keyframes
   不穿透 Shadow DOM 边界，须在 sidebar shadow 内重定义。 */
/* 单一事实源 = @/views/css/keyframes.ts|FADE_SLIDE_LEFT（与 content-layout.ts 共享），
   与 components.css 全局副本的一致性见该文件头说明。 */
${FADE_SLIDE_LEFT}

/* SVG 图标尺寸/着色（ADR-238 单一出处，跨 shadow 共享） */
${wsIconCSS}

/* .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts）
   覆盖 .instance-card（fadeSlideLeft）/ .sk-line（sk-shimmer）/ .footer-btn 等全部动效，
   不再逐类登记。 */
${noAnimationsCSS}
/* 下拉容器（push/pull）共享基础样式：.dd-wrap/.dd-menu/.dd-item（见 utils/dom/css.ts）。
   原内联于 tpl.ts syncDropdownHTML，此处收敛为 shadow 级共享，删内联后外观由本块承载。
   sidebar 用 click 展开（JS 改 style.display；控制器统一化见 ADR-238/utils/dom/dropdown.ts） */
${dropdownBaseCSS}
/* sidebar 下拉局部差异（宽度/换行/字号/项间距），覆盖共享默认值——勿回内联 */
.dd-wrap .dd-menu { min-width:160px; white-space:nowrap; font-size:var(--fs-xs); }
.dd-wrap .dd-item { padding:var(--sp-vh-cell); }
`;
