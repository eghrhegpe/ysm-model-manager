// ===== Canvas 全屏放大预览 =====
// 从 events.js 拆分：openFullPreview
/** 全窗放大预览（独立函数，不依赖组件实例） */
export async function openFullPreview(canvas, model, textureImg, labelsOn) {
  const { renderModel2D } = await import("../../utils/model2d.js");
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:var(--z-fullscreen);background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;flex-direction:column";
  const bigCanvas = document.createElement("canvas");
  bigCanvas.width = 600;
  bigCanvas.height = 600;
  bigCanvas.style.cssText =
    "max-width:90vw;max-height:80vh;border-radius:8px;background:rgba(0,0,0,.2)";
  overlay.appendChild(bigCanvas);
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11px;color:var(--muted);margin-top:6px";
  hint.textContent = "🖱️ 拖拽旋转 · 滚轮缩放 · ESC 关闭";
  overlay.appendChild(hint);
  let zoom = 1,
    rotation = 0;
  const doRender = () =>
    renderModel2D(bigCanvas, model, textureImg, {
      showLabels: labelsOn,
      zoom,
      rotation,
    });
  doRender();
  bigCanvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(10, zoom + (e.deltaY > 0 ? -0.3 : 0.3)));
      doRender();
    },
    { passive: false },
  );
  let dragging = false,
    lastX = 0;
  bigCanvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    rotation = (rotation + (e.clientX - lastX) * 0.5) % 360;
    lastX = e.clientX;
    doRender();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  const close = () => {
    if (overlay.parentNode) document.body.removeChild(overlay);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { once: true },
  );
  document.body.appendChild(overlay);
}
