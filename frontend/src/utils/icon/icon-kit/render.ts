/**
 * render.ts — icon-kit 渲染器：IconSpec → HTML 字符串。
 *
 * 三个源的统一出口，调用方无感（`renderIcon(spec)` 一个函数搞定所有源）。
 * 样式约定：
 *   - svg  → 复用既有 `.ws-icon`（width:1em / currentColor / 24×24，随主题与字号）；
 *   - emoji→ `.eicon`，保留字符原始外观（多源策略允许 emoji 作回退/长尾）；
 *   - font → `.ficon` + 调用方类名，预留图标字体形态。
 */
import type { IconSpec } from "./types.ts";

/** .ws-icon 同款 SVG 外壳（与 utils/icon/ui-icons.ts 的 svg() 一致，避免重复造轮子）。 */
function svgShell(inner: string): string {
  return `<svg class="ws-icon" viewBox="0 0 24 24">${inner}</svg>`;
}

/**
 * 把多源图标定义渲染成 HTML 字符串。
 * 未知源/缺字段时回退为空串（宁可不渲染，也不输出破坏结构的 HTML）。
 */
export function renderIcon(spec: IconSpec): string {
  switch (spec.src) {
    case "svg":
      return svgShell(spec.svg);
    case "emoji":
      return `<span class="eicon">${spec.char}</span>`;
    case "font":
      return `<span class="ficon ${spec.className}"></span>`;
    default:
      return "";
  }
}
