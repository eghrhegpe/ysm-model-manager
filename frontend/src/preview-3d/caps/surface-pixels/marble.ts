// ===== surface-pixels/marble.ts — 大理石：域扭曲把直线正弦带弯成脉络 =====
// 行业手法（Inigo Quilez domain warping）：sin(x + k·fbm) —— fbm 湍流扰动带坐标，
// 直线纹路被掰弯成自然脉络，团块感消失。零资产、保平铺。
// 无缝：带坐标 u*periodCount（periodCount 取整）+ warp 用 4D 环面噪声 → 边界严格对齐。

import { tiledFbm } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

const TAU = Math.PI * 2;
/** 域扭曲强度：湍流对带坐标的扰动幅度 */
const WARP_STRENGTH = 2.4;

export const generateMarblePixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const density = Math.max(0.25, input.density);
  const periodCount = Math.max(1, Math.round(input.gridSize * density)); // 取整 → 带在边界对齐
  const warpFreq = Math.max(1, Math.round(3 * density));

  for (let y = 0; y < sizePx; y++) {
    const v = (y + 0.5) / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = (x + 0.5) / sizePx;
      // 域扭曲：4D 环面 fbm 湍流偏移带坐标（无缝）→ 直线带弯成自然脉络
      // angleRad 与 grass/sand 同口径作相位偏移（审核 d2eee2f50：硬编码 0 令
      // matAngleDeg 滑杆对 marble 成死控件，违反 ADR-249 §2.4）
      const warp = tiledFbm(u, v, warpFreq, warpFreq, input.angleRad, 4) - 0.5;
      const band = Math.sin(TAU * (u * periodCount + warp * WARP_STRENGTH));
      const t = 0.5 + 0.5 * band;
      const i = (y * sizePx + x) * 4;
      px[i] = Math.round(r + t * (cr2 - r));
      px[i + 1] = Math.round(g + t * (cg2 - g));
      px[i + 2] = Math.round(b + t * (cb2 - b));
      px[i + 3] = 255;
    }
  }
  return px;
};
