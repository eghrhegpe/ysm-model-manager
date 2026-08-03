// ===== Canvas 导出 PNG 工具（类型化版 — ADR-014 P2）=====

/**
 * 在 canvas 下方附加"导出 PNG"按钮
 * @param container 存放 canvas 的容器
 * @param canvas 要导出的 canvas
 * @param filename 导出文件名（不含扩展名）
 */
export function addExportButton(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  filename: string,
): void {
  const row = document.createElement("div");
  row.className = "ysm-export-row";

  const btn = document.createElement("button");
  btn.textContent = "💾 导出 PNG";
  btn.style.cssText =
    "font-size:9px;padding:2px 8px;border-radius:4px;" +
    "border:1px solid var(--bd);background:var(--surf);" +
    "color:var(--txt);cursor:pointer";
  btn.onclick = (): void => exportCanvasPNG(canvas, filename);

  const hint = document.createElement("span");
  hint.className = "ysm-hint";
  hint.textContent = "点击下载骨骼预览图";

  row.appendChild(btn);
  row.appendChild(hint);
  container.appendChild(row);
}

/**
 * 将 canvas 内容导出为 PNG 文件下载
 */
function exportCanvasPNG(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement("a");
  link.download =
    (filename || "model-skeleton").replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".png";
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
