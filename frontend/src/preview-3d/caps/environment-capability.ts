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
// ADR-196 刀2：参数量（preset/intensity/resolution/useAsBackground）已迁移至全局 envState 单例。
// [锐评 F-1 收口 2026-10] 能力级开关亦已收编 schema 键 `envEnabled`（第四例，前三例
// shadow/reflector/sky）——原私有 `this.enabled` 退役，setEnabled/isEnabled 降为 schema 键
// 别名；setter 收口 setEnvState(source:'manual')，渲染由 registerEnvCallback 回调落地，
// setter 内不再直接 buildEnvironment（防双写/双重建）。

import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import {
  registerEnvCallback,
  withEnvCallbacksSuspended,
} from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import type { ModelType } from "@/preview-3d/state/model-defaults.ts";
import { pickModelDefaultFields } from "@/preview-3d/state/model-defaults.ts";
// ADR-216：监听器集合工厂提级共享原语（fog/light/ground/water 同源；菜单局部刷新 notify 用）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
// P2 抽取：纯像素工具（drawEnvEquirect / 缩略图 / 直方图）已下沉 env-pixels.ts，
// 对齐 P1 sun-beams.ts 范式（状态完全内聚、不反向依赖宿主）。
import { customHdrThumbnail, drawEnvEquirect, luminanceHistogram } from "./env-pixels.ts";
import { buildEnvironmentNodes } from "./environment-menu.ts";
import type { EnvSource } from "./environment-migrations.ts";
// ADR-292 D7：旧存档 envSource 迁移（与 ground-capability 同口径的可测纯函数，零 THREE/DOM 依赖）
import { normalizeEnvLegacyState } from "./environment-migrations.ts";
// 暗线 B 收口：scene.environment 槽位所有权纯判定（dispose 安全边界）下沉本文件，
// 与 env-pixels.ts 同范式——令 ADR-292 所有权契约集中在可单测一处，替代原 4 处手抄排除集。
import { envOwnsSceneEnvironment, isEnvDisposableSource } from "./environment-ownership.ts";
import type { EnvPreset, EnvPresetId, SelectableEnvPresetId } from "./environment-state.ts";
// ENV_PRESETS（程序化天空数据表）：本文件内部消费（buildPresetEquirectTex / getPresetThumbnail）。
// [锐评 2026-10-07 死再导出清收] 曾透传导出给 cap-configs.test / environment-capability.test，
// 生产消费方为零，两处测试已改直引 environment-state.ts；ENV_PRESET_BY_MODEL / ENV_PRESET_LINKAGE
// 更是无定义的死符号（ADR-284 / atmosphere-presets 取代）——透传一并删除。
import { ENV_PRESETS } from "./environment-state.ts";
import {
  type EnvPlacement,
  getTypedCap,
  persistState,
  restoreState,
  ringLog,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

export type { EnvPreset, EnvPresetId, SelectableEnvPresetId };

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
  /**
   * [ADR-292 D7] 最近一次经 envSource="sky" 从 SkyCapability 取回的烘焙纹理。
   * 仅用于 pmremToSceneEnv 的**所有权守卫**（不得 dispose 别人的纹理）；
   * 本 cap 不持有其生命周期，dispose 路径一律不碰它。
   */
  private skySourcedTex: THREE.Texture | null = null;

  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;
  /** [ADR-293 收口 2026-10] 参数变更订阅（菜单局部刷新）：仅离散键变更 notify——
   *  与 fog/light/ground/water 同款 listenerSet，消除环境面板「订阅了不说话的 cap、
   *  却靠 applyPreset 手动 refresh 兜底」的接线不对称（锐评暗线 A）。连续滑块
   *  （envIntensity / envResolution）恒不 notify（subscribe 契约，防指针脱靶）。 */
  private readonly listenerSet = createListenerSet();
  /** [R-1] 有存档恢复过 = 模型默认值让位（对齐 shadow/reflector/fog 同款守卫） */
  private isStateLoaded = false;
  /** 防递归标记：buildEnvironment 内部 setEnvState 触发回调时跳过 */
  private isBuilding = false;
  /**
   * [ADR-292 D7] cap 间协调查询器（组合根 createAll 注入）。
   * 用途：`envSource === "sky"` 时向 SkyCapability 取烘焙纹理。
   * 与 sky-capability 的 `caps` 同源同形（`ctx.caps` 由 registry 统一注入）。
   */
  private caps?: SceneCapabilityLookup;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    /** [锐评 F-1 收口] 保留形参以兼容既有调用方/测试（ADR-250 口径，同 sky/light/pp），
     *  但**不再写 cap 私有字段**——能力总开关唯一真值源是 `envState.envEnabled`。
     *  传值仅在显式给定时用于初始化该状态（不传则尊重 envState 现值，含存档恢复顺序）。 */
    enabled?: boolean;
    /** [ADR-292 D7] cap 间协调查询器——envSource="sky" 时经此向 sky 取烘焙纹理 */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    // [锐评 F-1 收口] 能力级总开关入 schema（对齐 ADR-250/ADR-293 的 pp/light 口径）：
    // 显式传值才写状态层，不传则尊重 envState 现值（含用户存档恢复的顺序）。
    // ⚠️ 顺序敏感：此处 setEnvState 发生在 registerEnvCallback **之前**，订阅者尚未就位，
    // 挂载/卸载副作用不会自动触发——场景对象由组合根随后的 apply() 落地。
    if (opts.enabled !== undefined) {
      setEnvState({ envEnabled: opts.enabled }, { source: "manual" });
    }
    if (opts.caps !== undefined) this.caps = opts.caps;
    this.prevEnvironment = this.scene.environment;
    this.prevBackground = (this.scene.background as THREE.Texture | THREE.Color | null) ?? null;

    // ADR-196：订阅 envState 变更，渲染由回调落地（只接收 environment 组的键）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
        if (this.isBuilding) return;
        // [锐评 F-1 收口] 能力总开关 = envState.envEnabled（原私有 this.enabled 已退役）——
        // schema 键本就在 "environment" 组内，toggle 派发天然到本回调；不接管则该键改了
        // 不落地（原实现靠私有门短路挂在最前面，键永无消费者 = 幽灵键）。
        // 开态走 buildEnvironment（从 envState 全量重写：取图通路/分辨率/背景一并跟上，
        // 同批兄弟键亦被覆盖，故可直接 return）；关态还原 scene.environment +
        // applyBackground(null)（背景槽同属本 cap，不随总开关关掉即悬空指向已释放纹理）。
        // ⚠️ 先处理开关分支并 return：buildEnvironment 内部 isBuilding 置位期间若有
        // 同步派发（取图路径），再入本回调会被首行 isBuilding 短路，不会递归。
        if (changed.has("envEnabled")) {
          if (envState.envEnabled) this.buildEnvironment();
          else {
            this.disposeEnvironment();
            this.scene.environment = this.prevEnvironment;
            this.applyBackground(null);
          }
          // [锐评 X-3 2026-10-04] IBL 是否在场直接决定 light 的 ambient 让位系数（×0.5）——
          // env 开关翻转必须通知 light 重算（与 `sky.setEnvironmentEnabled` 的跨 cap 通知
          // 先例同法）。判据「env 在场启用」现已唯一归本键。
          getTypedCap(this.caps, "light")?.refreshAmbientFromSky?.();
          this.notify();
          return;
        }
        const structural =
          changed.has("envPreset") ||
          changed.has("envResolution") ||
          changed.has("envUseAsBackground") ||
          // [ADR-292 D7] 来源切换是结构性变更（换整条取图通路），必须重建
          changed.has("envSource");
        if (structural && envState.envEnabled) {
          this.buildEnvironment();
        }
        if (changed.has("envIntensity")) {
          applyEnvIntensity([this.scene], envState.envIntensity);
        }
        // [ADR-293 收口 2026-10] 离散键 notify（subscribe 契约，对齐 fog/light 同款）：
        // 来源选择 / 背景开关 / 预设选择是离散控件，面板需实时刷新；连续滑块不 notify。
        // 复用 env 组现有按键集合——envSource/envUseAsBackground/envPreset 均属离散切换，
        // envPreset 已含在 structural 内，此处并集覆盖其余离散键。
        if (
          changed.has("envSource") ||
          changed.has("envUseAsBackground") ||
          changed.has("envPreset")
        ) {
          this.notify();
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
        `自定义 HDR 解码失败，保持当前渲染不动（通路键未拨回，画面维持旧内容）: ${err instanceof Error ? err.message : String(err)}`,
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
      // [ADR-292 D5 补全 2026-09-21] 通路权威 = envSource（buildCustomHdrTex 只认它）。
      // 旧代码只写 envPreset，选完 HDR 通路仍停 "preset" → 新图永不上屏（按钮整体失效）。
      // 严格按 D5「只写一个键」：不动 envPreset——它承载预设通路选图；无缓存时
      // buildCustomHdrTex 返回 null → buildEnvironment 回落预设渲染（D12 回落不改键），
      // 用户换 HDR 文件后自动生效，跨会话意图不被吞。
      setEnvState({ envSource: "custom" }, { source: "manual" });
    }
    // 解码失败 → **不动任何键**：通路本就停在原值，画面维持旧内容即正确语义。
  }

  /** 用户交互入口：清空 custom HDR，回到预设通路。
   *  [ADR-292 D5 补全] 与 onPickCustomHdr 对称：显式清除 = 撤回 custom 通路意图，
   *  envSource 落回 "preset"（不写则通路停在 custom、缓存已空 → 只剩静默回落，
   *  来源单选与画面再度分裂）。envPreset 仅在残留旧语义值 custom（新语义的非法选图值）
   *  时修回 studio（同 loadState 的 preset 修复口），否则保留用户预设原样回屏。 */
  onClearCustomHdr(): void {
    this.disposeCustomCache();
    const patch: Partial<EnvState> = {};
    if (envState.envSource === "custom") patch.envSource = "preset";
    if (envState.envPreset === "custom") patch.envPreset = "studio";
    if (Object.keys(patch).length > 0) setEnvState(patch, { source: "manual" });
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
    const preset = ENV_PRESETS[id as SelectableEnvPresetId];
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
    // 先清旧的 backgroundSrcTex：是否可 dispose 由 ownership 纯判定收口
    // （customHdrTex/skySourcedTex 各有专属释放路径或归他人所有，暗线 B）
    if (
      this.backgroundSrcTex &&
      isEnvDisposableSource(this.backgroundSrcTex, {
        customHdrTex: this.customHdrTex,
        skySourcedTex: this.skySourcedTex,
      })
    ) {
      this.backgroundSrcTex.dispose();
    }
    this.backgroundSrcTex = null;
    if (!envState.envEnabled || !envState.envUseAsBackground || !srcTex) {
      // 不使用：还原构造时的 prevBackground（不是 null 的话保留实例——也可能是 Color）
      this.scene.background = this.prevBackground;
      return;
    }
    this.backgroundSrcTex = srcTex;
    this.scene.background = this.backgroundSrcTex;
  }

  private buildPresetEquirectTex(): THREE.Texture | null {
    const preset = ENV_PRESETS[envState.envPreset as SelectableEnvPresetId] ?? ENV_PRESETS.sky;
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

  /**
   * 自定义 HDR 通路取图。
   *
   * [ADR-292 D5 定案] **本方法不写 `envPreset`**——`envSource` 是通路唯一权威，
   * `envPreset` 只承载「预设通路选哪张图」。原实现在无 HDR 缓存时把 envPreset 改写成
   * `"studio"`，导致：来源显示「自定义 HDR」而 envPreset 是 studio（两键分裂，
   * e2e 无从断言）；且用户手选的预设被静默吞掉。
   *
   * 现语义：无文件 → 记一次告警 + 返回 null（由 buildEnvironment 回落预设渲染），
   * **键值一个都不动**。用户意图（envSource==="custom"）完整保留，加载文件后自动生效。
   */
  private buildCustomHdrTex(): THREE.Texture | null {
    // 通路判定只看 envSource。兼容旧存档：只有 envPreset==="custom" 而无 envSource 键时
    // 由 normalizeEnvLegacyState 迁移补写 envSource，故此处无需再兼容 preset 信号。
    if (envState.envSource !== "custom") return null;
    if (this.customHdrTex) return this.customHdrTex;
    if (!this.customHdrWarnedMissing) {
      this.customHdrWarnedMissing = true;
      ringLog(
        "env",
        "来源为「自定义 HDR」但尚未加载文件，暂以预设渲染。请点击「选择 HDR 文件」加载 .hdr。",
        "warn",
        () =>
          console.warn("[EnvironmentCapability] envSource=custom 但无 HDR 缓存，暂回落预设渲染"),
      );
    }
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
      // [ADR-292 D7] 所有权守卫：只 dispose **本 cap 自建**的源纹理。
      // 排除两类外来者（暗线 B 收口为 isEnvDisposableSource 单一事实源）——
      //   ① customHdrTex：本 cap 的长期缓存（由 disposeCustomCache 释放，此处不得动）
      //   ② envSource="sky" 时来自 SkyCapability 的烘焙纹理：归 sky 所有（其 renderTarget
      //      持有），本 cap 若在此 dispose 会把 sky 的 renderTarget 纹理释放掉，
      //      导致天空 IBL 与后续烘焙出现「纹理已释放」类故障。
      if (
        isEnvDisposableSource(srcTex, {
          customHdrTex: this.customHdrTex,
          skySourcedTex: this.skySourcedTex,
        }) &&
        this.backgroundSrcTex !== srcTex
      ) {
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

  /**
   * [ADR-292 D7 + 锐评补全 2026-09-21] 向 SkyCapability 取一张烘焙好的天空 IBL 纹理。
   *
   * 所有权契约（D1/D2）：env 是 `scene.environment` 唯一写者；sky 只「烤」不「装」。
   * 失败/缺查询器的**每条路径都返回 null**，由调用方安全降级到预设路径——
   * 独立预览（无组合根注入 caps）不得因缺 sky 而崩。
   *
   * ⚠️ 返回的是 **PMREM 预滤波产物**（cubeUV 图集，`renderTarget.texture`），
   * 归 sky 所有（其 renderTarget 持有），本 cap **不得 dispose、更不得二次滤波**
   * ——把它喂给 `fromEquirectangular` 会把 cubeUV 图集按等距柱状采样重烤一遍，
   * 光照静默错乱（D-3 修复：sky 分支改为直装，见 buildEnvironment 前置分派）。
   *
   * @param force 透传给 sky 的阈值门控：离散结构性变更 true；昼夜循环等连续动画
   *   false——sky 未 dirty 时原样交回**同一纹理引用**，供 buildEnvironment 短路整轮重建（D-5）。
   */
  private buildSkyEnvTex(force = true): THREE.Texture | null {
    try {
      const sky = getTypedCap(this.caps, "sky");
      if (!sky?.bakeEnvironmentTexture) {
        this.skySourcedTex = null;
        return null;
      }
      const tex = sky.bakeEnvironmentTexture({ force }) ?? null;
      this.skySourcedTex = tex;
      return tex;
    } catch (e) {
      ringLog("env", `envSource=sky 取天空烘焙纹理失败，回退预设: ${e}`, "warn");
      this.skySourcedTex = null;
      return null;
    }
  }

  /**
   * @param skyForce 仅作用于「跟随天空」通路向 sky 取图时的阈值门控透传（D-5）：
   *   结构性变更（来源/预设/分辨率/装载开关/存档恢复）默认 true 拿当前帧的图；
   *   连续动画（昼夜循环经 refreshFromSkySource(false)）传 false，
   *   sky 未 dirty 交回同一纹理引用时本轮**整轮重建短路**，env 侧不再每帧全量重建。
   */
  private buildEnvironment(skyForce = true): void {
    if (this.isBuilding) return;
    this.isBuilding = true; // 取图即置位：buildSkyEnvTex 内部触发的同步派发须同样被 isBuilding 短路（对齐旧序）
    try {
      // [D-5] 同引用短路须**先捕获旧纹理引用**：buildSkyEnvTex 会把 this.skySourcedTex
      // 覆盖为新返回值，拿覆盖后的字段比「变没变」是循环自证，必须用覆盖前的引用对比。
      const prevSkyTex = this.skySourcedTex;
      // [D-3/D-5] 「跟随天空」前置分派：sky 产物已滤波，直装槽位；同引用未换 → 免整轮重建。
      if (envState.envEnabled && envState.envSource === "sky") {
        const skyTex = this.buildSkyEnvTex(skyForce);
        if (skyTex) {
          if (skyTex === prevSkyTex && this.scene.environment === skyTex) return;
          // [复审 D] 传覆盖前旧引用：skySourcedTex 此刻已被覆盖为新图，
          // 旧图若还挂在背景槽须并入排除集
          this.disposeEnvironment(prevSkyTex);
          this.skySourcedTex = skyTex;
          this.scene.environment = skyTex; // env 仍是槽位唯一写者（D1 红线）
          // cubeUV 图集不是合法的 background 源（天空视觉由 sky 的穹顶 mesh 本身承担）；
          // applyBackground(null) 同时清理旧背景纹理引用。
          this.applyBackground(null);
          return;
        }
        // 取不到（无 sky cap / 烘焙失败）→ 落到下方预设路径（不黑场景）。
      }
      // [复审 D] sky 取图失败（skySourcedTex 已被 buildSkyEnvTex 置 null）时，
      // 旧 sky 纹理同样须并入排除集——统一传覆盖前引用，两分支一个口径。
      this.disposeEnvironment(prevSkyTex);
      if (!envState.envEnabled) {
        this.scene.environment = this.prevEnvironment;
        this.applyBackground(null);
        return;
      }
      let srcTex: THREE.Texture | null = null;
      // [ADR-292 D7] 按 envSource 分派取图通路：preset / sky / custom（三者互斥）
      switch (envState.envSource) {
        case "sky":
          // 本分支仅在上方前置取图失败（返回 null）时到达 → 直接落预设兜底。
          break;
        case "custom":
          srcTex = this.buildCustomHdrTex();
          break;
        default:
          break; // "preset" → 下方 buildPresetEquirectTex
      }
      // 回落预设：custom/sky 通路取不到图（无文件/无查询器/烘焙失败）时一律回落，
      // 保证 scene.environment 始终有一张可用贴图（不出现「来源选了却没光」的黑场景）。
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

  /**
   * @param extraExclude 复审 D 收口：sky 直装分支里 buildSkyEnvTex 已把 this.skySourcedTex
   *   覆盖为**新**图，此刻若背景槽还挂着**旧** sky 图（今日不可达——sky 分支恒不挂背景；
   *   守卫防未来回潮），单比对现值会放行误 dispose。调用方把覆盖前捕获的旧引用传进来并入排除集。
   */
  private disposeEnvironment(extraExclude?: THREE.Texture | null): void {
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    this.envTexture = null;
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
    // backgroundSrcTex 清理：ownership 纯判定收口（暗线 B）。
    // 不等于 customHdrTex / skySourcedTex / extraExclude 才 dispose
    //（sky 纹理归 sky 所有，D-4 守卫：旧代码只排除 customHdrTex，
    // envSource=sky + useAsBackground 时代背景挂过 sky 图，切通路即误释 sky 的 GPU 资源）
    if (
      this.backgroundSrcTex &&
      isEnvDisposableSource(this.backgroundSrcTex, {
        customHdrTex: this.customHdrTex,
        skySourcedTex: this.skySourcedTex,
        extraExclude,
      })
    ) {
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

  /**
   * [锐评 F-1 收口] 能力启停 === 环境贴图总开关，真值源唯一 envState.envEnabled。
   *
   * 原实现是私有 `this.enabled` + 直接 buildEnvironment()——与 schema 键各说各话
   * （本键当时根本不存在），存档只能靠同款私有无前缀 `enabled` 方言续命，
   * 而迁移模块的判据①又依赖那枚方言键的 false 语义（跨代承重，见 loadState 回填）。
   * 现 setEnvState 同步 dispatch → 本 cap 回调的 `changed.has("envEnabled")` 分支
   * 统一 build/还原 + light 通知 + notify，写口不再自备副作用
   * （对齐 fog/shadow/water/reflector/sky 范式）。
   */
  setEnabled(v: boolean): void {
    setEnvState({ envEnabled: v }, { source: "manual" });
  }

  /** [锐评 F-1 收口] 读 envState.envEnabled——不再是私有门。 */
  isEnabled(): boolean {
    return envState.envEnabled;
  }

  /** [ADR-293 收口 2026-10] 参数变更订阅（菜单局部刷新）：仅离散键变更 notify（对齐 fog/water）。 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }

  /**
   * [ADR-292 D1] 本 cap 当前是否为 `scene.environment` 的「跟随天空」装载者。
   * sky 用它决定「自己装载」还是「转交 env」——避免两个 cap 争抢槽位。
   */
  isSkySourced(): boolean {
    return envState.envEnabled && envState.envSource === "sky";
  }

  /**
   * [ADR-292 D1] 天空参数变化后由 sky 调用：重新取图并装载。
   * 仅「跟随天空」通路有意义（envSource≠"sky" 时天空变化与槽位内容无关，早退——
   * 正是 D-1 红线的语义：槽位属 env，但 sky 事件不驱动预设通路重建）。
   *
   * @param force 阈值门控透传（D-5）：离散动作 true（缺省，拿当前帧的图）；
   *   昼夜循环等连续动画 false——天空未 dirty 时同引用短路，整轮免重建。
   */
  refreshFromSkySource(force = true): void {
    if (!this.isSkySourced()) return;
    this.buildEnvironment(force);
  }

  /** [ADR-292 D3] 当前供图来源（来源选择控件读值） */
  getSource(): EnvSource {
    return envState.envSource;
  }

  /**
   * [ADR-292 D3] 切换供图来源。
   *
   * **只写 `envSource` 一个键**——通路选择与「预设选哪张图」是正交的两件事。
   * 旧设计让本方法同时写 `envPreset:"custom"`，与 buildCustomHdrTex 的回退写
   * `envPreset:"studio"` 互相打架，导致来源与预设分裂、e2e 无法断言单一真值。
   * 现 `envPreset` 保留原值不动（切回预设通路时免丢用户此前选择）。
   */
  setSource(src: EnvSource): void {
    setEnvState({ envSource: src }, { source: "manual" });
  }

  /**
   * [R-1 收口 2026-09-22] 按模型类别套用环境预设；**有存档则让位**（对齐 shadow/reflector
   * isStateLoaded 守卫）。装配序 loadAll→applyModelDefaults 且 MODEL_DEFAULTS 各模型均携
   * envPreset/envIntensity——E-2 后恢复走 auto-model，同轨 auto-model→auto-model 被放行，
   * 无守卫则每次挂载存档预设被 studio 顶掉（探针实证：night 存档 → mmd 套回 studio）。
   */
  applyModelPreset(modelType: ModelType): void {
    if (this.isStateLoaded) return;
    // [锐评 2026-10-07 死键清收] envResolution / envUseAsBackground 曾是请求键，但 MODEL_DEFAULTS
    // 从不写这两键（分辨率/背景归属用户偏好，非模型类别离散值）——死键，删除请求。
    const picked = pickModelDefaultFields(modelType, ["envPreset", "envIntensity"]);
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
      // [锐评 F-1 收口] 能力总开关改落 **schema 键形** `envEnabled`，不再落无前缀
      // `enabled` 幽灵键（私有门已退役，键与门不再各说各话）。兄弟键保持原无前缀方言
      // 零迁移——`preset`/`intensity`/`useAsBackground` 另有跨代读者（迁移模块与本文件
      // loadState 的旧档分支），改名即断链。同族先例：reflector 亦仅前缀总开关、兄弟键不动。
      envEnabled: envState.envEnabled,
      preset: savePreset,
      // [ADR-292 D7] envSource 是「谁供 scene.environment」的单一事实源（preset/sky/custom），
      // 必须落盘——否则用户选 sky/custom 取图通路重启即丢，回退默认 preset 画面突变。
      // 键名与迁移模块 normalizeEnvLegacyState 产出的 envSource 同形（旧存档迁移后也归此键），
      // 保证 idempotent 快路（"envSource" in state）命中、不重复迁移。
      envSource: envState.envSource,
      intensity: envState.envIntensity,
      resolution: envState.envResolution,
      useAsBackground: envState.envUseAsBackground,
    });
  }

  loadState(): void {
    const raw = restoreState(this.id);
    if (!raw) return;

    // [锐评 F-1 收口] legacy 键形回填（fog/water/shadow/reflector 先例同法）：
    // 收口前 saveState 落的是**无前缀** `enabled`（私有门态）。回填判「前缀键缺失 ∧
    // 旧键类型合法」——防 undefined 覆盖混合形态的新键。
    // ⚠️ 这条回填是**跨代承重**而非礼貌兼容：下方 migrateEnvSource 判据①读 `envEnabled`
    // 的 false 语义（ADR-292「env 关 + sky IBL 开 → 迁 sky」是保画面不变的唯一强信号）。
    // 不回填则升级用户的 false 永久失传：判据①恒不成立 → envSource 落回 "preset"，
    // 画面从「天空 IBL」静默掉回「env 预设」——正是迁移总纲要防的突变。
    let withLegacy: Record<string, unknown> = raw;
    if (!("envEnabled" in raw) && typeof raw.enabled === "boolean") {
      withLegacy = { ...raw, envEnabled: raw.enabled };
    }

    // [ADR-292 D7] 旧存档（无 envSource 键）归一：按 migrateEnvSource 三条判据补写 envSource。
    // 已含 envSource 则幂等返回同引用（零拷贝）。
    // 与 ground-capability.loadState 同口径——否则 ADR-292 的 legacy 迁移纯函数（已带测试）
    // 永不被生产代码调用，旧存档落到「envSource 缺省 = preset」的伪默认。
    // 读值优先取回填后的 `envEnabled`（新键存在时即新键），旧档才回落到无前缀 `enabled`——
    // 混合形态存档认新键，防「迁移一次又回退一次」把用户手改静默吞掉。
    // [cross-slot 解耦 2026-10-07] 判据①供血线（sky IBL 开关）改读 envState.skyEnvironment
    // 单一事实源，不再跨槽读 sky 的 localStorage 槽：生产时序 registry.loadAll 按注册序
    // 串行（sky 先于 environment，scene-capability-registry.ts:187-190），sky.loadState
    // 已把 sky 存档的 environment 恢复进 envState.skyEnvironment（sky-capability.ts:714/928
    // 持久化同源）——读值与旧跨槽读等价，且 env 不再耦合 sky 的存档键形（sky 将来改
    // saveState 键名/键形，env 的判据①不再静默断链）。
    // ⚠️ 语义边界（独立 loadState，非 loadAll 编排）：sky 未先行 load 时
    // envState.skyEnvironment 为 schema 默认（true，env-state-schema.ts:100）而非 sky 存档
    // 原值——「sky 未 load」不被认作「sky IBL 关」。生产路径 loadAll 顺序串行无此窗口；
    // 单测直接调 env.loadState 时须以 setEnvState({ skyEnvironment }) 显式模拟 sky 已 load。
    const state = normalizeEnvLegacyState(withLegacy, {
      preset: withLegacy.preset,
      skyEnvironment: envState.skyEnvironment,
      envEnabled: withLegacy.envEnabled ?? withLegacy.enabled,
    });

    // 收集 envState 恢复值
    const partial: Partial<EnvState> = {};
    /** custom 通路读回但无 HDR 缓存 → 需在最后统一回落到 preset（含 envSource） */
    let customWithoutCache = false;

    // [锐评 F-1 收口] 能力总开关恢复：原为「不入 envState，直接写私有门」，现经 partial
    // 随其余 env 组键一次性 setEnvState（auto-model 源，与下方恢复块同口径）。
    if (typeof state.envEnabled === "boolean") partial.envEnabled = state.envEnabled;

    if (typeof state.preset === "string") {
      const p = state.preset as EnvPresetId;
      if (p === "custom") {
        if (!this.customHdrTex) {
          // 持久化读回 custom 但没缓存 → 告警一次，实际回落留到下方统一裁决（见 customWithoutCache）
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
          customWithoutCache = true;
        } else {
          partial.envPreset = "custom";
          partial.envSource = "custom";
        }
      } else if (ENV_PRESETS[p as SelectableEnvPresetId]) {
        partial.envPreset = p;
      }
    }

    if (typeof state.intensity === "number") partial.envIntensity = state.intensity;
    if (typeof state.resolution === "number") partial.envResolution = state.resolution;
    if (typeof state.useAsBackground === "boolean")
      partial.envUseAsBackground = state.useAsBackground;

    // [ADR-292 D7] D2：envSource 持久化读回（preset/sky/custom）。缺省（极旧存档未走迁移）
    // → 跳过，交由下方 buildEnvironment 按默认 "preset" 路径走。
    if (typeof state.envSource === "string")
      partial.envSource = state.envSource as EnvState["envSource"];

    // [ADR-292 D5 收尾] custom 回退必须**最后**裁决，优先级高于上面的读回与迁移结果。
    // 原因：HDR 文件内容不入 localStorage，所以任何存档里的 custom 通路跨会话都无图可用；
    // 而 normalizeEnvLegacyState 会按 preset==="custom" 迁移出 envSource==="custom"，
    // 若不在此处压掉，就会出现「来源显示自定义 HDR、实际渲染 studio」的两键分裂。
    // 放在读回之后 = 让「无缓存」这一运行时事实成为最终裁决者。
    if (customWithoutCache) {
      partial.envPreset = "studio";
      partial.envSource = "preset";
    }

    if (Object.keys(partial).length > 0) {
      // [锐评 E-2 / D1] 存档恢复是**程序化动作**，非用户手改——与 fog/ground loadState 同口径：
      // 用 auto-model 而非 manual。原 manual 会把 env 组 4 键 lastWriteSource 全打成 manual，
      // 此后 auto-atmosphere 氛围预设写 envPreset/envIntensity 一律被 shouldOverwrite 拒绝
      // （用户选 sunset 氛围，环境贴图却不跟着换）。同时挂起派发，恢复期间只写 envState，
      // 末尾 buildEnvironment 统一落地一次（避免逐键 dispatch × 逐键 rebuild 的重入抖动）。
      withEnvCallbacksSuspended(() => {
        setEnvState(partial, { source: "auto-model" });
      });
    }

    // [R-1] 有存档 = 模型默认值让位（对齐 shadow/reflector/fog）——置位须在恢复写之后、
    // build 之前；无存档的早退路径（上方 `if (!raw) return`）不置位，模型预设照常套用。
    this.isStateLoaded = true;

    // 恢复后显式 build（callback 可能因值未变而跳过，确保初始状态正确）
    this.buildEnvironment();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildEnvironment();
  }

  dispose(): void {
    this.unsubscribeEnv();
    // [锐评 E-4 + D-3 补全 2026-09-21] 还原前做 **ownership 守卫**（对齐 sky-capability.dispose 的对称实现）：
    // scene.environment / scene.background 是**多 cap 共享的全局槽位**——sky 的 IBL
    // PMREM 也会写 scene.environment。原实现无条件还原 prevEnvironment，若 sky 在本
    // cap 之后写过 environment（构造序：env → sky），env.dispose 会把 sky 的贴图冲掉，
    // 呈现「关掉环境贴图，天空 IBL 也黑了」。仅当槽位仍归本 cap 所有（自建贴图 /
    // 已被子路径置 null / **sky 源直装交回 sky 处置**）才还原。
    // 直装态（D-3）下槽位挂的是 sky 的烘焙纹理，本 cap 不拥有它：不主动清则本 cap
    // 死后槽位悬空指向 sky 的 renderTarget 纹理，全靠 registry 反序 dispose 里
    // sky 恰好随后收拾——所有权收口的意义就是路径自洽，不赌 dispose 顺序。
    // sky 侧 dispose 守卫见 slot ≠ owned 即不动，两序皆收敛到 prevEnvironment。
    // 守卫 = environment-capability.test.ts「dispose 顺序收敛」两例（A 序 env 先离场自行还原 /
    // B 序 sky 先离场后 env 不得二次还原与二次释放；两例均经变异实证）。
    // [暗线 B 收口] 占有权判定下沉 envOwnsSceneEnvironment 纯函数（与 3 处 isEnvDisposableSource 同文件）；
    // env 享还原权的纹理：本 cap 自建 PMREM 产物 + sky 直装交回纹理（D-3 直装独占，env 离场即还原）。
    if (envOwnsSceneEnvironment(this.scene.environment, [this.envTexture, this.skySourcedTex])) {
      this.scene.environment = this.prevEnvironment;
    }
    // background 同理（同槽位无他人竞写，但保持与 environment 同构，防未来多 cap 接入）
    const ownedBg = this.backgroundSrcTex;
    if (this.scene.background === null || this.scene.background === ownedBg) {
      this.scene.background = this.prevBackground;
    }
    this.disposeEnvironment();
    this.disposeCustomCache();
    // [锐评 2026-10-08 P1-1] 会话级字段必须复位——与 PostprocessingCapability.dispose 同款。
    // `sceneCapabilityRegistry.createAll` 有「同宿主 scene/renderer/camera 三引用全等
    // ⇒ 复用实例」短路（scene-capability-registry.ts|createAll），复用**不 dispose**，
    // 实例连同 `isStateLoaded=true` 原样留存 ⇒ `applyModelPreset` 的「有存档则让位」守卫
    // 永久挡下本会话的模型类别默认（换 YSM/VRM/MMD 都不再改变环境预设），且**无任何报错**。
    // 历史病灶：postprocessing 早已修复并留测试，本 cap 同族同病未治（同病半治）。
    this.isStateLoaded = false;
  }
}
