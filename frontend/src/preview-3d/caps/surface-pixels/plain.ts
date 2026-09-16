// ===== surface-pixels/plain.ts — 纯色填充（solid / plain 共用）=====
import type { SurfacePixelGenerator } from "./types.ts";

export const generatePlainPixels: SurfacePixelGenerator = (input, sizePx) => {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = input.color;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
};
