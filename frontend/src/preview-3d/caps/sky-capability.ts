// ===== 程序化天空能力（ADR-073 L1 首个落地能力）=====
// 复用 Three 官方 Sky（Preetham 大气散射，three/addons/objects/Sky.js），
// 禁止自写大气散射 shader（ADR-073 红线）。
// 本类仅做「接入 scene + uniform 管线 + 可选 IBL 环境联动」的薄封装，
// 后续 bloom/DOF/ground 等能力一律复用同一套路（核心 + 薄封装 + 注册表）。
//
// 设计要点：
// - Sky 材质 side=BackSide 且顶点 z 强制 far，故相机须始终位于天空盒内部：
//   天空盒半边长须 > 相机 maxDistance。预览核心 maxDistance=5000 → scale 默认 12000。
// - 天空依赖 tone mapping 才正确显色；本能力在 apply() 内为本次会话 renderer
//   设置 ACESFilmic + exposure，dispose() 时还原，作用域不泄漏到其它预览。
// - IBL 环境联动（scene.environment）默认开启（2026-08-16 目视验证通过，模型反射/环境光更真实）；
//   如需关闭调用 setEnvironmentEnabled(false)。
// - 实现 SceneCapability 统一接口，支持注册表自动发现 + 菜单控件 + 持久化。
// - God Rays（体积光束，ADR-107）：日出日落时从太阳方向向下投射的半透明光束。

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import type { SkyModelType } from "./sky-state.ts";
import { MODEL_SKY_PRESETS } from "./sky-state.ts";

export type { SkyModelType };
export { MODEL_SKY_PRESETS };

import type { PreviewMenuNode } from "../menu-node-types.ts";
import { disposeObject3D } from "../safe-dispose.ts";
import { registerEnvCallback } from "../state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "../state/env-state.ts";
import type { EnvState } from "../state/env-state-schema.ts";
import { ENV_PRESETS } from "./environment-capability.ts";
import {
  persistState,
  restoreFields,
  restoreState,
  ringLog,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";
import { buildSkyNodes } from "./sky-menu.ts";

/**
 * §4 解耦：给官方 Preetham Sky.js 的 ShaderMaterial 最小化注入两个 uniform，
 * 把「天空底色 × 太阳强度」和「太阳盘白光强度」从硬编码改为可配置尺度。
 * ——不替换 shader 主体（仍为 Preetham 物理模型），仅追加 uniforms 声明 + 两处乘法。
 * 🔗 ADR-073：仍为 Preetham，未自写三色渐变，合规。
 *
 * 🔎 需要 patch 的两处硬编码（来自 three/examples/jsm/objects/Sky.js SkyShader.fragmentShader）：
 *   ① L261:  `pow( vSunE * ((betaRTheta...) * (1.0-Fex) ), vec3(1.5))` → 把 vSunE 前乘 sunIntensityScale
 *        →  `pow( (vSunE * sunIntensityScale) * ((betaRTheta...) * (1.0-Fex) ), vec3(1.5))`
 *   ② L272:  `(vSunE * 19000.0 * Fex) * sundisc;` → 在 19000 后插入 sunDiscScale
 *        →  `(vSunE * 19000.0 * sunDiscScale * Fex) * sundisc;`
 *
 * ⚡ 幂等：重复调用不会重复注入。未注入过时才做 shader 替换并置 needsUpdate=true。
 *
 * @param defaults 默认值通常是 envState.skySunIntensityScale / envState.skySunDiscScale，
 *                 之后通过 uniforms.value 再同步运行时参数。
 */
export function injectSkySunScalePatch(
  mat: THREE.ShaderMaterial,
  defaults: { sunIntensityScale: number; sunDiscScale: number } = {
    sunIntensityScale: envState.skySunIntensityScale,
    sunDiscScale: envState.skySunDiscScale,
  },
): void {
  // 分字段幂等守卫（审计①：原「双字段整体短路」有半残缺口——uniform 已注册但乘法
  // 缺失时误判已注入 → 永不补全，静默半残）。现按字段各自校验：字段视为已注入
  // 仅当「uniform 存在 且 shader 已含对应乘法」。半残状态（uniform 在、乘法缺）下次
  // 调用自动补全乘法层；锚点彻底失配时 ringLog 留痕（消除静默失效缝隙）。
  const hasSunScaleUniform = mat.uniforms.sunIntensityScale !== undefined;
  const hasDiscScaleUniform = mat.uniforms.sunDiscScale !== undefined;
  const hasSunScaleUse = /vSunE\s*\*\s*sunIntensityScale/.test(mat.fragmentShader);
  const hasDiscScaleUse = /19000\.0\s*\*\s*sunDiscScale/.test(mat.fragmentShader);
  if (hasSunScaleUniform && hasDiscScaleUniform && hasSunScaleUse && hasDiscScaleUse) {
    // 完全注入 → 只确保默认值同步到 uniforms（不改 shader，避免重编译）
    mat.uniforms.sunIntensityScale.value = defaults.sunIntensityScale;
    mat.uniforms.sunDiscScale.value = defaults.sunDiscScale;
    return;
  }

  // ① 追加 uniforms（对象层先注册，即使后续 shader 替换失败也不 crash 运行时）
  if (!hasSunScaleUniform) mat.uniforms.sunIntensityScale = { value: defaults.sunIntensityScale };
  if (!hasDiscScaleUniform) mat.uniforms.sunDiscScale = { value: defaults.sunDiscScale };

  // ② patch fragmentShader：按"声明必须先于使用"的 GLSL 顺序三层独立幂等替换。
  //    每一层都做 contains 判断，避免重复替换。如果声明层未匹配，就跳过使用层（防未声明编译报错）
  let patched = false;

  // 2a) uniform 声明：在 "uniform float showSunDisc;\nuniform float time;" 之后追加成两行新声明
  const hasDecl = /uniform\s+float\s+sunIntensityScale\s*;/.test(mat.fragmentShader);
  if (!hasDecl) {
    const before = mat.fragmentShader;
    const uniformDeclInjection =
      "\nuniform float sunIntensityScale;\nuniform float sunDiscScale;\n";
    mat.fragmentShader = mat.fragmentShader.replace(
      /(uniform\s+float\s+showSunDisc\s*;\s*\n\s*uniform\s+float\s+time\s*;)/,
      `$1${uniformDeclInjection}`,
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      // regex 未匹配（Three 未来版本可能调整 uniforms 顺序），做全局兜底：在最后一个 uniform 声明后加
      // 取 "// Cloud noise functions" 之前最后一个 `uniform ...;` 的行尾追加
      const fallbackIdx = mat.fragmentShader.indexOf("float hash( vec2 p )");
      if (fallbackIdx > 0) {
        mat.fragmentShader =
          mat.fragmentShader.slice(0, fallbackIdx) +
          "uniform float sunIntensityScale;\nuniform float sunDiscScale;\n" +
          mat.fragmentShader.slice(fallbackIdx);
        patched = true;
      } else {
        ringLog(
          "sky",
          "injectSkySunScalePatch 无法注入声明，跳过 shader patch。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
          "error",
        );
        // 声明失败 → 不再继续使用层的替换，防 GLSL 编译错
        return;
      }
    }
  }

  // 2b) 解耦点 ①：pow( vSunE * (  →  pow( (vSunE * sunIntensityScale) * (
  if (!hasSunScaleUse) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "pow( vSunE * (",
      "pow( (vSunE * sunIntensityScale) * (",
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      // 本层需补但锚点失配（无论 uniform 已注册与否——半残修复同样可能被外部破坏
      // 挡住）→ ringLog 留痕，消除「静默半残」失效缝隙
      ringLog(
        "sky",
        "injectSkySunScalePatch 解耦点①（vSunE 缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
        "error",
      );
    }
  }

  // 2c) 解耦点 ②：19000.0 * Fex → 19000.0 * sunDiscScale * Fex
  if (!hasDiscScaleUse) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "19000.0 * Fex",
      "19000.0 * sunDiscScale * Fex",
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      ringLog(
        "sky",
        "injectSkySunScalePatch 解耦点②（太阳盘缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
        "error",
      );
    }
  }

  // ③ 有改动才触发重编译
  if (patched) mat.needsUpdate = true;
}

