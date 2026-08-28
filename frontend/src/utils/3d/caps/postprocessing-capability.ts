// ===== PostprocessingCapability：后处理管线能力（ADR-073 caps/ 能力模式）=====
// 合并/升级原有 PostprocessingManager（原本只在 volumetric engine=postprocess 时激活）
// 为 SceneCapability 接口：独立开关 + Bloom 参数独立可调（原跟随 volumetric 做联动可开/关）+ SSAO + SSR。
//
// 设计要点：
//   - 兼容旧 PostprocessingManager 外部接口：render(dt, lightCap): boolean，setSize，dispose
//   - 延迟创建 composer：需要启用（enabled=true 或 lightCap volumetric postprocess 触发）时才创建，无 composer 时走普通 renderer.render
//   - Pass 顺序：RenderPass → (SSAOPass 可选) → UnrealBloomPass → (SSRPass 可选，reflectionMode 控制) → OutputPass
//   - dispose 还原构造前 renderer.toneMapping 等输出设置，不泄漏
//   - SceneCapability 接口 + 注册表驱动：菜单自动渲染所有控件
//   - setPreset 按模型类别分：方块/体素 = Bloom 薄 + 关 SSAO（无明显细节）；VRM/MMD = SSAO 中档 + Bloom 柔光
//   - reflectionMode 三档：envmap-only (SSR off) / envmap+ssr (默认，SSR 叠上 envmap 反射当屏外 fallback) / ssr-only (SSR 无屏外补全)

import * as THREE from "three";
import { previewPixelRatio } from "../render-budget.ts";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import type { LightCapability } from "./light-capability.ts";
import type { ReflectorCapability } from "./reflector-capability.ts";
import type { PostprocessingLike } from "../adapters/postprocessing.ts";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

/** 反射模式三档：envmap-only 纯环境贴图、envmap+ssr SSR+屏外 fallback、ssr-only 纯 SSR（屏外会变黑） */
export type ReflectionMode = "envmap-only" | "envmap+ssr" | "ssr-only";

export interface PostprocessingParams {
  enabled: boolean;
  /** Bloom 强度（0~3）*/
  bloomStrength: number;
  /** Bloom 阈值（0~1；低于此亮度的像素不参与 bloom） */
  bloomThreshold: number;
  /** Bloom 半径（0~2） */
  bloomRadius: number;
  /** 是否让 Bloom 参数跟随 LightCapability 体积光联动（开启后用 opacity/edgeFade 调 bloom） */
  bloomFollowVolumetric: boolean;
  /** SSAO 开关 */
  ssaoEnabled: boolean;
  /** SSAO 采样半径（控制 AO 扩散范围） */
  ssaoRadius: number;
  /** SSAO 最小生效距离 */
  ssaoMinDist: number;
  /** SSAO 最大生效距离 */
  ssaoMaxDist: number;
  /** 后处理输出色彩映射（默认 ACES Filmic） */
  toneMapping: "none" | "linear" | "reinhard" | "aces" | "cineon";
  /** 曝光值（toneMapping≠none 时生效） */
  exposure: number;
  /** 反射模式：envmap-only 纯环境贴图 / envmap+ssr SSR 叠 envmap 屏外 fallback / ssr-only 纯 SSR */
  reflectionMode: ReflectionMode;
  /** SSR 透明度（SSR 叠 envmap 时的混合强度，0.5 默认） */
  ssrOpacity: number;
  /** SSR 最大反射距离（越大越吃性能，180 默认） */
  ssrMaxDistance: number;
  /** SSR 厚度判定（越大越不易漏反射，0.018 默认） */
  ssrThickness: number;
  /** SSR 模糊开关（真=两通高斯模糊镜面） */
  ssrBlur: boolean;
  /** SSR 距离衰减（真=远处反射变淡） */
  ssrDistanceAttenuation: boolean;
  /** SSR 菲涅尔（真=斜反射强，正反射弱） */
  ssrFresnel: boolean;
  /** SSR 多重弹射（真=上帧结果做迭代，细节更好但更慢） */
  ssrBouncing: boolean;
  /** SSR 开启时，自动禁用 ReflectorCapability 单平面镜面（省 draw call + 防 z-fighting） */
  reflectorDisableWhenSSR: boolean;
}

const THREE_TONE_MAPPING: Record<PostprocessingParams["toneMapping"], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  cineon: THREE.CineonToneMapping,
};

