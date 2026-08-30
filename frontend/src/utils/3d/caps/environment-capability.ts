// ===== EnvironmentCapability：环境贴图/光照能力（ADR-073 caps/ 能力模式）=====
// 严格遵循 Three 标准 envMap 管线（经验 ID 433477 硬教训）：
//   1a) 程序化 Canvas 2D → Equirectangular 纹理（EquirectangularReflectionMapping 必设置）
//   1b) 或 RGBELoader 解码用户 HDR → DataTexture（Linear-sRGB → SRGBColorSpace 转换交给 PMREM）
//   2) PMREMGenerator.fromEquirectangular() 预滤波生成 scene.environment
//   3) 同步：mesh.material.envMapIntensity 统一调整（仅支持 MeshStandard/Physical/ToonMaterial）
//   4) dispose 时 dispose PMREM 产物、custom HDR 缓存、并还原 scene.environment
// 缓存策略（经验 637368）：custom HDR 成功解码后，保存 decoded DataTexture + 文件名缓存，
// preset 来回切换 custom 时不重复解码；更换/清空 HDR 或 dispose 时 dispose 旧纹理 + revoke blob。

import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export type EnvPresetId = "sky" | "studio" | "sunset" | "night" | "forest" | "custom";

export interface EnvPreset {
  id: Exclude<EnvPresetId, "custom">;
  label: string;
  /** 顶部天空色（y=+1 方向） */
  zenith: number;
  /** 地平线色（y≈0 方向） */
  horizon: number;
  /** 底部地面色（y=-1 方向） */
  nadir: number;
  /** 太阳/主光源色 */
  sunColor: number;
  /** 太阳/主光源在 equirect 上的归一化位置（x: 0~1 经度, y: 0~1 纬度，0=底 1=顶） */
  sunPos: { x: number; y: number };
  /** 太阳半径（归一化，0~0.2） */
  sunRadius: number;
  /** 云/光斑层数（0~3） */
  hazeLayers: number;
  /** 默认 envMapIntensity（0~3） */
  defaultIntensity: number;
}

export const ENV_PRESETS: Record<Exclude<EnvPresetId, "custom">, EnvPreset> = {
  sky: {
    id: "sky", label: "天空（跟随 SkyCapability）",
    zenith: 0x0b5ea8, horizon: 0x78a7e6, nadir: 0xb8d0ec,
    sunColor: 0xfff1c0, sunPos: { x: 0.25, y: 0.75 }, sunRadius: 0.05,
    hazeLayers: 1, defaultIntensity: 1.0,
  },
  studio: {
    id: "studio", label: "工作室",
    zenith: 0xcfd8e5, horizon: 0xeef2f7, nadir: 0x8a95a8,
    sunColor: 0xfff4e2, sunPos: { x: 0.3, y: 0.7 }, sunRadius: 0.1,
    hazeLayers: 3, defaultIntensity: 1.6,
  },
  sunset: {
    id: "sunset", label: "日落",
    zenith: 0x2a1855, horizon: 0xff8a5c, nadir: 0xffd28f,
    sunColor: 0xffe0a8, sunPos: { x: 0.5, y: 0.2 }, sunRadius: 0.12,
    hazeLayers: 2, defaultIntensity: 1.4,
  },
  night: {
    id: "night", label: "夜景",
    zenith: 0x02030a, horizon: 0x0e1530, nadir: 0x07091a,
    sunColor: 0xc8d4f0, sunPos: { x: 0.7, y: 0.82 }, sunRadius: 0.04,
    hazeLayers: 0, defaultIntensity: 0.7,
  },
  forest: {
    id: "forest", label: "森林",
    zenith: 0x1e4a3a, horizon: 0x6fa47a, nadir: 0x4a6b3a,
    sunColor: 0xd8f0a0, sunPos: { x: 0.2, y: 0.55 }, sunRadius: 0.06,
    hazeLayers: 2, defaultIntensity: 1.1,
  },
};
/** preset=custom 时 select 里展示的 label（不进 ENV_PRESETS，无程序化 canvas 参数） */
const CUSTOM_PRESET_LABEL = "自定义 HDR";

