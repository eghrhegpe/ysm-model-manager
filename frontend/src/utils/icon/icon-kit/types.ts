/**
 * types.ts — icon-kit 多源图标类型定义。
 *
 * IconSpec：一个图标在不同源下的定义。目前支持三种源——
 *   svg   = 内联 SVG 路径（复用 `.ws-icon` 外壳，随主题色/字号缩放）；
 *   emoji = 单个 emoji 字符（`.eicon` span，保留字符原始外观）；
 *   font  = 图标字体类名（`.ficon` span + 类名，预留图标字体形态）。
 *
 * 决策指引（SVG 优先、不强制全 SVG）：
 *   - 能精确控制颜色/缩放/跨平台一致 → 用 svg（首选）；
 *   - 需要世界表情/特殊字形、接受其自带外观 → 用 emoji；
 *   - 接入图标字体库 → 用 font，在主题里定义该类的字体族。
 */
export type IconSource = "svg" | "emoji" | "font";

export type IconSpec =
  | { src: "svg"; svg: string }
  | { src: "emoji"; char: string }
  | { src: "font"; className: string };
