// ===== Canvas 导出 PNG 工具 =====

/**
 * 在 canvas 下方附加"导出 PNG"按钮
 * @param {HTMLElement} container - 存放 canvas 的容器
 * @param {HTMLCanvasElement} canvas - 要导出的 canvas
 * @param {string} filename - 导出文件名（不含扩展名）
 */
export function addExportButton(container, canvas, filename) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;margin-top:4px;align-items:center";

  const btn = document.createElement("button");
  btn.textContent = "💾 导出 PNG";
  btn.style.cssText =
    "font-size:9px;padding:2px 8px;border-radius:4px;" +
    "border:1px solid var(--bd);background:var(--surf);" +
    "color:var(--txt);cursor:pointer";
  btn.onclick = () => exportCanvasPNG(canvas, filename);

  const hint = document.createElement("span");
  hint.style.cssText = "font-size:8px;color:var(--muted)";
  hint.textContent = "点击下载骨骼预览图";

  row.appendChild(btn);
  row.appendChild(hint);
  container.appendChild(row);
}

/**
 * 将 canvas 内容导出为 PNG 文件下载
 */
function exportCanvasPNG(canvas, filename) {
  const link = document.createElement("a");
  link.download =
    (filename || "model-skeleton").replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".png";
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