/**
 * 预设快捷联动表：选某预设时，除切 environment.preset 外，一并联动 sky/fog/env 参数，
 * 让「日落」「夜景」等预设呈现完整氛围，而非只换一张 envMap。
 *
 * 字段语义：
 *  - sky: { time, cloud } — 调 SkyCapability.setTime / setCloudCoverage
 *  - fog: { enabled, mode?, density?, near?, far? } — 调 FogCapability 对应 setter
 *  - envIntensity: number — 调 EnvironmentCapability.setIntensity
 *  - 仅列需要改的字段；未列的字段保持用户当前值（不覆盖）
 */
export interface EnvPresetLinkage {
  sky?: { time: number; cloud: number };
  fog?: {
    enabled: boolean;
    mode?: "linear" | "exp2";
    density?: number;
    near?: number;
    far?: number;
  };
  envIntensity?: number;
}

export const ENV_PRESET_LINKAGE: Record<Exclude<EnvPresetId, "custom">, EnvPresetLinkage> = {
  sky: {
    sky: { time: 9, cloud: 0.1 },
    envIntensity: 1.0,
  },
  studio: {
    sky: { time: 12, cloud: 0.0 },
    fog: { enabled: false },
    envIntensity: 1.6,
  },
  sunset: {
    sky: { time: 18, cloud: 0.6 },
    fog: { enabled: true, mode: "linear", density: 0.02, near: 50, far: 800 },
    envIntensity: 1.4,
  },
  night: {
    sky: { time: 22, cloud: 0.0 },
    fog: { enabled: true, mode: "exp2", density: 0.015 },
    envIntensity: 0.7,
  },
  forest: {
    sky: { time: 10, cloud: 0.4 },
    fog: { enabled: true, mode: "exp2", density: 0.03 },
    envIntensity: 1.1,
  },
};

export interface EnvironmentParams {
  enabled: boolean;
  preset: EnvPresetId;
  /** envMap 反射强度（作用于所有 mesh 的 material.envMapIntensity） */
  intensity: number;
  /** 程序化纹理分辨率（宽，高=宽/2）；越大过渡越平滑，512 足够 */
  resolution: number;
  /** 是否把当前环境贴图（HDR 原图/程序化 canvas）作为 scene.background */
  useAsBackground: boolean;
}

export const DEFAULT_ENV_PARAMS: EnvironmentParams = {
  enabled: true,
  preset: "sky",
  intensity: 1.0,
  resolution: 1024,
  useAsBackground: false,
};

/** 模型类别环境默认 preset（YSM 方块=sky，VRM/MMD=studio 柔光更友好，体素=forest） */
export const ENV_PRESET_BY_MODEL: Record<string, Partial<EnvironmentParams>> = {
  default: { preset: "sky", intensity: ENV_PRESETS.sky.defaultIntensity },
  ysm: { preset: "sky", intensity: 1.0 },
  vrm: { preset: "studio", intensity: ENV_PRESETS.studio.defaultIntensity },
  mmd: { preset: "studio", intensity: ENV_PRESETS.studio.defaultIntensity },
  "mmd-scene": { preset: "sky", intensity: 1.1 },
  litematic: { preset: "forest", intensity: ENV_PRESETS.forest.defaultIntensity },
  resourcepack: { preset: "sky", intensity: 1.0 },
};

/** 给 canvas 2D ctx 填充 equirectangular 环境贴图（程序化） */
export function drawEnvEquirect(canvas: HTMLCanvasElement, p: EnvPreset): void {
  const W = canvas.width;
  const H = canvas.height;
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
  band.addColorStop(0.3, `rgba(${midCol.r * 255 | 0},${midCol.g * 255 | 0},${midCol.b * 255 | 0},${0.06 + 0.04 * p.hazeLayers})`);
  band.addColorStop(0.5, "rgba(255,255,255,0)");
  band.addColorStop(0.7, `rgba(${midCol.r * 255 | 0},${midCol.g * 255 | 0},${midCol.b * 255 | 0},${0.05 + 0.03 * p.hazeLayers})`);
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

/** 遍历 roots 设置所有 mesh 的 material.envMapIntensity（仅 Standard/Physical/Toon 支持） */
function applyEnvIntensity(roots: THREE.Object3D[], intensity: number): void {
  for (const root of roots) {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if ("envMapIntensity" in mat) {
          (mat as unknown as { envMapIntensity: number }).envMapIntensity = intensity;
          mat.needsUpdate = true;
        }
      }
    });
  }
}

