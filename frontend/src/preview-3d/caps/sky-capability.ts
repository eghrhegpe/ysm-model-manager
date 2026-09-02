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
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { Sky } from "three/addons/objects/Sky.js";
import {
  type SceneCapability,
  type SceneCapabilityLookup,
  type MenuControlDef,
  persistState,
  restoreState,
  restoreFields,
} from "./scene-capability.ts";
import { ENV_PRESETS } from "./environment-capability.ts";

export interface SkyParams {
  /** 太阳高度角（度，0=地平线，90=天顶） */
  elevation: number;
  /** 太阳方位角（度） */
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** 云量 0=晴空；默认 0（预览偏好干净天空） */
  cloudCoverage: number;
  /** 天空盒缩放（半边长须 > 相机 maxDistance；预览核心=5000 → 12000） */
  scale: number;
  /** 是否联动 IBL 环境贴图（scene.environment）。默认 true（2026-08-16 目视验证通过） */
  environment: boolean;
  /** 时间-of-day（小时 0-24），太阳方位/高度的单一事实来源；默认 9（上午，观感较佳） */
  timeOfDay: number;
  /** ACES 曝光（天空正确显色所需，同时影响模型观感） */
  exposure: number;
  /**
   * §4 解耦：Preetham 模型中天空底色 Lin 被 `vSunE × 太阳强度` 强耦合，
   * 正午 vSunE≈1000 会把整个天空散射炸白。此参数把 `vSunE` 缩放为 `vSunE × sunIntensityScale`，
   * 让天空色（蓝/橙/紫渐变）与太阳绝对亮度解耦。合理范围 0.5~1.0，默认 0.75。
   */
  sunIntensityScale: number;
  /**
   * §4 解耦：Preetham 太阳盘本身是 `vSunE × 19000` 的白光炸弹，经过 Bloom 会染白屏幕。
   * 此参数把 19000 缩放为 `19000 × sunDiscScale`，保留辨识度但压到不炸屏。
   * 合理范围 0.2~1.0，默认 0.5。
   */
  sunDiscScale: number;
}

export const DEFAULT_SKY_PARAMS: SkyParams = {
  elevation: 10,
  azimuth: 180,
  // §3 曝光治理：turbidity 10→7.5（雾霾天→通透蓝天）；rayleigh 2→2.5（蓝调更明显）
  // 前值 v1.14：turbidity=10 正午表现偏牛奶白，配合高曝光整片发白
  turbidity: 7.5,
  rayleigh: 2.5,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  cloudCoverage: 0,
  scale: 12000,
  environment: true,
  timeOfDay: 9,
  exposure: 0.5,
  // §4 解耦：默认 0.75 / 0.5，正午蓝天从 1000² 压到 750²（削 44%），太阳盘砍半
  sunIntensityScale: 0.75,
  sunDiscScale: 0.5,
};

/** 模型类别标识（取 PreviewAdapter.id：ysm/vrm/mmd/litematic） */
export type SkyModelType = typeof RESOURCE_TYPES.YSM | "vrm" | "mmd" | "litematic" | "default";

/**
 * 按模型类别的散射/曝光预设（ADR-073 #3）。
 * 不同模型材质特性不同：VRM 为 PBR 角色、MMD 常带 toon/emissive 易过曝、
 * YSM/Litematic 为方块哑光。预设仅调散射与曝光，不改太阳位置（由 timeOfDay 控制）。
 * 数值为初始合理值，观感待目视微调。
 */
