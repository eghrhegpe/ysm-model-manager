// ===== 3D 预览悬浮控制层组件（ADR-057）=====
// 用途：替代 skeleton.ts 内联 style.cssText 控制栏，集中治理样式 + 双端响应式。
// 挂载点：3D overlay 挂 document.body（light DOM），全局 CSS 经 ensureFabStyles 注入 head 一次。
// 触发 FAB 在预览面板 Shadow DOM 内（.preview-fab 见 css.ts，因 Shadow DOM 隔离需本地样式）。
import { attachTooltip } from "./tooltip.ts";
import { overlayStyleRoot, onOverlayStyleTargetReset } from "../../preview-3d/overlay-style-bridge.ts";

export const YSW_FAB_CSS = `
/* ===== 3D 全屏 overlay 根容器（#ysm-overlay-3d，light DOM） ===== */
.ysm-ovl-root{position:fixed;inset:0;z-index:var(--z-fullscreen);background:#11111b;display:flex;flex-direction:column}

/* ===== 3D overlay 控制层（顶栏按钮/下拉/标签，light DOM） ===== */
.ysm-ovl-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,.3);flex-shrink:0;pointer-events:auto;position:relative;z-index:10}
.ysm-ovl-spacer{flex:1}
.ysm-ovl-btn{font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .12s ease}
.ysm-ovl-btn:hover{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.ysm-ovl-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#7c83ff) 35%,transparent)}
.ysm-ovl-select{font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);cursor:pointer;font-family:inherit}
.ysm-ovl-select:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#7c83ff) 35%,transparent)}
.ysm-ovl-label{font-size:11px;color:rgba(255,255,255,.5)}
.ysm-ovl-val{font-size:11px;color:rgba(255,255,255,.6);min-width:20px}
.ysm-ovl-slider{width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)}
.ysm-ovl-shotwrap{position:relative;display:inline-block;margin-right:8px}
.ysm-ovl-shotmenu{display:none;position:absolute;top:100%;left:0;z-index:100;background:#2a2b3e;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 0;min-width:120px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.ysm-ovl-shotitem{padding:4px 12px;font-size:11px;color:rgba(255,255,255,.85);cursor:pointer;white-space:nowrap;transition:background .12s ease}
.ysm-ovl-shotitem:hover{background:color-mix(in srgb,var(--accent) 30%,transparent)}

/* ===== 3D 信息面板（原内联布局，移入 CSS 以便响应式覆盖宽度） ===== */
.preview-panel{position:absolute;top:0;right:0;bottom:0;width:260px;background:rgba(0,0,0,.4);border-left:1px solid rgba(255,255,255,.1);overflow-y:auto;padding:10px 12px;font-size:11px;color:rgba(255,255,255,.75);z-index:5}

/* ===== 底部导航 + 分类弹窗（紧凑工具型外观）=====
   3D 全屏无常驻侧栏，功能经底部导航按域分组。 */
.preview-dock-nav{position:absolute;left:12px;bottom:12px;display:flex;gap:2px;padding:4px;border-radius:5px;background:#1b1c24;border:1px solid rgba(255,255,255,.12);box-shadow:0 3px 10px rgba(0,0,0,.28);z-index:20}
.preview-dock-navbtn{display:flex;align-items:center;min-width:0;padding:6px 10px;border-radius:3px;border:1px solid transparent;background:transparent;color:rgba(255,255,255,.72);cursor:pointer;font-family:inherit;font-size:11px;line-height:1.2;transition:background .12s ease}
.preview-dock-navbtn .preview-ic{display:none}
.preview-dock-navbtn:hover{background:rgba(255,255,255,.08);color:#fff}
.preview-dock-navbtn--on{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.12)}
.preview-dock-navlabel{white-space:nowrap}
.ysm-3d-popup{position:absolute;left:50%;bottom:68px;transform:translateX(-50%);width:280px;max-height:min(60vh,420px);overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:6px;background:#1b1c24;border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:25;color:rgba(255,255,255,.85);font-size:11px;box-sizing:border-box}
.ysm-3d-popsec{font-weight:600;font-size:11px;color:rgba(255,255,255,.9);margin:8px 0 4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}
.ysm-3d-popsec:first-child{border-top:none;padding-top:0;margin-top:0}
.ysm-3d-poprow{display:flex;align-items:center;gap:8px}
.ysm-3d-poplabel{font-size:11px;color:rgba(255,255,255,.55);white-space:nowrap}
.ysm-3d-popselect{flex:1;font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:rgba(255,255,255,.85);cursor:pointer;font-family:inherit}
.ysm-3d-popslider{flex:1;accent-color:var(--accent,#7c83ff);cursor:pointer}
.ysm-3d-popval{font-size:11px;color:rgba(255,255,255,.7);min-width:24px;text-align:right}
.ysm-3d-popbtn{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);cursor:pointer;font-family:inherit;text-align:left;transition:background .12s ease}
.ysm-3d-popbtn:hover{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.ysm-3d-popbtn--row{width:100%;margin:1px 0}

/* ===== 图标语义类（light DOM + Shadow DOM 均生效；shadow DOM 内由父级 .preview-fab .preview-ic 兜底）===== */
.preview-ic{display:inline-flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0}
.preview-ic--cam::before{content:"📷"}
.preview-ic--rot::before{content:"⟲"}
.preview-ic--close::before{content:"✕"}
.preview-ic--panel-hide::before{content:"◀"}
.preview-ic--panel-show::before{content:"▶"}

/* ===== 双端响应式：复用 MikuMikuAR 断点（ADR-057 §2.4） ===== */
@media (max-width:480px){
  .ysm-ovl-bar{padding:4px 8px;gap:4px;flex-wrap:wrap}
  .preview-panel{width:min(78vw,260px)}
  .ysm-3d-popup{width:min(86vw,280px)}
}
@media (orientation:landscape) and (max-height:500px){
  .ysm-ovl-bar{padding:3px 8px;gap:6px}
}
/* 触控热区扩到 44px（Apple HIG），透明叠加不改视觉高度 */
@media (pointer:coarse){
  .ysm-ovl-btn,.ysm-ovl-select,.ysm-ovl-shotitem{min-height:44px}
  .preview-dock-navbtn,.ysm-3d-popbtn{min-height:44px}
}
`;