export const DEFAULT_POSTPROC_PARAMS: PostprocessingParams = {
  enabled: false,
  bloomStrength: 0.6,
  bloomThreshold: 0.6,
  bloomRadius: 0.5,
  bloomFollowVolumetric: true,
  ssaoEnabled: false,
  ssaoRadius: 8,
  ssaoMinDist: 0.005,
  ssaoMaxDist: 0.1,
  toneMapping: "aces",
  exposure: 1.0,
  reflectionMode: "envmap-only",
  ssrOpacity: 0.5,
  ssrMaxDistance: 180,
  ssrThickness: 0.018,
  ssrBlur: true,
  ssrDistanceAttenuation: true,
  ssrFresnel: true,
  ssrBouncing: false,
  reflectorDisableWhenSSR: true,
};

/** SSRPass.OUTPUT 枚举（0=Default 正常显示反射混合），其他调试项 1=Beauty 2=SSR 仅深度 3=Blur 4=Normal 5=Metalness 先不暴露 */
const SSRPASS_OUTPUT_DEFAULT = 0;

/* ============ getMenuControls 拆分：4 个包级函数（前缀 ppc 防冲突） ============ */

function ppcBuildBasic(cap: PostprocessingCapability): MenuControlDef[] {
  return [
    {
      id: "pp-enabled",
      kind: "toggle",
      labelKey: "preview.postprocessing",
      fallback: "后处理管线",
      getValue: () => cap.isEnabled(),
      setValue: (v) => cap.setEnabled(v as boolean),
    },
    {
      id: "pp-toneMapping",
      kind: "select",
      labelKey: "preview.toneMapping",
      fallback: "色彩映射",
      group: "preview.postprocessingGroupColor",
      select: [
        { value: "none", label: "无" },
        { value: "linear", label: "线性" },
        { value: "reinhard", label: "Reinhard" },
        { value: "aces", label: "ACES Filmic" },
        { value: "cineon", label: "Cineon" },
      ],
      getValue: () => cap.getParams().toneMapping,
      setValue: (v) => cap.setToneMapping(v as PostprocessingParams["toneMapping"]),
    },
    {
      id: "pp-exposure",
      kind: "slider",
      labelKey: "preview.exposure",
      fallback: "曝光",
      group: "preview.postprocessingGroupColor",
      slider: { min: 0.1, max: 3, step: 0.05 },
      getValue: () => cap.getParams().exposure,
      setValue: (v) => cap.setExposure(v as number),
    },
  ];
}

function ppcBuildBloom(cap: PostprocessingCapability): MenuControlDef[] {
  return [
    {
      id: "pp-bloom-strength",
      kind: "slider",
      labelKey: "preview.bloomStrength",
      fallback: "辉光强度",
      group: "preview.postprocessingGroupBloom",
      slider: { min: 0, max: 3, step: 0.05 },
      getValue: () => cap.getParams().bloomStrength,
      setValue: (v) => cap.setBloomStrength(v as number),
    },
    {
      id: "pp-bloom-threshold",
      kind: "slider",
      labelKey: "preview.bloomThreshold",
      fallback: "辉光阈值",
      group: "preview.postprocessingGroupBloom",
      slider: { min: 0, max: 1, step: 0.02 },
      getValue: () => cap.getParams().bloomThreshold,
      setValue: (v) => cap.setBloomThreshold(v as number),
    },
    {
      id: "pp-bloom-radius",
      kind: "slider",
      labelKey: "preview.bloomRadius",
      fallback: "辉光半径",
      group: "preview.postprocessingGroupBloom",
      slider: { min: 0, max: 2, step: 0.02 },
      getValue: () => cap.getParams().bloomRadius,
      setValue: (v) => cap.setBloomRadius(v as number),
    },
    {
      id: "pp-bloom-follow",
      kind: "toggle",
      labelKey: "preview.bloomFollowVolumetric",
      fallback: "跟随体积光联动",
      group: "preview.postprocessingGroupBloom",
      getValue: () => cap.getParams().bloomFollowVolumetric,
      setValue: (v) => cap.setBloomFollowVolumetric(v as boolean),
    },
  ];
}

