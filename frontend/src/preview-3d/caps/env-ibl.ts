// ===== 环境·IBL 资产管线（ADR-091-d1 拆分，从 environment-capability.ts 下沉）=====
// 承载 PMREM 预滤波、三通路取图（preset/sky/custom）、背景槽管理、dispose 顺序收敛。
// cap 本体退化为「状态→应用编排壳」，本类是**真实渲染管线**。
//
// 严格遵循 Three 标准 envMap 管线（经验 ID 433477 硬教训）：
//   1a) 程序化 Canvas 2D → Equirectangular 纹理（EquirectangularReflectionMapping 必设置）
//   1b) 或 RGBELoader 解码用户 HDR → DataTexture（Linear-sRGB → SRGBColorSpace 转换交给 PMREM）
//   2) PMREMGenerator.fromEquirectangular() 预滤波生成 scene.environment
//   3) 同步：mesh.material.envMapIntensity 统一调整（仅支持 MeshStandard/Physical/ToonMaterial）
//   4) dispose 时 dispose PMREM 产物、custom HDR 缓存（经 EnvHdrCache）、并还原 scene.environment

import * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import type { EnvHdrCache } from "./env-hdr-cache.ts";
import { drawEnvEquirect, luminanceHistogram } from "./env-pixels.ts";
import { envOwnsSceneEnvironment, isEnvDisposableSource } from "./environment-ownership.ts";
import { ENV_PRESETS, type SelectableEnvPresetId } from "./environment-state.ts";
import { getTypedCap, ringLog, type SceneCapabilityLookup } from "./scene-capability.ts";

/** 本管线构造入参（cap 注入组合根依赖；hdr 是 cap 持有的缓存容器，本类只读其 tex） */
export interface EnvIblHost {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hdr: EnvHdrCache;
  /** [ADR-292 D7] cap 间协调查询器——envSource="sky" 时经此向 sky 取烘焙纹理（可显式传 undefined） */
  caps?: SceneCapabilityLookup | undefined;
}

export class EnvIbl {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly hdr: EnvHdrCache;
  private readonly caps?: SceneCapabilityLookup;

  /** PMREMGenerator 生产 WebGLRenderTarget，需 dispose */
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** 当前挂载到 scene.environment 的预滤波贴图 */
  private envTexture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  /** 构造前的 scene.environment（dispose 时还原） */
  private prevEnvironment: THREE.Texture | null;
  /** 构造前的 scene.background（dispose 时还原） */
  private prevBackground: THREE.Texture | THREE.Color | null;
  /** 当前用作 scene.background 的源纹理（非 PMREM 版），useAsBackground=true 时赋值，下次 build 先 dispose */
  private backgroundSrcTex: THREE.Texture | null = null;
  /**
   * [ADR-292 D7] 最近一次经 envSource="sky" 从 SkyCapability 取回的烘焙纹理。
   * 仅用于所有权守卫（不得 dispose 别人的纹理）；本管线不持有其生命周期，dispose 路径一律不碰它。
   */
  private skySourcedTex: THREE.Texture | null = null;
  /** 防递归标记：build 内部 setEnvState 触发回调时跳过 */
  private isBuilding = false;

  constructor(host: EnvIblHost) {
    this.scene = host.scene;
    this.renderer = host.renderer;
    this.hdr = host.hdr;
    if (host.caps !== undefined) this.caps = host.caps;
    this.prevEnvironment = this.scene.environment;
    this.prevBackground = (this.scene.background as THREE.Texture | THREE.Color | null) ?? null;
  }

