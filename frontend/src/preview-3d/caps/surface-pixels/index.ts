// ===== surface-pixels/index.ts — 材质像素生成器调度表 =====

import { generateGrassPixels } from "./grass.ts";
import { generateMarblePixels } from "./marble.ts";
import { generatePlainPixels } from "./plain.ts";
import { generateSandPixels } from "./sand.ts";
import type { SurfaceCanvasStyle, SurfacePixelGenerator } from "./types.ts";

/** 纯色生成器（solid / plain 共用），由 ground-surface-spec 直接调用 */
export { generatePlainPixels };

/** 噪声材质生成器表（键 = canvasStyle） */
export const SURFACE_PIXEL_GENERATORS: Record<SurfaceCanvasStyle, SurfacePixelGenerator> = {
  marble: generateMarblePixels,
  sand: generateSandPixels,
  grass: generateGrassPixels,
};
