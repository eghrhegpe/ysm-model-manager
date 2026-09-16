// ===== surface-pixels/sand.ts — 沙子：高频细颗粒、低对比噪声 =====
// 无缝：4D 环面噪声（noise.ts tiledFbm）——纹理自身 repeat 无接缝。
// angleRad 作环面相位偏移（任意角度仍无缝）；整体图案旋转由 GPU texture.rotation 负责。

import { tiledFbm } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

export const generateSandPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const density = Math.max(0.25, input.density);
  const grain = Math.max(1, input.gridSize) / 8;
  const baseFreq = Math.max(1, Math.round(16 * density * grain)); // 高频细颗粒
  const contrast = 0.45;

  for (let y = 0; y < sizePx; y++) {
    const v = (y + 0.5) / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = (x + 0.5) / sizePx;
      const n = tiledFbm(u, v, baseFreq, baseFreq, input.angleRad, 3);
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