export class SkyCapability implements SceneCapability {
  readonly id = "sky";
  readonly labelKey = "preview.sky";
  readonly icon = "🌤️";
  readonly descKey = "preview.skyDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private caps?: SceneCapabilityLookup;
  /** PMREMGenerator 延迟创建（构造函数不依赖 WebGL，node 测试友好） */
  private pmrem: THREE.PMREMGenerator | null = null;
  private sky: Sky;
  private envScene: THREE.Scene;
  private envSky: Sky;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private enabled: boolean;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;
  /** 本实例是否已向 toneRefCount 贡献过引用（apply 幂等标记——防重复 apply 抬高计数；
   *  从未贡献的实例 dispose 不得拆共享 tone 状态，见 dispose/apply 注释） */
  private toneApplied = false;
  private prevToneMapping: THREE.ToneMapping;
  private prevExposure: number;
  /** 构造前 scene.environment 的快照——dispose 时还原，detach 不触碰（用户可能再启用） */
  private prevEnvironment: THREE.Texture | THREE.CubeTexture | null;
  /** 引用计数：多个 SkyCapability 共享同一 renderer 时，
   *  tone mapping 只在第一个 attach 时设置，只在最后一个 dispose 时恢复。
   *  WeakMap：cap 未 dispose 时不得阻碍 renderer 被 GC（锐评 P2）。 */
  private static toneRefCount = new WeakMap<THREE.WebGLRenderer, number>();
  private static prevToneMap = new WeakMap<THREE.WebGLRenderer, THREE.ToneMapping>();
  private static prevExposureMap = new WeakMap<THREE.WebGLRenderer, number>();
  /** God Rays（体积光束）*/
  private godRays: THREE.Group | null = null;
  private godRaysEnabled = false;
  private godRaysTime: { value: number };
  /** Sunset Tint Overlay（日落暖色渐变）*/
  private sunsetTintMesh: THREE.Mesh | null = null;
  /** ADR-196：运行时太阳位置（从 envState.skyTimeOfDay 推导） */
  private elevation = 0;
  private azimuth = 180;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
    /** cap 间协调查询器（组合根 createAll 注入）——环境开关变化通知 light 刷新 ambient */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    if (opts.caps !== undefined) this.caps = opts.caps;
    this.enabled = opts.enabled ?? true;
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevExposure = this.renderer.toneMappingExposure;
    this.prevEnvironment = this.scene.environment;
    // Sky 是 Mesh + ShaderMaterial，纯数据对象，构造函数不依赖 WebGL
    this.sky = this.createSky();
    this.envSky = this.createSky();
    // §4 解耦：只给主天空 this.sky 注入 sun scale 补丁，envSky（用于 IBL）保持原生 Preetham —
    // 这样 IBL 环境贴图的色调基准与物体反射保持物理正确，而主天空不再被 1000² 的太阳强度炸白。
    injectSkySunScalePatch(this.sky.material as THREE.ShaderMaterial, {
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    });
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky);
    // God Rays 初始化（默认禁用）
    this.godRaysTime = { value: 0 };
    this.createGodRays();
    // Sunset Tint 初始化
    this.createSunsetTintMesh();

    // ADR-196：初始化运行时太阳位置
    this.elevation = envState.skyElevation;
    this.azimuth = envState.skyAzimuth;

    // ADR-196：订阅 envState 变更
    this.unsubscribeEnv = registerEnvCallback(this, (changed, state) => {
      if (changed.has("skyTimeOfDay")) {
        this.syncSunFromTime();
        if (this.enabled) {
          this.writeUniforms(this.sky);
          this.writeUniforms(this.envSky);
          // PMREM 重建门控收敛于此（原散落在 setTime/update/setSun 双写）：
          //  - skyForceEnv=true（手动 setTime/setSun）→ 无条件重建（滑块/时间轴体验不降级）
          //  - skyForceEnv=false（昼夜循环 update）→ 太阳高度角变化 ≥ 阈值才重建（GPU 熔炉治理）
          if (state.skyEnvironment) {
            if (state.skyForceEnv) {
              this.regenerateEnvironment();
            } else {
              const el = this.elevation;
              const dirty =
                Math.abs(el - this.lastPmremElevation) >= SkyCapability.PMREM_ELEVATION_THRESHOLD;
              if (dirty) this.regenerateEnvironment();
            }
          }
        }
        this.updateGodRays();
        this.updateSunsetTint();
      }
      if (changed.has("skyElevation") || changed.has("skyAzimuth")) {
        if (this.enabled) {
          this.writeUniforms(this.sky);
          this.writeUniforms(this.envSky);
          if (state.skyEnvironment && state.skyForceEnv) {
            this.regenerateEnvironment();
          }
        }
      }
      if (changed.has("skyElevation")) {
        this.elevation = state.skyElevation;
      }
      if (changed.has("skyAzimuth")) {
        this.azimuth = state.skyAzimuth;
      }
      if (changed.has("skyCloudCoverage")) {
        if (this.enabled) {
          this.sky.material.uniforms.cloudCoverage.value = state.skyCloudCoverage;
          this.envSky.material.uniforms.cloudCoverage.value = state.skyCloudCoverage;
          // regenerate=true（setCloudCoverage 第二参）→ 云量影响环境烘焙，重刷 IBL
          if (state.skyForceEnv && state.skyEnvironment) this.regenerateEnvironment();
        }
      }
      if (changed.has("skyTurbidity")) {
        if (this.enabled) this.sky.material.uniforms.turbidity.value = state.skyTurbidity;
      }
      if (changed.has("skyRayleigh")) {
        if (this.enabled) this.sky.material.uniforms.rayleigh.value = state.skyRayleigh;
      }
      if (changed.has("skyMieCoefficient")) {
        if (this.enabled) this.sky.material.uniforms.mieCoefficient.value = state.skyMieCoefficient;
      }
      if (changed.has("skyMieDirectionalG")) {
        if (this.enabled)
          this.sky.material.uniforms.mieDirectionalG.value = state.skyMieDirectionalG;
      }
      if (changed.has("skySunIntensityScale")) {
        if (this.enabled) {
          const u = this.sky.material.uniforms;
          if (u.sunIntensityScale !== undefined)
            u.sunIntensityScale.value = state.skySunIntensityScale;
        }
      }
      if (changed.has("skySunDiscScale")) {
        if (this.enabled) {
          const u = this.sky.material.uniforms;
          if (u.sunDiscScale !== undefined) u.sunDiscScale.value = state.skySunDiscScale;
        }
      }
      if (changed.has("skyExposure")) {
        if (this.enabled) this.renderer.toneMappingExposure = state.skyExposure;
      }
      if (changed.has("skyEnvironment")) {
        if (this.enabled) {
          if (state.skyEnvironment) this.regenerateEnvironment();
          else this.clearEnvironment();
        }
      }
      if (changed.has("skyGodRaysEnabled")) {
        if (this.enabled) this.updateGodRays();
      }
      if (changed.has("skyAutoRotate")) {
        // autoRotate 仅影响 update(dt) 行为，无需立即响应
      }
    });
  }

  /** 确保 PMREMGenerator 已创建（延迟到首次需要时） */
  private ensurePMREM(): THREE.PMREMGenerator {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
    }
    return this.pmrem;
  }

  private createSky(): Sky {
    const sky = new Sky();
    sky.scale.setScalar(envState.skyScale);
    sky.material.uniforms.cloudCoverage.value = envState.skyCloudCoverage;
    return sky;
  }

  /** 应用天空到场景（背景 + 可选 IBL + tone mapping + god rays） */
  apply(): void {
    this.syncSunFromTime();
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (!this.enabled) {
      this.detach();
      return;
    }
    if (!this.sky.parent) this.scene.add(this.sky);
    // 天空依赖 tone mapping 显色；引用计数仲裁多 session 共享 renderer。
    // 幂等：本实例已贡献过就不再 +1（重复 apply（setEnabled 往返）不得抬高计数，
    // 否则 dispose 永远到不了 0，tone mapping 永不恢复）。
    if (!this.toneApplied) {
      const cnt = SkyCapability.toneRefCount.get(this.renderer) ?? 0;
      if (cnt === 0) {
        SkyCapability.prevToneMap.set(this.renderer, this.renderer.toneMapping);
        SkyCapability.prevExposureMap.set(this.renderer, this.renderer.toneMappingExposure);
      }
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      SkyCapability.toneRefCount.set(this.renderer, cnt + 1);
      this.toneApplied = true;
    }
    // exposure 每次都刷：apply→detach→apply 往返时 toneApplied 已为 true，
    // 但 exposure 可能已被外部改过，必须重新写入。
    this.renderer.toneMappingExposure = envState.skyExposure;
    if (envState.skyEnvironment) this.regenerateEnvironment();
    else this.clearEnvironment();
    // 更新 god rays 和 sunset tint
    this.updateGodRays();
    this.updateSunsetTint();
  }

  private writeUniforms(sky: Sky): void {
    const u = sky.material.uniforms;
    u.turbidity.value = envState.skyTurbidity;
    u.rayleigh.value = envState.skyRayleigh;
    u.mieCoefficient.value = envState.skyMieCoefficient;
    u.mieDirectionalG.value = envState.skyMieDirectionalG;
    u.cloudCoverage.value = envState.skyCloudCoverage;
    const phi = THREE.MathUtils.degToRad(90 - this.elevation);
    const theta = THREE.MathUtils.degToRad(this.azimuth);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sun);
    if (u.sunIntensityScale !== undefined) {
      u.sunIntensityScale.value = envState.skySunIntensityScale;
    }
    if (u.sunDiscScale !== undefined) {
      u.sunDiscScale.value = envState.skySunDiscScale;
    }
  }

  private regenerateEnvironment(): void {
    // 生成环境贴图时隐藏太阳盘，避免光斑伪影（Sky 文档建议）
    this.envSky.material.uniforms.showSunDisc.value = 0;
    try {
      if (this.renderTarget) this.renderTarget.dispose();
      this.renderTarget = this.ensurePMREM().fromScene(this.envScene);
      this.scene.environment = this.renderTarget.texture;
      // 同步阈值基准：任何重建路径（手动 forceEnv / 循环阈值命中 / setSun / preset）
      // 都以此时太阳高度角为新的门控基准，避免循环在手动调参后首帧冗余重建。
      this.lastPmremElevation = this.elevation;
    } catch (e) {
      ringLog("sky", `环境贴图生成失败: ${e}`, "error");
      // catch 后 renderTarget 可能悬空（fromScene 抛错时 renderTarget 已 dispose 但未重置）
      this.renderTarget = null;
      this.scene.environment = null;
    } finally {
      this.envSky.material.uniforms.showSunDisc.value = 1;
    }
  }

  private clearEnvironment(): void {
    if (this.scene.environment === this.renderTarget?.texture) {
      this.scene.environment = null;
    }
  }

  /** 调整太阳位置（度） */
  setSun(elevation: number, azimuth: number): void {
    // ADR-196 收口：纯写 envState；渲染应用（writeUniforms/PMREM 重建）统一走
    // callback 的 skyElevation/skyAzimuth 分支（forceEnv=true → 无条件重建）。
    setEnvState(
      { skyElevation: elevation, skyAzimuth: azimuth, skyForceEnv: true },
      { source: "manual" },
    );
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else this.detach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnvironmentEnabled(v: boolean): void {
    // ADR-196 收口：纯写 envState；regenerate/clear 由 callback 的 skyEnvironment 分支落地。
    setEnvState({ skyEnvironment: v }, { source: "manual" });
    // [doc:adr-126-p5] 双间接光协调：环境光开关变化同步 light 的 ambient 衰减（防 ×0.5 过期）——
    // 经构造注入的查询器（组合根 createAll 传入），不 import registry（防模块环）。
    // 跨 cap 通知非 envState 派发范畴（light 的 ambient 衰减读 sky 开关做派生），setter 保留。
    (
      this.caps?.getById("light") as { refreshAmbientFromSky?: () => void } | null | undefined
    )?.refreshAmbientFromSky?.();
  }

  /** 按模型类别套用散射/曝光预设（ADR-073 #3）；modelType 取 adapter.id（ysm/vrm/mmd/litematic） */
  setPreset(modelType: string): void {
    const preset = MODEL_SKY_PRESETS[modelType] ?? MODEL_SKY_PRESETS.default;
    // MODEL_SKY_PRESETS 的 key 是旧名（turbidity），需映射到 Schema 新名（skyTurbidity）
    const mapped: Partial<EnvState> = {};
    if (preset.turbidity !== undefined) mapped.skyTurbidity = preset.turbidity;
    if (preset.rayleigh !== undefined) mapped.skyRayleigh = preset.rayleigh;
    if (preset.mieCoefficient !== undefined) mapped.skyMieCoefficient = preset.mieCoefficient;
    if (preset.mieDirectionalG !== undefined) mapped.skyMieDirectionalG = preset.mieDirectionalG;
    if (preset.exposure !== undefined) mapped.skyExposure = preset.exposure;
    if (preset.sunIntensityScale !== undefined)
      mapped.skySunIntensityScale = preset.sunIntensityScale;
    if (preset.sunDiscScale !== undefined) mapped.skySunDiscScale = preset.sunDiscScale;
    // ADR-196 收口：纯写 envState；uniform 由 callback 各键分支落地 + 末尾强制重建一次
    // （预设切换是离散动作，散射参数变化应刷新环境烘焙——callback 各分支不互知，
    //  单一 changed 集内多键无法各自触发 rebuild，故此处保留一次显式 regenerate）。
    setEnvState({ ...mapped, skyForceEnv: true }, { source: "auto-model" });
    if (this.enabled && envState.skyEnvironment) this.regenerateEnvironment();
  }

  /** 设置云量 0=晴空 1=多云（ADR-073 #4）；regenerate=true 时同步刷新 IBL 环境 */
  setCloudCoverage(v: number, regenerate = false): void {
    const clamped = Math.max(0, Math.min(1, v));
    // ADR-196 收口：纯写 envState；uniform 由 callback 的 skyCloudCoverage 分支落地；
    // regenerate 语义保留（置 skyForceEnv 由 callback 判定重建）。
    setEnvState(
      { skyCloudCoverage: clamped, ...(regenerate ? { skyForceEnv: true } : {}) },
      { source: "manual" },
    );
  }

  /** §4 解耦：设置太阳强度对天空底色的耦合尺度（0.5~1.0，默认 0.75）；
   *  1.0 = 原生 Preetham 强度（正午最白），越低天空越不被太阳光绑架。 */
  setSunIntensityScale(v: number): void {
    const clamped = Math.max(0, Math.min(1.5, v));
    // ADR-196 收口：纯写 envState；uniform 由 callback 落地。
    setEnvState({ skySunIntensityScale: clamped }, { source: "manual" });
  }

  /** §4 解耦：设置太阳盘白光的尺度（0.2~1.0，默认 0.5）；
   *  1.0 = 原生 19000× 白光炸弹，越低太阳盘越暗、Bloom 越不炸屏。 */
  setSunDiscScale(v: number): void {
    const clamped = Math.max(0, Math.min(1.5, v));
    // ADR-196 收口：纯写 envState；uniform 由 callback 落地。
    setEnvState({ skySunDiscScale: clamped }, { source: "manual" });
  }

  /** 获取解耦尺度当前值（用于 UI getter / 测试断言） */
  getSunIntensityScale(): number {
    return envState.skySunIntensityScale;
  }
  getSunDiscScale(): number {
    return envState.skySunDiscScale;
  }

  /** 返回完整 params 浅拷贝（UI 面板 / 测试断言用，对齐其它 capability 口径） */
  getParams() {
    return {
      elevation: this.elevation,
      azimuth: this.azimuth,
      turbidity: envState.skyTurbidity,
      rayleigh: envState.skyRayleigh,
      mieCoefficient: envState.skyMieCoefficient,
      mieDirectionalG: envState.skyMieDirectionalG,
      cloudCoverage: envState.skyCloudCoverage,
      scale: envState.skyScale,
      environment: envState.skyEnvironment,
      timeOfDay: envState.skyTimeOfDay,
      exposure: envState.skyExposure,
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    };
  }

  // ── 昼夜循环动画（2026-08-20 引入；2026-09-03 迁入 SceneCapability.update(dt)）──
  // 自建 rAF 循环已删除——此前与 mount-preview-core 全局唯一 rAF（L591 c.update?.(dt)）
  // 双时钟并存，帧序 / document.hidden 暂停语义分裂；timeOfDay 推进改由核心帧循环驱动。
  // 速度：约 1 小时/秒（24 秒一圈），夜间会自然转暗。
  private autoRotateOn = false;
  private static readonly AUTO_ROTATE_HOURS_PER_SEC = 1;
  /**
   * 上次 PMREM 环境贴图重建时的太阳高度角（°）。
   * 昼夜循环下 setTime 每帧被 update(dt) 驱动——环境贴图重生是「立方体贴图 + mip 模糊」的
   * 重活（锐评 P1 GPU 熔炉）：高度角变化未超阈值时不重建（IBL 反射差异肉眼不可辨），
   * 手动 setTime（滑块/时间轴）走 forceEnv=true 强制刷新（拖动即见，体验不降级）。
   * 初始 -999 保证首次 setTime 必然重建（无论手动或循环首帧）。
   */
  private lastPmremElevation = -999;
  private static readonly PMREM_ELEVATION_THRESHOLD = 2.0; // 太阳高度角变化 ≥ 2° 才重建

  /** 启动昼夜循环；已开则 no-op（实际推进由 update(dt) 驱动） */
  startAutoRotate(): void {
    this.autoRotateOn = true;
  }

  /** 停止昼夜循环；已停则 no-op */
  stopAutoRotate(): void {
    this.autoRotateOn = false;
  }

  /** 当前是否正在昼夜循环 */
  isAutoRotating(): boolean {
    return this.autoRotateOn;
  }

  /** SceneCapability.update(dt) 钩子（对齐 water-capability 用法）：dt 单位秒，
   *  昼夜循环开启时按 1 小时/秒推进 timeOfDay；setTime 内部已取模 24。
   *  forceEnv=false：昼夜循环每帧驱动 setTime，PMREM 只按太阳高度角阈值重建
   *  （锐评 P1 GPU 熔炉修复——每帧重生环境贴图是 rAF 热路径上的重活）。 */
  update(dt: number): void {
    if (!this.enabled) return;
    this.godRaysTime.value += dt;
    if (!this.autoRotateOn) return;
    // 昼夜循环每帧驱动 timeOfDay，PMREM 按太阳高度角阈值重建（callback 的 skyTimeOfDay
    // 分支统一门控——锐评 P1 GPU 熔炉修复 + code_review #1/#14 force 语义）。
    // force 跳过 shouldOverwrite：autoRotate 推进是动画自身行为，用户拖过一次时间滑杆
    // （manual 写入）后 auto-model 写被永久拒绝 → 昼夜循环冻结；force 恢复推进语义。
    setEnvState(
      {
        skyTimeOfDay:
          (((envState.skyTimeOfDay + dt * SkyCapability.AUTO_ROTATE_HOURS_PER_SEC) % 24) + 24) % 24,
        skyForceEnv: false,
      },
      { source: "auto-model", force: true },
    );
  }

  /** 由 timeOfDay 推导太阳 elevation/azimuth（单一事实来源，避免与 setSun 双写冲突） */
  private syncSunFromTime(): void {
    const { elevation, azimuth } = this.hourToSun(envState.skyTimeOfDay);
    this.elevation = elevation;
    this.azimuth = azimuth;
  }

  /** 按一天中的小时（0-24）映射太阳位置：6=日出(东)、12=正午(南)、18=日落(西)，夜间在地平线下 → 天空转暗 */
  private hourToSun(hour: number): { elevation: number; azimuth: number } {
    const h = ((hour % 24) + 24) % 24;
    const dayAngle = ((h - 6) / 12) * Math.PI; // 6→0, 12→π/2, 18→π
    const elevation = Math.sin(dayAngle) * 70; // 峰值 70°，夜间为负 → 天空转暗
    const azimuth = 90 + ((h - 6) / 12) * 180; // 90(东)→180(南)→270(西)
    return { elevation, azimuth };
  }

  /**
   * 当前 timeOfDay 对应的太阳归一化坐标 (x: 0-1 经度, y: 0-1 纬度，0=底 1=顶)。
   * 供时间轴标记太阳位置；与 ENV_PRESETS.sunPos 同一口径。
   */
  getSunPosition(): { x: number; y: number } {
    const { elevation, azimuth } = this.hourToSun(envState.skyTimeOfDay);
    // azimuth 90~270 → x 0~1；elevation -70~70 → y 0~1（70=顶 1.0，-70=底 0.0）
    const x = (azimuth - 90) / 180;
    const y = (elevation + 70) / 140;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  /**
   * 按时间设置太阳位置（time-of-day），联动天空与 IBL 环境。
   * @param opts.forceEnv 是否强制重建 PMREM 环境贴图（默认 true——滑块/时间轴手动
   *   setTime 都是用户主动调参，拖动即见 + 既有测试不改语义）；
   *   传 false 走阈值门控：太阳高度角变化 < PMREM_ELEVATION_THRESHOLD 不重建
   *   （昼夜循环 update(dt) 每帧调用，锐评 P1 GPU 熔炉修复）。
   */
  setTime(hour: number, opts?: { forceEnv?: boolean }): void {
    const forceEnv = opts?.forceEnv ?? true;
    // ADR-196 收口：纯写 envState，渲染应用（syncSun/writeUniforms/PMREM 门控/godrays/tint）
    // 统一走 registerEnvCallback 的 skyTimeOfDay 分支。
    setEnvState(
      { skyTimeOfDay: ((hour % 24) + 24) % 24, skyForceEnv: forceEnv },
      { source: "manual" },
    );
  }

  getTimeOfDay(): number {
    return envState.skyTimeOfDay;
  }

  /** 当前是否联动 IBL 环境贴图（下拉开关初始化用） */
  isEnvironmentEnabled(): boolean {
    return envState.skyEnvironment;
  }

  /** 当前云量（ADR-085 S2：菜单初始化惰性读，消灭硬编码 "0%"） */
  getCloudCoverage(): number {
    return envState.skyCloudCoverage;
  }

  // ── God Rays ──

  /** 创建 sunset tint overlay mesh */
  private createSunsetTintMesh(): void {
    const scale = envState.skyScale * 0.999; // 略小于 sky，避免 z-fighting

    const geometry = new THREE.PlaneGeometry(scale, scale);

    const sunsetPreset = ENV_PRESETS.sunset;
    const uniforms = {
      uIntensity: { value: 0 },
      uSunPosition: { value: new THREE.Vector3() },
      uTintHorizon: { value: new THREE.Color(sunsetPreset.horizon) }, // 0xff8a5c 橙
      uTintZenith: { value: new THREE.Color(sunsetPreset.zenith) }, // 0x2a1855 暗蓝紫
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        #include <common>
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vDir;
        uniform float uIntensity;
        uniform vec3 uSunPosition;
        uniform vec3 uTintHorizon;
        uniform vec3 uTintZenith;

        void main() {
          vec3 dir = normalize(vDir);
          // 地平线混合：direction.y 越低越接近地平线
          float horizonBlend = max(0.0, 1.0 - dir.y);
          // 太阳方向加强：靠近太阳的方向 tint 更强
          float sunProximity = max(0.0, dot(dir, normalize(uSunPosition)));
          float sunBoost = smoothstep(-0.5, 1.0, sunProximity);
          // 综合 tint 强度
          float tintStrength = uIntensity * mix(horizonBlend * 0.8, 1.0, sunBoost * 0.3);
          vec3 tintColor = mix(uTintZenith, uTintHorizon, horizonBlend);
          gl_FragColor = vec4(tintColor * tintStrength, tintStrength * 0.6);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });

    this.sunsetTintMesh = new THREE.Mesh(geometry, material);
    this.sunsetTintMesh.visible = false;
  }

  /** 获取 sunset tint intensity（与 god rays 共用同一强度曲线） */
  getSunsetTintIntensity(): number {
    return this.getGodRaysIntensity();
  }

  /** 更新 sunset tint mesh 的 uniform */
  private updateSunsetTint(): void {
    if (!this.sunsetTintMesh) return;
    const intensity = this.getSunsetTintIntensity();
    const mat = this.sunsetTintMesh.material as THREE.ShaderMaterial;
    if (mat.uniforms) {
      mat.uniforms.uIntensity.value = intensity;
      mat.uniforms.uSunPosition.value.copy(this.sky.material.uniforms.sunPosition.value);
    }
  }

  private createConeShaderMaterial(): THREE.ShaderMaterial {
    const uniforms = {
      uColor: { value: new THREE.Color(1.0, 0.7, 0.3) },
      uIntensity: { value: 0 },
      uTime: this.godRaysTime,
    };

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        #include <common>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uTime;

        void main() {
          float verticalFade = 1.0 - vUv.y;
          verticalFade = pow(verticalFade, 1.5);
          float radialDist = abs(vUv.x - 0.5) * 2.0;
          float radialFade = 1.0 - radialDist * radialDist;
          float shimmer = sin(uTime * 2.0 + vUv.y * 6.28) * 0.05 + 1.0;
          float alpha = uIntensity * verticalFade * radialFade * shimmer;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(uColor * alpha, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private createConePlanes(): THREE.Group {
    const scale = envState.skyScale;
    const width = scale * 0.3;
    const height = scale * 0.4;

    const geo1 = new THREE.PlaneGeometry(width, height, 1, 1);
    const geo2 = new THREE.PlaneGeometry(width, height, 1, 1);
    const material = this.createConeShaderMaterial();

    const mesh1 = new THREE.Mesh(geo1, material);
    const mesh2 = new THREE.Mesh(geo2, material);
    mesh2.rotation.z = Math.PI / 2;

    mesh1.position.y = height * 0.5;
    mesh2.position.y = height * 0.5;

    const group = new THREE.Group();
    group.add(mesh1);
    group.add(mesh2);
    group.visible = false;
    return group;
  }

  /** 创建体积光束 geometry + material（仅构造期调用一次；重建入口从未启用，不承担 dispose 旧实例职责） */
  private createGodRays(): void {
    this.godRays = this.createConePlanes();
  }

  /** 获取 god rays 太阳色（跟随 sunset 预设的 sunColor） */
  private getGodRaysColor(): THREE.Color {
    // 日落预设的 sunColor = 0xffe0a8（暖橙），最贴合日出日落光束
    const sunsetPreset = ENV_PRESETS.sunset;
    return new THREE.Color(sunsetPreset.sunColor);
  }

  /** 获取 god rays intensity（0~1，elevation<20° 时激活） */
  getGodRaysIntensity(): number {
    if (this.elevation > 20) return 0;
    return Math.min(1, Math.max(0, (20 - this.elevation) / 30));
  }

  /** 按太阳位置更新 god rays 旋转和 intensity */
  private updateGodRays(): void {
    if (!this.godRays) return;
    if (!this.godRaysEnabled) {
      if (this.godRays.parent) this.godRays.parent.remove(this.godRays);
      this.godRays.visible = false;
      return;
    }
    const { elevation, azimuth } = this.hourToSun(envState.skyTimeOfDay);
    const elRad = THREE.MathUtils.degToRad(elevation);
    // 旋转 group：先绕 X 轴调整仰角，再绕 Y 轴调整方位
    this.godRays.rotation.x = -elRad; // 负：仰角越高，beam 越往下压
    this.godRays.rotation.y = THREE.MathUtils.degToRad(azimuth - 90); // 0°=东, 90°=南

    // 更新 intensity
    const intensity = this.getGodRaysIntensity();
    const mat = this.godRays.children[0] as THREE.Mesh;
    if (mat.material instanceof THREE.ShaderMaterial && mat.material.uniforms?.uIntensity) {
      mat.material.uniforms.uIntensity.value = intensity;
    }

    // 挂载/卸载
    if (intensity > 0 && !this.godRays.parent) {
      // 挂载时初始化颜色为 sunset 预设的 sunColor
      const mat = this.godRays.children[0] as THREE.Mesh;
      if (mat.material instanceof THREE.ShaderMaterial) {
        mat.material.uniforms.uColor.value.copy(this.getGodRaysColor());
      }
      this.scene.add(this.godRays);
      this.godRays.visible = true;
    } else if (intensity === 0 && this.godRays.parent) {
      this.godRays.parent.remove(this.godRays);
      this.godRays.visible = false;
    }

    // 同步 sunset tint mesh 的挂载状态
    if (
      intensity > 0 &&
      this.godRaysEnabled &&
      this.sunsetTintMesh &&
      !this.sunsetTintMesh.parent
    ) {
      this.scene.add(this.sunsetTintMesh);
      this.sunsetTintMesh.visible = true;
    } else if (
      this.sunsetTintMesh &&
      (intensity === 0 || !this.godRaysEnabled) &&
      this.sunsetTintMesh.parent
    ) {
      this.sunsetTintMesh.parent.remove(this.sunsetTintMesh);
      this.sunsetTintMesh.visible = false;
    }
  }

  /** 是否启用 god rays */
  isGodRaysEnabled(): boolean {
    return this.godRaysEnabled;
  }

  /** 切换 god rays 开关 */
  setGodRaysEnabled(v: boolean): void {
    this.godRaysEnabled = v;
    if (!this.enabled) return;
    this.updateGodRays();
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树：timeline controls 节点 + sky-time/sky-env 平铺原生
   *  + 高级组 folder。sky 无能力总开关（无 getMasterToggle）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildSkyNodes(this);
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      timeOfDay: envState.skyTimeOfDay,
      cloudCoverage: envState.skyCloudCoverage,
      environment: envState.skyEnvironment,
      enabled: this.enabled,
      godRaysEnabled: this.godRaysEnabled,
      // §4 解耦：持久化用户调整的太阳耦合尺度
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    });
  }

  /** 从 localStorage 恢复状态（字段恢复走 restoreFields，消除与 ground/water 同构的 typeof 样板） */
  loadState(): void {
    restoreFields(restoreState(this.id), {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
      timeOfDay: {
        number: (v) => {
          setEnvState({ skyTimeOfDay: v }, { source: "manual" });
        },
      },
      cloudCoverage: {
        number: (v) => {
          setEnvState({ skyCloudCoverage: v }, { source: "manual" });
        },
      },
      environment: {
        boolean: (v) => {
          setEnvState({ skyEnvironment: v }, { source: "manual" });
        },
      },
      godRaysEnabled: {
        boolean: (v) => {
          this.godRaysEnabled = v;
        },
      },
      // §4 解耦：恢复用户调过的耦合尺度（如果有值）；无值保留 DEFAULT 兜底
      sunIntensityScale: {
        number: (v) => {
          setEnvState({ skySunIntensityScale: v }, { source: "manual" });
        },
      },
      sunDiscScale: {
        number: (v) => {
          setEnvState({ skySunDiscScale: v }, { source: "manual" });
        },
      },
    });
  }

  private detach(): void {
    if (this.sky.parent) this.sky.parent.remove(this.sky);
    this.clearEnvironment();
    if (this.godRays?.parent) this.godRays.parent.remove(this.godRays);
    if (this.sunsetTintMesh?.parent) this.sunsetTintMesh.parent.remove(this.sunsetTintMesh);
    // 回滚 tone mapping：setEnabled(false) 时天空消失但 renderer 仍 ACESFilmic 的问题。
    // 引用计数仲裁多 session 共享 renderer，只在最后一个贡献过的 session 退出时还原。
    this.releaseTone();
  }

  /** 回滚本实例对共享 tone 状态的贡献（幂等：toneApplied=false 后再调无副作用） */
  private releaseTone(): void {
    if (!this.toneApplied) return;
    const cnt = SkyCapability.toneRefCount.get(this.renderer) ?? 0;
    if (cnt <= 1) {
      this.renderer.toneMapping =
        SkyCapability.prevToneMap.get(this.renderer) ?? this.prevToneMapping;
      this.renderer.toneMappingExposure =
        SkyCapability.prevExposureMap.get(this.renderer) ?? this.prevExposure;
      SkyCapability.toneRefCount.delete(this.renderer);
      SkyCapability.prevToneMap.delete(this.renderer);
      SkyCapability.prevExposureMap.delete(this.renderer);
    } else {
      SkyCapability.toneRefCount.set(this.renderer, cnt - 1);
    }
    this.toneApplied = false;
  }

  dispose(): void {
    this.stopAutoRotate();
    this.unsubscribeEnv();
    this.detach();
    // 守卫依据：本能力生成过的 environment 贴图引用（须在 renderTarget dispose/置空前捕获）
    const ownedEnv = this.renderTarget?.texture ?? null;
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    // tone mapping 已由 detach()→releaseTone() 回滚，此处不再重复处理。
    // dispose 还原 scene.environment 到构造前状态（detach 仅 clearEnvironment 不还原 prev）。
    // 守卫（锐评 P1 跨 cap 踩踏）：仅当当前 environment 仍归本能力所有（自建贴图或已被
    // clearEnvironment 置 null）才还原——environment-capability（HDR）若在本能力之后写过
    // scene.environment，无条件还原会把别人的贴图冲掉。
    if (this.scene.environment === null || this.scene.environment === ownedEnv) {
      this.scene.environment = this.prevEnvironment;
    }
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.envSky.geometry.dispose();
    (this.envSky.material as THREE.Material).dispose();
    this.pmrem?.dispose();
    // 释放 god rays / sunset tint（disposeObject3D uuid 去重——god rays 两 mesh 共享 material 只释放一次）
    disposeObject3D(this.godRays);
    this.godRays = null;
    // 释放 sunset tint mesh
    disposeObject3D(this.sunsetTintMesh);
    this.sunsetTintMesh = null;
  }
}
