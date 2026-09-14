// ===== Canvas 全屏放大预览 =====
// 从 events.ts 拆分：openFullPreview
import { t } from "@/core/i18n/t.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import { renderModel2D } from "@/views/app-preview/model2d/model2d.ts";

/** 全窗放大预览（独立函数，不依赖组件实例） */
/** 全屏放大预览样式(P1 批次10:cssText 抽类;overlay 挂 document.body light DOM,head 注入适用) */
const zoomCss = `
.zoom-overlay { position:fixed; inset:0; z-index:var(--z-fullscreen); background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; flex-direction:column; }
.zoom-canvas { max-width:90vw; max-height:80vh; border-radius:var(--radius-lg); background:rgba(0,0,0,.2); touch-action:none; }
.zoom-hint { font-size:var(--fs-sm); color:var(--muted); margin-top:6px; }
`;
let _zoomStyleEl: HTMLStyleElement | null = null;
function ensureZoomStyles(): void {
  if (_zoomStyleEl) return;
  const el = document.createElement("style");
  el.textContent = zoomCss;
  document.head.appendChild(el);
  _zoomStyleEl = el;
}

export async function openFullPreview(
  _canvas: HTMLCanvasElement,
  model: BedrockGeometry,
  textureImg: HTMLImageElement | null,
  labelsOn: boolean,
): Promise<void> {
  ensureZoomStyles(); // P1 批次10:cssText 抽类注入(幂等)
  const overlay = document.createElement("div");
  overlay.className = "zoom-overlay";
  // a11y：自建模态须与 features/dialogs/modal.ts 基座一致——role + aria-modal + Esc 关闭 + 焦点归还
  // （同轮整改漏网，P2 补齐；全屏放大本质是模态对话框，读屏须能播报并困在内部）
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("preview.zoom"));
  overlay.tabIndex = -1;
  const opener = document.activeElement as HTMLElement | null;
  const bigCanvas = document.createElement("canvas");
  bigCanvas.width = 600;
  bigCanvas.height = 600;
  bigCanvas.className = "zoom-canvas";
  overlay.appendChild(bigCanvas);
  const hint = document.createElement("div");
  hint.className = "zoom-hint";
  hint.textContent = t("preview.hint.zoom");
  overlay.appendChild(hint);
  let zoom = 1,
    rotation = 0;
  // BedrockGeometry.uv 含 string 形态（对象序列化），model2d 的 BedrockCube.uv 仅 number[]——cast 兼容
  const model2d = model as Parameters<typeof renderModel2D>[1];
  let hoverCleanup: (() => void) | null = null;
  const doRender = (): void => {
    hoverCleanup?.();
    hoverCleanup = renderModel2D(bigCanvas, model2d, textureImg, {
      showLabels: labelsOn,
      zoom,
      rotation,
    });
  };
  doRender();
  bigCanvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      // 比例式缩放：缩放幅度跟随 deltaY 大小（高 DPI/慢速滚轮精细，猛滚快速），
      // 优于固定步长 ±0.3（输入强度与缩放脱钩）
      const factor = Math.exp(-e.deltaY * 0.001);
      zoom = Math.max(0.2, Math.min(10, zoom * factor));
      doRender();
    },
    { passive: false },
  );
  let dragging = false,
    lastX = 0;
  bigCanvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 左键守卫（右键不触发旋转）
    dragging = true;
    lastX = e.clientX;
    bigCanvas.setPointerCapture(e.pointerId);
  });
  const onWindowMove = (e: PointerEvent): void => {
    if (!dragging) return;
    rotation = (rotation + (e.clientX - lastX) * 0.5) % 360;
    lastX = e.clientX;
    doRender();
  };
  const onWindowUp = (e: PointerEvent): void => {
    dragging = false;
    if (bigCanvas.hasPointerCapture(e.pointerId)) {
      bigCanvas.releasePointerCapture(e.pointerId);
    }
  };
  // 触屏手势被系统抢占时 pointercancel 兜底复位，防 dragging 卡 true
  const onWindowCancel = (): void => {
    dragging = false;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const onPopState = (): void => close();
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") close();
  };
  window.addEventListener("pointermove", onWindowMove);
  window.addEventListener("pointerup", onWindowUp);
  window.addEventListener("pointercancel", onWindowCancel);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    hoverCleanup?.();
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowUp);
    window.removeEventListener("pointercancel", onWindowCancel);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (overlay.parentNode) document.body.removeChild(overlay);
    // a11y：焦点归还触发元素（模态关闭后不得把焦点留在已移除节点上，WCAG 2.4.3）
    opener?.focus?.();
    // code_review 47e68917b #2（P2）：样式保持会话级——_zoomStyleEl 是模块级单例
    // （ensureZoomStyles 守卫重入），本会话可能同时存在多个 zoom overlay（异步
    // openFullPreview 可重入）；此处 remove 会把第二个仍在显示的 overlay 的样式
    // 连根拔掉（.zoom-* 全失效）——回归旧行为（注入一次不回收，~10 行 CSS）
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("popstate", onPopState);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.body.appendChild(overlay);
  // a11y：焦点移入对话框，读屏与键盘由此进入模态上下文（Esc 已挂在 document 级）
  overlay.focus();
}
