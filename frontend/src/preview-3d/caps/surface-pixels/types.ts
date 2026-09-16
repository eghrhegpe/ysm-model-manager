// ===== surface-pixels/types.ts — 生成器输入与签名（去环依赖，不 import cap 文件）=====
// 供 caps/surface-pixels/ 下各材质生成器共享；不引入 three / DOM，保留 node 单测能力。

/** 材质像素生成器的统一输入（从 GroundSurfaceStructuralSpec 投影而来） */
export interface SurfacePixelInput {
  /** 主色 [r,g,b] 0-255 */
  color: [number, number, number];
  /** 副色（噪声插值另一端）[r,g,b] 0-255 */
  color2: [number, number, number];
  /** 粒度基准（gridSize） */
  gridSize: number;
  /** 图案密度（控制频率/粗细） */
  density: number;
  /** 颗粒角度（弧度；与 appearance.rotationRad 不同层） */
  angleRad: number;
}

/** 噪声材质样式（plain 走独立纯色生成器，不在此表） */
export type SurfaceCanvasStyle = "marble" | "sand" | "grass";

/** 材质像素生成器签名：输入 → sizePx² RGBA Uint8Array */
export type SurfacePixelGenerator = (input: SurfacePixelInput, sizePx: number) => Uint8Array;
