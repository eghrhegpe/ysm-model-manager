// ===== app-toast Shadow CSS =====
// ADR-238：UI_ICONS 的 SVG 依赖 .ws-icon 尺寸/着色规则，而 CSS 不穿透 shadow 边界
// ⇒ 必须就地带上 wsIconCSS（同范式 context-menu/menu-css.ts、app-preview/css.ts）。
// .no-animations 通配桥（ADR-015 §2.4 约束 1；规则本体 = @/utils/dom/css.ts）：
// 覆盖 .toast（toastIn）/ slideOut 等动效；此前文档层白名单的 .toast 选择器住在
// shadow 内，恒不匹配，开关在本域静默失效。
import { noAnimationsCSS, wsIconCSS } from "@/utils/dom/css.ts";

export const toastCSS: string = `
:host {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: var(--z-toast); display: flex; flex-direction: column; pointer-events: none;
}
/* toast 的真实父节点是 #c（.toast-container），不是 :host——原先把 gap 写在
   :host 上，toast 只是它的孙节点，这条 8px 间距从未生效（2026-09 闸发现）。 */
.toast-container { display: flex; flex-direction: column; gap: 8px; }
.toast {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-radius:var(--radius-lg); background: var(--card); color: var(--txt); font-size: var(--fs-base);
  box-shadow: 0 6px 20px rgba(0,0,0,.4); animation: toastIn .3s cubic-bezier(.34,1.56,.64,1);
  border: 1px solid var(--bd); pointer-events: auto;
  font-family: var(--font-ui);
}
.toast.error { border-left: 3px solid var(--status-error); }
.toast.success { border-left: 3px solid var(--status-success); }
.toast.warn { border-left: 3px solid var(--status-error); }
.toast.info { border-left: 3px solid var(--accent); }
.toast .msg { flex: 1; white-space: pre-line; }
/* ADR-267：type 驱动语义图标（.toast-icon 承载）——图标不含色，状态色由 type 左边框承担 */
.toast .toast-icon { display: inline-flex; align-items: center; flex: 0 0 auto; }
/* 常态=容器色（隐形）→ 悬停 --hover 浮现，与设置页 .stg-path-* / 导航选中态同口径
   （原常态 --hover → 悬停 --act，起手高一档故需第二级色；2026-09 反向取值对齐全站） */
.toast .undo-btn { padding:var(--btn-padding-std); border-radius: var(--radius-sm); border: none; background: transparent; color: var(--accent); cursor: pointer; font-size: var(--fs-sm); font-family: inherit; transition: background var(--tr-fast); }
.toast .undo-btn:hover { background: var(--hover); }
.toast .close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: var(--fs-md); padding: 0 2px; }
.toast .close-btn:hover { color: var(--txt); }
@keyframes toastIn { 0% { transform: translateY(20px) scale(.95); opacity: 0; } 60% { transform: translateY(-4px) scale(1.02); opacity: 1; } 100% { transform: translateY(0) scale(1); } }
@keyframes slideOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(20px); opacity: 0; } }
${wsIconCSS}
${noAnimationsCSS}
`;
