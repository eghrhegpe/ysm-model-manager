// ===== env-pixels — 环境贴图纯像素工具（P2 抽取自 environment-capability.ts）=====
// 对齐 P1 拆分先例（sun-beams.ts 拆轴自 sky-capability / ADR-177 light-cone.ts 抽离
// LightCapability 锥体）：把不属于「环境贴图 IBL 管理」主职责的纯像素工具下沉本文件，
// 使 environment-capability.ts 收口 envMap 管线 / PMREM / HDR 加载等渲染轴。
// 本文件零应用层依赖：只 import three + ENV_PRESETS 纯数据（经 EnvPreset 类型），
// 不反向 import EnvironmentCapability——实例状态经参数注入解耦（customHdrTex /
// backgroundSrcTex）。行为与原实现逐字等价（契约：environment-capability.test.ts
// 的缩略图与直方图数据分支用例）。
// 内容：
//   - drawEnvEquirect：程序化 Canvas 2D equirectangular 环境贴图绘制（含私有 helper
//     hexToCss / withAlphaCss）
//   - customHdrThumbnail：custom HDR（HalfFloat DataTexture）降采样 + Reinhard tonemap
//     生成缩略图 dataURL
//   - luminanceHistogram：16-bin 亮度直方图（custom HDR / 程序化背景双数据源）

import * as THREE from "three";
import type { EnvPreset } from "./environment-state.ts";

/** 给 canvas 2D ctx 填充 equirectangular 环境贴图（程序化） */
export function drawEnvEquirect(canvas: HTMLCanvasElement, p: EnvPreset): void {
  const W = canvas.width;
  const H = canvas.height;
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);

  // 1) 垂直渐变：zenith → horizon（上半段），horizon → nadir（下半段）
  const gradTop = ctx.createLinearGradient(0, 0, 0, H / 2);
  gradTop.addColorStop(0, hexToCss(p.zenith));
  gradTop.addColorStop(1, hexToCss(p.horizon));
  ctx.fillStyle = gradTop;
  ctx.fillRect(0, 0, W, H / 2);

  const gradBottom = ctx.createLinearGradient(0, H / 2, 0, H);
  gradBottom.addColorStop(0, hexToCss(p.horizon));
  gradBottom.addColorStop(1, hexToCss(p.nadir));
  ctx.fillStyle = gradBottom;
  ctx.fillRect(0, H / 2, W, H / 2);

  // 2) 水平方向柔光带（模拟横向环境光包裹）
  const band = ctx.createLinearGradient(0, 0, W, 0);
  const midCol = new THREE.Color(p.horizon).lerp(new THREE.Color(p.zenith), 0.3);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(
    0.3,
    `rgba(${(midCol.r * 255) | 0},${(midCol.g * 255) | 0},${(midCol.b * 255) | 0},${0.06 + 0.04 * p.hazeLayers})`,
  );
  band.addColorStop(0.5, "rgba(255,255,255,0)");
  band.addColorStop(
    0.7,
    `rgba(${(midCol.r * 255) | 0},${(midCol.g * 255) | 0},${(midCol.b * 255) | 0},${0.05 + 0.03 * p.hazeLayers})`,
  );
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, H);

  // 3) 太阳圆盘（在 equirect 上 x,y 映射到 (lon, lat)。lat 0.5=地平线，1=天顶）
  const cx = p.sunPos.x * W;
  const cy = (1 - p.sunPos.y) * H; // canvas y=0 是顶，对应 lat=1
  const radius = p.sunRadius * W;
  if (radius > 0) {
    const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3);
    radial.addColorStop(0, hexToCss(p.sunColor));
    radial.addColorStop(0.4, withAlphaCss(p.sunColor, 0.45));
    radial.addColorStop(1, withAlphaCss(p.sunColor, 0));
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4) hazeLayers: 横向水平云带（简化版）
  for (let i = 0; i < p.hazeLayers; i++) {
    const yBase = (0.42 + i * 0.05) * H;
    const yBand = 0.04 * H;
    const hGrad = ctx.createLinearGradient(0, yBase - yBand, W, yBase + yBand);
    hGrad.addColorStop(0, "rgba(255,255,255,0)");
    hGrad.addColorStop(0.2, "rgba(255,255,255,0.08)");
    hGrad.addColorStop(0.5, "rgba(255,255,255,0.03)");
    hGrad.addColorStop(0.8, "rgba(255,255,255,0.08)");
    hGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, yBase - yBand, W, yBand * 2);
  }
}

