// ===== sidebar Shadow CSS =====
import { btnBaseCSS } from "../../css/shared-styles.js";
export const sidebarCSS = `
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
.vc {
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
}
.vc-header {
  padding: 5px 10px; cursor: pointer; transition: background var(--tr-fast);
}
.vc-header:hover { background: var(--hover); }
.vc-header.active { background: color-mix(in srgb, var(--accent) 20%, transparent); border-left: 3px solid var(--accent); padding-left: 7px; box-shadow: inset 0 0 8px color-mix(in srgb, var(--accent) 8%, transparent); }
/* 涟漪选中效果 */
.vc-header { position: relative; overflow: hidden; }
.vc-header::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%), var(--accent) 0%, transparent 70%); opacity: 0; transition: opacity .4s; pointer-events: none; }
.vc-header.ripple::after { opacity: 0.12; }
/* 交错瀑布流入场动画 */
.vc { animation: fadeSlideLeft .35s cubic-bezier(.34,1.56,.64,1) both; }
.vc-hdr-row1 { display: flex; align-items: center; }
.vc-hdr-row2 { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.vc-header .name { flex: 1; font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: var(--fs-xs); padding: 1px 4px; border-radius: 3px; min-width:16px;text-align:center; }
.vc-header .tag.green { background: color-mix(in srgb, var(--status-success) 13%, transparent); color: var(--status-success); }
.vc-header .tag.red { background: color-mix(in srgb, var(--status-error) 13%, transparent); color: var(--status-error); }
.vc-header .tag.orange { background: color-mix(in srgb, var(--sm-optional) 13%, transparent); color: var(--sm-optional); }
.vc-hdr-row1 .chk { flex-shrink:0; margin:0; cursor:pointer; }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--fs-base) - 2px); color: var(--muted); margin-bottom: 6px; }
/* ===== 统一按钮系统 .btn-base ===== */
${btnBaseCSS}

.footer-btn {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: calc(var(--fs-base) - 2px); font-family: var(--font-ui);
  text-align: center; transition: background var(--tr-fast);
}
.footer-btn:hover { background: var(--hover); }
/* 骨架屏 */
.sk-item { padding: 10px; margin-bottom: 6px; border-radius: 8px; border: 1px solid var(--bd); background: var(--surf); }
.sk-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bd) 25%, var(--hover) 50%, var(--bd) 75%); background-size: 200% 100%; animation: sk-shimmer 1.5s infinite; margin-bottom: 6px; }
.sk-w80 { width: 80%; }
.sk-w40 { width: 40%; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;
