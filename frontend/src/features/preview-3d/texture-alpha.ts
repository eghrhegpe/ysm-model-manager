import * as THREE from "three";
import { AlphaIndex } from "./alpha-index.ts";

export type TextureAlphaMode = "opaque" | "cutout" | "blend";

/** 纹理级透明信息：整图模式 + 面级查询索引（ADR-118 Phase B） */
export interface TextureAlphaInfo {
  mode: TextureAlphaMode;
  /** 像素不可读（非 RGBA 数据 / 无 document / tainted）时为 null，面级拆分回退整图模式 */
  index: AlphaIndex | null;
  width: number;
  height: number;
}

const ALPHA_INFO_KEY = "ysmAlphaInfo";

export function getTextureAlphaInfo(texture: THREE.Texture): TextureAlphaInfo {
  const cached = texture.userData[ALPHA_INFO_KEY] as TextureAlphaInfo | undefined;
  if (cached) return cached;

  const pixels = readRgbaPixels(texture);
  const info: TextureAlphaInfo = pixels
    ? {
        mode: classifyRgba(pixels.data),
        index: new AlphaIndex(pixels.data, pixels.width, pixels.height),
        width: pixels.width,
        height: pixels.height,
      }
    : { mode: "opaque", index: null, width: 0, height: 0 };
  texture.userData[ALPHA_INFO_KEY] = info;
  return info;
}

/** Classify alpha once per cached texture so material setup can choose a render path. */
export function getTextureAlphaMode(texture: THREE.Texture): TextureAlphaMode {
  return getTextureAlphaInfo(texture).mode;
}

// blend 阈值收敛：0.005 过低——整张贴图只要混入 >0.5% 半透明像素（车漆抗锯齿、
// 窗玻璃、发光渐变、轮毂边缘）就把整 mesh 判 blend，transparent=true+depthWrite=false
// 进透明队列 → 多模型同场时透明乱序叠加/不写深度，硬实部件（底盘/背光位）被后画
// 物体覆盖或背向被盖掉（"底盘消失/左灯仅单侧见"）。收紧到 5%，让准不透明主结构走
// opaque/cutout（alphaTest），仅真玻璃/强透材质保持 blend。
const BLEND_MIN_RATIO = 0.05;

function classifyRgba(data: ArrayLike<number>): TextureAlphaMode {
  let hasTransparent = false;
  let translucent = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i] ?? 255;
    if (alpha > 0 && alpha < 255) translucent++;
    else if (alpha === 0) hasTransparent = true;
  }
  if (translucent / total > BLEND_MIN_RATIO) return "blend";
  return hasTransparent ? "cutout" : "opaque";
}

interface RgbaSample {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

function readRgbaPixels(texture: THREE.Texture): RgbaSample | null {
  const image = texture.image as {
    data?: ArrayLike<number>;
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  } | null;
  if (!image) return null;

  if (image.data && texture.format === THREE.RGBAFormat) {
    return {
      data: image.data,
      width: image.width ?? 0,
      height: image.height ?? 0,
    };
  }
  if (image.data && texture.format !== THREE.RGBAFormat) return null;

  const width = image.naturalWidth ?? image.width ?? 0;
  const height = image.naturalHeight ?? image.height ?? 0;
  if (!width || !height || typeof document === "undefined") return null;

  try {
    // 缩小采样（code review P3）：全分辨率 readback 对 2048²/4096² 纹理分配 16-64MB
    // 并阻塞主线程数十 ms（每纹理一次，模型构建关键路径）；alpha 模式分类只需
    // 有界样本，256px 封顶即可
    const MAX_SAMPLE = 256;
    const scale = Math.min(1, MAX_SAMPLE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    return {
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    // Preserve rendering for unsupported/tainted image sources.
    return null;
  }
}