function ppcBuildSSAO(cap: PostprocessingCapability): MenuControlDef[] {
  return [
    {
      id: "pp-ssao-enabled",
      kind: "toggle",
      labelKey: "preview.ssao",
      fallback: "环境光遮蔽 (SSAO)",
      group: "preview.postprocessingGroupSsao",
      getValue: () => cap.getParams().ssaoEnabled,
      setValue: (v) => cap.setSSAOEnabled(v as boolean),
    },
    {
      id: "pp-ssao-radius",
      kind: "slider",
      labelKey: "preview.ssaoRadius",
      fallback: "SSAO 采样半径",
      group: "preview.postprocessingGroupSsao",
      slider: { min: 0.5, max: 32, step: 0.5 },
      getValue: () => cap.getParams().ssaoRadius,
      setValue: (v) => cap.setSSAORadius(v as number),
    },
    {
      id: "pp-ssao-mindist",
      kind: "slider",
      labelKey: "preview.ssaoMinDist",
      fallback: "SSAO 最小距离",
      group: "preview.postprocessingGroupSsao",
      slider: { min: 0.001, max: 0.05, step: 0.001 },
      getValue: () => cap.getParams().ssaoMinDist,
      setValue: (v) => cap.setSSAOMinDist(v as number),
    },
    {
      id: "pp-ssao-maxdist",
      kind: "slider",
      labelKey: "preview.ssaoMaxDist",
      fallback: "SSAO 最大距离",
      group: "preview.postprocessingGroupSsao",
      slider: { min: 0.01, max: 1, step: 0.01 },
      getValue: () => cap.getParams().ssaoMaxDist,
      setValue: (v) => cap.setSSAOMaxDist(v as number),
    },
  ];
}

function ppcBuildSSR(cap: PostprocessingCapability): MenuControlDef[] {
  return [
    {
      id: "pp-reflection-mode",
      kind: "select",
      labelKey: "preview.reflectionMode",
      fallback: "反射模式",
      group: "preview.postprocessingGroupReflection",
      select: [
        { value: "envmap-only", label: "仅环境贴图" },
        { value: "envmap+ssr", label: "环境贴图 + 屏幕空间" },
        { value: "ssr-only", label: "仅屏幕空间" },
      ],
      getValue: () => cap.getParams().reflectionMode,
      setValue: (v) => cap.setReflectionMode(v as ReflectionMode),
    },
    {
      id: "pp-reflector-disable-when-ssr",
      kind: "toggle",
      labelKey: "preview.reflectorDisableWhenSSR",
      fallback: "SSR 时自动禁用地面镜面",
      group: "preview.postprocessingGroupReflection",
      getValue: () => cap.getParams().reflectorDisableWhenSSR,
      setValue: (v) => cap.setReflectorDisableWhenSSR(v as boolean),
    },
    {
      id: "pp-ssr-opacity",
      kind: "slider",
      labelKey: "preview.ssrOpacity",
      fallback: "SSR 反射强度",
      group: "preview.postprocessingGroupSsr",
      slider: { min: 0, max: 1, step: 0.02 },
      getValue: () => cap.getParams().ssrOpacity,
      setValue: (v) => cap.setSSROpacity(v as number),
    },
    {
      id: "pp-ssr-maxdistance",
      kind: "slider",
      labelKey: "preview.ssrMaxDistance",
      fallback: "SSR 最大距离",
      group: "preview.postprocessingGroupSsr",
      slider: { min: 10, max: 800, step: 5 },
      getValue: () => cap.getParams().ssrMaxDistance,
      setValue: (v) => cap.setSSRMaxDistance(v as number),
    },
    {
      id: "pp-ssr-thickness",
      kind: "slider",
      labelKey: "preview.ssrThickness",
      fallback: "SSR 厚度判定",
      group: "preview.postprocessingGroupSsr",
      slider: { min: 0.001, max: 0.1, step: 0.001 },
      getValue: () => cap.getParams().ssrThickness,
      setValue: (v) => cap.setSSRThickness(v as number),
    },
    {
      id: "pp-ssr-blur",
      kind: "toggle",
      labelKey: "preview.ssrBlur",
      fallback: "SSR 模糊",
      group: "preview.postprocessingGroupSsr",
      getValue: () => cap.getParams().ssrBlur,
      setValue: (v) => cap.setSSRBlur(v as boolean),
    },
    {
      id: "pp-ssr-distanceAttenuation",
      kind: "toggle",
      labelKey: "preview.ssrDistanceAttenuation",
      fallback: "SSR 距离衰减",
      group: "preview.postprocessingGroupSsr",
      getValue: () => cap.getParams().ssrDistanceAttenuation,
      setValue: (v) => cap.setSSRDistanceAttenuation(v as boolean),
    },
    {
      id: "pp-ssr-fresnel",
      kind: "toggle",
      labelKey: "preview.ssrFresnel",
      fallback: "SSR 菲涅尔",
      group: "preview.postprocessingGroupSsr",
      getValue: () => cap.getParams().ssrFresnel,
      setValue: (v) => cap.setSSRFresnel(v as boolean),
    },
    {
      id: "pp-ssr-bouncing",
      kind: "toggle",
      labelKey: "preview.ssrBouncing",
      fallback: "SSR 多重弹射（慢）",
      group: "preview.postprocessingGroupSsr",
      getValue: () => cap.getParams().ssrBouncing,
      setValue: (v) => cap.setSSRBouncing(v as boolean),
    },
  ];
}

