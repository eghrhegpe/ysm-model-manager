// ===== surface-pixels/grass.ts — 草地：各向异性噪声 → 定向纤维（非圆形斑块）=====
// 行业手法：草叶是定向纤维，不是各向同性斑点。x 轴频率压缩（ANISO_X < 1）使噪声
// 特征沿 x 拉长成条纹/纤维，零资产、保平铺。
// 无缝：4D 环面噪声（noise.ts tiledFbm）——纹理自身 repeat 无接缝。
// angleRad 改为「环面相位偏移」（任意角度仍无缝）；整体图案旋转由 GPU texture.rotation 负责。

import { tiledFbm } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

/** 各向异性系数：x 轴频率压缩（<1）→ 噪声特征沿 x 方向拉长成纤维 */
const ANISO_X = 0.35;

export const generateGrassPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const [cr2, cg2, cb2] = input.color2;
  const density = Math.max(0.25, input.density);
  const grain = Math.max(1, input.gridSize) / 8;
  const baseFreq = Math.max(1, Math.round(8 * density * grain));
  const freqX = Math.max(1, Math.round(baseFreq * ANISO_X)); // 各向异性：x 向拉长成纤维
  const freqY = baseFreq;
  const contrast = 0.95;

  for (let y = 0; y < sizePx; y++) {
    const v = (y + 0.5) / sizePx; // [0,1) 采样中心
    for (let x = 0; x < sizePx; x++) {
      const u = (x + 0.5) / sizePx;
      // 4D 环面无缝噪声（angleRad 作相位偏移，任意角度仍无缝）
      const n = tiledFbm(u, v, freqX, freqY, input.angleRad, 4);
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