function hexToCss(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r},${g},${b})`;
}
function withAlphaCss(hex: number, a: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 把 customHdrTex（HalfFloatType DataTexture）降采样为缩略图 dataURL。
 * 流程：读半浮点 RGB → 块平均到 thumbW×thumbH → Reinhard tonemap → sRGB 8-bit → canvas.toDataURL。
 * 没有自定义 HDR 时返回 null。
 * P2 抽取：原为 EnvironmentCapability#getCustomHdrThumbnail，this.customHdrTex 改为参数注入。
 */
export function customHdrThumbnail(
  tex: THREE.DataTexture | null,
  thumbW = 128,
  thumbH = 64,
): string | null {
  if (!tex) return null;
  const img = tex.image as { data: Uint16Array; width: number; height: number } | undefined;
  if (!img?.data || !img.width || !img.height) return null;

  const srcW = img.width;
  const srcH = img.height;
  const src = img.data;
  // 半浮点读法：Uint16Array 视图 + Float32 reinterpret
  const buf = new ArrayBuffer(src.length * 2);
  new Uint16Array(buf).set(src);
  const f32 = new Float32Array(buf);

  const canvas = document.createElement("canvas");
  canvas.width = thumbW;
  canvas.height = thumbH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = ctx.createImageData(thumbW, thumbH);
  const dst = imageData.data;

  for (let ty = 0; ty < thumbH; ty++) {
    const y0 = Math.floor((ty * srcH) / thumbH);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * srcH) / thumbH));
    for (let tx = 0; tx < thumbW; tx++) {
      const x0 = Math.floor((tx * srcW) / thumbW);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * srcW) / thumbW));
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const si = (yy * srcW + xx) * 3;
          r += f32[si];
          g += f32[si + 1];
          b += f32[si + 2];
          count++;
        }
      }
      if (count > 0) {
        r /= count;
        g /= count;
        b /= count;
      }
      // Reinhard tonemap + sRGB 编码
      const encode = (v: number): number => {
        const mapped = v / (1 + v); // Reinhard
        const clamped = Math.max(0, Math.min(1, mapped));
        // sRGB 近似（gamma 2.2）
        return Math.round(clamped ** (1 / 2.2) * 255);
      };
      const di = (ty * thumbW + tx) * 4;
      dst[di] = encode(r);
      dst[di + 1] = encode(g);
      dst[di + 2] = encode(b);
      dst[di + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * 计算当前环境贴图的 16-bin 亮度直方图。
 * 数据源：customHdrTex（custom HDR 分支）或 backgroundSrcTex 的 canvas（程序化预设）。
 * 返回 number[16]，每个 bin 是该亮度区间的像素数；无数据源时返回全 0 数组。
 * P2 抽取：原为 EnvironmentCapability#getLuminanceHistogram，实例字段改为参数注入。
 */
export function luminanceHistogram(
  customHdrTex: THREE.DataTexture | null,
  backgroundSrcTex: THREE.Texture | null,
): number[] {
  const BINS = 16;
  const hist = new Array<number>(BINS).fill(0);

  // 优先用 customHdrTex（HalfFloatType DataTexture）
  if (customHdrTex) {
    const img = customHdrTex.image as
      | { data: Uint16Array; width: number; height: number }
      | undefined;
    if (img?.data && img.width && img.height) {
      const src = img.data;
      const total = img.width * img.height;
      // 降采样：每 ~4096 个像素取 1 个（大 HDR 2k+ 时性能考量）
      const stride = Math.max(1, Math.floor(total / 4096));
      // half-float (Uint16) → float32 逐元素转换
      const hf = THREE.DataUtils.fromHalfFloat;
      for (let i = 0; i < total; i += stride) {
        const r = hf(src[i * 3]);
        const g = hf(src[i * 3 + 1]);
        const b = hf(src[i * 3 + 2]);
        // Relative luminance (Rec. 601)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Reinhard-ish 映射到 [0,1) 区间
        const mapped = lum / (1 + lum);
        const bin = Math.min(BINS - 1, Math.floor(mapped * BINS));
        hist[bin]++;
      }
      return hist;
    }
  }

  // 程序化预设：从 backgroundSrcTex 的 canvas 读像素
  if (backgroundSrcTex) {
    const canvas = backgroundSrcTex.image as HTMLCanvasElement | undefined;
    if (canvas?.getContext) {
      try {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const data = ctx.getImageData(0, 0, w, h).data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const bin = Math.min(BINS - 1, Math.floor(lum * BINS));
            hist[bin]++;
          }
          return hist;
        }
      } catch {
        // canvas tainted (cross-origin) 或 getImageData 抛错 → 静默返回全 0
      }
    }
  }

  return hist;
}
