// ===== surface-pixels/sand.ts — 沙子：高频细颗粒、低对比噪声 =====

import { valueNoise } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

export const generateSandPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const cosA = Math.cos(input.angleRad);
  const sinA = Math.sin(input.angleRad);
  const half = sizePx / 2;
  const density = Math.max(0.25, input.density);
  const grain = Math.max(1, input.gridSize) / 8;
  const freq = 14 * density * grain;
  const contrast = 0.45;

  for (let y = 0; y < sizePx; y++) {
    const ny = (y - half) / half;
    for (let x = 0; x < sizePx; x++) {
      const nx = (x - half) / half;
      const rx = nx * cosA + ny * sinA;
      const ry = -nx * sinA + ny * cosA;
      let n = 0;
      n += valueNoise(rx * freq + 17, ry * freq + 17) * 0.5;
      n += valueNoise(rx * freq * 2 - 9, ry * freq * 2 - 9) * 0.3;
      n += valueNoise(rx * freq * 4 + 5, ry * freq * 4 + 5) * 0.2;
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
