// ===== PostprocessingCapability：后处理管线能力（ADR-073 caps/ 能力模式）=====
// 合并/升级原有 PostprocessingManager（原本只在 volumetric engine=postprocess 时激活）
// 为 SceneCapability 接口：独立开关 + Bloom 参数独立可调（原跟随 volumetric 做联动可开/关）+ SSAO + SSR。
//
// 设计要点：
//   - 兼容旧 PostprocessingManager 外部接口：render(dt, lightCap): boolean，setSize，dispose
//   - [ADR-250 §2.2 + ADR-299] composer **惰性常驻**：首次启用才建、dispose 才拆（会话轴），
//     关闭态既不建也**不参与每帧渲染**（render 返回 false，交回 render-host 直渲），
//     故「换模型」不再触发整组 GPU 资源重建，且默认关闭的会话零成本。
//     （ADR-299 实测：关闭态走 composer 每帧多耗 1.05ms GPU / +53.7%，另常驻 35.3MB 缓冲。）
//   - Pass 顺序：RenderPass → (SSRPass 可选，reflectionMode 控制) → (SSAOPass 可选) → UnrealBloomPass → OutputPass
//     （SSR 独占链首：它忽略 readBuffer、把自身 beauty 整片覆写进 writeBuffer，排前面才能让 SSAO/Bloom 叠加而非被吃掉）
//   - dispose 还原构造前 renderer.toneMapping 等输出设置，不泄漏
//   - SceneCapability 接口 + 注册表驱动：菜单自动渲染所有控件
//   - reflectionMode 三档：envmap-only (SSR off) / envmap+ssr (默认，SSR 叠上 envmap 反射当屏外 fallback) / ssr-only (SSR 无屏外补全)
//
// ADR-196 刀2：参数真值源从 this.params 迁移到全局 envState 单例。
// ADR-250：**启用意图亦入 envState（`ppEnabled`）**，本 cap 不再持有 enabled 字段；
//   `POSTPROC_PRESETS` / `applyPostProcDefaults` / `perTypeGate` / `perfMaster` /
//   `syncEffectiveEnabled` 全部退役——模型类别不再写 cap 私有字段（职责越界收口）。
//   `toneMappingExposure` 属主归 sky（有效曝光 = skyExposure × ppExposure），本 cap 只写
//   toneMapping / outputColorSpace。
// - 构造只留 scene/renderer/camera/caps（enabled 形参保留仅为兼容，经 setEnvState 落状态层）
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
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, isSsrRenderActive, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { pickModelDefaultFields, toModelType } from "@/preview-3d/state/model-defaults.ts";
import type { LightCapability } from "./light-capability.ts";
import { buildPostprocessingNodes } from "./postprocessing-menu.ts";
// 状态/序列化轴（PostprocessingParams / 默认值 / toneMapping 键表）已下沉
// postprocessing-state.ts；此处透传导出，保持既有调用方（postprocessing-capability.test.ts、
// cap-configs.test.ts 等）的 import 路径不破坏。THREE.ToneMapping 枚举求值仍在本文件
// toneMappingValue()（惰性，测试 mock 约束见 state 文件头注释）。
// [ADR-250] POSTPROC_PRESETS 已删除——模型类别默认偏好改走 MODEL_DEFAULTS 写 `ppEnabled`。
import {
  DEFAULT_POSTPROC_PARAMS,
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
export { DEFAULT_POSTPROC_PARAMS };

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

/** composer 读/写缓冲的 MSAA 采样数（与 renderer 的 antialias 意图对齐；WebGL2 下才生效） */
const POSTPROC_MSAA_SAMPLES = 4;

export class PostprocessingCapability implements SceneCapability, PostprocessingLike {
  readonly id = "postprocessing";
  /** [暗线 C1 收口] 面板渲染 id（core.ts dock 绑定）≠ cap id：面板用 postproc / cap 用 postprocessing */
  readonly panelId = "postproc";
  readonly labelKey = "preview.postprocessing";
  readonly icon = "sparkle";
  readonly descKey = "preview.postprocessingDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;

  // composer
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private ssrPass: SSRPass | null = null;
  private outputPass: OutputPass | null = null;

  // [ADR-299] composer 惰性常驻的尺寸凭据。关闭态 composer 尚未创建，render-host 每帧
  // 下发的 setSize / setPixelRatio 必须留下记录，否则首次启用时只能按
  // `previewPixelRatio(devicePixelRatio)` 现场猜——自适应降档（render-host 的
  // sampleAdaptivePixelRatio）后就会建出与 renderer 实际像素比不符的读写缓冲。
  private lastW = 0;
  private lastH = 0;
  private lastPixelRatio = 0;

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

  /** [ADR-250] 启用意图唯一真值源 = `envState.ppEnabled`，本 cap 不再持有该字段。
   *  历史：`enabled` 曾一枚字段扛三重语义（能力级挂载 / 模型类别门禁 perTypeGate /
   *  性能总闸 perfMaster），由 `syncEffectiveEnabled()` 二元相与重算，且被构造入参、
   *  loadState、setEnabled、applyPostProcDefaults 四条写路径写——ADR-247 R1 即「补一条漏一条」
   *  的产物。降参后写路径收敛为一条状态流，模型类别不再写 cap 私有字段。 */
  private get enabled(): boolean {
    return envState.ppEnabled;
  }

  // prev 状态（dispose 还原）
  // [ADR-250] prevExposure 已删除——曝光属主归 sky，本 cap 不再持有/归还该字段。
  private prevToneMapping: THREE.ToneMapping;
  private prevOutputColorSpace: string;

  // ADR-196：取消订阅函数
  private unsubscribeEnv: () => void;
  /** [R-1 收口 2026-09-22] 有存档 = 模型默认让位。ppEnabled 在 MODEL_DEFAULTS（ADR-250
   *  各模型显式写），恢复 source 改 auto-model 后若无守卫，同轨 auto-model→auto-model
   *  被 shouldOverwrite 放行 → 每次挂载模型值顶掉存档开关（fog/env 探针同形病）。 */
  private isStateLoaded = false;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    /** [ADR-250] 保留形参以兼容既有调用方/测试，但**不再写 cap 字段**——
     *  启用意图唯一真值源是 `envState.ppEnabled`。传值仅在显式给定时用于初始化该状态。 */
    enabled?: boolean;
    /** cap 间协调查询器（组合根 createAll 注入）——reflector 联动经查询器，不手工接线 */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.camera = opts.camera;
    // 条件赋值（对齐 sky/light 惯例）：exactOptionalPropertyTypes 下 undefined 不写入字段
    if (opts.caps !== undefined) this.caps = opts.caps;
    // [ADR-250] 显式传值才写状态层；不传则尊重 envState 现有值（含用户存档恢复的顺序）。
    // ⚠️ 顺序敏感：此处 setEnvState 发生在 registerEnvCallback **之前**，订阅者尚未就位，
    // 故其副作用（tone mapping 接管）不会自动触发——构造末尾显式补一次 apply()。
    if (opts.enabled !== undefined) {
      setEnvState({ ppEnabled: opts.enabled }, { source: "manual" });
    }

    this.prevToneMapping = this.renderer.toneMapping;
    this.prevOutputColorSpace = this.renderer.outputColorSpace;

    // [ADR-250 §2.2 → ADR-299] composer **惰性常驻**：构造期只在「启用意图已为真」时建
    // （存档恢复 / 调用方显式传 enabled=true 的场景）；默认 `ppEnabled=false`
    // （env-state-schema 默认值）的会话**一个 RenderTarget 都不分配**。
    // 实测依据（ADR-299）：关闭态走 composer 每帧多耗 1.05ms GPU（+53.7%，948×610@DPR1），
    // 另常驻 35.3MB 读写缓冲——而默认参数下真实效果（bloom/ssao/ssr 全关）只占 0.21ms，
    // 管线过路费是载荷的 5 倍。建后仍常驻（换模型/启停不销毁），ADR-250 §2.2 的
    // 「换模型不重建 GPU 资源」收益完整保留。
    // syncReflector=false：构造期不压制 reflector（见 buildComposer 注释）。
    if (this.enabled) this.buildComposer(false);

    // ADR-196：订阅 envState 变更，同步 pass 属性 / 重建 composer（只接收 postprocessing 组的键）
    this.unsubscribeEnv = registerEnvCallback(this, this.onEnvChanged, "postprocessing");
    // 订阅就位后补齐构造期已写状态的副作用（tone mapping 接管）。
    // ⚠️ **不在此调 applyReflectorSync**：SSR↔reflector 抑制是 pull 式、由启用动作驱动
    //（原实现在 buildComposer 内触发）。构造期未启用即压制 reflector 会越权，
    // 破坏「enable 才同步」的既有语义（reflector 联动测试锁死）。
    this.apply();
  }

  /* -------- ADR-196：envState 变更回调（同步 pass 属性 / 重建 composer）-------- */

  private onEnvChanged = (changed: Set<EnvStateKey>, state: EnvState): void => {
    // [ADR-250 + ADR-299] 启用意图翻转：不销毁 composer（常驻），只切每帧参与 + 归权输出设置；
    // 开启且尚未建时在此惰性创建（applyEnabledSideEffects 是唯一创建点）。
    if (changed.has("ppEnabled")) {
      this.applyEnabledSideEffects();
    }

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

    // 色彩映射（[ADR-250] 曝光已退出本 cap 属主范围，见 applyToneMapping）。
    // 保留 enabled 守卫：未启用时不得夺取 renderer.toneMapping（否则「关了后处理却改色调」）。
    if (this.enabled && changed.has("ppToneMapping")) {
      this.applyToneMapping();
    }

    // Reflector 联动
    if (changed.has("ppReflectorDisableWhenSSR")) {
      this.applyReflectorSync();
    }
  };

  /* -------- 内部：构建/销毁 composer -------- */

  /** [ADR-250 §2.2 + ADR-299] composer **生命周期**惰性常驻：首次启用才建，建后不随
   *  启用意图/模型切换销毁（GPU 资源与模型轴解耦的收益保留）。
   *  ⚠️ 但「生命周期常驻」≠「每帧都走 composer」——本方法答的是后者：关闭态一律 false，
   *  把渲染交回 render-host 的直渲兜底，避免 ADR-299 实测的 1.05ms/帧过路费。
   *  两者分开，才能既省每帧又保住「换模型不重建」。
   *  `lightCap` 形参保留以兼容 PostprocessingLike 契约与既有调用方。 */
  private needComposer(lightCap: LightCapability | null): boolean {
    // [ADR-246 D1] 体积光分支已删除（条件恒不成立）。
    void lightCap;
    return this.composer !== null && this.enabled;
  }

  private createComposerBase(): EffectComposer {
    // [ADR-299] 尺寸优先取 host 下发过的凭据（见字段注释），无凭据时才回落到 renderer 现值
    // 与 `previewPixelRatio`——惰性化后 composer 可能在会话中段才建，此时 devicePixelRatio
    // 已不能代表 renderer 的实际像素比（自适应降档）。
    const logicalSize = this.renderer.getSize(new THREE.Vector2());
    const w = this.lastW > 0 ? this.lastW : Math.max(logicalSize.x, 1);
    const h = this.lastH > 0 ? this.lastH : Math.max(logicalSize.y, 1);
    const pixelRatio =
      this.lastPixelRatio > 0 ? this.lastPixelRatio : previewPixelRatio(window.devicePixelRatio);
    // [P2 修复] EffectComposer 自建读/写缓冲时不带 samples（three r185 构造器：
    // `new WebGLRenderTarget(w, h, { type: HalfFloatType })`，samples 默认 0），而共享 renderer
    // 是 `antialias: true` 建的——后期一开，整链改画进非 MSAA 离屏缓冲 → 抗锯齿被静默旁路，
    // 边缘锯齿回归。此处显式给 composer 的缓冲开 MSAA，与 renderer 的抗锯齿意图对齐
    // （构造器会 `renderTarget.clone()` 作 renderTarget2，samples 随 copy() 一并带上；
    //  后续 setSize 只改尺寸，不丢 samples）。
    // 采样数按 renderer **实际**拿到的 antialias 属性决定：浏览器未授予时给 0，避免白付带宽。
    const gl = this.renderer.getContext() as WebGLRenderingContext | null | undefined;
    const antialiasGranted = gl?.getContextAttributes?.()?.antialias === true;
    const renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.round(w * pixelRatio)),
      Math.max(1, Math.round(h * pixelRatio)),
      { type: THREE.HalfFloatType, samples: antialiasGranted ? POSTPROC_MSAA_SAMPLES : 0 },
    );
    const composer = new EffectComposer(this.renderer, renderTarget);
    composer.setPixelRatio(pixelRatio);
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
      // ⚠️ groundReflector 必须保持 null（2026-09 读 three r185 源码核实）：SSRPass 期望的是
      // `ReflectorForSSRPass` 实例（`import { ReflectorForSSRPass } from "three/addons/objects/..."`），
      // 其 render 会调 `groundReflector.doRender(...)`——本仓用的是官方 `Reflector`（无 doRender），
      // 误接线会在 SSRPass.render 抛 "doRender is not a function"。
      // 且 ReflectorForSSRPass 是**替代品**而非附加品（自带与 SSR 对齐的 maxDistance/opacity/
      // fresnel uniform），要启用须整体替换 ReflectorCapability 的 mesh，不是在此补参数。
      // 现状无需它：SSR 活动时 applyReflectorSync 已按 envState.ppReflectorDisableWhenSSR（默认 true）
      // 压制单平面镜，双反射默认不可达。
      // selects=null 是**故意的**：使 SSRPass 的 `selective = Array.isArray(null) = false` →
      // 跳过 metalness pass（少一次整场渲染），全场景统一走非 select 分支。
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
      // [顺序修复] SSR 必须独占链首（紧跟 RenderPass）：读 three r185 SSRPass.js 核实，
      // OUTPUT.Default 分支把**自己的** beautyRenderTarget.texture 以 NoBlending 整片写入
      // writeBuffer（`readBuffer` 形参在 render() 里被注释忽略），因此任何排在它之前的 pass
      // （SSAO/Bloom）成果都会被覆盖——原顺序「Bloom → SSR」导致一开 SSR 就静默吃掉 Bloom/SSAO。
      // 插在 renderPass 之后即位于 SSAO 之前；SSAO 用 CustomBlending 叠在 readBuffer 上、
      // Bloom 也读 readBuffer，二者排在其后即可全保。
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      const renderPassIndex = composer.passes.indexOf(this.renderPass!);
      composer.passes.splice(renderPassIndex + 1, 0, this.ssrPass);
    }
  }

  private buildComposer(syncReflector = true): void {
    this.disposeComposer();
    const useSSR = envState.ppReflectionMode !== "envmap-only";
    this.composer = this.createComposerBase();
    this.attachSSAOPass(this.composer);
    this.attachSSRAndBloomPasses(this.composer, useSSR);
    // [ADR-250] 构造期建 composer 时不触发 reflector 抑制（`syncReflector=false`）：
    // 抑制是「启用后借走 reflector」的动作，未启用即压制属越权，且会破坏
    // 「enable 才同步」的既有语义（reflector 联动测试锁死）。
    if (syncReflector) this.applyReflectorSync();
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

  private applyReflectorSync(): void {
    const reflectorCap = this.reflectorCap();
    if (!reflectorCap) return;
    // 抑制门禁 = 真正在渲染 SSR（[锐评 F-1] 判定收编 state/env-state|isSsrRenderActive 单源，
    // 与 water-capability|reflectionActive 同源）：reflectionMode 配置 + 启用意图 ppEnabled
    // 同时成立。历史：原实现只看 reflectionMode，导致「用户关掉整条后处理、SSR pass 已
    // 旁路（render() 里 ssrPass.enabled=false）」时，镜子仍被压制——SSR 没在渲染却白禁了
    // 单平面镜。关掉后处理（ppEnabled=false）就该放回镜子、退出抑制态。
    const shouldDisableReflector = isSsrRenderActive() && envState.ppReflectorDisableWhenSSR;
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

  /**
   * 写入色彩映射。[ADR-250 §2.3] **不再写 `toneMappingExposure`**——曝光属主归 sky。
   *
   * 历史（本 ADR 的根因）：本方法与 `SkyCapability.apply()` 并写同一个
   * `renderer.toneMappingExposure`，值为 `ppExposure`(全局 1.0) 对 `skyExposure`(per-type 0.5~0.6)。
   * 后处理一开即夺走属主，造成约 1.8× 亮度跳变——这才是「MMD 亮瞎」的真因
   * （per-type 亮度参数实为空，见 ADR §1.1）。且该跳变被误归因为「切档位忘了归还」，
   * 「切模型门禁翻 true」这条同源路径从未被识别。
   *
   * 现口径：`renderer.toneMappingExposure = skyExposure × ppExposure`，由 sky 侧统一写入
   * （`sky-capability.ts|applyExposure`），本 cap 只负责 tone mapping 与色彩空间。
   */
  private applyToneMapping(): void {
    this.renderer.toneMapping = toneMappingValue(envState.ppToneMapping);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /**
   * 归还输出设置给构造前的值。
   *
   * [ADR-250 §2.3] 曝光已不在本 cap 属主范围内——`toneMappingExposure` 由 sky 独占
   * （`skyExposure × ppExposure`），故此处**只归还 toneMapping / outputColorSpace**。
   * 原实现归还 exposure 的那段「是否仍持有」的归属判定随之退役：
   * 并发持有是无解的（不像 reflector 可串行压制），只能定单一属主。
   */
  private restoreOutputSettings(): void {
    // sky 活跃即让位（一个字段都不写）：sky 对 renderer 有持续写入权
    //（ACESFilmic + skyExposure × ppExposure，经 refcount 仲裁多 session 共享 renderer），
    // 此刻它才是 tone/outputColorSpace 的属主。本 cap 的构造期快照可能陈旧
    //（组合根 createAll 时本 cap 先于 sky.apply 构造，快照=sky 接管前的默认值），
    // 盲还原会把 sky 当前值打回默认，制造「关后处理却让天空跳变」的二次伤害。
    const skyOwns = getTypedCap(this.caps, "sky")?.isEnabled() === true;
    if (skyOwns) return;
    // sky 缺席/停用时，按字段各自的归属归还：renderer 上仍是本 cap 写入的值
    // 才说明我们仍是持有者（对齐本文件 applyReflectorSync 的抑制态归属范式）。
    if (this.renderer.toneMapping === toneMappingValue(envState.ppToneMapping)) {
      this.renderer.toneMapping = this.prevToneMapping;
    }
    // outputColorSpace 同样按**字段各自的归属**归还——本 cap 在 applyToneMapping 里写的是
    // 常量 `THREE.SRGBColorSpace`，故「renderer 上仍是 SRGB」才说明我们仍是持有者。
    // 缺此判定时，若他处（适配器自建流程 / 其它 cap）已把色彩空间改成别的值，本 cap 停用
    // 会把别人的值盲打回构造期快照——与上面 toneMapping 的范式不对称，属漏判。
    if (this.renderer.outputColorSpace === THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = this.prevOutputColorSpace as THREE.ColorSpace;
    }
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
      // [ADR-247 D1 审查补强 R2] 数值守卫：原式 `vol.enabled ? vol.opacity : 0` 在体积光关闭时
      // 短路为 0，顺带掩盖了 opacity 缺失；改成直读后，undefined 会经乘法扩散成 NaN 并永久
      // 污染 bloomPass（strength/threshold 无 clamp）。生产路径 readVolParams 恒出数值，
      // 但 syncBloomPass 接受外部 LightCapability stub，需自守。
      const raw = vol.opacity;
      const gain = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
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

  /** 每帧调用：若返回 true 表示已渲染（composer.render）；否则调用方需 renderer.render。
   *  [ADR-299] 关闭态（composer 未建 **或** 已建但被关闭）一律返回 false——交回 render-host
   *  的直渲兜底，不再付 composer 的每帧过路费（实测 1.05ms/帧、+53.7%，见 ADR-299）。
   *  composer 本身不销毁（ADR-250 §2.2 常驻语义），仅退出每帧参与。 */
  render(dt: number, lightCap: LightCapability | null): boolean {
    // needComposer 已含 `this.enabled`，故此处起 composer 与「已启用」二者同时成立。
    if (!this.needComposer(lightCap)) return false;
    if (this.ssaoPass) this.ssaoPass.enabled = envState.ppSsaoEnabled;
    if (this.ssrPass) this.ssrPass.enabled = envState.ppReflectionMode !== "envmap-only";
    if (this.bloomPass) this.bloomPass.enabled = envState.ppBloomEnabled;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.renderPass!.enabled = true;
    this.syncBloomPass(lightCap);
    this.syncSSAOPass();
    this.syncSSRPass();
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.composer!.render(dt);
    return true;
  }

  setSize(width: number, height: number): void {
    // [ADR-299] 凭据无条件记录：关闭态 composer 为 null，但首次启用时要按此尺寸建缓冲。
    this.lastW = width;
    this.lastH = height;
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
    // [ADR-299] 同 setSize：关闭态也记，供惰性创建时对齐 renderer 的实际像素比。
    this.lastPixelRatio = pixelRatio;
    this.composer?.setPixelRatio(pixelRatio);
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    // [ADR-250] 曝光归 sky，本 cap 只在启用时接管 tone mapping / 色彩空间
    if (this.enabled) this.applyToneMapping();
  }

  /** 写入启用意图。[ADR-250] 唯一真值源 = `envState.ppEnabled`——本方法走 setEnvState，
   *  副作用（tone mapping 接管/归还、reflector 联动）由 onEnvChanged 统一落地，
   *  不再在此直接改 cap 字段（消除「四路写同一字段」的对账负担）。 */
  setEnabled(v: boolean): void {
    setEnvState({ ppEnabled: v }, { source: "manual" });
  }

  /** 启用意图翻转的副作用出口。[ADR-299] 这里是 composer **唯一的惰性创建点**：首次启用
   *  才建，已建则原样复用（换模型/反复启停都不重建，ADR-250 §2.2 的解耦收益完整保留）。
   *  关闭分支**不销毁** composer——只归还输出设置并退出每帧参与（render 返回 false）。 */
  private applyEnabledSideEffects(): void {
    if (this.enabled) {
      // syncReflector=false：抑制由本函数末尾那次 applyReflectorSync() 统一落地，
      // 避免 buildComposer 内触发一次、此处再触发一次的重复（reflector 两态非幂等敏感）。
      if (!this.composer) this.buildComposer(false);
      this.applyToneMapping();
    } else {
      this.restoreOutputSettings();
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

  /** [ADR-250] 按模型类别套用「后处理默认是否开启」。
   *  与 sky/light/fog/shadow/reflector/environment 六 cap 的 `applyModelPreset` 同构：
   *  读 `MODEL_DEFAULTS` 里自己关注的键（此处仅 `ppEnabled`），经 `setEnvState` 以
   *  `auto-model` 源写入——**写的是状态参数，不是 cap 私有字段**（职责边界收口）。
   *  用户手动开关（`source: "manual"`）按 ADR-196 仲裁规则不被覆盖。 */
  applyModelPreset(modelType: string): void {
    // [R-1] 有存档 = 模型默认让位（对齐 shadow/reflector/fog/env；恢复已改 auto-model，
    // 同轨放行若无守卫则每次挂载 ppEnabled 存档被模型值顶掉）
    if (this.isStateLoaded) return;
    const preset = pickModelDefaultFields(toModelType(modelType), ["ppEnabled"]);
    if (Object.keys(preset).length > 0) {
      setEnvState(preset, { source: "auto-model" });
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

    // 表驱动恢复：存档键（params 名）→ envState 键，类型校验后写回。
    // [锐评 P-1 收口 2026-09-22] source 一律 auto-model（对齐 fog F-2 / env E-2 / sky S-1
    // 纪律）：原 manual 把 pp 组键打成手改足迹，此后 auto-atmosphere 氛围预设写
    // ppExposure/ppBloomStrength（sunset/night 档全携）被静默拒绝——重启后切氛围
    // 曝光不跟调。ppEnabled 的模型默认顶档风险由 isStateLoaded 守卫承接（R-1）。
    restoreFields(state, {
      // [ADR-250] 存档的 `enabled` 键名保持向后兼容，但落点改为统一状态层。
      // 原实现写 this.enabled + 手工同步 perTypeGate（ADR-247 R1 的补丁），
      // 降参后二者归一，**该失配在结构上不再可能发生**。
      enabled: { boolean: (v) => setEnvState({ ppEnabled: v }, { source: "auto-model" }) },
      bloomStrength: {
        number: (v) => setEnvState({ ppBloomStrength: v }, { source: "auto-model" }),
      },
      bloomThreshold: {
        number: (v) => setEnvState({ ppBloomThreshold: v }, { source: "auto-model" }),
      },
      bloomRadius: {
        number: (v) => setEnvState({ ppBloomRadius: v }, { source: "auto-model" }),
      },
      bloomFollowVolumetric: {
        boolean: (v) => setEnvState({ ppBloomFollowVolumetric: v }, { source: "auto-model" }),
      },
      bloomEnabled: {
        boolean: (v) => setEnvState({ ppBloomEnabled: v }, { source: "auto-model" }),
      },
      ssaoEnabled: {
        boolean: (v) => setEnvState({ ppSsaoEnabled: v }, { source: "auto-model" }),
      },
      ssaoRadius: {
        number: (v) => setEnvState({ ppSsaoRadius: v }, { source: "auto-model" }),
      },
      ssaoMinDist: {
        number: (v) => setEnvState({ ppSsaoMinDist: v }, { source: "auto-model" }),
      },
      ssaoMaxDist: {
        number: (v) => setEnvState({ ppSsaoMaxDist: v }, { source: "auto-model" }),
      },
      toneMapping: oneOf(["none", "linear", "reinhard", "aces", "cineon"], (v) =>
        setEnvState({ ppToneMapping: v }, { source: "auto-model" }),
      ),
      exposure: { number: (v) => setEnvState({ ppExposure: v }, { source: "auto-model" }) },
      reflectionMode: oneOf(["envmap-only", "envmap+ssr", "ssr-only"], (v) =>
        setEnvState({ ppReflectionMode: v }, { source: "auto-model" }),
      ),
      ssrOpacity: {
        number: (v) => setEnvState({ ppSsrOpacity: v }, { source: "auto-model" }),
      },
      ssrMaxDistance: {
        number: (v) => setEnvState({ ppSsrMaxDistance: v }, { source: "auto-model" }),
      },
      ssrThickness: {
        number: (v) => setEnvState({ ppSsrThickness: v }, { source: "auto-model" }),
      },
      ssrBlur: { boolean: (v) => setEnvState({ ppSsrBlur: v }, { source: "auto-model" }) },
      ssrDistanceAttenuation: {
        boolean: (v) => setEnvState({ ppSsrDistanceAttenuation: v }, { source: "auto-model" }),
      },
      ssrFresnel: { boolean: (v) => setEnvState({ ppSsrFresnel: v }, { source: "auto-model" }) },
      ssrBouncing: { boolean: (v) => setEnvState({ ppSsrBouncing: v }, { source: "auto-model" }) },
      reflectorDisableWhenSSR: {
        boolean: (v) => setEnvState({ ppReflectorDisableWhenSSR: v }, { source: "auto-model" }),
      },
    });
    this.isStateLoaded = true; // [R-1] 有存档 = 模型默认让位（置于恢复写后、副作用应用前）

    // [ADR-250] 恢复后按启用意图落输出设置（曝光已归 sky，此处只管 tone mapping）
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
    this.restoreOutputSettings();
  }
}
