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
//   - applyPostProcDefaults 按模型类别分：方块/体素 = Bloom 薄 + 关 SSAO（无明显细节）；VRM/MMD = SSAO 中档 + Bloom 柔光
//   - reflectionMode 三档：envmap-only (SSR off) / envmap+ssr (默认，SSR 叠上 envmap 反射当屏外 fallback) / ssr-only (SSR 无屏外补全)
//
// ADR-196 刀2：参数真值源从 this.params 迁移到全局 envState 单例。
// - 构造只留 scene/renderer/camera/enabled（enabled 默认 false，与 DEFAULT_POSTPROC_PARAMS.enabled 一致）
// - setter 收口为 setEnvState({ppXxx: v}, {source:'manual'})；callback 就地同步 pass 属性
// - 结构性变化（ssaoEnabled/reflectionMode）→ callback 内 rebuild composer
// - getParams() 从 envState 组装新对象（兼容层，供 menu/测试读）
// - saveState/loadState 沿用旧 params 键名（向后兼容已有存档），读写走 envState

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { PostprocessingLike } from "@/preview-3d/infra/postprocessing.ts";
import { previewPixelRatio } from "@/preview-3d/infra/render-budget.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import type { LightCapability } from "./light-capability.ts";
import { buildPostprocessingNodes } from "./postprocessing-menu.ts";
// 状态/序列化轴（PostprocessingParams / 默认值 / 光影包预设 / toneMapping 键表）已下沉
// postprocessing-state.ts；此处透传导出，保持既有调用方（postprocessing-capability.test.ts、
// cap-configs.test.ts 等）的 import 路径不破坏。THREE.ToneMapping 枚举求值仍在本文件
// toneMappingValue()（惰性，测试 mock 约束见 state 文件头注释）。
import {
  DEFAULT_POSTPROC_PARAMS,
  POSTPROC_PRESETS,
  type PostprocessingParams,
  type ReflectionMode,
} from "./postprocessing-state.ts";
import type { ReflectorCapability } from "./reflector-capability.ts";
import {
  getTypedCap,
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

export type { PostprocessingParams, ReflectionMode };
export { DEFAULT_POSTPROC_PARAMS, POSTPROC_PRESETS };

/** 惰性求值 THREE 枚举：调用期才触碰 THREE.ToneMapping（规避测试 mock 缺枚举导出的收集期崩溃） */
function toneMappingValue(key: PostprocessingParams["toneMapping"]): THREE.ToneMapping {
  switch (key) {
    case "none":
      return THREE.NoToneMapping;
    case "linear":
      return THREE.LinearToneMapping;
    case "reinhard":
      return THREE.ReinhardToneMapping;
    case "aces":
      return THREE.ACESFilmicToneMapping;
    case "cineon":
      return THREE.CineonToneMapping;
    default:
      return THREE.NoToneMapping;
  }
}

/** SSRPass.OUTPUT 枚举（0=Default 正常显示反射混合），其他调试项 1=Beauty 2=SSR 仅深度 3=Blur 4=Normal 5=Metalness 先不暴露 */
const SSRPASS_OUTPUT_DEFAULT = 0;

export class PostprocessingCapability implements SceneCapability, PostprocessingLike {
  readonly id = "postprocessing";
  readonly labelKey = "preview.postprocessing";
  readonly icon = "🎇";
  readonly descKey = "preview.postprocessingDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private enabled: boolean;

  // composer
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private ssrPass: SSRPass | null = null;
  private outputPass: OutputPass | null = null;

  // 联动 ReflectorCapability（SSR 开启时可自动禁用）——2026-09-14 起经构造注入的
  // caps 查询器现场取（getTypedCap(this.caps, "reflector")），替代原 setReflectorCap 注入器
  private readonly caps?: SceneCapabilityLookup;
  // [ADR-247 D2] SSR 联动抑制态。原实现只用单个 `reflectorPrevEnabled: boolean | undefined`
  // 承载「上一值 + 是否在抑制」两重语义，哨兵 undefined 与合法值 false 混淆：
  // SSR 抑制期间用户手动重开 reflector 后，SSR 关闭会用陈旧 prev 抹掉用户选择。
  // 现拆为显式两态——suppressing 表示「当前压制由本 cap 施加」，仅在 true 时才谈还原。
  private reflectorSuppressing = false;
  /** 本 cap 施加抑制前的 reflector 状态（仅 suppressing=true 期间有效） */
  private reflectorPrevEnabled = false;

  /** [ADR-247 D3] per-type 门禁（模型类别预设是否允许后处理）。
   *  与「性能档位总闸」正交：最终生效开关 = 总闸 && 门禁。手动开关（pp-enabled）绕过二者。
   *  ADR-196 删掉 params.enabled 双写后，门禁一度与生效开关共用 this.enabled，靠调用方
   *  `setMasterEnabled(v ? this.enabled : false)` 把门禁值回读再传回才得以存活——
   *  约束落在调用方、注释还引用了已删除的字段。现恢复为显式字段，语义自持。 */
  private perTypeGate = false;
  /** 性能档位总闸（render.bloom）。默认放行，由 applyPerfPreset 驱动。 */
  private perfMaster = true;

  // prev 状态（dispose 还原）
  private prevToneMapping: THREE.ToneMapping;
  private prevOutputColorSpace: string;
  private prevExposure: number;

  // ADR-196：取消订阅函数
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    enabled?: boolean;
    /** cap 间协调查询器（组合根 createAll 注入）——reflector 联动经查询器，不手工接线 */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.camera = opts.camera;
    // 条件赋值（对齐 sky/light 惯例）：exactOptionalPropertyTypes 下 undefined 不写入字段
    if (opts.caps !== undefined) this.caps = opts.caps;
    // ADR-196：enabled 默认 false（与 DEFAULT_POSTPROC_PARAMS.enabled 一致）
    this.enabled = opts.enabled ?? false;
    // [ADR-247 D3] 构造期 enabled 同时作为 per-type 门禁初值，保证「生效 = 总闸 && 门禁」
    // 在构造后立即自洽（总闸默认放行）。否则 setMasterEnabled 会因门禁初值 false 而无声失效。
    this.perTypeGate = this.enabled;

    this.prevToneMapping = this.renderer.toneMapping;
    this.prevOutputColorSpace = this.renderer.outputColorSpace;
    this.prevExposure = this.renderer.toneMappingExposure;

    // 曝光归权：enabled=false 时绝不触碰 renderer（保留 SkyCapability 的低曝光值）
    if (this.enabled) this.applyToneMapping();

    // ADR-196：订阅 envState 变更，同步 pass 属性 / 重建 composer（只接收 postprocessing 组的键）
    this.unsubscribeEnv = registerEnvCallback(this, this.onEnvChanged, "postprocessing");
  }

  /* -------- ADR-196：envState 变更回调（同步 pass 属性 / 重建 composer）-------- */

  private onEnvChanged = (changed: Set<string>, state: EnvState): void => {
    // 结构性变化（影响 pass 组合）→ 重建 composer（若已存在）
    if (changed.has("ppSsaoEnabled") || changed.has("ppReflectionMode")) {
      if (this.composer) this.buildComposer();
      return; // rebuild 创建新 pass，无需逐项同步
    }

    // 独立辉光开关 → 旁路 bloomPass
    if (changed.has("ppBloomEnabled") && this.bloomPass) {
      this.bloomPass.enabled = state.ppBloomEnabled;
    }

    // Bloom 参数（base 值；render() 时 syncBloomPass 应用体积光联动）
    if (
      this.bloomPass &&
      (changed.has("ppBloomStrength") ||
        changed.has("ppBloomThreshold") ||
        changed.has("ppBloomRadius"))
    ) {
      this.bloomPass.strength = state.ppBloomStrength;
      this.bloomPass.threshold = state.ppBloomThreshold;
      this.bloomPass.radius = state.ppBloomRadius;
    }

    // SSAO 参数
    if (
      this.ssaoPass &&
      (changed.has("ppSsaoRadius") || changed.has("ppSsaoMinDist") || changed.has("ppSsaoMaxDist"))
    ) {
      this.ssaoPass.kernelRadius = state.ppSsaoRadius;
      this.ssaoPass.minDistance = state.ppSsaoMinDist;
      this.ssaoPass.maxDistance = state.ppSsaoMaxDist;
    }

    // SSR 参数
    if (
      this.ssrPass &&
      (changed.has("ppSsrOpacity") ||
        changed.has("ppSsrMaxDistance") ||
        changed.has("ppSsrThickness") ||
        changed.has("ppSsrBlur") ||
        changed.has("ppSsrDistanceAttenuation") ||
        changed.has("ppSsrFresnel") ||
        changed.has("ppSsrBouncing"))
    ) {
      this.ssrPass.opacity = state.ppReflectionMode === "ssr-only" ? 1 : state.ppSsrOpacity;
      this.ssrPass.maxDistance = state.ppSsrMaxDistance;
      this.ssrPass.thickness = state.ppSsrThickness;
      this.ssrPass.blur = state.ppSsrBlur;
      this.ssrPass.distanceAttenuation = state.ppSsrDistanceAttenuation;
      this.ssrPass.fresnel = state.ppSsrFresnel;
      this.ssrPass.bouncing = state.ppSsrBouncing;
    }

    // 色彩映射 / 曝光
    if (this.enabled && (changed.has("ppExposure") || changed.has("ppToneMapping"))) {
      this.applyToneMapping();
    }

    // Reflector 联动
    if (changed.has("ppReflectorDisableWhenSSR")) {
      this.applyReflectorSync();
    }
  };

  /* -------- 内部：构建/销毁 composer -------- */

  private needComposer(lightCap: LightCapability | null): boolean {
    if (this.enabled) return true;
    // [ADR-246 D1] 原 volumetric 分支已删除：它要求 engine === "postprocess" &&
    // volumetric.enabled，而写入 postprocess 的同时该 enabled 已被强制置 false —— 条件恒不成立，
    // 是一段永不生效的死逻辑（postprocess 引擎本身也从未有任何体积光 pass）。
    // 体积光现由 cone 引擎（Geometry+Shader）独立渲染，不需要 composer。
    void lightCap;
    return false;
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
    if (!envState.ppSsaoEnabled) return;
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(logicalSize.x, 1);
    const h = Math.max(logicalSize.y, 1);
    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h, 32);
    this.ssaoPass.kernelRadius = envState.ppSsaoRadius;
    this.ssaoPass.minDistance = envState.ppSsaoMinDist;
    this.ssaoPass.maxDistance = envState.ppSsaoMaxDist;
    this.ssaoPass.output =
      (SSAOPass as unknown as { OUTPUT: { Default: number } }).OUTPUT?.Default ?? 0;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const renderPassIndex = composer.passes.indexOf(this.renderPass!);
    composer.passes.splice(renderPassIndex + 1, 0, this.ssaoPass);
  }

  private attachSSRAndBloomPasses(composer: EffectComposer, useSSR: boolean): void {
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(logicalSize.x, 1);
    const h = Math.max(logicalSize.y, 1);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      envState.ppBloomStrength,
      envState.ppBloomRadius,
      envState.ppBloomThreshold,
    );
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
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
        isBouncing: envState.ppSsrBouncing,
      });
      this.ssrPass.output = SSRPASS_OUTPUT_DEFAULT;
      this.ssrPass.opacity = envState.ppSsrOpacity;
      this.ssrPass.maxDistance = envState.ppSsrMaxDistance;
      this.ssrPass.thickness = envState.ppSsrThickness;
      this.ssrPass.blur = envState.ppSsrBlur;
      this.ssrPass.distanceAttenuation = envState.ppSsrDistanceAttenuation;
      this.ssrPass.fresnel = envState.ppSsrFresnel;
      if (envState.ppReflectionMode === "ssr-only") this.ssrPass.opacity = 1;
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      const bloomIndex = composer.passes.indexOf(this.bloomPass!);
      composer.passes.splice(bloomIndex + 1, 0, this.ssrPass);
    }
  }

  private buildComposer(): void {
    this.disposeComposer();
    const useSSR = envState.ppReflectionMode !== "envmap-only";
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

  /** 当前 reflector 能力实例（查询器现场取；createAll 时 reflector 先于本 cap 创建，查询即就绪） */
  private reflectorCap(): ReflectorCapability | undefined {
    return getTypedCap(this.caps, "reflector");
  }

  private ssrIsActive(): boolean {
    return envState.ppReflectionMode !== "envmap-only";
  }

  private applyReflectorSync(): void {
    const reflectorCap = this.reflectorCap();
    if (!reflectorCap) return;
    // SSR 活动 + 用户设置了 reflectorDisableWhenSSR
    const shouldDisableReflector = this.ssrIsActive() && envState.ppReflectorDisableWhenSSR;
    if (shouldDisableReflector) {
      // 首次施加压制时记录原值（后续同步不覆盖基准）
      if (!this.reflectorSuppressing) {
        this.reflectorPrevEnabled = reflectorCap.isEnabled();
        this.reflectorSuppressing = true;
      }
      if (reflectorCap.isEnabled()) reflectorCap.setEnabled(false);
    } else if (this.reflectorSuppressing) {
      // 解除压制。本同步是 pull 式（仅由 postprocessing 侧事件触发），无法观测用户手动
      // 拨动 reflector 开关——故以「reflector 此刻是否仍处于我们压下的关闭态」判定归属：
      //   · 仍为 false → 压制仍由我们持有 → 还原 prev（压制前用户意图）
      //   · 已为 true  → 用户手动重开过 → 我们已非持有者，保留用户选择，不回放陈旧 prev
      // 两种情况都清空抑制态，保证下一轮 SSR 能重新记录基准。
      if (!reflectorCap.isEnabled()) {
        reflectorCap.setEnabled(this.reflectorPrevEnabled);
      }
      this.reflectorSuppressing = false;
    }
  }

  /* -------- 参数应用 -------- */

  private applyToneMapping(): void {
    this.renderer.toneMapping = toneMappingValue(envState.ppToneMapping);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMappingExposure = envState.ppExposure;
  }

  private syncBloomPass(lightCap: LightCapability | null): void {
    if (!this.bloomPass) return;
    // 独立辉光开关：false 时整个 bloomPass 旁路（Pass.enabled=false），不影响 SSAO/SSR
    this.bloomPass.enabled = envState.ppBloomEnabled;
    if (!envState.ppBloomEnabled) return;
    if (envState.ppBloomFollowVolumetric && lightCap) {
      const vol = lightCap.getParams().volumetric;
      // [ADR-247] 联动门禁只看联动开关本身，读「浓度意图」opacity，与体积光「此刻是否可见」解耦。
      // 历史：ADR-246 D1 曾把门禁收紧为 volumetric.enabled（原实现无条件读 opacity，而该
      // opacity 在 postprocess 模式下被引擎强制关闭，更荒谬）——但读「可见性」会让联动开关
      // 继承另一功能的运行时状态：默认配置（联动 on + 体积光 off）下 gain 恒 0，开关显示
      // 「开」却从不生效，正是「开关撒谎」。联动语义是「是否接受体积光浓度调制 bloom」的
      // 用户偏好；可见性取决于聚光灯这一物理前置，不该静默撤销用户偏好。
      const gain = vol.opacity;
      // [doc:adr-126-p5] 联动解耦（用户拍板方案 b）：以用户设置（bloomStrength/bloomThreshold）
      // 为基准，体积光 opacity 仅做 ±20% 微调。此前 opacity 直接放大成 strength 系数
      //（满值 1.5 = 默认 2.5 倍）+ 阈值压到 0.2——开体积光即亮爆；体积光是光柱浓度语义，
      // 不该主导全局 bloom。radius 保持用户设置（edgeFade 联动半径本就怪）。
      this.bloomPass.threshold = envState.ppBloomThreshold * (1 - 0.2 * gain);
      this.bloomPass.strength = envState.ppBloomStrength * (1 + 0.2 * gain);
      this.bloomPass.radius = envState.ppBloomRadius;
    } else {
      this.bloomPass.threshold = envState.ppBloomThreshold;
      this.bloomPass.strength = envState.ppBloomStrength;
      this.bloomPass.radius = envState.ppBloomRadius;
    }
  }

  private syncSSAOPass(): void {
    if (!this.ssaoPass) return;
    this.ssaoPass.kernelRadius = envState.ppSsaoRadius;
    this.ssaoPass.minDistance = envState.ppSsaoMinDist;
    this.ssaoPass.maxDistance = envState.ppSsaoMaxDist;
  }

  private syncSSRPass(): void {
    if (!this.ssrPass) return;
    this.ssrPass.opacity = envState.ppReflectionMode === "ssr-only" ? 1 : envState.ppSsrOpacity;
    this.ssrPass.maxDistance = envState.ppSsrMaxDistance;
    this.ssrPass.thickness = envState.ppSsrThickness;
    this.ssrPass.blur = envState.ppSsrBlur;
    this.ssrPass.distanceAttenuation = envState.ppSsrDistanceAttenuation;
    this.ssrPass.fresnel = envState.ppSsrFresnel;
    this.ssrPass.bouncing = envState.ppSsrBouncing;
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
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.composer!.render(dt);
    return true;
  }

  setSize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
      if (this.bloomPass) this.bloomPass.resolution = new THREE.Vector2(width, height);
      if (this.ssrPass) {
        this.ssrPass.width = width;
        this.ssrPass.height = height;
        this.ssrPass.setSize(width, height);
      }
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

  /** 性能档位总闸（render.bloom 绑定入口）：[ADR-247 D3] 只写总闸字段，生效开关 = 总闸 && 门禁。
   *  门禁由 applyPostProcDefaults 维护，总闸 off 不得抹掉门禁（否则 off→on 循环后
   *  bloom 再也开不回来）——该保护现由本方法自持，不再依赖调用方把门禁值回读传回。
   *  手动开关（pp-enabled）走 setEnabled，不受总闸/门禁限制。 */
  setMasterEnabled(v: boolean): void {
    this.perfMaster = v;
    this.syncEffectiveEnabled();
  }

  /** 按「总闸 && 门禁」重算生效开关并落地副作用（composer 构建/销毁 + 曝光 + reflector 联动） */
  private syncEffectiveEnabled(): void {
    const next = this.perfMaster && this.perTypeGate;
    if (this.enabled === next) return;
    this.enabled = next;
    if (next) {
      this.buildComposer();
      this.applyToneMapping();
    } else {
      this.disposeComposer();
    }
    this.applyReflectorSync();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** ADR-196：从 envState 组装 PostprocessingParams 新对象（兼容层，供 menu/测试读） */
  getParams(): PostprocessingParams {
    return {
      enabled: this.enabled,
      bloomStrength: envState.ppBloomStrength,
      bloomThreshold: envState.ppBloomThreshold,
      bloomRadius: envState.ppBloomRadius,
      bloomFollowVolumetric: envState.ppBloomFollowVolumetric,
      bloomEnabled: envState.ppBloomEnabled,
      ssaoEnabled: envState.ppSsaoEnabled,
      ssaoRadius: envState.ppSsaoRadius,
      ssaoMinDist: envState.ppSsaoMinDist,
      ssaoMaxDist: envState.ppSsaoMaxDist,
      toneMapping: envState.ppToneMapping,
      exposure: envState.ppExposure,
      reflectionMode: envState.ppReflectionMode,
      ssrOpacity: envState.ppSsrOpacity,
      ssrMaxDistance: envState.ppSsrMaxDistance,
      ssrThickness: envState.ppSsrThickness,
      ssrBlur: envState.ppSsrBlur,
      ssrDistanceAttenuation: envState.ppSsrDistanceAttenuation,
      ssrFresnel: envState.ppSsrFresnel,
      ssrBouncing: envState.ppSsrBouncing,
      reflectorDisableWhenSSR: envState.ppReflectorDisableWhenSSR,
    };
  }

  applyPostProcDefaults(modelType: string): void {
    const preset = POSTPROC_PRESETS[modelType] ?? POSTPROC_PRESETS.default;
    // per-type 门禁 enabled（不入 schema，单独携带）
    const { enabled: presetEnabled, ...presetEnv } = preset;

    // envState 亮度/参数覆盖（统一亮度口径：preset 当前为空，全部继承 envState 默认）
    if (Object.keys(presetEnv).length > 0) {
      setEnvState(presetEnv, { source: "auto-model" });
    }

    // [ADR-247 D3] 预设的 enabled 写入 per-type 门禁（不再直接写生效开关），
    // 生效开关由「总闸 && 门禁」重算——总闸 off 时门禁仍被正确记录，off→on 可恢复。
    const gateChanged = presetEnabled !== undefined && presetEnabled !== this.perTypeGate;
    if (presetEnabled !== undefined) {
      this.perTypeGate = presetEnabled;
    }
    this.syncEffectiveEnabled();
    // 门禁未翻转但生效开关已开：envState 可能更新了参数 → 重建 composer 同步 pass 组合
    // （翻转路径已由 syncEffectiveEnabled 构建过，二者互斥，避免 double build）
    if (!gateChanged && this.enabled) {
      if (this.composer) this.buildComposer();
      this.applyToneMapping();
    }
  }

  /* -------- 参数 setter（ADR-196：收口为 setEnvState）-------- */

  setBloomStrength(v: number): void {
    setEnvState({ ppBloomStrength: v }, { source: "manual" });
  }
  setBloomThreshold(v: number): void {
    setEnvState({ ppBloomThreshold: v }, { source: "manual" });
  }
  setBloomRadius(v: number): void {
    setEnvState({ ppBloomRadius: v }, { source: "manual" });
  }
  setBloomFollowVolumetric(v: boolean): void {
    setEnvState({ ppBloomFollowVolumetric: v }, { source: "manual" });
  }
  setBloomEnabled(v: boolean): void {
    setEnvState({ ppBloomEnabled: v }, { source: "manual" });
  }

  setSSAOEnabled(v: boolean): void {
    setEnvState({ ppSsaoEnabled: v }, { source: "manual" });
  }
  setSSAORadius(v: number): void {
    setEnvState({ ppSsaoRadius: v }, { source: "manual" });
  }
  setSSAOMinDist(v: number): void {
    setEnvState({ ppSsaoMinDist: v }, { source: "manual" });
  }
  setSSAOMaxDist(v: number): void {
    setEnvState({ ppSsaoMaxDist: v }, { source: "manual" });
  }

  setToneMapping(v: PostprocessingParams["toneMapping"]): void {
    setEnvState({ ppToneMapping: v }, { source: "manual" });
  }
  setExposure(v: number): void {
    setEnvState({ ppExposure: v }, { source: "manual" });
  }

  setReflectionMode(v: ReflectionMode): void {
    setEnvState({ ppReflectionMode: v }, { source: "manual" });
  }
  setSSROpacity(v: number): void {
    setEnvState({ ppSsrOpacity: v }, { source: "manual" });
  }
  setSSRMaxDistance(v: number): void {
    setEnvState({ ppSsrMaxDistance: v }, { source: "manual" });
  }
  setSSRThickness(v: number): void {
    setEnvState({ ppSsrThickness: v }, { source: "manual" });
  }
  setSSRBlur(v: boolean): void {
    setEnvState({ ppSsrBlur: v }, { source: "manual" });
  }
  setSSRDistanceAttenuation(v: boolean): void {
    setEnvState({ ppSsrDistanceAttenuation: v }, { source: "manual" });
  }
  setSSRFresnel(v: boolean): void {
    setEnvState({ ppSsrFresnel: v }, { source: "manual" });
  }
  setSSRBouncing(v: boolean): void {
    setEnvState({ ppSsrBouncing: v }, { source: "manual" });
  }
  setReflectorDisableWhenSSR(v: boolean): void {
    setEnvState({ ppReflectorDisableWhenSSR: v }, { source: "manual" });
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（能力总开关）-------- */
  /** 能力总开关节点 id（pp-enabled）：已升场景组根视图 headerToggle +
   *  面板首行统一经 filter 移除（复用 envCapSubNodes 同一剔除逻辑，防一二级双份）。 */
  getMasterNodeId(): string {
    return "pp-enabled";
  }

  /** 完整后处理节点树：基座 toggle + 5 文件夹（Color/Bloom/SSAO/Reflection/SSR）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildPostprocessingNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      bloomStrength: envState.ppBloomStrength,
      bloomThreshold: envState.ppBloomThreshold,
      bloomRadius: envState.ppBloomRadius,
      bloomFollowVolumetric: envState.ppBloomFollowVolumetric,
      bloomEnabled: envState.ppBloomEnabled,
      ssaoEnabled: envState.ppSsaoEnabled,
      ssaoRadius: envState.ppSsaoRadius,
      ssaoMinDist: envState.ppSsaoMinDist,
      ssaoMaxDist: envState.ppSsaoMaxDist,
      toneMapping: envState.ppToneMapping,
      exposure: envState.ppExposure,
      reflectionMode: envState.ppReflectionMode,
      ssrOpacity: envState.ppSsrOpacity,
      ssrMaxDistance: envState.ppSsrMaxDistance,
      ssrThickness: envState.ppSsrThickness,
      ssrBlur: envState.ppSsrBlur,
      ssrDistanceAttenuation: envState.ppSsrDistanceAttenuation,
      ssrFresnel: envState.ppSsrFresnel,
      ssrBouncing: envState.ppSsrBouncing,
      reflectorDisableWhenSSR: envState.ppReflectorDisableWhenSSR,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;

    // 表驱动恢复：存档键（params 名）→ envState 键，类型校验后写回
    restoreFields(state, {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
      bloomStrength: { number: (v) => setEnvState({ ppBloomStrength: v }, { source: "manual" }) },
      bloomThreshold: { number: (v) => setEnvState({ ppBloomThreshold: v }, { source: "manual" }) },
      bloomRadius: { number: (v) => setEnvState({ ppBloomRadius: v }, { source: "manual" }) },
      bloomFollowVolumetric: {
        boolean: (v) => setEnvState({ ppBloomFollowVolumetric: v }, { source: "manual" }),
      },
      bloomEnabled: { boolean: (v) => setEnvState({ ppBloomEnabled: v }, { source: "manual" }) },
      ssaoEnabled: { boolean: (v) => setEnvState({ ppSsaoEnabled: v }, { source: "manual" }) },
      ssaoRadius: { number: (v) => setEnvState({ ppSsaoRadius: v }, { source: "manual" }) },
      ssaoMinDist: { number: (v) => setEnvState({ ppSsaoMinDist: v }, { source: "manual" }) },
      ssaoMaxDist: { number: (v) => setEnvState({ ppSsaoMaxDist: v }, { source: "manual" }) },
      toneMapping: oneOf(["none", "linear", "reinhard", "aces", "cineon"], (v) =>
        setEnvState({ ppToneMapping: v }, { source: "manual" }),
      ),
      exposure: { number: (v) => setEnvState({ ppExposure: v }, { source: "manual" }) },
      reflectionMode: oneOf(["envmap-only", "envmap+ssr", "ssr-only"], (v) =>
        setEnvState({ ppReflectionMode: v }, { source: "manual" }),
      ),
      ssrOpacity: { number: (v) => setEnvState({ ppSsrOpacity: v }, { source: "manual" }) },
      ssrMaxDistance: { number: (v) => setEnvState({ ppSsrMaxDistance: v }, { source: "manual" }) },
      ssrThickness: { number: (v) => setEnvState({ ppSsrThickness: v }, { source: "manual" }) },
      ssrBlur: { boolean: (v) => setEnvState({ ppSsrBlur: v }, { source: "manual" }) },
      ssrDistanceAttenuation: {
        boolean: (v) => setEnvState({ ppSsrDistanceAttenuation: v }, { source: "manual" }),
      },
      ssrFresnel: { boolean: (v) => setEnvState({ ppSsrFresnel: v }, { source: "manual" }) },
      ssrBouncing: { boolean: (v) => setEnvState({ ppSsrBouncing: v }, { source: "manual" }) },
      reflectorDisableWhenSSR: {
        boolean: (v) => setEnvState({ ppReflectorDisableWhenSSR: v }, { source: "manual" }),
      },
    });

    // 曝光归权：只有恢复出来 enabled=true 时才写入 renderer tone mapping / exposure
    if (this.enabled) this.applyToneMapping();
    this.applyReflectorSync();
  }

  /* -------- 生命周期 -------- */

  dispose(): void {
    // SSR 禁用时若 reflector 被禁用，要恢复。
    // [ADR-247 D2] 判定与 applyReflectorSync 同口径：仅当我们仍持有压制（reflector 仍为
    // 关闭态）时才还原；用户压制期内已手动重开则保留其选择。
    const reflectorCap = this.reflectorCap();
    if (reflectorCap && this.reflectorSuppressing && !reflectorCap.isEnabled()) {
      reflectorCap.setEnabled(this.reflectorPrevEnabled);
    }
    this.reflectorSuppressing = false;
    this.unsubscribeEnv();
    this.disposeComposer();
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.outputColorSpace = this.prevOutputColorSpace as THREE.ColorSpace;
    this.renderer.toneMappingExposure = this.prevExposure;
  }
}