let _fabInjected = false;
onOverlayStyleTargetReset(() => { _fabInjected = false; }); // ADR-175 M1:目标切换重注入
/** 幂等注入 overlay 全局样式（ADR-175 M1：目标经桥——overlay shadow root，无 overlay 时 head 兜底） */
export function ensureFabStyles(): void {
  if (_fabInjected) return;
  if (typeof document === "undefined") return;
  // head 兜底路径保留 id 去重；shadow root 目标每次 overlay 重建都需重注入，不做 document 级去重
  if (overlayStyleRoot() === document.head) {
    const ex = document.getElementById("ysw-fab-styles");
    if (ex) {
      _fabInjected = true;
      return;
    }
  }
  const style = document.createElement("style");
  style.id = "ysw-fab-styles";
  style.textContent = YSW_FAB_CSS;
  overlayStyleRoot().appendChild(style);
  _fabInjected = true;
}

export interface IconButtonOpts {
  icon?: string;
  label?: string;
  title?: string;
  className?: string;
  onClick?: () => void;
}
/** 图标按钮工厂（ADR-057 §2.6）：统一 emoji/图标按钮，集中可达性；用 textContent 防 XSS。
 * icon 支持两种形态：
 *   - Unicode 文本字面量（如 "✕" "\u{1F4F7}"）→ 直接写入 .preview-ic span
 *   - CSS 类名字符串（如 "cam" "rot" "close"）→ 注入 .preview-ic--{name} class 到 .preview-ic span
 * title 走自定义 tooltip（tooltip.ts 单例，~350ms 即显），不设原生 title 防双气泡；
 * 可达性由 aria-label 承担。
 */
export function createIconButton(opts: IconButtonOpts): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = opts.className || "ysm-ovl-btn";
  if (opts.title) {
    btn.setAttribute("aria-label", opts.title);
    attachTooltip(btn, opts.title);
  }
  if (opts.icon) {
    const ic = document.createElement("span");
    ic.className = "preview-ic";
    if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(opts.icon)) {
      // CSS class name form: match preview-ic-{name} rule in YSW_FAB_CSS
      ic.classList.add("preview-ic", `preview-ic--${opts.icon}`);
    } else {
      // Unicode emoji form
      ic.textContent = opts.icon;
    }
    btn.appendChild(ic);
  }
  if (opts.label) {
    const lb = document.createElement("span");
    lb.textContent = opts.label;
    btn.appendChild(lb);
  }
  if (opts.onClick) btn.onclick = opts.onClick;
  return btn;
}
