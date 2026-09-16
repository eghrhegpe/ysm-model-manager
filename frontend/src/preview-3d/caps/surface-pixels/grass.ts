// ===== surface-pixels/grass.ts — 草地：各向异性噪声 → 定向纤维（非圆形斑块）=====
// 行业手法：草叶是定向纤维，不是各向同性斑点。x 轴压缩采样频率（ANISO_X < 1）使噪声
// 特征沿 x 拉长成条纹；再与材质角度（angleRad）叠加，纤维跟随用户设定方向。零资产、保平铺。

import { valueNoise } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

/** 各向异性系数：x 轴频率压缩（<1）→ 噪声特征沿 x 方向拉长成纤维 */
const ANISO_X = 0.35;

export const generateGrassPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const cosA = Math.cos(input.angleRad);
  const sinA = Math.sin(input.angleRad);
  const half = sizePx / 2;
  const density = Math.max(0.25, input.density);
  const grain = Math.max(1, input.gridSize) / 8;
  const freq = 5 * density * grain;
  const contrast = 0.95;

  for (let y = 0; y < sizePx; y++) {
    const ny = (y - half) / half;
    for (let x = 0; x < sizePx; x++) {
      const nx = (x - half) / half;
      const rx = nx * cosA + ny * sinA;
      const ry = -nx * sinA + ny * cosA;
      // 关键：x 轴压缩 → 各向异性（定向纤维，而非圆形斑块）
      const ax = rx * ANISO_X;
      const ay = ry;
      let n = 0;
      n += valueNoise(ax * freq + 17, ay * freq + 17) * 0.5;
      n += valueNoise(ax * freq * 2 - 9, ay * freq * 2 - 9) * 0.3;
      n += valueNoise(ax * freq * 4 + 5, ay * freq * 4 + 5) * 0.2;
      const t = Math.min(1, Math.max(0, 0.5 + (n - 0.5) * contrast * 2));
      const i = (y * sizePx + x) * 4;
      px[i] = Math.round(r + t * (cr2 - r));
      px[i + 1] = Math.round(g + t * (cg2 - g));
      px[i + 2] = Math.round(b + t * (cb2 - b));
      px[i + 3] = 255;
    }
  }
  return px;
};