/** 模型类别后处理预设 */
export const POSTPROC_PRESETS: Record<string, Partial<PostprocessingParams>> = {
  default: { ...DEFAULT_POSTPROC_PARAMS },
  ysm: {
    // 方块：后处理薄，避免像素感丢失；SSR off（方块 PBR 效果有限）
    enabled: false, bloomStrength: 0.3, bloomThreshold: 0.85, bloomRadius: 0.3,
    ssaoEnabled: false, toneMapping: "aces", exposure: 1.0,
    reflectionMode: "envmap-only", reflectorDisableWhenSSR: true,
  },
  vrm: {
    // PBR 角色：Bloom 柔光 + SSAO 中档 + SSR 默认开（金属皮肤反射明显）
    // ✨ v1.14 调优：默认开启后处理，Bloom 更柔和自然
    enabled: true, bloomStrength: 0.6, bloomThreshold: 0.7, bloomRadius: 0.5,
    ssaoEnabled: false, ssaoRadius: 10, toneMapping: "aces", exposure: 1.05,
    reflectionMode: "envmap-only", ssrOpacity: 0.5, ssrMaxDistance: 180, reflectorDisableWhenSSR: true,
  },
  mmd: {
    // toon：Bloom 阈值提升防白天天空全图泛白（§2 曝光治理）；toon 自发光仍有溢出但范围收敛
    // 前值 v1.14：strength=1.0 threshold=0.5 radius=0.9 → 过强，天空亮区 >0.5 触发 Bloom → 整片泛白
    enabled: true, bloomStrength: 0.85, bloomThreshold: 0.7, bloomRadius: 0.8,
    ssaoEnabled: false, ssaoRadius: 6, toneMapping: "aces", exposure: 1.05,
    reflectionMode: "envmap-only",
  },
  litematic: {
    // 体素：Bloom 小，SSAO 关（无明显细节反而出噪声）；SSR 关（方块反射无细节）
    enabled: false, bloomStrength: 0.3, bloomThreshold: 0.9, bloomRadius: 0.2,
    ssaoEnabled: false, toneMapping: "aces", exposure: 1.0,
    reflectionMode: "envmap-only",
  },
  resourcepack: {
    enabled: false, bloomStrength: 0.3, bloomThreshold: 0.85, bloomRadius: 0.3,
    ssaoEnabled: false, toneMapping: "aces", exposure: 1.0,
    reflectionMode: "envmap-only",
  },
  "mmd-scene": {
    // 场景模型：Bloom 稍强出氛围，SSAO 中档增加纵深，SSR 开（场景地面反射）
    // 阈值从 0.55 → 0.72（§2 曝光治理）：避免大面积天空触发 Bloom，保留场景高光与自发光溢出
    enabled: false, bloomStrength: 0.8, bloomThreshold: 0.72, bloomRadius: 0.85,
    ssaoEnabled: false, ssaoRadius: 15, toneMapping: "aces", exposure: 1.0,
    reflectionMode: "envmap-only",
  },
};

export class PostprocessingCapability implements SceneCapability, PostprocessingLike {
  readonly id = "postprocessing";
  readonly labelKey = "preview.postprocessing";
  readonly icon = "🎇";
  readonly descKey = "preview.postprocessingDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private params: PostprocessingParams;
  private enabled: boolean;

  // composer
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private ssrPass: SSRPass | null = null;
  private outputPass: OutputPass | null = null;