/** <input type=file accept=.hdr,image/vnd.radiance> 触发选择并返回首个 File；取消返回 null */
function pickHdrFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hdr,image/vnd.radiance,image/x-hdr";
    input.multiple = false;
    const cleanup = (): void => {
      input.remove();
      window.removeEventListener("focus", onBlurWindow);
    };
    const onBlurWindow = (): void => {
      // 部分浏览器取消后不会立即触发 change；等一个 tick 仍没选就兜底 null
      setTimeout(() => {
        if (input.files === null) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    input.onchange = (): void => {
      cleanup();
      const f = input.files?.[0] ?? null;
      resolve(f);
    };
    window.addEventListener("focus", onBlurWindow, { once: true });
    input.click();
  });
}

function ecBuildBasic(cap: EnvironmentCapability): MenuControlDef[] {
  return [
    {
      id: "env-enabled",
      kind: "toggle",
      labelKey: "preview.environment",
      fallback: "环境贴图",
      getValue: () => cap.isEnabled(),
      setValue: (v) => cap.setEnabled(v as boolean),
    },
    {
      id: "env-preset",
      kind: "preset-thumb",
      labelKey: "preview.envPresetThumbnail",
      fallback: "预设预览",
      group: "preview.envGroupPreset",
      thumb: {
        size: 64,
        options: ((): Array<{ value: string; label: string; getThumb: () => string | null }> => {
          const keys = Object.keys(ENV_PRESETS) as Array<Exclude<EnvPresetId, "custom">>;
          return keys.map((id) => ({
            value: id,
            label: ENV_PRESETS[id].label,
            getThumb: () => cap.getPresetThumbnail(id, 64),
          }));
        })(),
        activeValue: () => cap.getPresetId(),
        onSelect: (v) => cap.setPresetId(v as EnvPresetId),
      },
      getValue: () => "",
      setValue: () => { /* 由 thumb.onSelect 处理 */ },
    },
    {
      id: "env-use-as-background",
      kind: "toggle",
      labelKey: "preview.envUseAsBackground",
      fallback: "用作背景",
      group: "preview.envGroupBackground",
      hintKey: "preview.envUseAsBackgroundHint",
      getValue: () => cap.isUseAsBackground(),
      setValue: (v) => cap.setUseAsBackground(v as boolean),
    },
    {
      id: "env-intensity",
      kind: "slider",
      labelKey: "preview.envIntensity",
      fallback: "反射强度",
      group: "preview.envGroupBackground",
      slider: { min: 0, max: 3, step: 0.05 },
      getValue: () => cap.getIntensity(),
      setValue: (v) => cap.setIntensity(v as number),
    },
  ];
}

function ecBuildCustomHdr(cap: EnvironmentCapability): MenuControlDef[] {
  return [
    {
      id: "env-hdr-preview",
      kind: "image",
      labelKey: "preview.envHdrPreview",
      fallback: "HDR 预览",
      group: "preview.envGroupCustomHdr",
      getValue: () => cap.getCustomHdrThumbnail(),
      setValue: () => { /* 只读 */ },
    },
    {
      id: "env-pick-hdr",
      kind: "button",
      labelKey: "preview.envPickHdr",
      fallback: "自定义 HDR",
      group: "preview.envGroupCustomHdr",
      button: {
        textKey: "preview.envPickHdrBtn",
        variant: "primary",
        action: async () => cap.onPickCustomHdr(),
        disabled: () => cap.isCustomHdrLoading(),
        getHint: () => {
          if (cap.isCustomHdrLoading()) return "加载中…";
          const n = cap.getCustomHdrName();
          return n ? `已加载：${n}` : "";
        },
        hintKey: "preview.envPickHdrHint",
      },
      getValue: () => "",
      setValue: () => { /* ignore */ },
    },
    {
      id: "env-clear-hdr",
      kind: "button",
      labelKey: "preview.envClearHdr",
      fallback: "清除自定义 HDR",
      group: "preview.envGroupCustomHdr",
      button: {
        textKey: "preview.envClearHdrBtn",
        variant: "ghost",
        action: () => cap.onClearCustomHdr(),
        disabled: () => !cap.hasCustomHdr(),
        hintKey: "preview.envClearHdrHint",
        getHint: () => (cap.hasCustomHdr() ? "已清空将回到工作室预设" : ""),
      },
      getValue: () => "",
      setValue: () => { /* ignore */ },
    },
  ];
}