  /**
   * 把 backgroundSrcTex 或 程序化 CanvasTexture 挂到 scene.background（useAsBackground=true 时）；
   * useAsBackground=false 或 enabled=false：还原 prevBackground（若 prevBackground 是 Color 对象保留实例，Texture 保留引用，不 dispose prev）
   */
  private applyBackground(srcTex: THREE.Texture | null): void {
    // 先清旧的 backgroundSrcTex：是否可 dispose 由 ownership 纯判定收口
    // （customHdrTex/skySourcedTex 各有专属释放路径或归他人所有，暗线 B）
    if (
      this.backgroundSrcTex &&
      isEnvDisposableSource(this.backgroundSrcTex, {
        customHdrTex: this.hdr.tex,
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
    if (this.hdr.tex) return this.hdr.tex;
    if (!this.hdr.warnedMissing) {
      this.hdr.warnedMissing = true;
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
      // [ADR-292 D7] 所有权守卫：只 dispose **本管线自建**的源纹理。
      // 排除两类外来者（暗线 B 收口为 isEnvDisposableSource 单一事实源）——
      //   ① customHdrTex：本 cap 的长期缓存（由 EnvHdrCache.dispose 释放，此处不得动）
      //   ② envSource="sky" 时来自 SkyCapability 的烘焙纹理：归 sky 所有（其 renderTarget
      //      持有），本 cap 若在此 dispose 会把 sky 的 renderTarget 纹理释放掉，
      //      导致天空 IBL 与后续烘焙出现「纹理已释放」类故障。
      if (
        isEnvDisposableSource(srcTex, {
          customHdrTex: this.hdr.tex,
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
   * 主装配入口：按 envState 全量重写 scene.environment（取图通路/分辨率/背景一并跟上）。
   *
   * @param skyForce 仅作用于「跟随天空」通路向 sky 取图时的阈值门控透传（D-5）：
   *   结构性变更（来源/预设/分辨率/装载开关/存档恢复）默认 true 拿当前帧的图；
   *   连续动画（昼夜循环经 refreshFromSkySource(false)）传 false，
   *   sky 未 dirty 交回同一纹理引用时本轮**整轮重建短路**，env 侧不再每帧全量重建。
   */
  build(skyForce = true): void {
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

  /** 计算当前环境贴图的 16-bin 亮度直方图。
   *  数据源：customHdrTex（custom HDR 分支）或 backgroundSrcTex 的 canvas（程序化预设）。
   *  返回 number[16]；无数据源时返回全 0 数组。像素运算下沉 env-pixels.ts#luminanceHistogram。 */
  getLuminanceHistogram(): number[] {
    return luminanceHistogram(this.hdr.tex, this.backgroundSrcTex);
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
        customHdrTex: this.hdr.tex,
        skySourcedTex: this.skySourcedTex,
        extraExclude,
      })
    ) {
      this.backgroundSrcTex.dispose();
    }
    this.backgroundSrcTex = null;
  }

  /**
   * 完整释放：还原 scene.environment / scene.background 两槽位（所有权收敛）+ 释放 PMREM 管线。
   *
   * scene.environment / scene.background 是**多 cap 共享的全局槽位**——sky 的 IBL
   * PMREM 也会写 scene.environment。原实现无条件还原 prevEnvironment，若 sky 在本
   * cap 之后写过 environment（构造序：env → sky），env.dispose 会把 sky 的贴图冲掉，
   * 呈现「关掉环境贴图，天空 IBL 也黑了」。仅当槽位仍归本 cap 所有（自建贴图 /
   * 已被子路径置 null / **sky 源直装交回 sky 处置**）才还原。
   * 守卫 = environment-capability.test.ts「dispose 顺序收敛」两例（变异实证）。
   * 不 dispose custom HDR 缓存（归 EnvHdrCache，cap 侧调 hdr.dispose）。
   */
  dispose(): void {
    if (envOwnsSceneEnvironment(this.scene.environment, [this.envTexture, this.skySourcedTex])) {
      this.scene.environment = this.prevEnvironment;
    }
    if (
      envOwnsSceneEnvironment(this.scene.background as THREE.Texture | null, [
        this.backgroundSrcTex,
      ])
    ) {
      this.scene.background = this.prevBackground;
    }
    this.disposeEnvironment();
  }
}