  // 联动 ReflectorCapability（SSR 开启时可自动禁用）
  private reflectorCap: ReflectorCapability | null = null;
  // 记录上次 SSR on 时 Reflector 原本 enabled，SSR 关闭时精确恢复
  private reflectorPrevEnabled: boolean | undefined;

  // prev 状态（dispose 还原）
  private prevToneMapping: THREE.ToneMapping;
  private prevOutputColorSpace: string;
  private prevExposure: number;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    params?: Partial<PostprocessingParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.camera = opts.camera;
    this.params = { ...DEFAULT_POSTPROC_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;

    this.prevToneMapping = this.renderer.toneMapping;
    this.prevOutputColorSpace = this.renderer.outputColorSpace;
    this.prevExposure = this.renderer.toneMappingExposure;

    // 曝光归权：enabled=false 时绝不触碰 renderer（保留 SkyCapability 的低曝光值）
    if (this.enabled) this.applyToneMapping();
  }

  /* -------- 内部：构建/销毁 composer -------- */

  private needComposer(lightCap: LightCapability | null): boolean {
    if (this.enabled) return true;
    const useVolumetric = lightCap &&
      lightCap.getVolumetricEngine() === "postprocess" &&
      lightCap.getParams().volumetric.enabled;
    return !!useVolumetric;
  }

