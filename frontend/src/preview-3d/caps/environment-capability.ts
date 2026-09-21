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
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import type { ModelType } from "@/preview-3d/state/model-defaults.ts";
import { pickModelDefaultFields } from "@/preview-3d/state/model-defaults.ts";
// P2 抽取：纯像素工具（drawEnvEquirect / 缩略图 / 直方图）已下沉 env-pixels.ts，
// 对齐 P1 sun-beams.ts 范式（状态完全内聚、不反向依赖宿主）。
import { customHdrThumbnail, drawEnvEquirect, luminanceHistogram } from "./env-pixels.ts";
import { buildEnvironmentNodes } from "./environment-menu.ts";
import type { EnvPreset, EnvPresetId } from "./environment-state.ts";
// ENV_PRESETS / ENV_PRESET_BY_MODEL / ENV_PRESET_LINKAGE 仍被 cap/菜单/测试消费，保留透传导出。
import { ENV_PRESETS } from "./environment-state.ts";
import {
  type EnvPlacement,
  persistState,
  restoreState,
  ringLog,
  type SceneCapability,
} from "./scene-capability.ts";

// P2 抽取：drawEnvEquirect 已下沉 env-pixels.ts，保留透传导出（测试/调用方仍从 cap 文件导入）。
export { drawEnvEquirect } from "./env-pixels.ts";
export type { EnvPreset, EnvPresetId };
// ENV_PRESETS（程序化天空数据表）仍被 cap/菜单/测试消费，保留透传导出。
export { ENV_PRESETS };

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
  readonly icon = "globe";
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

    // ADR-196：订阅 envState 变更，渲染由回调落地（只接收 environment 组的键）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
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
      },
      "environment",
    );
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
   * P2 抽取：像素运算下沉 env-pixels.ts#customHdrThumbnail，本方法仅注入实例状态。
   */
  getCustomHdrThumbnail(thumbW = 128, thumbH = 64): string | null {
    return customHdrThumbnail(this.customHdrTex, thumbW, thumbH);
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
    // 回退 studio：写 setEnvState 触发 callback build（isBuilding 守卫防递归）。
    // [锐评 E-3] 来源纪律：回退是**程序化动作**，不是用户手改——原实现写 "manual"
    // 会把 envPreset 的 lastWriteSource 打成 manual，此后 auto-atmosphere 氛围预设
    // 写 envPreset 一律被 shouldOverwrite 拒绝（用户选 sunset，环境贴图却不跟着换）。
    // force:true 语义同昼夜循环先例：程序化动作不得被守卫冻结。此处必须 force——
    // 若用户曾手选过 studio（prev=manual），auto-model 写入会被守卫拒绝，
    // envState.envPreset 将滞留 "custom" 而渲染已是 studio 贴图（真值源与画面撕裂）。
    setEnvState({ envPreset: "studio" }, { source: "auto-model", force: true });
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
   * P2 抽取：像素运算下沉 env-pixels.ts#luminanceHistogram，本方法仅注入实例状态。
   */
  getLuminanceHistogram(): number[] {
    return luminanceHistogram(this.customHdrTex, this.backgroundSrcTex);
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

  applyModelPreset(modelType: ModelType): void {
    const picked = pickModelDefaultFields(modelType, [
      "envPreset",
      "envIntensity",
      "envResolution",
      "envUseAsBackground",
    ]);
    if (Object.keys(picked).length > 0) setEnvState(picked, { source: "auto-model" });
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
    setEnvState({ envIntensity: v }, { source: "manual" }); // 值域钳制在唯一写入口（ADR-283）
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

  /** 环境面板归属（ADR-268）：氛围卡首位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "atmosphere", order: 10 };
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
    // [锐评 E-4] 还原前做 **ownership 守卫**（对齐 sky-capability.dispose 的对称实现）：
    // scene.environment / scene.background 是**多 cap 共享的全局槽位**——sky 的 IBL
    // PMREM 也会写 scene.environment。原实现无条件还原 prevEnvironment，若 sky 在本
    // cap 之后写过 environment（构造序：env → sky），env.dispose 会把 sky 的贴图冲掉，
    // 呈现「关掉环境贴图，天空 IBL 也黑了」。仅当槽位仍归本 cap 所有（自建贴图，
    // 或已被子路径置 null）才还原。
    const ownedEnv = this.envTexture;
    if (this.scene.environment === null || this.scene.environment === ownedEnv) {
      this.scene.environment = this.prevEnvironment;
    }
    // background 同理（同槽位无他人竞写，但保持与 environment 同构，防未来多 cap 接入）
    const ownedBg = this.backgroundSrcTex;
    if (this.scene.background === null || this.scene.background === ownedBg) {
      this.scene.background = this.prevBackground;
    }
    this.disposeEnvironment();
    this.disposeCustomCache();
  }
}