function ecBuildHistogram(cap: EnvironmentCapability): MenuControlDef[] {
  return [
    {
      id: "env-histogram",
      kind: "histogram",
      labelKey: "preview.envHistogram",
      fallback: "亮度直方图",
      group: "preview.envGroupBackground",
      getValue: () => cap.getLuminanceHistogram(),
      setValue: () => { /* 只读 */ },
    },
  ];
}

export class EnvironmentCapability implements SceneCapability {
  readonly id = "environment";
  readonly labelKey = "preview.environment";
  readonly icon = "🌍";
  readonly descKey = "preview.environmentDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: EnvironmentParams;
  private enabled: boolean;

  private pmrem: THREE.PMREMGenerator | null = null;
  /** 当前挂载到 scene.environment 的预滤波贴图 */
  private envTexture: THREE.Texture | null = null;
  /** PMREMGenerator 生产 WebGLRenderTarget，需 dispose */
  private envRT: THREE.WebGLRenderTarget | null = null;

  /** 构造前的 scene.environment（dispose 时还原） */
  private prevEnvironment: THREE.Texture | null = null;
  /** 构造前的 scene.background（dispose 时还原） */
  private prevBackground: THREE.Texture | THREE.Color | null = null;
  /** 当前用作 scene.background 的源纹理（非 PMREM 版），useAsBackground=true 时赋值，下次 buildEnvironment 先 dispose */
  private backgroundSrcTex: THREE.Texture | null = null;

  /* ===== custom HDR 缓存（经验 637368：DataTexture 存单例，preset 切换不重复解码）===== */
  /** RGBELoader 解码结果（DataTexture，HalfFloatType），dispose 时才释放 */
  private customHdrTex: THREE.DataTexture | null = null;
  /** 用户选的原始文件名（仅展示用，不持久化） */
  private customHdrName = "";
  /** 当前 HDR 是否正在异步加载（按钮禁用、失败会清空） */
  private customHdrLoading = false;
  /** 用户选 preset=custom 但没有缓存 DataTexture 时，是否已经向环形日志面板告警过（避免重复刷屏） */
  private customHdrWarnedMissing = false;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<EnvironmentParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = { ...DEFAULT_ENV_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;
    this.prevEnvironment = this.scene.environment;
    this.prevBackground = (this.scene.background as THREE.Texture | THREE.Color | null) ?? null;
  }

  /* -------- 内部：自定义 HDR 管线 -------- */

  /** 释放 custom HDR 纹理缓存（不会动当前已挂 envRT/envTexture，释放整个 PMREM 管线由 disposeEnvironment 负责） */
  private disposeCustomCache(): void {
    if (this.customHdrTex) {
      this.customHdrTex.dispose();
      this.customHdrTex = null;
    }
    this.customHdrName = "";
  }

  /** 用 RGBELoader 从 File 解码 HDR 并写入 customHdrTex，成功返回 true，失败告警并返回 false */
  private async loadCustomHdrFromFile(file: File): Promise<boolean> {
    this.customHdrLoading = true;
    let blobURL = "";
    try {
      // 经验：HDRLoader/RGBELoader.parse(buffer) 返回 TexData（{data,width,height}），
      // 要获得 DataTexture 要走基类 DataTextureLoader.load 的包装链路（负责 new DataTexture 并填 format/type/magFilter...）。
      // 所以把 File 转成 blob URL 再 loader.load()。
      blobURL = URL.createObjectURL(file);
      const loader = new RGBELoader();
      loader.setDataType(THREE.HalfFloatType);
      const tex = await new Promise<THREE.DataTexture>((resolve, reject) => {
        loader.load(
          blobURL,
          (t) => resolve(t),
          undefined,
          (err) => reject(err),
        );
      });
      tex.mapping = THREE.EquirectangularReflectionMapping; // 教训 433477：mapping 必设
      // HDR(RGBE) 解析出来是 Linear 空间，PMREMGenerator 对 Linear 输入需要显式标记
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.needsUpdate = true;
      // 替换旧缓存（先写新再放旧，避免引用悬空）
      const old = this.customHdrTex;
      this.customHdrTex = tex;
      this.customHdrName = file.name;
      if (old) old.dispose();
      this.customHdrWarnedMissing = false;
      return true;
    } catch (err) {
      console.warn("[EnvironmentCapability] 自定义 HDR 解码失败，回退到 studio 预设:", err);
      // 失败不保留中间缓存
      this.disposeCustomCache();
      return false;
    } finally {
      if (blobURL) URL.revokeObjectURL(blobURL);
      this.customHdrLoading = false;
    }
  }

