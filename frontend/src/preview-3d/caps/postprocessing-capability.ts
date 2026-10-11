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
//
// [ADR-329 刀① 2026-10-11] composer 管线（构建/pass 管理/渲染/尺寸）已下沉
// `postprocessing-composer.ts|PostprocessingComposer`，本 cap 退化为**状态编排薄壳**：
//   - 持有 composerHost 叶实例（构造装配接口同前：scene/renderer/camera/caps）；
//   - 保留：enabled 门、onEnvChanged 编排（结构性重建委托叶 build/applySSRModeToPass）、
//     SSR↔Reflector 抑制联动、setter 群、getMenuNodes、持久化、apply/dispose 委托；
//   - 管线细节（Pass 链序/MSAA/尺寸凭据/同步表）一律在叶——**勿**把 pass 字段或 build
//     逻辑搬回本 cap（叶文件头部注明职责边界）。

import type * as THREE from "three";
import type { PostprocessingLike } from "@/preview-3d/infra/postprocessing.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
import { envState, isSsrRenderActive, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { pickModelDefaultFields, toModelType } from "@/preview-3d/state/model-defaults.ts";
// [锐评 X-6 / 方案 C 2026-10-04] 菜单局部刷新订阅原语（fog/water/reflector 同源）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import type { LightCapability } from "./light-capability.ts";
import { type FieldRestorer, oneOf, restoreFields } from "./persist-utils.ts";
// [ADR-329 刀①] composer 管线叶（构建/渲染/尺寸/参数同步全在叶）
import { PostprocessingComposer } from "./postprocessing-composer.ts";
import { buildPostprocessingNodes } from "./postprocessing-menu.ts";
// 状态/序列化轴（PostprocessingParams / 默认值 / toneMapping 键表）已下沉
// postprocessing-state.ts；此处透传导出，保持既有调用方（postprocessing-capability.test.ts、
// cap-configs.test.ts 等）的 import 路径不破坏。
import {
  DEFAULT_POSTPROC_PARAMS,
  POSTPROC_PERSIST_FIELDS,
  type PostprocessingParams,
  PP_PARAMS_TO_ENV,
  type ReflectionMode,
} from "./postprocessing-state.ts";
import type { ReflectorCapability } from "./reflector-capability.ts";
import {
  getTypedCap,
  persistState,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

export type { PostprocessingParams, ReflectionMode };
export { DEFAULT_POSTPROC_PARAMS };

export class PostprocessingCapability implements SceneCapability, PostprocessingLike {
  readonly id = "postprocessing";
  /** [暗线 C1 收口] 面板渲染 id（core.ts dock 绑定）≠ cap id：面板用 postproc / cap 用 postprocessing */
  readonly panelId = "postproc";
  readonly labelKey = "preview.postprocessing";
  readonly icon = "sparkle";
  readonly descKey = "preview.postprocessingDesc";

  // [ADR-329 刀①] composer 管线叶——所有 pass/尺寸/渲染细节收进叶，cap 只留编排
  /** composer 叶实例（构造装配；composerOf(cap) 白盒探针取同一引用） */
  private readonly composerHost: PostprocessingComposer;

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

  // ADR-196：取消订阅函数
  private unsubscribeEnv: () => void;
  /** [锐评 X-6 / 方案 C 2026-10-04] 菜单局部刷新订阅（对齐 fog/water/reflector 同法）：
   *  本 cap 的 20 处 `disabled: disabledWhenOff(cap)` 灰化是**渲染期求值**，缺本订阅链时
   *  `ppEnabled` 翻转不会重建面板 ⇒ 灰化态滞后（「总开关关了、子控件还亮着」）。
   *  触发点只有一处：`ppEnabled` 翻转（其余参数变更无需重建面板）。 */
  private readonly listenerSet = createListenerSet();
  /** 订阅菜单局部刷新；返回取消订阅函数（面板卸载须回调） */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }
  private notify(): void {
    this.listenerSet.notify();
  }
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
    // [ADR-329 刀①] composer 叶构造装配（管线状态全在叶，prev 快照等服务叶内）
    this.composerHost = new PostprocessingComposer({
      scene: opts.scene,
      renderer: opts.renderer,
      camera: opts.camera,
      ...(opts.caps !== undefined ? { caps: opts.caps } : {}),
    });
    // 条件赋值（对齐 sky/light 惯例）：exactOptionalPropertyTypes 下 undefined 不写入字段
    if (opts.caps !== undefined) this.caps = opts.caps;
    // [ADR-250] 显式传值才写状态层；不传则尊重 envState 现有值（含用户存档恢复的顺序）。
    // ⚠️ 顺序敏感：此处 setEnvState 发生在 registerEnvCallback **之前**，订阅者尚未就位，
    // 故其副作用（tone mapping 接管）不会自动触发——构造末尾显式补一次 apply()。
    if (opts.enabled !== undefined) {
      setEnvState({ ppEnabled: opts.enabled }, { source: "manual" });
    }

    // [ADR-250 §2.2 → ADR-299] composer **惰性常驻**：构造期只在「启用意图已为真」时建
    // （存档恢复 / 调用方显式传 enabled=true 的场景）；默认 `ppEnabled=false`
    // （env-state-schema 默认值）的会话**一个 RenderTarget 都不分配**。
    // 实测依据（ADR-299）：关闭态走 composer 每帧多耗 1.05ms GPU（+53.7%，948×610@DPR1），
    // 另常驻 35.3MB 读写缓冲——而默认参数下真实效果（bloom/ssao/ssr 全关）只占 0.21ms，
    // 管线过路费是载荷的 5 倍。建后仍常驻（换模型/启停不销毁），ADR-250 §2.2 的
    // 「换模型不重建 GPU 资源」收益完整保留。
    // syncReflector=false：构造期不压制 reflector（见 buildComposer 注释）。
    if (this.enabled) this.composerHost.buildComposer();

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
    // ① 启用意图翻转（ADR-250 + ADR-299）：**不销毁** composer（常驻），只切每帧参与 +
    //    归权输出设置；开启且尚未建时在此惰性创建（applyEnabledSideEffects 是唯一创建点）。
    if (changed.has("ppEnabled")) {
      this.applyEnabledSideEffects();
      // [锐评 X-6 / 方案 C] 同上：本 cap 的 20 处 `disabled` 依赖渲染期求值，翻转须重建面板，
      // 否则灰化态滞后（既有缺陷，2026-10-04 随「未启用态判据」一并收口）。
      this.notify();
    }

    // ② 结构性变化：仅 SSAO 开关真正增删 pass → 重建后 return（新 pass 无需逐项同步）。
    //
    //    ⚠️ `ppReflectionMode` **不重建**（[锐评 P2-4]）：SSR 档位变化只需切 `ssrPass.enabled`
    //    与少量参数（render() 每帧已按 `ppReflectionMode !== "envmap-only"` 同步 enabled）。
    //    原实现每次切档都 `new SSRPass(...)`，而 three 0.186.1 的 `SSRPass.dispose` 漏释放
    //    `ssrMaterial`（持有 defines 与全部 uniforms 的 ShaderMaterial）——上游客源缺陷，
    //    本仓无法直接修，故从根上不重建，反复切档不再累积未释放的 ShaderMaterial。
    if (changed.has("ppSsaoEnabled")) {
      if (this.composerHost.hasComposer()) this.composerHost.buildComposer();
      return;
    }
    // 反射模式：唯一需要动 pass 组合的情况是「已启用 + 需要 SSR + 尚无 ssrPass」→ 补挂。
    // ⚠️ 不可在此 return：SSR 活跃性直接决定 reflector 抑制，必须落到 ③ 的 applyReflectorSync，
    //    否则「SSR 开→压制单平面镜 / SSR 关→归还」的联动失效（原实现靠 buildComposer 内那次
    //    applyReflectorSync 兜住，改为免重建后须显式触发）。
    if (changed.has("ppReflectionMode")) {
      if (this.composerHost.hasComposer()) {
        // [ADR-329 刀①] 叶内封装「需 SSR 且尚无 ssrPass → 补挂；已有 → 调档位」判定
        this.composerHost.syncReflectionMode(state);
      }
    }

    // ③ 参数属性同步（按键触发，表驱动；PARAM_SYNC 已下沉叶，经 syncParamsIfChanged 委托）
    this.composerHost.syncParamsIfChanged(changed, state);

    // ④ Reflector 联动：SSR 是否在渲染（isSsrRenderActive）决定单平面镜的压制/归还。
    if (changed.has("ppReflectorDisableWhenSSR") || changed.has("ppReflectionMode")) {
      this.applyReflectorSync();
    }
  };

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

  /* -------- 兼容旧 PostprocessingManager 对外 API -------- */

  /** 每帧调用：若返回 true 表示已渲染（composer.render）；否则调用方需 renderer.render。
   *  [ADR-299] 关闭态（composer 未建 **或** 已建但被关闭）一律返回 false——交回 render-host
   *  的直渲兜底，不再付 composer 的每帧过路费（实测 1.05ms/帧、+53.7%，见 ADR-299）。
   *  composer 本身不销毁（ADR-250 §2.2 常驻语义），仅退出每帧参与。 */
  render(dt: number, lightCap: LightCapability | null): boolean {
    // [ADR-329 刀①] 判定留在 cap（enabled 门 + hasComposer），叶只管渲染动作；返回语义不变
    if (!this.enabled || !this.composerHost.hasComposer()) return false;
    this.composerHost.render(dt, lightCap);
    return true;
  }

  setSize(width: number, height: number): void {
    this.composerHost.setSize(width, height);
  }

  setPixelRatio(pixelRatio: number): void {
    this.composerHost.setPixelRatio(pixelRatio);
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    // [ADR-250] 曝光归 sky，本 cap 只在启用时接管 tone mapping / 色彩空间
    if (this.enabled) this.composerHost.applyToneMapping();
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
      if (!this.composerHost.hasComposer()) this.composerHost.buildComposer();
      this.composerHost.applyToneMapping();
    } else {
      this.composerHost.restoreOutputSettings();
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

  /** 保存状态到 localStorage（存档键名沿用旧 params 名，向后兼容已有存档——文件头契约）。
   *  [2026-10 B 类收口] 写侧表驱动：遍历 `PP_PARAMS_TO_ENV`（存档名→envState 键映射），
   *  手抄 19 字段清单退役——新增 pp 参数只需登记 params 接口 + POSTPROC_PERSIST_FIELDS +
   *  PP_PARAMS_TO_ENV（编译期 satisfies 互锁 + [B类] schema⇔表同构契约锁兜底）。
   *  `enabled` 不在搬运表内（params 上的只读视图，真值 envState.ppEnabled，ADR-250 单门），
   *  手写一行；与 ground 私有 enabled 同形例外。 */
  saveState(): void {
    const state: Record<string, unknown> = { enabled: envState.ppEnabled };
    for (const [paramsKey, envKey] of Object.entries(PP_PARAMS_TO_ENV)) {
      state[paramsKey] = envState[envKey as EnvStateKey];
    }
    persistState(this.id, state);
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;

    // 表驱动恢复（存档键 params 名 → envState 键，类型校验后写回）。
    // [2026-10 B 类收口] restorer 表由 POSTPROC_PERSIST_FIELDS（种别表，编译期 satisfies
    // 与 params 接口互锁）× PP_PARAMS_TO_ENV（键名映射）合成——读写两侧共用同一组表，
    // 手写 19 行还原器退役；新增 pp 键只需登记两张表，save/load 自动跟上
    // （漏登记由 [B类] schema⇔表同构契约锁兜底）。
    // [锐评 P-1 收口 2026-09-22] source 一律 auto-model（对齐 fog F-2 / env E-2 / sky S-1
    // 纪律）：原 manual 把 pp 组键打成手改足迹，此后 auto-atmosphere 氛围预设写
    // ppExposure/ppBloomStrength（sunset/night 档全携）被静默拒绝——重启后切氛围
    // 曝光不跟调。ppEnabled 的模型默认顶档风险由 isStateLoaded 守卫承接（R-1）。
    const restorers: Record<string, FieldRestorer> = {};
    for (const [paramsKey, kind] of Object.entries(POSTPROC_PERSIST_FIELDS)) {
      const envKey = PP_PARAMS_TO_ENV[paramsKey as keyof typeof PP_PARAMS_TO_ENV];
      const write = (v: number | boolean | string): void => {
        setEnvState({ [envKey]: v } as Partial<EnvState>, { source: "auto-model" });
      };
      if (kind === "number") {
        restorers[paramsKey] = { number: write };
      } else if (kind === "boolean") {
        restorers[paramsKey] = { boolean: write };
      } else {
        restorers[paramsKey] = oneOf(kind.oneOf, write);
      }
    }
    // [ADR-250] 存档 `enabled` 键名保持向后兼容，落点为统一状态层 ppEnabled
    // （params 上的只读视图，不在搬运表；原写 this.enabled + 手工同步 perTypeGate，
    // 降参后归一，**该失配在结构上不再可能发生**）。
    restorers.enabled = {
      boolean: (v) => setEnvState({ ppEnabled: v }, { source: "auto-model" }),
    };
    restoreFields(state, restorers);
    this.isStateLoaded = true; // [R-1] 有存档 = 模型默认让位（置于恢复写后、副作用应用前）

    // [ADR-250] 恢复后按启用意图落输出设置（曝光已归 sky，此处只管 tone mapping）
    if (this.enabled) this.composerHost.applyToneMapping();
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
    // [ADR-329 刀①] composer 销毁 + 会话级字段复位（lastW/lastH/lastPixelRatio）全在叶
    this.composerHost.dispose();
    // [2026-10 锐评 P1-2 / P2-5] 会话级字段必须复位。
    // `scene-capability-registry.createAll` 有「同宿主三引用全等则复用实例」短路
    //（scene-capability-registry.ts:86-95），复用后上个会话的残留会让：
    //  ① `isStateLoaded` 恒真 → `applyModelPreset` 的守卫永久挡下本会话的模型默认
    //    （换 YSM/VRM/MMD 都不再改变后处理开关）；
    //  ② 尺寸凭据（现收在叶 dispose 内复位）若残留 → 本会话惰性创建的 composer 按
    //     **上个会话**的尺寸/像素比建缓冲（自适应降档后尤甚）。
    this.isStateLoaded = false;
  }
}
