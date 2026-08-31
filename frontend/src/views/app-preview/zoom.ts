// ===== Canvas 全屏放大预览 =====
// 从 events.ts 拆分：openFullPreview
import type { BedrockGeometry } from "../../features/preview-3d/decoder/geometry.ts";
import { renderModel2D } from "../../features/preview-3d/model2d.ts";

/** 全窗放大预览（独立函数，不依赖组件实例） */
export async function openFullPreview(
  canvas: HTMLCanvasElement,
  model: BedrockGeometry,
  textureImg: HTMLImageElement | null,
  labelsOn: boolean,
): Promise<void> {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:var(--z-fullscreen);background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;flex-direction:column";
  const bigCanvas = document.createElement("canvas");
  bigCanvas.width = 600;
  bigCanvas.height = 600;
  bigCanvas.style.cssText =
    "max-width:90vw;max-height:80vh;border-radius:8px;background:rgba(0,0,0,.2);touch-action:none";
  overlay.appendChild(bigCanvas);
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11px;color:var(--muted);margin-top:6px";
  hint.textContent = "🖱️ 拖拽旋转 · 滚轮缩放 · ESC 关闭";
  overlay.appendChild(hint);
  let zoom = 1,
    rotation = 0;
  // BedrockGeometry.uv 含 string 形态（对象序列化），model2d 的 BedrockCube.uv 仅 number[]——cast 兼容
  const model2d = model as Parameters<typeof renderModel2D>[1];
  const doRender = (): void =>
    renderModel2D(bigCanvas, model2d, textureImg, {
      showLabels: labelsOn,
      zoom,
      rotation,
    });
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
  window.addEventListener("pointermove", onWindowMove);
  window.addEventListener("pointerup", onWindowUp);
  window.addEventListener("pointercancel", onWindowCancel);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowUp);
    window.removeEventListener("pointercancel", onWindowCancel);
    document.removeEventListener("keydown", onKey);
    if (overlay.parentNode) document.body.removeChild(overlay);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}