export const MODEL_SKY_PRESETS: Record<string, Partial<SkyParams>> = {
  // §3 曝光治理：各预设 turbidity 按原比例整体下调，rayleigh 同步上调，
  // 让正午 Preetham 天空从"牛奶白"回归"通透蓝天"，同时保持预设间原有的差异梯度。
  // §4 解耦：全部预设统一携带 sunIntensityScale / sunDiscScale（0.75/0.5 默认），
  // 后续目视验证后可按模型微调。
  default: { turbidity: 7.5, rayleigh: 2.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.5, sunIntensityScale: 0.75, sunDiscScale: 0.5 },
  // VRM PBR 角色：原 turbidity=7 已偏低，再微调至 6；rayleigh 轻微上浮，蓝天当背景更衬肤色
  vrm: { turbidity: 6, rayleigh: 2.3, mieCoefficient: 0.004, mieDirectionalG: 0.85, exposure: 0.55, sunIntensityScale: 0.78, sunDiscScale: 0.55 },
  // MMD Toon：原 9→7.5（去雾霾感）；rayleigh 1.8→2.3（补回蓝色层次）；sunDiscScale 稍低（Toon 背景易白）
  mmd: { turbidity: 7.5, rayleigh: 2.3, mieCoefficient: 0.006, mieDirectionalG: 0.8, exposure: 0.55, sunIntensityScale: 0.72, sunDiscScale: 0.45 },
  // MMD 场景：原 14 极雾霾→10 正常云絮天；rayleigh 翻倍从 1.2→2.0，避免背景死白
  "mmd-scene": { turbidity: 10, rayleigh: 2.0, mieCoefficient: 0.008, mieDirectionalG: 0.75, exposure: 0.55, sunIntensityScale: 0.7, sunDiscScale: 0.45 },
  // YSM 方块：原 11→8.5；哑光方块需要更强的蓝白对比
  ysm: { turbidity: 8.5, rayleigh: 2.6, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.6, sunIntensityScale: 0.75, sunDiscScale: 0.5 },
  // Litematic 体素：同 default，10→7.5
  litematic: { turbidity: 7.5, rayleigh: 2.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.5, sunIntensityScale: 0.75, sunDiscScale: 0.5 },
};

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
 * @param defaults 默认值通常是 DEFAULT_SKY_PARAMS.sunIntensityScale / sunDiscScale，
 *                 之后通过 uniforms.value 再同步运行时参数。
 */
export function injectSkySunScalePatch(
  mat: THREE.ShaderMaterial,
  defaults: { sunIntensityScale: number; sunDiscScale: number } = {
    sunIntensityScale: DEFAULT_SKY_PARAMS.sunIntensityScale,
    sunDiscScale: DEFAULT_SKY_PARAMS.sunDiscScale,
  },
): void {
  // 幂等守卫：检查 uniforms 里是否已经有注入标记字段
  if (mat.uniforms.sunIntensityScale !== undefined && mat.uniforms.sunDiscScale !== undefined) {
    // 已存在 → 只确保默认值同步到 uniforms（不改 shader，避免重编译）
    mat.uniforms.sunIntensityScale.value = defaults.sunIntensityScale;
    mat.uniforms.sunDiscScale.value = defaults.sunDiscScale;
    return;
  }

  // ① 追加 uniforms（对象层先注册，即使后续 shader 替换失败也不 crash 运行时）
  mat.uniforms.sunIntensityScale = { value: defaults.sunIntensityScale };
  mat.uniforms.sunDiscScale = { value: defaults.sunDiscScale };

  // ② patch fragmentShader：按"声明必须先于使用"的 GLSL 顺序三层独立幂等替换。
  //    每一层都做 contains 判断，避免重复替换。如果声明层未匹配，就跳过使用层（防未声明编译报错）
  let patched = false;

  // 2a) uniform 声明：在 "uniform float showSunDisc;\nuniform float time;" 之后追加成两行新声明
  const hasDecl = /uniform\s+float\s+sunIntensityScale\s*;/.test(mat.fragmentShader);
  if (!hasDecl) {
    const before = mat.fragmentShader;
    const uniformDeclInjection = "\nuniform float sunIntensityScale;\nuniform float sunDiscScale;\n";
    mat.fragmentShader = mat.fragmentShader.replace(
      /(uniform\s+float\s+showSunDisc\s*;\s*\n\s*uniform\s+float\s+time\s*;)/,
      "$1" + uniformDeclInjection,
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
        console.warn(
          "[sky-capability] injectSkySunScalePatch 无法注入声明，跳过 shader patch。",
          "请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
        );
        // 声明失败 → 不再继续使用层的替换，防 GLSL 编译错
        return;
      }
    }
  }

  // 2b) 解耦点 ①：pow( vSunE * (  →  pow( (vSunE * sunIntensityScale) * (
  const hasVSuScale = /vSunE\s*\*\s*sunIntensityScale/.test(mat.fragmentShader);
  if (!hasVSuScale) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "pow( vSunE * (",
      "pow( (vSunE * sunIntensityScale) * (",
    );
    if (mat.fragmentShader !== before) patched = true;
  }

  // 2c) 解耦点 ②：19000.0 * Fex → 19000.0 * sunDiscScale * Fex
  const hasDiscScale = /19000\.0\s*\*\s*sunDiscScale/.test(mat.fragmentShader);
  if (!hasDiscScale) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "19000.0 * Fex",
      "19000.0 * sunDiscScale * Fex",
    );
    if (mat.fragmentShader !== before) patched = true;
  }

  // ③ 有改动才触发重编译
  if (patched) mat.needsUpdate = true;
}

