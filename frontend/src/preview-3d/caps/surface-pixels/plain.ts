// ===== surface-pixels/plain.ts — 纯色填充（solid / plain 共用）=====
// [P1 批 2026-10-04] 微噪点分支：matMicroNoise>0 时叠加高频无缝微细节——
// 4D 环面 tiledFbm（与 marble/sand/grass 同一基建，u→u+1 严格无缝，RepeatWrapping 平铺不露边）。
// 幅度 ±amp/255：人眼几乎不觉察，但破除「无限纯色」的塑料感（探索档 P1 提案 A 收口）。
// amp 是 spec 的 structural 参数（改动触发纹理重建，不进外观原地路径）。
import { tiledFbm } from "./noise.ts";
import type { SurfacePixelGenerator } from "./types.ts";

/** 微噪点频率：每贴图像素域 24 周期（高频细颗粒；探索档概念值，24 周期/512px 贴图） */
const MICRO_NOISE_FREQ = 24;
/** 微噪点 octave 数（3 层即够——细节要「看不见的大体均匀」，非 marble 式脉络） */
const MICRO_NOISE_OCTAVES = 3;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export const generatePlainPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  const amp = input.microNoise ?? 0;
  if (amp <= 0) {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
    return px;
  }
  // u/v 归一化与 marble 同口径（像素中心采样），tiledFbm 环面嵌入保证平铺无缝
  for (let y = 0; y < sizePx; y++) {
    const v = (y + 0.5) / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = (x + 0.5) / sizePx;
      // 中心化 ±amp（0.5=中点 → d∈[-amp, amp]），clamp 防 255 溢出回绕
      const d =
        (tiledFbm(u, v, MICRO_NOISE_FREQ, MICRO_NOISE_FREQ, 0, MICRO_NOISE_OCTAVES) - 0.5) *
        2 *
        amp;
      const i = (y * sizePx + x) * 4;
      px[i] = clamp255(r + d);
      px[i + 1] = clamp255(g + d);
      px[i + 2] = clamp255(b + d);
      px[i + 3] = 255;
    }
  }
  return px;
};
