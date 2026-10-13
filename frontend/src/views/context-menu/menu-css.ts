// ===== context-menu Shadow CSS =====
// ADR-238：resolveIcon 喂入 .ws-icon SVG，须就地 adopt——CSS 不穿透 shadow 边界，
// 漏带则图标退回 24×24 viewBox 默认尺寸（实测坑，同范式 app-nav/tpl.ts、
// app-content/css/content-layout.ts）。.no-animations 通配桥（ADR-015 §2.4 约束 1；
// 规则本体 = @/utils/dom/css.ts）：覆盖 .menu（menuPop）与菜单项内联 style 的
// itemSlideIn（!important 作者声明压过普通内联声明）。
import { noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";

export const menuCSS: string = `
:host {
  position: fixed;
  z-index: var(--z-popover);
  display: none;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
}
.menu {
  background: var(--card);
  border: 1px solid var(--bd);
  border-radius:var(--radius-lg);
  padding:var(--sp-1);
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  animation: menuPop .2s cubic-bezier(.34,1.56,.64,1);
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding:var(--sp-vh-btn);
  border-radius: var(--radius-sm);
  font-size: var(--fs-btn-secondary);
  color: var(--txt);
  cursor: pointer;
  transition: background var(--tr-fast);
}
.item:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
.item.danger:hover { background: var(--status-error); color: var(--bg); }
.item .icon { font-size: var(--fs-base); width: 16px; text-align: center; }
/* 标题行（header:true）：纯展示，不是可激活项。复用 .item 的排版（flex/gap/
   padding）但抹掉一切「可点」信号——否则鼠标悬停会高亮、光标变手型，
   用户点下去却什么也不发生（2026-09 锐评实测：instance/batch 首行、
   workshop 四行信息全是这种假可点行）。选择器与 .item:hover 同特异度，
   靠源序在后覆盖，勿上移。 */
.item-header { cursor: default; color: var(--muted); font-size: var(--fs-xs); }
.item-header:hover { background: none; color: var(--muted); }
.divider {
  border: none;
  border-top: 1px solid var(--bd);
  margin: 3px 8px;
}
@keyframes menuPop { 0% { opacity: 0; transform: scale(.85) translateY(-6px); } 60% { opacity: 1; transform: scale(1.02) translateY(0); } 100% { transform: scale(1); } }
@keyframes itemSlideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
${wsIconCSS}
${noAnimationsCSS}
`;