function skcBuildTime(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-timeline",
      kind: "timeline",
      labelKey: "preview.skyTimeline",
      fallback: "光影时间轴",
      getValue: () => cap.getTimeOfDay(),
      setValue: (v) => cap.setTime(v as number),
    },
    {
      id: "sky-time",
      kind: "slider",
      labelKey: "preview.timeOfDay",
      fallback: "时间",
      slider: { min: 0, max: 24, step: 0.5, unit: "h" },
      getValue: () => cap.getTimeOfDay(),
      setValue: (v) => cap.setTime(v as number),
    },
  ];
}

function skcBuildSun(cap: SkyCapability): MenuControlDef[] {
  return [];
}

function skcBuildScattering(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-cloud",
      kind: "slider",
      labelKey: "preview.cloudCoverage",
      fallback: "云量",
      group: "preview.skyGroupAdvanced",
      slider: { min: 0, max: 1, step: 0.05, unit: "%" },
      getValue: () => cap.getCloudCoverage(),
      setValue: (v) => cap.setCloudCoverage(v as number, true),
    },
    {
      id: "sky-env",
      kind: "toggle",
      labelKey: "preview.environmentMapping",
      fallback: "环境贴图",
      group: "preview.skyGroupAdvanced",
      // [doc:adr-125] 自动并入设置面板（画质分组）。原 settings 面板手写的
      // 「PMREM 环境光」toggle 与本控件同源，已由聚合取代
      settingsOrder: 20,
      getValue: () => cap.isEnvironmentEnabled(),
      setValue: (v) => cap.setEnvironmentEnabled(v as boolean),
    },
    // §4 解耦：两个太阳耦合尺度作为高级滑块（默认在 0.75/0.5 已做过优化，高级用户可再调）
    {
      id: "sky-sun-intensity",
      kind: "slider",
      labelKey: "preview.skySunIntensityScale",
      fallback: "天空×太阳耦合",
      hintKey: "preview.skySunIntensityScaleHint",
      group: "preview.skyGroupAdvanced",
      slider: { min: 0.3, max: 1.2, step: 0.05 },
      getValue: () => cap.getSunIntensityScale(),
      setValue: (v) => cap.setSunIntensityScale(v as number),
    },
    {
      id: "sky-sun-disc",
      kind: "slider",
      labelKey: "preview.skySunDiscScale",
      fallback: "太阳盘强度",
      hintKey: "preview.skySunDiscScaleHint",
      group: "preview.skyGroupAdvanced",
      slider: { min: 0.0, max: 1.2, step: 0.05 },
      getValue: () => cap.getSunDiscScale(),
      setValue: (v) => cap.setSunDiscScale(v as number),
    },
  ];
}

function skcBuildAutoRotate(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-auto-rotate",
      kind: "toggle",
      labelKey: "preview.skyAutoRotate",
      fallback: "昼夜循环",
      hintKey: "preview.skyAutoRotateHint",
      group: "preview.skyGroupAdvanced",
      getValue: () => cap.isAutoRotating(),
      setValue: (v) => {
        if (v) cap.startAutoRotate();
        else cap.stopAutoRotate();
      },
    },
  ];
}