  private createComposerBase(): EffectComposer {
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(logicalSize.x, 1);
    const h = Math.max(logicalSize.y, 1);
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
    composer.setSize(w, h);

    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);

    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);

    return composer;
  }

  private attachSSAOPass(composer: EffectComposer): void {
    if (!this.params.ssaoEnabled) return;
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(logicalSize.x, 1);
    const h = Math.max(logicalSize.y, 1);
    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h, 32);
    this.ssaoPass.kernelRadius = this.params.ssaoRadius;
    this.ssaoPass.minDistance = this.params.ssaoMinDist;
    this.ssaoPass.maxDistance = this.params.ssaoMaxDist;
    this.ssaoPass.output = (SSAOPass as unknown as { OUTPUT: { Default: number } }).OUTPUT?.Default ?? 0;
    const renderPassIndex = composer.passes.indexOf(this.renderPass!);
    composer.passes.splice(renderPassIndex + 1, 0, this.ssaoPass);
  }

  private attachSSRAndBloomPasses(composer: EffectComposer, useSSR: boolean): void {
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(logicalSize.x, 1);
    const h = Math.max(logicalSize.y, 1);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      this.params.bloomStrength,
      this.params.bloomRadius,
      this.params.bloomThreshold,
    );
    const outputPassIndex = composer.passes.indexOf(this.outputPass!);
    composer.passes.splice(outputPassIndex, 0, this.bloomPass);

    if (useSSR) {
      this.ssrPass = new SSRPass({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        width: w,
        height: h,
        selects: null,
        groundReflector: null,
        isBouncing: this.params.ssrBouncing,
      });
      this.ssrPass.output = SSRPASS_OUTPUT_DEFAULT;
      this.ssrPass.opacity = this.params.ssrOpacity;
      this.ssrPass.maxDistance = this.params.ssrMaxDistance;
      this.ssrPass.thickness = this.params.ssrThickness;
      this.ssrPass.blur = this.params.ssrBlur;
      this.ssrPass.distanceAttenuation = this.params.ssrDistanceAttenuation;
      this.ssrPass.fresnel = this.params.ssrFresnel;
      if (this.params.reflectionMode === "ssr-only") this.ssrPass.opacity = 1;
      const bloomIndex = composer.passes.indexOf(this.bloomPass!);
      composer.passes.splice(bloomIndex + 1, 0, this.ssrPass);
    }
  }

  private buildComposer(): void {
    this.disposeComposer();
    const useSSR = this.params.reflectionMode !== "envmap-only";
    this.composer = this.createComposerBase();
    this.attachSSAOPass(this.composer);
    this.attachSSRAndBloomPasses(this.composer, useSSR);
    this.applyReflectorSync();
  }

  private disposeComposer(): void {
    this.ssaoPass?.dispose();
    this.ssaoPass = null;
    this.ssrPass?.dispose();
    this.ssrPass = null;
    this.renderPass?.dispose();
    this.renderPass = null;
    this.bloomPass?.dispose();
    this.bloomPass = null;
    this.outputPass?.dispose();
    this.outputPass = null;
    this.composer?.dispose();
    this.composer = null;
  }

  /* -------- Reflector 联动：SSR on 时可自动禁用 ReflectorCapability 单平面镜面 -------- */

  private ssrIsActive(): boolean {
    return this.params.reflectionMode !== "envmap-only";
  }

  private applyReflectorSync(): void {
    if (!this.reflectorCap) return;
    // SSR 活动 + 用户设置了 reflectorDisableWhenSSR
    const shouldDisableReflector = this.ssrIsActive() && this.params.reflectorDisableWhenSSR;
    if (shouldDisableReflector) {
      if (this.reflectorPrevEnabled === undefined) {
        this.reflectorPrevEnabled = this.reflectorCap.isEnabled();
      }
      if (this.reflectorCap.isEnabled()) this.reflectorCap.setEnabled(false);
    } else {
      // 还原：当 SSR 不活动或用户取消了 reflectorDisableWhenSSR
      if (this.reflectorPrevEnabled !== undefined) {
        this.reflectorCap.setEnabled(this.reflectorPrevEnabled);
        this.reflectorPrevEnabled = undefined;
      }
    }
  }

  /** 由 mount-preview-core wiring：registry createAll 之后注入 ReflectorCapability 引用 */
  setReflectorCap(cap: ReflectorCapability | null): void {
    // 切新引用前先还原旧引用（若之前禁用了 reflector）
    if (this.reflectorCap && this.reflectorCap !== cap && this.reflectorPrevEnabled !== undefined) {
      this.reflectorCap.setEnabled(this.reflectorPrevEnabled);
      this.reflectorPrevEnabled = undefined;
    }
    this.reflectorCap = cap;
    this.applyReflectorSync();
  }

  /* -------- 参数应用 -------- */

  private applyToneMapping(): void {
    this.renderer.toneMapping = THREE_TONE_MAPPING[this.params.toneMapping];
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMappingExposure = this.params.exposure;
  }

  private syncBloomPass(lightCap: LightCapability | null): void {
    if (!this.bloomPass) return;
    if (this.params.bloomFollowVolumetric && lightCap) {
      const vol = lightCap.getParams().volumetric;
      this.bloomPass.threshold = Math.max(0.05, 0.5 - vol.opacity * 0.3);
      this.bloomPass.strength = vol.opacity * 1.5;
      this.bloomPass.radius = vol.edgeFade * 0.5 + 0.1;
    } else {
      this.bloomPass.threshold = this.params.bloomThreshold;
      this.bloomPass.strength = this.params.bloomStrength;
      this.bloomPass.radius = this.params.bloomRadius;
    }
  }

  private syncSSAOPass(): void {
    if (!this.ssaoPass) return;
    this.ssaoPass.kernelRadius = this.params.ssaoRadius;
    this.ssaoPass.minDistance = this.params.ssaoMinDist;
    this.ssaoPass.maxDistance = this.params.ssaoMaxDist;
  }

  private syncSSRPass(): void {
    if (!this.ssrPass) return;
    this.ssrPass.opacity = this.params.reflectionMode === "ssr-only" ? 1 : this.params.ssrOpacity;
    this.ssrPass.maxDistance = this.params.ssrMaxDistance;
    this.ssrPass.thickness = this.params.ssrThickness;
    this.ssrPass.blur = this.params.ssrBlur;
    this.ssrPass.distanceAttenuation = this.params.ssrDistanceAttenuation;
    this.ssrPass.fresnel = this.params.ssrFresnel;
    this.ssrPass.bouncing = this.params.ssrBouncing;
  }

  /* -------- 兼容旧 PostprocessingManager 对外 API -------- */

  /** 每帧调用：若返回 true 表示已渲染（composer.render）；否则调用方需 renderer.render */
  render(dt: number, lightCap: LightCapability | null): boolean {
    const need = this.needComposer(lightCap);
    if (!need) {
      if (this.composer) this.disposeComposer();
      return false;
    }
    if (!this.composer) this.buildComposer();
    this.syncBloomPass(lightCap);
    this.syncSSAOPass();
    this.syncSSRPass();
    this.composer!.render(dt);
    return true;
  }

  setSize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
      if (this.bloomPass) this.bloomPass.resolution = new THREE.Vector2(width, height);
      if (this.ssrPass) { this.ssrPass.width = width; this.ssrPass.height = height; this.ssrPass.setSize(width, height); }
    }
  }

  setPixelRatio(pixelRatio: number): void {
    this.composer?.setPixelRatio(pixelRatio);
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    // 曝光归权：enabled=false 时跳 applyToneMapping，让 SkyCapability 的曝光值成为事实源
    if (this.enabled) this.applyToneMapping();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    if (v) {
      // 切到 on：立刻写入当前 tone mapping / exposure 到 renderer
      this.buildComposer();
      this.applyToneMapping();
    } else {
      this.disposeComposer();
      // 切到 off：不主动改 renderer exposure/toneMapping，交给 dispose 精确还原 prev 值
      // （SkyCapability 仍会在 apply/setTime 时重写自己的曝光值，不会长期残留 postproc 的高曝光）
    }
    this.applyReflectorSync();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getParams(): PostprocessingParams {
    return this.params;
  }

  setPreset(modelType: string): void {
    const preset = POSTPROC_PRESETS[modelType] ?? POSTPROC_PRESETS.default;
    // 反射模式（SSR 三档）是用户显式选择：预设只做合理默认，不覆盖 loadState 恢复的持久化值
    // （对齐 fog「预设不强制覆盖用户选择」口径，修复重启后 SSR 模式被静默重置为 envmap-only）
    const { reflectionMode: _presetMode, ...presetRest } = preset;
    this.params = { ...this.params, ...presetRest };
    // 曝光归权：enabled=false 时 applyToneMapping 不写 renderer（避免覆盖 SkyCapability 写入值）
    if (this.enabled) this.applyToneMapping();
    if (this.composer) {
      this.buildComposer(); // 重新按预设构建（pass 组合可能改变）
    }
  }

  /* -------- 参数 setter -------- */

  setBloomStrength(v: number): void {
    this.params.bloomStrength = v;
    if (this.bloomPass) this.bloomPass.strength = v;
  }
  setBloomThreshold(v: number): void {
    this.params.bloomThreshold = v;
    if (this.bloomPass) this.bloomPass.threshold = v;
  }
  setBloomRadius(v: number): void {
    this.params.bloomRadius = v;
    if (this.bloomPass) this.bloomPass.radius = v;
  }
  setBloomFollowVolumetric(v: boolean): void {
    this.params.bloomFollowVolumetric = v;
  }

  setSSAOEnabled(v: boolean): void {
    this.params.ssaoEnabled = v;
    if (this.composer) this.buildComposer();
  }
  setSSAORadius(v: number): void {
    this.params.ssaoRadius = v;
    this.syncSSAOPass();
  }
  setSSAOMinDist(v: number): void {
    this.params.ssaoMinDist = v;
    this.syncSSAOPass();
  }
  setSSAOMaxDist(v: number): void {
    this.params.ssaoMaxDist = v;
    this.syncSSAOPass();
  }

  setToneMapping(v: PostprocessingParams["toneMapping"]): void {
    this.params.toneMapping = v;
    // 曝光归权：enabled=false 时只更新 params，不写 renderer（让 SkyCapability 的低曝光生效）
    if (this.enabled) this.applyToneMapping();
  }
  setExposure(v: number): void {
    this.params.exposure = v;
    if (this.enabled) this.applyToneMapping();
  }

  setReflectionMode(v: ReflectionMode): void {
    this.params.reflectionMode = v;
    if (this.composer) this.buildComposer(); // SSRPass 组合改变，必须重建
  }
  setSSROpacity(v: number): void {
    this.params.ssrOpacity = v;
    this.syncSSRPass();
  }
  setSSRMaxDistance(v: number): void {
    this.params.ssrMaxDistance = v;
    this.syncSSRPass();
  }
  setSSRThickness(v: number): void {
    this.params.ssrThickness = v;
    this.syncSSRPass();
  }
  setSSRBlur(v: boolean): void {
    this.params.ssrBlur = v;
    this.syncSSRPass();
  }
  setSSRDistanceAttenuation(v: boolean): void {
    this.params.ssrDistanceAttenuation = v;
    this.syncSSRPass();
  }
  setSSRFresnel(v: boolean): void {
    this.params.ssrFresnel = v;
    this.syncSSRPass();
  }
  setSSRBouncing(v: boolean): void {
    this.params.ssrBouncing = v;
    this.syncSSRPass();
  }
  setReflectorDisableWhenSSR(v: boolean): void {
    this.params.reflectorDisableWhenSSR = v;
    this.applyReflectorSync();
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [
      ...ppcBuildBasic(this),
      ...ppcBuildBloom(this),
      ...ppcBuildSSAO(this),
      ...ppcBuildSSR(this),
    ];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      bloomStrength: this.params.bloomStrength,
      bloomThreshold: this.params.bloomThreshold,
      bloomRadius: this.params.bloomRadius,
      bloomFollowVolumetric: this.params.bloomFollowVolumetric,
      ssaoEnabled: this.params.ssaoEnabled,
      ssaoRadius: this.params.ssaoRadius,
      ssaoMinDist: this.params.ssaoMinDist,
      ssaoMaxDist: this.params.ssaoMaxDist,
      toneMapping: this.params.toneMapping,
      exposure: this.params.exposure,
      reflectionMode: this.params.reflectionMode,
      ssrOpacity: this.params.ssrOpacity,
      ssrMaxDistance: this.params.ssrMaxDistance,
      ssrThickness: this.params.ssrThickness,
      ssrBlur: this.params.ssrBlur,
      ssrDistanceAttenuation: this.params.ssrDistanceAttenuation,
      ssrFresnel: this.params.ssrFresnel,
      ssrBouncing: this.params.ssrBouncing,
      reflectorDisableWhenSSR: this.params.reflectorDisableWhenSSR,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (typeof state.bloomStrength === "number") this.params.bloomStrength = state.bloomStrength;
    if (typeof state.bloomThreshold === "number") this.params.bloomThreshold = state.bloomThreshold;
    if (typeof state.bloomRadius === "number") this.params.bloomRadius = state.bloomRadius;
    if (typeof state.bloomFollowVolumetric === "boolean") this.params.bloomFollowVolumetric = state.bloomFollowVolumetric;
    if (typeof state.ssaoEnabled === "boolean") this.params.ssaoEnabled = state.ssaoEnabled;
    if (typeof state.ssaoRadius === "number") this.params.ssaoRadius = state.ssaoRadius;
    if (typeof state.ssaoMinDist === "number") this.params.ssaoMinDist = state.ssaoMinDist;
    if (typeof state.ssaoMaxDist === "number") this.params.ssaoMaxDist = state.ssaoMaxDist;
    if (typeof state.toneMapping === "string" && (THREE_TONE_MAPPING as Record<string, number>)[state.toneMapping] !== undefined) {
      this.params.toneMapping = state.toneMapping as PostprocessingParams["toneMapping"];
    }
    if (typeof state.exposure === "number") this.params.exposure = state.exposure;
    if (typeof state.reflectionMode === "string" && (state.reflectionMode === "envmap-only" || state.reflectionMode === "envmap+ssr" || state.reflectionMode === "ssr-only")) {
      this.params.reflectionMode = state.reflectionMode;
    }
    if (typeof state.ssrOpacity === "number") this.params.ssrOpacity = state.ssrOpacity;
    if (typeof state.ssrMaxDistance === "number") this.params.ssrMaxDistance = state.ssrMaxDistance;
    if (typeof state.ssrThickness === "number") this.params.ssrThickness = state.ssrThickness;
    if (typeof state.ssrBlur === "boolean") this.params.ssrBlur = state.ssrBlur;
    if (typeof state.ssrDistanceAttenuation === "boolean") this.params.ssrDistanceAttenuation = state.ssrDistanceAttenuation;
    if (typeof state.ssrFresnel === "boolean") this.params.ssrFresnel = state.ssrFresnel;
    if (typeof state.ssrBouncing === "boolean") this.params.ssrBouncing = state.ssrBouncing;
    if (typeof state.reflectorDisableWhenSSR === "boolean") this.params.reflectorDisableWhenSSR = state.reflectorDisableWhenSSR;
    // 曝光归权：只有恢复出来 enabled=true 时才写入 renderer tone mapping / exposure
    if (this.enabled) this.applyToneMapping();
    this.applyReflectorSync();
  }

  /* -------- 生命周期 -------- */

  dispose(): void {
    // SSR 禁用时若 reflector 被禁用，要恢复
    if (this.reflectorCap && this.reflectorPrevEnabled !== undefined) {
      this.reflectorCap.setEnabled(this.reflectorPrevEnabled);
      this.reflectorPrevEnabled = undefined;
    }
    this.disposeComposer();
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.outputColorSpace = this.prevOutputColorSpace as THREE.ColorSpace;
    this.renderer.toneMappingExposure = this.prevExposure;
  }
}
