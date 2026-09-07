// ===== EnvironmentCapability：环境贴图/光照能力（ADR-073 caps/ 能力模式）=====
// 严格遵循 Three 标准 envMap 管线（经验 ID 433477 硬教训）：
//   1a) 程序化 Canvas 2D → Equirectangular 纹理（EquirectangularReflectionMapping 必设置）
//   1b) 或 RGBELoader 解码用户 HDR → DataTexture（Linear-sRGB → SRGBColorSpace 转换交给 PMREM）
//   2) PMREMGenerator.fromEquirectangular() 预滤波生成 scene.environment
//   3) 同步：mesh.material.envMapIntensity 统一调整（仅支持 MeshStandard/Physical/ToonMaterial）
//   4) dispose 时 dispose PMREM 产物、custom HDR 缓存、并还原 scene.environment
// 缓存策略（经验 637368）：custom HDR 成功解码后，保存 decoded DataTexture + 文件名缓存，
// preset 来回切换 custom 时不重复解码；更换/清空 HDR 或 dispose 时 dispose 旧纹理 + revoke blob。
//
// ADR-196 刀2：参数量（preset/intensity/resolution/useAsBackground）已迁移至全局 envState 单例，
// 能力级 enabled 留 cap 私有 this.enabled。setter 收口 setEnvState(source:'manual')，
// 渲染由 registerEnvCallback 回调落地，setter 内不再直接 buildEnvironment（防双写/双重建）。

import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import type { PreviewMenuNode } from "../menu-node-types.ts";
import { registerEnvCallback } from "../state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "../state/env-state.ts";
import type { EnvState } from "../state/env-state-schema.ts";
import { buildEnvironmentNodes } from "./environment-menu.ts";
import type { EnvPreset, EnvPresetId } from "./environment-state.ts";
// ENV_PRESETS / ENV_PRESET_BY_MODEL / ENV_PRESET_LINKAGE 仍被 cap/菜单/测试消费，保留透传导出。
import { ENV_PRESETS } from "./environment-state.ts";
import { MODEL_DEFAULTS } from "../state/model-defaults.ts";
import { persistState, restoreState, ringLog, type SceneCapability } from "./scene-capability.ts";

export type { EnvPreset, EnvPresetId };
// ENV_PRESETS（程序化天空数据表）仍被 cap/菜单/测试消费，保留透传导出。
export { ENV_PRESETS };

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

export class EnvironmentCapability implements SceneCapability {
  readonly id = "environment";
  readonly labelKey = "preview.environment";
  readonly icon = "🌍";
  readonly descKey = "preview.environmentDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  /** 能力总开关（不入 envState，getMasterNodeId 返回 'env-enabled'） */
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

  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;
  /** 防递归标记：buildEnvironment 内部 setEnvState 触发回调时跳过 */
  private isBuilding = false;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.enabled = opts.enabled ?? true;
    this.prevEnvironment = this.scene.environment;
    this.prevBackground = (this.scene.background as THREE.Texture | THREE.Color | null) ?? null;

