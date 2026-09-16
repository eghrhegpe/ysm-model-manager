// ===== surface-pixels/marble.ts — 大理石：域扭曲把直线正弦带弯成脉络 =====
// 行业手法（Inigo Quilez domain warping）：sin(x + k·fbm) —— fbm 湍流扰动带坐标，
// 直线纹路被掰弯成自然脉络，团块感消失。零资产、保平铺。

import { fbm } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

const TAU = Math.PI * 2;
/** 域扭曲强度：湍流对带坐标的扰动幅度 */
const WARP_STRENGTH = 2.4;

export const generateMarblePixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const cosA = Math.cos(input.angleRad);
  const sinA = Math.sin(input.angleRad);
  const half = sizePx / 2;
  const density = Math.max(0.25, input.density);
  const periodCount = Math.max(1, input.gridSize) * density;

  for (let y = 0; y < sizePx; y++) {
    const ny = (y - half) / half;
    for (let x = 0; x < sizePx; x++) {
      const nx = (x - half) / half;
      const rx = nx * cosA + ny * sinA;
      const ry = -nx * sinA + ny * cosA;
      // 域扭曲：fbm 湍流偏移带坐标 → 直线带弯成自然脉络
      const warp = fbm(rx * 3 * density + 10, ry * 3 * density + 10, 4) - 0.5;
      const band = Math.sin((rx * periodCount + warp * WARP_STRENGTH) * TAU);
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
