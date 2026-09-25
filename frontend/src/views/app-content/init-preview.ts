// ===== 预览面板拖拽调整（为 app-content/index.ts 减负，ADR-040）=====
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import type { AppContentHost } from "./host.ts";

/** 预览面板宽度夹取范围与默认值（恢复与 onMove 共用，防两处魔法数漂移） */
const PREVIEW_W_MIN = 160;
const PREVIEW_W_MAX = 500;
const PREVIEW_W_DEFAULT = 240;

function clampPreviewWidth(w: number): number {
  return Math.max(PREVIEW_W_MIN, Math.min(PREVIEW_W_MAX, w));
}

/**
 * 初始化预览面板拖拽调整宽度
 * @param host - app-content 组件实例
 */
export function initPreviewResize(host: AppContentHost): void {
  // 先移除上一轮 _render 遗留的 document 监听器，防止切页累积泄漏——
  // 必须在 handle/preview 缺失的 early-return 之前执行：否则切到无预览页时
  // 上一轮监听器（闭包引用已卸载 DOM）会残留到下一次带预览的渲染（陷阱 #2）
  if (host.state.resizeMove) document.removeEventListener("pointermove", host.state.resizeMove);
  if (host.state.resizeUp) document.removeEventListener("pointerup", host.state.resizeUp);

  const handle = host.state.root.getElementById("preview-resize-handle");
  const preview = host.state.root.getElementById("app-preview");
  if (!handle || !preview) {
    // 同步清空存储的处理器，避免陈旧闭包被后续 render 重复移除/误用
    host.state.resizeMove = null;
    host.state.resizeUp = null;
    return;
  }

  // 宽度真值单点在此：localStorage 恢复（模板不再写死 width / var 死引用）。
  // 脏值（parseInt NaN）回落默认宽，不写无效 style
  const savedWidth = safeGet("preview-width");
  const parsed = savedWidth ? parseInt(savedWidth, 10) : Number.NaN;
  preview.style.width = `${Number.isFinite(parsed) ? clampPreviewWidth(parsed) : PREVIEW_W_DEFAULT}px`;

  // pointerdown 绑定与 handle 元素同寿命（handle 随面板世代新建）——幂等守卫防
  // 同世代多次进入本函数时在同一个 handle 上累积 handler
  if (handle.dataset.resizeBound) return;
  handle.dataset.resizeBound = "1";

  let resizing = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 左键守卫（右键不触发 resize）
    resizing = true;
    e.preventDefault();
    handle.style.background = "var(--accent)";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture(e.pointerId);
  });
  const onMove = (e: PointerEvent): void => {
    if (!resizing) return;
    const rect = preview.getBoundingClientRect();
    const newW = clampPreviewWidth(rect.right - e.clientX);
    preview.style.width = `${newW}px`;
  };
  const onUp = (e: PointerEvent): void => {
    if (!resizing) return;
    resizing = false;
    handle.style.background = "transparent";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    // 保存宽度到 localStorage
    safeSet("preview-width", preview.style.width);
  };
  host.state.resizeMove = onMove;
  host.state.resizeUp = onUp;
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}