  /** 用户交互入口：按钮点击 → pick file → decode → buildEnvironment */
  async onPickCustomHdr(): Promise<void> {
    const f = await pickHdrFile();
    if (!f) return;
    const ok = await this.loadCustomHdrFromFile(f);
    if (ok) {
      this.params.preset = "custom";
      // 重建环境贴图：用刚解码的 customHdrTex 走 PMREM
      this.buildEnvironment();
    } else {
      // 解码失败 → 回退 studio 预设（保证反射始终有内容，不出现黑镜，教训 433477-4）
      this.params.preset = "studio";
      this.buildEnvironment();
    }
  }

  /** 用户交互入口：清空 custom HDR，回到 studio */
  onClearCustomHdr(): void {
    this.disposeCustomCache();
    if (this.params.preset === "custom") this.params.preset = "studio";
    this.buildEnvironment();
  }

  /** 当前是否已有 custom HDR 缓存（用于按钮 hint / preset=custom 不告警） */
  hasCustomHdr(): boolean {
    return this.customHdrTex !== null;
  }
  getCustomHdrName(): string {
    return this.customHdrName;
  }
  isCustomHdrLoading(): boolean {
    return this.customHdrLoading;
  }

  /**
   * 把 customHdrTex（HalfFloatType DataTexture）降采样为缩略图 dataURL。
   * 流程：读半浮点 RGB → 块平均到 thumbW×thumbH → Reinhard tonemap → sRGB 8-bit → canvas.toDataURL。
   * 没有自定义 HDR 时返回 null。
   */
  getCustomHdrThumbnail(thumbW = 128, thumbH = 64): string | null {
    if (!this.customHdrTex) return null;
    const img = this.customHdrTex.image as { data: Uint16Array; width: number; height: number } | undefined;
    if (!img || !img.data || !img.width || !img.height) return null;

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
        let r = 0, g = 0, b = 0, count = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const si = (yy * srcW + xx) * 3;
            r += f32[si];
            g += f32[si + 1];
            b += f32[si + 2];
            count++;
          }
        }
        if (count > 0) { r /= count; g /= count; b /= count; }
        // Reinhard tonemap + sRGB 编码
        const encode = (v: number): number => {
          const mapped = v / (1 + v); // Reinhard
          const clamped = Math.max(0, Math.min(1, mapped));
          // sRGB 近似（gamma 2.2）
          return Math.round(Math.pow(clamped, 1 / 2.2) * 255);
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

  /** 从程序化预设生成缩略图 dataURL（thumbW×thumbH/2，2:1 比例）。custom 预设返回 null。 */
  getPresetThumbnail(id: EnvPresetId, thumbW: number): string | null {
    if (id === "custom") return null;
    const preset = ENV_PRESETS[id as Exclude<EnvPresetId, "custom">];
    if (!preset) return null;
    const canvas = document.createElement("canvas");
    canvas.width = thumbW;
    canvas.height = Math.max(1, Math.floor(thumbW / 2));
    drawEnvEquirect(canvas, preset);
    return canvas.toDataURL("image/png");
  }

  /* -------- 内部：重建环境贴图 -------- */

  /** 把 backgroundSrcTex 或 程序化 CanvasTexture 挂到 scene.background（useAsBackground=true 时）；
   *  useAsBackground=false 或 enabled=false：还原 prevBackground（若 prevBackground 是 Color 对象保留实例，Texture 保留引用，不 dispose prev） */
  private applyBackground(srcTex: THREE.Texture | null): void {
    // 先清旧的 backgroundSrcTex（不碰 customHdrTex / prevBackground）
    if (this.backgroundSrcTex && this.backgroundSrcTex !== this.customHdrTex) {
      this.backgroundSrcTex.dispose();
    }
    this.backgroundSrcTex = null;
    if (!this.enabled || !this.params.useAsBackground || !srcTex) {
      // 不使用：还原构造时的 prevBackground（不是 null 的话保留实例——也可能是 Color）
      this.scene.background = this.prevBackground;
      return;
    }
    this.backgroundSrcTex = srcTex;
    this.scene.background = this.backgroundSrcTex;
  }

  private buildPresetEquirectTex(): THREE.Texture | null {
    const preset = ENV_PRESETS[this.params.preset as Exclude<EnvPresetId, "custom">] ?? ENV_PRESETS.sky;
    const W = this.params.resolution;
    const H = Math.floor(W / 2);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    drawEnvEquirect(canvas, preset);

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private buildCustomHdrTex(): THREE.Texture | null {
    if (this.params.preset !== "custom") return null;
    if (this.customHdrTex) return this.customHdrTex;
    if (!this.customHdrWarnedMissing) {
      this.customHdrWarnedMissing = true;
      const logger = (globalThis as unknown as { __ysmRingLog?: (mod: string, msg: string, lvl?: "info" | "warn" | "error") => void }).__ysmRingLog;
      if (logger) logger("env", "未加载 HDR 文件，已自动回退到「工作室」预设。请点击「选择 HDR 文件」加载 .hdr。", "warn");
      else console.warn("[EnvironmentCapability] preset=custom 但无 HDR 缓存，回退 studio 预设");
    }
    this.params.preset = "studio";
    return null;
  }

  private pmremToSceneEnv(srcTex: THREE.Texture | null): void {
    if (!srcTex) return;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const rt = this.pmrem.fromEquirectangular(srcTex);
    this.envRT = rt;
    this.envTexture = rt.texture;
    this.scene.environment = this.envTexture;
    this.applyBackground(srcTex);
    if (srcTex !== this.customHdrTex && this.backgroundSrcTex !== srcTex) {
      srcTex.dispose();
    }
  }

  private buildEnvironment(): void {
    this.disposeEnvironment();
    if (!this.enabled) {
      this.scene.environment = this.prevEnvironment;
      this.applyBackground(null);
      return;
    }
    let srcTex: THREE.Texture | null = null;
    if (this.params.preset === "custom") {
      srcTex = this.buildCustomHdrTex();
    }
    if (!srcTex) {
      srcTex = this.buildPresetEquirectTex();
    }
    this.pmremToSceneEnv(srcTex);
  }

  /**
   * 计算当前环境贴图的 16-bin 亮度直方图。
   * 数据源：customHdrTex（custom HDR 分支）或 backgroundSrcTex 的 canvas（程序化预设）。
   * 返回 number[16]，每个 bin 是该亮度区间的像素数；无数据源时返回全 0 数组。
   */
  getLuminanceHistogram(): number[] {
    const BINS = 16;
    const hist = new Array<number>(BINS).fill(0);

    // 优先用 customHdrTex（HalfFloatType DataTexture）
    if (this.customHdrTex) {
      const img = this.customHdrTex.image as { data: Uint16Array; width: number; height: number } | undefined;
      if (img && img.data && img.width && img.height) {
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
    if (this.backgroundSrcTex) {
      const canvas = this.backgroundSrcTex.image as HTMLCanvasElement | undefined;
      if (canvas && canvas.getContext) {
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

  private disposeEnvironment(): void {
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    this.envTexture = null;
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
    // backgroundSrcTex 清理：只有不等于 customHdrTex（程序化 CanvasTexture 情形）才 dispose
    if (this.backgroundSrcTex && this.backgroundSrcTex !== this.customHdrTex) {
      this.backgroundSrcTex.dispose();
    }
    this.backgroundSrcTex = null;
  }

  /** 对外：切换模型后同步所有 mesh 的 envMapIntensity
   *  由 mount-preview-core 在 build 完成后和 switchToSession 后调用 */
  syncMeshIntensity(roots: THREE.Object3D[]): void {
    applyEnvIntensity(roots, this.params.intensity);
  }

  /* -------- 公共 API -------- */

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.buildEnvironment();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPreset(modelType: string): void {
    const modelPreset = ENV_PRESET_BY_MODEL[modelType] ?? ENV_PRESET_BY_MODEL.default;
    // setPreset 是"模型类别初始化"入口，不应该跳到 custom（custom 由用户主动选 HDR 才进）
    const safe: Partial<EnvironmentParams> = { ...modelPreset };
    if (safe.preset === "custom") safe.preset = "studio";
    this.params = { ...this.params, ...safe };
    this.buildEnvironment();
  }

  setPresetId(id: EnvPresetId): void {
    if (id === "custom" && !this.customHdrTex) {
      // preset=custom 但没缓存 → 不 build（没内容），提示用户点"选择 HDR"按钮，保持现有预设
      const logger = (globalThis as unknown as { __ysmRingLog?: (mod: string, msg: string, lvl?: "info" | "warn" | "error") => void }).__ysmRingLog;
      if (logger) logger("env", "「自定义 HDR」需要先选择 .hdr 文件，请点击下方按钮选择 HDR 文件。", "warn");
      return;
    }
    this.params.preset = id;
    this.buildEnvironment();
  }

  getPresetId(): EnvPresetId {
    return this.params.preset;
  }

  setIntensity(v: number): void {
    this.params.intensity = Math.max(0, Math.min(5, v));
    // 只对所有 mesh 直接赋值即可（scan scene.children 不会把 camera/light 当内容父节点误伤；
    // 简化版直接对 scene 根 traverse，保证无遗漏）
    applyEnvIntensity([this.scene], this.params.intensity);
  }

  getIntensity(): number {
    return this.params.intensity;
  }

  setResolution(v: number): void {
    this.params.resolution = v;
    if (this.enabled) this.buildEnvironment();
  }

  setUseAsBackground(v: boolean): void {
    this.params.useAsBackground = v;
    // 切换开关只需要重新 assign background，不需要重跑 PMREM（canvas / DataTexture 源都还在）
    // 但简化实现直接 buildEnvironment：程序化分支会走同一张 canvas，但 applyBackground 会正确设置/还原
    // useAsBackground=true 时程序化 CanvasTexture 不会立即 dispose，false 时立即释放。
    this.buildEnvironment();
  }

  isUseAsBackground(): boolean {
    return this.params.useAsBackground;
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [...ecBuildBasic(this), ...ecBuildCustomHdr(this), ...ecBuildHistogram(this)];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    // ⚠️ 不存 custom HDR 二进制/文件名（blob/base64 会炸 localStorage；重启后文件名也没意义）
    // 保存 preset 时：若当前是 custom + 有缓存 → 存 preset=custom；
    // 若当前是 custom + 无缓存（告警回退到 studio 时还没 buildEnvironment 成功）→ 存 studio
    const savePreset: EnvPresetId =
      this.params.preset === "custom" && !this.customHdrTex ? "studio" : this.params.preset;
    persistState(this.id, {
      enabled: this.enabled,
      preset: savePreset,
      intensity: this.params.intensity,
      resolution: this.params.resolution,
      useAsBackground: this.params.useAsBackground,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (typeof state.preset === "string") {
      const p = state.preset as EnvPresetId;
      // 只有 custom=custom 且已有缓存（不可能，因为存的时候不存 HDR，这里只做二次保险）时保留
      if (p === "custom") {
        if (!this.customHdrTex) {
          // 持久化读回 custom 但没缓存 → 静默回退 studio + 告警一次
          if (!this.customHdrWarnedMissing) {
            this.customHdrWarnedMissing = true;
            const logger = (globalThis as unknown as { __ysmRingLog?: (mod: string, msg: string, lvl?: "info" | "warn" | "error") => void }).__ysmRingLog;
            if (logger) logger("env", "上次设置为自定义 HDR，但 HDR 文件未持久化保存，已自动回退到「工作室」预设。请重新选择 HDR 文件。", "warn");
            else console.warn("[EnvironmentCapability] loadState 读回 preset=custom，但 custom HDR 无法跨会话持久化，回退 studio");
          }
          this.params.preset = "studio";
        } else {
          this.params.preset = "custom";
        }
      } else if (ENV_PRESETS[p as Exclude<EnvPresetId, "custom">]) {
        this.params.preset = p;
      }
    }
    if (typeof state.intensity === "number") this.params.intensity = state.intensity;
    if (typeof state.resolution === "number") this.params.resolution = state.resolution;
    if (typeof state.useAsBackground === "boolean") this.params.useAsBackground = state.useAsBackground;
    this.buildEnvironment();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildEnvironment();
  }

  dispose(): void {
    this.scene.environment = this.prevEnvironment;
    this.scene.background = this.prevBackground;
    this.disposeEnvironment();
    this.disposeCustomCache();
  }
}