    // ADR-196：订阅 envState 变更，渲染由回调落地
    this.unsubscribeEnv = registerEnvCallback(this, (changed, _state) => {
      if (this.isBuilding) return;
      const structural =
        changed.has("envPreset") ||
        changed.has("envResolution") ||
        changed.has("envUseAsBackground");
      if (structural && this.enabled) {
        this.buildEnvironment();
      }
      if (changed.has("envIntensity")) {
        applyEnvIntensity([this.scene], envState.envIntensity);
      }
    });
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
      ringLog(
        "env",
        `自定义 HDR 解码失败，回退到 studio 预设: ${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
      // 失败不保留中间缓存
      this.disposeCustomCache();
      return false;
    } finally {
      if (blobURL) URL.revokeObjectURL(blobURL);
      this.customHdrLoading = false;
    }
  }

  /** 用户交互入口：按钮点击 → pick file → decode → setEnvState → callback build */
  async onPickCustomHdr(): Promise<void> {
    const f = await pickHdrFile();
    if (!f) return;
    const ok = await this.loadCustomHdrFromFile(f);
    if (ok) {
      // 成功：写 preset=custom → 触发 callback build
      setEnvState({ envPreset: "custom" }, { source: "manual" });
    } else {
      // 解码失败 → 回退 studio 预设（保证反射始终有内容，不出现黑镜，教训 433477-4）
      setEnvState({ envPreset: "studio" }, { source: "manual" });
    }
  }

  /** 用户交互入口：清空 custom HDR，回到 studio */
  onClearCustomHdr(): void {
    this.disposeCustomCache();
    if (envState.envPreset === "custom") {
      // 仅 custom 时写回 studio → 触发 callback build；非 custom 保持当前预设
      setEnvState({ envPreset: "studio" }, { source: "manual" });
    }
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
    const img = this.customHdrTex.image as
      | { data: Uint16Array; width: number; height: number }
      | undefined;
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
    if (!this.enabled || !envState.envUseAsBackground || !srcTex) {
      // 不使用：还原构造时的 prevBackground（不是 null 的话保留实例——也可能是 Color）
      this.scene.background = this.prevBackground;
      return;
    }
    this.backgroundSrcTex = srcTex;
    this.scene.background = this.backgroundSrcTex;
  }

  private buildPresetEquirectTex(): THREE.Texture | null {
    const preset =
      ENV_PRESETS[envState.envPreset as Exclude<EnvPresetId, "custom">] ?? ENV_PRESETS.sky;
    const W = envState.envResolution;
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
    if (envState.envPreset !== "custom") return null;
    if (this.customHdrTex) return this.customHdrTex;
    if (!this.customHdrWarnedMissing) {
      this.customHdrWarnedMissing = true;
      ringLog(
        "env",
        "未加载 HDR 文件，已自动回退到「工作室」预设。请点击「选择 HDR 文件」加载 .hdr。",
        "warn",
        () => console.warn("[EnvironmentCapability] preset=custom 但无 HDR 缓存，回退 studio 预设"),
      );
    }
    // 回退 studio：写 setEnvState 触发 callback build（isBuilding 守卫防递归）
    setEnvState({ envPreset: "studio" }, { source: "manual" });
    return null;
  }

  private pmremToSceneEnv(srcTex: THREE.Texture | null): void {
    if (!srcTex) return;
    try {
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
    } catch (e) {
      ringLog("env", `PMREM 生成失败: ${e}`, "error");
      this.disposeEnvironment();
      this.scene.environment = this.prevEnvironment;
      // 失败回滚必须与禁用分支/dispose 同构：buildEnvironment 先 disposeEnvironment()，
      // 已把旧 backgroundSrcTex dispose 掉——成功路径靠 applyBackground 重挂新背景，
      // 失败路径必须显式还原 prevBackground，否则 scene.background 悬空指向已释放纹理
      this.applyBackground(null);
    }
  }

  private buildEnvironment(): void {
    if (this.isBuilding) return;
    this.isBuilding = true;
    try {
      this.disposeEnvironment();
      if (!this.enabled) {
        this.scene.environment = this.prevEnvironment;
        this.applyBackground(null);
        return;
      }
      let srcTex: THREE.Texture | null = null;
      if (envState.envPreset === "custom") {
        srcTex = this.buildCustomHdrTex();
      }
      if (!srcTex) {
        srcTex = this.buildPresetEquirectTex();
      }
      this.pmremToSceneEnv(srcTex);
    } finally {
      this.isBuilding = false;
    }
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
      const img = this.customHdrTex.image as
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
    if (this.backgroundSrcTex) {
      const canvas = this.backgroundSrcTex.image as HTMLCanvasElement | undefined;
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
    applyEnvIntensity(roots, envState.envIntensity);
  }

  /* -------- 公共 API -------- */

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.buildEnvironment();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPreset(modelType: string): void {
    const preset = MODEL_DEFAULTS[modelType as keyof typeof MODEL_DEFAULTS] ?? MODEL_DEFAULTS.default;
    // ADR-196：统一数据源 MODEL_DEFAULTS；callback → buildEnvironment。
    const partial: Partial<EnvState> = {};
    const src = preset as Record<string, unknown>;
    if (src.envPreset !== undefined) partial.envPreset = src.envPreset as EnvPresetId;
    if (src.envIntensity !== undefined) partial.envIntensity = src.envIntensity as number;
    if (src.envResolution !== undefined) partial.envResolution = src.envResolution as number;
    if (src.envUseAsBackground !== undefined) partial.envUseAsBackground = src.envUseAsBackground as boolean;
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "auto-model" });
  }

  setPresetId(id: EnvPresetId): void {
    if (id === "custom" && !this.customHdrTex) {
      // preset=custom 但没缓存 → 不 setEnvState（没内容），提示用户点"选择 HDR"按钮，保持现有预设
      ringLog("env", "「自定义 HDR」需要先选择 .hdr 文件，请点击下方按钮选择 HDR 文件。", "warn");
      return;
    }
    setEnvState({ envPreset: id }, { source: "manual" });
    // callback → buildEnvironment
  }

  getPresetId(): EnvPresetId {
    return envState.envPreset;
  }

  setIntensity(v: number): void {
    setEnvState({ envIntensity: Math.max(0, Math.min(5, v)) }, { source: "manual" });
    // callback → applyEnvIntensity（无需显式调用）
  }

  getIntensity(): number {
    return envState.envIntensity;
  }

  setResolution(v: number): void {
    setEnvState({ envResolution: v }, { source: "manual" });
    // callback → buildEnvironment（enabled 时）
  }

  setUseAsBackground(v: boolean): void {
    setEnvState({ envUseAsBackground: v }, { source: "manual" });
    // callback → buildEnvironment
  }

  isUseAsBackground(): boolean {
    return envState.envUseAsBackground;
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力总开关节点 id：env 面板据此升 header + body 剔除同源 */
  getMasterNodeId(): string {
    return "env-enabled";
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树：env-enabled 平铺 toggle（能力总开关）+ preset/background/customHdr 三 folder。
   *  background 组合并修复：use-as-background/intensity/histogram 同归一个 folder（getMenuControls 里被拆两段）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildEnvironmentNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    // ⚠️ 不存 custom HDR 二进制/文件名（blob/base64 会炸 localStorage；重启后文件名也没意义）
    // 保存 preset 时：若当前是 custom + 有缓存 → 存 preset=custom；
    // 若当前是 custom + 无缓存（告警回退到 studio 时还没 buildEnvironment 成功）→ 存 studio
    const savePreset: EnvPresetId =
      envState.envPreset === "custom" && !this.customHdrTex ? "studio" : envState.envPreset;
    persistState(this.id, {
      enabled: this.enabled,
      preset: savePreset,
      intensity: envState.envIntensity,
      resolution: envState.envResolution,
      useAsBackground: envState.envUseAsBackground,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;

    // 能力级 enabled 不入 envState，直接恢复
    if (typeof state.enabled === "boolean") {
      this.enabled = state.enabled;
    }

    // 收集 envState 恢复值
    const partial: Partial<EnvState> = {};

    if (typeof state.preset === "string") {
      const p = state.preset as EnvPresetId;
      if (p === "custom") {
        if (!this.customHdrTex) {
          // 持久化读回 custom 但没缓存 → 静默回退 studio + 告警一次
          if (!this.customHdrWarnedMissing) {
            this.customHdrWarnedMissing = true;
            ringLog(
              "env",
              "上次设置为自定义 HDR，但 HDR 文件未持久化保存，已自动回退到「工作室」预设。请重新选择 HDR 文件。",
              "warn",
              () =>
                console.warn(
                  "[EnvironmentCapability] loadState 读回 preset=custom，但 custom HDR 无法跨会话持久化，回退 studio",
                ),
            );
          }
          partial.envPreset = "studio";
        } else {
          partial.envPreset = "custom";
        }
      } else if (ENV_PRESETS[p as Exclude<EnvPresetId, "custom">]) {
        partial.envPreset = p;
      }
    }

    if (typeof state.intensity === "number") partial.envIntensity = state.intensity;
    if (typeof state.resolution === "number") partial.envResolution = state.resolution;
    if (typeof state.useAsBackground === "boolean")
      partial.envUseAsBackground = state.useAsBackground;

    if (Object.keys(partial).length > 0) {
      setEnvState(partial, { source: "manual" });
    }

    // 恢复后显式 build（callback 可能因值未变而跳过，确保初始状态正确）
    this.buildEnvironment();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildEnvironment();
  }

  dispose(): void {
    this.unsubscribeEnv();
    this.scene.environment = this.prevEnvironment;
    this.scene.background = this.prevBackground;
    this.disposeEnvironment();
    this.disposeCustomCache();
  }
}