function skcBuildAtmosphereFX(cap: SkyCapability): MenuControlDef[] {
  return [
    {
      id: "sky-godrays",
      kind: "toggle",
      labelKey: "preview.skyGodRays",
      fallback: "体积光束",
      hintKey: "preview.skyGodRaysHint",
      group: "preview.skyGroupAdvanced",
      getValue: () => cap.isGodRaysEnabled(),
      setValue: (v) => cap.setGodRaysEnabled(v as boolean),
    },
  ];
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
  private params: SkyParams;
  private enabled: boolean;
  /** 本实例是否已向 toneRefCount 贡献过引用（apply 幂等标记——防重复 apply 抬高计数；
   *  从未贡献的实例 dispose 不得拆共享 tone 状态，见 dispose/apply 注释） */
  private toneApplied = false;
  private prevToneMapping: THREE.ToneMapping;
  private prevExposure: number;
  /** 引用计数：多个 SkyCapability 共享同一 renderer 时，
   *  tone mapping 只在第一个 attach 时设置，只在最后一个 dispose 时恢复 */
  private static toneRefCount = new Map<THREE.WebGLRenderer, number>();
  private static prevToneMap = new Map<THREE.WebGLRenderer, THREE.ToneMapping>();
  private static prevExposureMap = new Map<THREE.WebGLRenderer, number>();
  /** God Rays（体积光束）*/
  private godRays: THREE.Group | null = null;
  private godRaysEnabled: boolean;
  private godRaysTime: { value: number };
  /** Sunset Tint Overlay（日落暖色渐变）*/
  private sunsetTintMesh: THREE.Mesh | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<SkyParams>;
    enabled?: boolean;
    /** cap 间协调查询器（组合根 createAll 注入）——环境开关变化通知 light 刷新 ambient */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.caps = opts.caps;
    this.params = { ...DEFAULT_SKY_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevExposure = this.renderer.toneMappingExposure;
    // Sky 是 Mesh + ShaderMaterial，纯数据对象，构造函数不依赖 WebGL
    this.sky = this.createSky();
    this.envSky = this.createSky();
    // §4 解耦：只给主天空 this.sky 注入 sun scale 补丁，envSky（用于 IBL）保持原生 Preetham —
    // 这样 IBL 环境贴图的色调基准与物体反射保持物理正确，而主天空不再被 1000² 的太阳强度炸白。
    injectSkySunScalePatch(this.sky.material as THREE.ShaderMaterial, {
      sunIntensityScale: this.params.sunIntensityScale,
      sunDiscScale: this.params.sunDiscScale,
    });
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky);
    // God Rays 初始化（默认禁用）
    this.godRaysEnabled = false;
    this.godRaysTime = { value: 0 };
    this.createGodRays();
    // Sunset Tint 初始化
    this.createSunsetTintMesh();
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
    sky.scale.setScalar(this.params.scale);
    sky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
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
      this.renderer.toneMappingExposure = this.params.exposure;
      SkyCapability.toneRefCount.set(this.renderer, cnt + 1);
      this.toneApplied = true;
    }
    if (this.params.environment) this.regenerateEnvironment();
    else this.clearEnvironment();
    // 更新 god rays 和 sunset tint
    this.updateGodRays();
    this.updateSunsetTint();
  }

  private writeUniforms(sky: Sky): void {
    const u = sky.material.uniforms;
    u["turbidity"].value = this.params.turbidity;
    u["rayleigh"].value = this.params.rayleigh;
    u["mieCoefficient"].value = this.params.mieCoefficient;
    u["mieDirectionalG"].value = this.params.mieDirectionalG;
    u["cloudCoverage"].value = this.params.cloudCoverage;
    const phi = THREE.MathUtils.degToRad(90 - this.params.elevation);
    const theta = THREE.MathUtils.degToRad(this.params.azimuth);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u["sunPosition"].value.copy(sun);
    // §4 解耦：只有已注入过 sun scale patch 的天空（即主天空 this.sky）才同步这两个新 uniform；
    // envSky 未注入 patch，uniforms 上没有这两个字段，跳过即可（保持原生 Preetham 物理模型）。
    if (u["sunIntensityScale"] !== undefined) {
      u["sunIntensityScale"].value = this.params.sunIntensityScale;
    }
    if (u["sunDiscScale"] !== undefined) {
      u["sunDiscScale"].value = this.params.sunDiscScale;
    }
  }

  private regenerateEnvironment(): void {
    // 生成环境贴图时隐藏太阳盘，避免光斑伪影（Sky 文档建议）
    this.envSky.material.uniforms["showSunDisc"].value = 0;
    try {
      if (this.renderTarget) this.renderTarget.dispose();
      this.renderTarget = this.ensurePMREM().fromScene(this.envScene);
      this.scene.environment = this.renderTarget.texture;
    } catch (e) {
      console.error("[sky] 环境贴图生成失败:", e);
      // catch 后 renderTarget 可能悬空（fromScene 抛错时 renderTarget 已 dispose 但未重置）
      this.renderTarget = null;
      this.scene.environment = null;
    } finally {
      this.envSky.material.uniforms["showSunDisc"].value = 1;
    }
  }

  private clearEnvironment(): void {
    if (this.scene.environment === this.renderTarget?.texture) {
      this.scene.environment = null;
    }
  }

  /** 调整太阳位置（度） */
  setSun(elevation: number, azimuth: number): void {
    this.params.elevation = elevation;
    this.params.azimuth = azimuth;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.enabled && this.params.environment) this.regenerateEnvironment();
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
    this.params.environment = v;
    if (!this.enabled) return;
    if (v) this.regenerateEnvironment();
    else this.clearEnvironment();
    // [doc:adr-126-p5] 双间接光协调：环境光开关变化同步 light 的 ambient 衰减（防 ×0.5 过期）——
    // 经构造注入的查询器（组合根 createAll 传入），不 import registry（防模块环）
    (this.caps?.getById("light") as { refreshAmbientFromSky?: () => void } | null | undefined)
      ?.refreshAmbientFromSky?.();
  }

  /** 按模型类别套用散射/曝光预设（ADR-073 #3）；modelType 取 adapter.id（ysm/vrm/mmd/litematic） */
  setPreset(modelType: string): void {
    const preset = MODEL_SKY_PRESETS[modelType] ?? MODEL_SKY_PRESETS.default;
    this.params = { ...this.params, ...preset };
    if (!this.enabled) return;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.params.environment) this.regenerateEnvironment();
  }

  /** 设置云量 0=晴空 1=多云（ADR-073 #4）；regenerate=true 时同步刷新 IBL 环境 */
  setCloudCoverage(v: number, regenerate = false): void {
    this.params.cloudCoverage = Math.max(0, Math.min(1, v));
    this.sky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
    this.envSky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
    if (regenerate && this.enabled && this.params.environment) this.regenerateEnvironment();
  }

  /** §4 解耦：设置太阳强度对天空底色的耦合尺度（0.5~1.0，默认 0.75）；
   *  1.0 = 原生 Preetham 强度（正午最白），越低天空越不被太阳光绑架。 */
  setSunIntensityScale(v: number): void {
    const clamped = Math.max(0, Math.min(1.5, v));
    this.params.sunIntensityScale = clamped;
    const u = this.sky.material.uniforms;
    if (u["sunIntensityScale"] !== undefined) u["sunIntensityScale"].value = clamped;
    // 环境贴图 envSky 不受这个参数影响（保持原生 Preetham，PBR 反射更真实）。
  }

  /** §4 解耦：设置太阳盘白光的尺度（0.2~1.0，默认 0.5）；
   *  1.0 = 原生 19000× 白光炸弹，越低太阳盘越暗、Bloom 越不炸屏。 */
  setSunDiscScale(v: number): void {
    const clamped = Math.max(0, Math.min(1.5, v));
    this.params.sunDiscScale = clamped;
    const u = this.sky.material.uniforms;
    if (u["sunDiscScale"] !== undefined) u["sunDiscScale"].value = clamped;
  }

  /** 获取解耦尺度当前值（用于 UI getter / 测试断言） */
  getSunIntensityScale(): number { return this.params.sunIntensityScale; }
  getSunDiscScale(): number { return this.params.sunDiscScale; }

  /** 返回完整 params 浅拷贝（UI 面板 / 测试断言用，对齐其它 capability 口径） */
  getParams(): SkyParams { return { ...this.params }; }

  // ── 昼夜循环动画（2026-08-20）──
  // requestAnimationFrame 循环递增 timeOfDay，让用户预览全天光照变化。
  // 速度：约 1 小时/秒（24 秒一圈），夜间会自然转暗。
  private autoRotateId: number | null = null;
  private autoRotateLastTs: number | null = null;
  private static readonly AUTO_ROTATE_HOURS_PER_SEC = 1;

  /** 启动昼夜循环；已在跑则 no-op */
  startAutoRotate(): void {
    if (this.autoRotateId !== null) return;
    this.autoRotateLastTs = null;
    const tick = (ts: number): void => {
      if (this.autoRotateLastTs === null) this.autoRotateLastTs = ts;
      const dt = (ts - this.autoRotateLastTs) / 1000; // 秒
      this.autoRotateLastTs = ts;
      const next = this.params.timeOfDay + dt * SkyCapability.AUTO_ROTATE_HOURS_PER_SEC;
      this.setTime(next);
      this.autoRotateId = requestAnimationFrame(tick);
    };
    this.autoRotateId = requestAnimationFrame(tick);
  }

  /** 停止昼夜循环；未在跑则 no-op */
  stopAutoRotate(): void {
    if (this.autoRotateId === null) return;
    cancelAnimationFrame(this.autoRotateId);
    this.autoRotateId = null;
    this.autoRotateLastTs = null;
  }

  /** 当前是否正在昼夜循环 */
  isAutoRotating(): boolean {
    return this.autoRotateId !== null;
  }

  /** 由 timeOfDay 推导太阳 elevation/azimuth（单一事实来源，避免与 setSun 双写冲突） */
  private syncSunFromTime(): void {
    const { elevation, azimuth } = this.hourToSun(this.params.timeOfDay);
    this.params.elevation = elevation;
    this.params.azimuth = azimuth;
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
    const { elevation, azimuth } = this.hourToSun(this.params.timeOfDay);
    // azimuth 90~270 → x 0~1；elevation -70~70 → y 0~1（70=顶 1.0，-70=底 0.0）
    const x = (azimuth - 90) / 180;
    const y = (elevation + 70) / 140;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  /** 按时间设置太阳位置（time-of-day），联动天空与 IBL 环境 */
  setTime(hour: number): void {
    this.params.timeOfDay = ((hour % 24) + 24) % 24;
    this.syncSunFromTime();
    if (!this.enabled) return;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.params.environment) this.regenerateEnvironment();
    // 更新 god rays 和 sunset tint
    this.updateGodRays();
    this.updateSunsetTint();
  }

  getTimeOfDay(): number {
    return this.params.timeOfDay;
  }

  /** 当前是否联动 IBL 环境贴图（下拉开关初始化用） */
  isEnvironmentEnabled(): boolean {
    return this.params.environment;
  }

  /** 当前云量（ADR-085 S2：菜单初始化惰性读，消灭硬编码 "0%"） */
  getCloudCoverage(): number {
    return this.params.cloudCoverage;
  }

  // ── God Rays ──

  /** 创建 sunset tint overlay mesh */
  private createSunsetTintMesh(): void {
    const scale = this.params.scale * 0.999; // 略小于 sky，避免 z-fighting

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
      mat.uniforms.uSunPosition.value.copy(this.sky.material.uniforms["sunPosition"].value);
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
    const scale = this.params.scale;
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

  /** 释放一组 mesh 的 geometry/material（god rays / sunset tint 复用） */
  private disposeMeshGroup(group: THREE.Object3D | null): void {
    if (!group) return;
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const mat = child.material;
      if (mat instanceof THREE.ShaderMaterial) mat.dispose();
    });
  }

  /** 创建体积光束 geometry + material */
  private createGodRays(): void {
    this.disposeMeshGroup(this.godRays);
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
    if (this.params.elevation > 20) return 0;
    return Math.min(1, Math.max(0, (20 - this.params.elevation) / 30));
  }

  /** 按太阳位置更新 god rays 旋转和 intensity */
  private updateGodRays(): void {
    if (!this.godRays) return;
    if (!this.godRaysEnabled) {
      if (this.godRays.parent) this.godRays.parent.remove(this.godRays);
      this.godRays.visible = false;
      return;
    }
    const { elevation, azimuth } = this.hourToSun(this.params.timeOfDay);
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
    if (intensity > 0 && this.godRaysEnabled && this.sunsetTintMesh && !this.sunsetTintMesh.parent) {
      this.scene.add(this.sunsetTintMesh);
      this.sunsetTintMesh.visible = true;
    } else if (this.sunsetTintMesh && (intensity === 0 || !this.godRaysEnabled) && this.sunsetTintMesh.parent) {
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

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return [...skcBuildTime(this), ...skcBuildSun(this), ...skcBuildScattering(this), ...skcBuildAutoRotate(this), ...skcBuildAtmosphereFX(this)];
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      timeOfDay: this.params.timeOfDay,
      cloudCoverage: this.params.cloudCoverage,
      environment: this.params.environment,
      enabled: this.enabled,
      godRaysEnabled: this.godRaysEnabled,
      // §4 解耦：持久化用户调整的太阳耦合尺度
      sunIntensityScale: this.params.sunIntensityScale,
      sunDiscScale: this.params.sunDiscScale,
    });
  }

  /** 从 localStorage 恢复状态（字段恢复走 restoreFields，消除与 ground/water 同构的 typeof 样板） */
  loadState(): void {
    restoreFields(restoreState(this.id), {
      enabled: { boolean: (v) => { this.enabled = v; } },
      timeOfDay: { number: (v) => { this.params.timeOfDay = v; } },
      cloudCoverage: { number: (v) => { this.params.cloudCoverage = v; } },
      environment: { boolean: (v) => { this.params.environment = v; } },
      godRaysEnabled: { boolean: (v) => { this.godRaysEnabled = v; } },
      // §4 解耦：恢复用户调过的耦合尺度（如果有值）；无值保留 DEFAULT 兜底
      sunIntensityScale: { number: (v) => { this.params.sunIntensityScale = v; } },
      sunDiscScale: { number: (v) => { this.params.sunDiscScale = v; } },
    });
  }

  private detach(): void {
    if (this.sky.parent) this.sky.parent.remove(this.sky);
    this.clearEnvironment();
    if (this.godRays?.parent) this.godRays.parent.remove(this.godRays);
    if (this.sunsetTintMesh?.parent) this.sunsetTintMesh.parent.remove(this.sunsetTintMesh);
  }

  dispose(): void {
    this.stopAutoRotate();
    this.detach();
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    // 引用计数仲裁：只在最后一个贡献过的 session 退出时恢复原始 tone mapping。
    // 本实例从未 apply 贡献过（enabled:false / loadState 恢复后未启用）→ 不得动共享
    // 状态——否则会误删仍存活 session 的 prevToneMap/prevExposureMap 并提前还原 tone。
    if (this.toneApplied) {
      const cnt = SkyCapability.toneRefCount.get(this.renderer) ?? 0;
      if (cnt <= 1) {
        this.renderer.toneMapping = SkyCapability.prevToneMap.get(this.renderer) ?? this.prevToneMapping;
        this.renderer.toneMappingExposure = SkyCapability.prevExposureMap.get(this.renderer) ?? this.prevExposure;
        SkyCapability.toneRefCount.delete(this.renderer);
        SkyCapability.prevToneMap.delete(this.renderer);
        SkyCapability.prevExposureMap.delete(this.renderer);
      } else {
        SkyCapability.toneRefCount.set(this.renderer, cnt - 1);
      }
      this.toneApplied = false;
    }
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.envSky.geometry.dispose();
    (this.envSky.material as THREE.Material).dispose();
    this.pmrem?.dispose();
    // 释放 god rays
    this.disposeMeshGroup(this.godRays);
    this.godRays = null;
    // 释放 sunset tint mesh
    this.disposeMeshGroup(this.sunsetTintMesh);
    this.sunsetTintMesh = null;
  }
}
