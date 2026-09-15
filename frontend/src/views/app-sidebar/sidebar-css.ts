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
  border-radius:var(--radius-md); margin-bottom: 4px; overflow: hidden;
}
/* 拖拽导入悬停态：虚线框提示「拖到此卡片可直接推送到该整合包」 */
.instance-card.dnd-over { border: 1px dashed var(--accent, #89b4fa); box-shadow: 0 0 0 1px var(--accent, #89b4fa) inset; }
.instance-card-header {
  padding: 5px 10px; cursor: pointer; transition: background var(--tr-fast);
}
.instance-card-header:hover { background: var(--hover); }
/* 高亮对齐导航栏选中态口径：--hover 淡底（与文件树悬停同口径，亮色主题不加深）+ 指示边框，文字保持 --txt */
.instance-card-header.active { background: var(--hover); border-left: 3px solid var(--accent); padding-left: 7px; }
.instance-card-header.active .name { color: var(--txt); }
/* 涟漪选中效果：与选中底同口径（--hover），避免 accent 强调色 */
.instance-card-header { position: relative; overflow: hidden; }
.instance-card-header::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%), var(--hover) 0%, transparent 70%); opacity: 0; transition: opacity .4s; pointer-events: none; }
.instance-card-header.ripple::after { opacity: 0.12; }
/* 交错瀑布流入场动画 */
.instance-card { animation: fadeSlideLeft .35s cubic-bezier(.34,1.56,.64,1) both; }
.card-name-row { display: flex; align-items: center; }
.card-status-row { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.instance-card-header .name { flex: 1; font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: var(--fs-xs); padding: 1px 4px; border-radius:var(--radius-xs); min-width:16px;text-align:center; }
.instance-card-header .tag.green { background: color-mix(in srgb, var(--status-success) 13%, transparent); color: var(--status-success); }
.instance-card-header .tag.red { background: color-mix(in srgb, var(--status-error) 13%, transparent); color: var(--status-error); }
.instance-card-header .tag.orange { background: color-mix(in srgb, var(--sm-optional) 13%, transparent); color: var(--sm-optional); }
.card-name-row .chk { flex-shrink:0; margin:0; cursor:pointer; }
/* 资源包计数锚点：📦 收口为可定位/可样式化的语义节点（aria-hidden 不参与朗读，数值由内部 chip 承载） */
.pkg-icon { flex-shrink: 0; line-height: 1; }
.instance-card-pkg-count { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--fs-base) - 2px); color: var(--muted); margin-bottom: 6px; }
/* ===== 统一按钮系统 .btn-base ===== */
${btnBaseCSS}

.footer-btn {
  width: 100%; padding: 5px 8px; border-radius:var(--radius-md);
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: calc(var(--fs-base) - 2px); font-family: var(--font-ui);
  text-align: center; transition: background var(--tr-fast);
}
.footer-btn:hover { background: var(--hover); }
/* 骨架屏 */
.sk-item { padding: 10px; margin-bottom: 6px; border-radius:var(--radius-lg); border: 1px solid var(--bd); background: var(--surf); }
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
   sidebar 用 click 展开（JS 改 style.display），故只引基础串、不引 dropdownHoverCSS */
${dropdownBaseCSS}
/* sidebar 下拉局部差异（宽度/换行/字号/项间距），覆盖共享默认值——勿回内联 */
.dd-wrap .dd-menu { min-width:160px; white-space:nowrap; font-size:var(--fs-xs); }
.dd-wrap .dd-item { padding:4px 8px; }
`;
