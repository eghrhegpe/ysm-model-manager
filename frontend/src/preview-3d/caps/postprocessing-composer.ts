// ===== PostprocessingComposer：后处理 composer 管线叶（ADR-329 刀① 落地，2026-10-11）=====
// 病症：postprocessing-capability.ts 原 951 行单类混装「composer 管线（构建/pass 管理/渲染/
// 尺寸）」+「状态编排（enabled 门/reflector 联动/持久化/menu）」两类职责；管线段约 230 行
// 高内聚、与 setter/菜单/persist 零耦合，却与其余逻辑同文件共存（10-09 锐评记「菜单叶存在
// 但 cap 内 setter 仍在」同族病）。本叶把管线整块收编，cap 退化为状态薄壳。
//
// 拆分范式承 ADR-091-d1（EnvironmentCapability → env-ibl.ts / env-hdr-cache.ts）：
//   - 叶构造注入 renderer/scene/camera，该页状态（composer/pass 引用/尺寸凭据
//     prev 快照）全部收进叶实例；
//   - cap 公开 API（render/setSize/setPixelRatio/dispose 等签名）零变更，内部委托本叶；
//   - 测试注入点 = `composerOf(cap)` 白盒探针（TS private 运行时即普通属性，同 hdrOf/iblOf
//     范式）。
//
// 职责边界（勿回移）：
//   - 本叶管「composer 及其 pass 的构建/销毁/渲染/尺寸/参数同步」；
//   - cap 管「enabled 门（envState.ppEnabled）、SSR↔Reflector 抑制联动、持久化、menu、
//     setter 群、onEnvChanged 编排」——**不得**把 pass 字段或 build 逻辑搬回 cap。
//
// 设计要点（随拆随迁，来源 postprocessing-capability.ts 原注释）：
//   - [ADR-250 §2.2 + ADR-299] composer **惰性常驻**：首次启用才建、dispose 才拆（会话轴），
//     关闭态既不建也**不参与每帧渲染**（cap.render 判 enabled 返回 false，交回 render-host 直渲）。
//   - Pass 顺序：RenderPass → (SSRPass 可选) → (SSAOPass 可选) → UnrealBloomPass → OutputPass
//     （SSR 独占链首：忽略 readBuffer、NoBlending 整片覆写 writeBuffer，排前才能让 SSAO/Bloom
//     叠加而非被吃掉——read three r185 SSRPass.js 核实）。
//   - MSAA：构造期按 renderer 实际授予的 antialias 决定 samples（不白付带宽）。
//   - 尺寸凭据 lastW/lastH/lastPixelRatio：关闭态 render-host 每帧下发记录，首次启用按
//     凭据建缓冲（对齐自适应降档后的真实像素比，不回落 devicePixelRatio）。
//
// 与 cap 的接线（装配/编排全在 cap，本叶只提供可操作对象）：
//   - cap.buildComposer(syncReflector) → 本叶 buildComposer()（叶不感知 reflector，联动由
//     cap 在调用点负责——见 cap 内 applyReflectorSync 注释）。

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { POSTPROC_MSAA_SAMPLES } from "@/preview-3d/infra/msaa-samples.ts";
import { previewPixelRatio } from "@/preview-3d/infra/render-budget.ts";
import { effectiveToneMappingExposure, envState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import type { LightCapability } from "./light-capability.ts";
import { bloomThresholdToLinear, type PostprocessingParams } from "./postprocessing-state.ts";

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

/** composer 叶构造入参（cap 构造时装配后传入） */
export interface PostprocessingComposerDeps {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
}

/**
 * 后处理 composer 管线（ADR-329 刀①）：持有 composer 及其 pass 的完整生命周期。
 * cap 持有一个本类实例，公开 API 全部委托（签名零变更），跨 cap 联动留在 cap。
 */
export class PostprocessingComposer {
  /** 参数字段与写入函数映射：cap 的 onEnvChanged 按键组唤起，同步 pass 属性。
   *  与 cap 原 PARAM_SYNC 语义一致，但 write 收叶实例（叶持有 pass 引用）。
   *  private static：write 内访问叶私有 pass 字段须在同 class 内（TS private 类外不可见）。 */
  private static readonly PARAM_SYNC: ReadonlyArray<{
    keys: readonly EnvStateKey[];
    write: (host: PostprocessingComposer, state: EnvState) => boolean;
  }> = [
    {
      keys: ["ppBloomEnabled"],
      write: (host) => {
        if (!host.bloomPass) return false;
        host.bloomPass.enabled = envState.ppBloomEnabled;
        return true;
      },
    },
    {
      keys: ["ppBloomStrength", "ppBloomThreshold", "ppBloomRadius"],
      write: (host, s) => {
        if (!host.bloomPass) return false;
        // base 值；render() 时 syncBloomPass 再应用体积光联动。
        // [2026-10 bloom 域修复] threshold 在**每个写入点**都做曝光域换算——与
        // syncBloomPass/attachSSRAndBloomPasses 同域，防「键变更→下一 render 之前」
        // 的帧窗口里 pass 躺着一帧裸用户值（症状：拖阈值滑杆瞬间辉光先炸再收）。
        host.bloomPass.strength = s.ppBloomStrength;
        host.bloomPass.threshold = bloomThresholdToLinear(
          s.ppBloomThreshold,
          effectiveToneMappingExposure(),
        );
        host.bloomPass.radius = s.ppBloomRadius;
        return true;
      },
    },
    {
      keys: ["ppSsaoRadius", "ppSsaoMinDist", "ppSsaoMaxDist"],
      write: (host, s) => {
        if (!host.ssaoPass) return false;
        host.ssaoPass.kernelRadius = s.ppSsaoRadius;
        host.ssaoPass.minDistance = s.ppSsaoMinDist;
        host.ssaoPass.maxDistance = s.ppSsaoMaxDist;
        return true;
      },
    },
    {
      keys: [
        "ppSsrOpacity",
        "ppSsrMaxDistance",
        "ppSsrThickness",
        "ppSsrBlur",
        "ppSsrDistanceAttenuation",
        "ppSsrFresnel",
        "ppSsrBouncing",
      ],
      write: (host, s) => {
        if (!host.ssrPass) return false;
        // ssr-only 档无屏外 fallback，混合无意义 → 不透明度恒为 1
        host.ssrPass.opacity = s.ppReflectionMode === "ssr-only" ? 1 : s.ppSsrOpacity;
        host.ssrPass.maxDistance = s.ppSsrMaxDistance;
        host.ssrPass.thickness = s.ppSsrThickness;
        host.ssrPass.blur = s.ppSsrBlur;
        host.ssrPass.distanceAttenuation = s.ppSsrDistanceAttenuation;
        host.ssrPass.fresnel = s.ppSsrFresnel;
        host.ssrPass.bouncing = s.ppSsrBouncing;
        return true;
      },
    },
    {
      keys: ["ppToneMapping"],
      write: (host) => {
        // enabled 守卫：未启用时不得夺取 renderer.toneMapping（否则「关了后处理却改色调」）
        if (!envState.ppEnabled) return false;
        host.applyToneMapping();
        return true;
      },
    },
  ];
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;

  // composer（惰性常驻：首次启用才建，dispose 才拆）
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

  // prev 状态（dispose 还原）
  // [ADR-250] prevExposure 不存在——曝光属主归 sky，本叶不持有/归还该字段。
  private prevToneMapping: THREE.ToneMapping;
  private prevOutputColorSpace: string;

  constructor(deps: PostprocessingComposerDeps) {
    this.scene = deps.scene;
    this.renderer = deps.renderer;
    this.camera = deps.camera;
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevOutputColorSpace = this.renderer.outputColorSpace;
  }

  /** composer 是否已构建（惰性常驻的查询口；cap.render 与 enabled 门合用） */
  hasComposer(): boolean {
    return this.composer !== null;
  }

  /** cap.onEnvChanged 委托：按键组唤起 PARAM_SYNC 表同步 pass 属性（结构键不在此——
   *  结构性重建由 cap 调 buildComposer/applySSRModeToPass，见 cap 内 onEnvChanged 主干）。 */
  syncParamsIfChanged(changed: Set<EnvStateKey>, state: EnvState): void {
    for (const entry of PostprocessingComposer.PARAM_SYNC) {
      if (entry.keys.some((k) => changed.has(k))) entry.write(this, state);
    }
  }

  /** 反射模式变更处理（cap.onEnvChanged 委托）。免重建：已经建了 composer 才补挂 SSR /
   *  调档位（[锐评 P2-4]：切档不重建——避免每次切档重建整链的 GPU 抖动；
   *  [2026-10-11] 原立论「three 0.186.1 SSRPass.dispose 漏释放 ssrMaterial」已补丁化，
   *  见 `disposeComposer`——泄漏不再成立，但「切档不重建」本身仍是正确的性能选择）。 */
  syncReflectionMode(state: EnvState): void {
    if (!this.composer) return;
    // 已启用 + 需要 SSR + 尚无 ssrPass → 补挂（重建整链）
    if (!this.ssrPass && state.ppReflectionMode !== "envmap-only") {
      this.buildComposer();
    } else if (this.ssrPass) {
      this.applySSRModeToPass();
    }
  }

  /* -------- 构建/销毁 composer -------- */

  /** [ADR-250 §2.2 + ADR-299] composer **生命周期**惰性常驻：首次启用才建，建后不随
   *  启用意图/模型切换销毁（GPU 资源与模型轴解耦的收益保留）。本方法只构建；每帧是否
   *  走 composer 由 cap.render 的 enabled 门 + 本叶 hasComposer 共同决定。 */
  buildComposer(): void {
    this.disposeComposer();
    const useSSR = envState.ppReflectionMode !== "envmap-only";
    this.composer = this.createComposerBase();
    this.attachSSAOPass(this.composer);
    this.attachSSRAndBloomPasses(this.composer, useSSR);
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
    // [P2 修复] EffectComposer 自建读/写缓冲时不带 samples（three 0.186.1 构造器
    // ——实装版本，`frontend/package.json` 声明 `^0.186.1`；本行原写「r185」，属版本标签陈旧，
    // 该构造器签名自 r185 起未变、结论不受影响：
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

  /** [2026-10 锐评 P2-1] pass 构造尺寸统一取 host 下发的凭据（与 composer 同源）。
   *  原实现从 `renderer.getSize()` 现取，而 composer 用 `lastW/lastH`——同一函数内两套
   *  尺寸源，在「容器已变但尚未下发」的窗口内会分叉。凭据为空时才回落 renderer 现值。 */
  private passSizes(): { w: number; h: number } {
    const logical = this.renderer.getSize(new THREE.Vector2());
    return {
      w: Math.max(this.lastW > 0 ? this.lastW : logical.x, 1),
      h: Math.max(this.lastH > 0 ? this.lastH : logical.y, 1),
    };
  }

  private attachSSAOPass(composer: EffectComposer): void {
    if (!envState.ppSsaoEnabled) return;
    const { w, h } = this.passSizes();
    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h, 32);
    this.ssaoPass.kernelRadius = envState.ppSsaoRadius;
    this.ssaoPass.minDistance = envState.ppSsaoMinDist;
    this.ssaoPass.maxDistance = envState.ppSsaoMaxDist;
    this.ssaoPass.output =
      (SSAOPass as unknown as { OUTPUT: { Default: number } }).OUTPUT?.Default ?? 0;
    // [锐评 P1-1] 走 insertPass（addPass/insertPass 是唯一会按物理尺寸下发 setSize 的
    // 同步点），替代原 `composer.passes.splice(...)` 直插——后者绕过同步，使新 pass
    // 停留在构造期的逻辑尺寸上，「插入即正确」的不变量失守。
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    composer.insertPass(this.ssaoPass, composer.passes.indexOf(this.renderPass!) + 1);
  }

  private attachSSRAndBloomPasses(composer: EffectComposer, useSSR: boolean): void {
    const { w, h } = this.passSizes();

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      envState.ppBloomStrength,
      envState.ppBloomRadius,
      // [2026-10 bloom 域修复] 用户阈值是「曝光后可见亮度」语义，pass 消费的是
      // 「曝光前线性 HDR」域（OutputPass 的 ACES+曝光在 bloom **之后**）——除以有效
      // 曝光换算回线性域。render() 每帧 syncBloomPass 重算，曝光滑杆变化自动跟上。
      bloomThresholdToLinear(envState.ppBloomThreshold, effectiveToneMappingExposure()),
    );
    // [锐评 P1-1] insertPass 替代 splice（同 attachSSAOPass）。
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    composer.insertPass(this.bloomPass, composer.passes.indexOf(this.outputPass!));

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
      // [锐评 P1-1] insertPass 替代 splice（同上）：插入即按物理尺寸初始化。
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      composer.insertPass(this.ssrPass, composer.passes.indexOf(this.renderPass!) + 1);
    }
  }

  /** [锐评 P2-4] 反射模式变更时把档位落到既有 ssrPass，不重建 composer。
   *  `ssr-only` 需把 opacity 顶到 1（纯 SSR、无屏外环境贴图补全）；
   *  其余档位恢复用户设定的 opacity（`envmap+ssr` 为半混合）。
   *  enabled 由 cap.render 每帧按 `ppReflectionMode !== "envmap-only"` 统一同步，此处不重复。 */
  applySSRModeToPass(): void {
    if (!this.ssrPass) return;
    this.ssrPass.opacity = envState.ppReflectionMode === "ssr-only" ? 1 : envState.ppSsrOpacity;
  }

  /** 销毁 composer 及全部 pass（幂等：null 即跳过 micro；cap.dispose / build 前调用） */
  disposeComposer(): void {
    this.ssaoPass?.dispose();
    this.ssaoPass = null;
    // [2026-10-11 上游泄漏补丁] `SSRPass.dispose()` 漏释放 `ssrMaterial`——读源码实证
    // (`three/examples/jsm/postprocessing/SSRPass.js` 的 dispose)：它释放 7 个 RT
    // (beauty/prev/normal/metalness/ssr/blur/blur2) + 7 个材质 (normalMaterial /
    // metalnessOn/OffMaterial / blurMaterial / blurMaterial2 / copyMaterial /
    // depthRenderMaterial) + fsQuad，**唯独漏掉主 ShaderMaterial `ssrMaterial`**——
    // 而它持 `tDiffuse`/`tNormal`/`tMetalness`/`tDepth` 四张纹理引用 + 全部 defines/uniforms。
    // 不补即每次拆链漏一个 ShaderMaterial 及其 GPU program。
    // 类型依据：`ssrMaterial` 在官方 `@types/three` 的 SSRPass.d.ts 有公开声明（无需强转）。
    // 撤除条件：three 上游修复后（本文件 `postprocessing-ssr-dispose.test.ts` 首例会转红提示）。
    this.ssrPass?.ssrMaterial.dispose();
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

  /* -------- 像素比 / 尺寸凭据 -------- */

  /** setSize：**只**记凭据并交给 composer 驱动，不得手写 ssrPass.setSize。
   *  [ADR-299] 凭据无条件记录：关闭态 composer 为 null，但首次启用时要按此尺寸建缓冲。
   *  [2026-10 锐评 P1-1] 详见 cap 原注释：composer.setSize 会以物理量遍历所有 pass 下发；
   *  全程用 addPass/insertPass（见 createComposerBase/attach*），resize 单一驱动。 */
  setSize(width: number, height: number): void {
    this.lastW = width;
    this.lastH = height;
    this.composer?.setSize(width, height);
  }

  /** setPixelRatio：同 setSize——关闭态也记，供惰性创建时对齐 renderer 的实际像素比。
   *  [锐评 P1-1] composer.setPixelRatio 内部会以 `setSize(_width, _height)` 级联重算。 */
  setPixelRatio(pixelRatio: number): void {
    this.lastPixelRatio = pixelRatio;
    this.composer?.setPixelRatio(pixelRatio);
  }

  /* -------- 每帧渲染 -------- */

  /** 每帧调用（cap.render 判过 enabled 门 + hasComposer 后委托本方法）。
   *  同步 pass 开关/参数 → composer.render。 */
  render(dt: number, lightCap: LightCapability | null): void {
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
  }

  private syncBloomPass(lightCap: LightCapability | null): void {
    if (!this.bloomPass) return;
    // 独立辉光开关：false 时整个 bloomPass 旁路（Pass.enabled=false），不影响 SSAO/SSR
    this.bloomPass.enabled = envState.ppBloomEnabled;
    if (!envState.ppBloomEnabled) return;
    // [2026-10 bloom 域修复] 用户阈值语义 =「曝光后可见亮度」，pass 阈值域 =「曝光前线性
    // HDR」（ACES+曝光压在 OutputPass、位于 bloom 之后）。统一在此现读有效曝光做域换算，
    // 每帧自愈：用户拖曝光滑杆（sky 组键，不派发本 cap）下一帧阈值即对齐，无需跨组订阅。
    // threshold 先按联动 ±20% 缩放、再换域（联动是「浓度微调」语义，作用于用户可见值上）。
    const exposure = effectiveToneMappingExposure();
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
      this.bloomPass.threshold = bloomThresholdToLinear(
        envState.ppBloomThreshold * (1 - 0.2 * gain),
        exposure,
      );
      // strength 是加性增益、无「亮度域」语义，且随 OutputPass 曝光自然缩放——不换域。
      this.bloomPass.strength = envState.ppBloomStrength * (1 + 0.2 * gain);
      this.bloomPass.radius = envState.ppBloomRadius;
    } else {
      this.bloomPass.threshold = bloomThresholdToLinear(envState.ppBloomThreshold, exposure);
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

  /* -------- 输出设置（tone mapping / colorSpace）-------- */

  /**
   * 写入色彩映射。[ADR-250 §2.3] **不再写 `toneMappingExposure`**——曝光属主归 sky。
   *
   * 历史（ADR 的根因）：本方法与 `SkyCapability.apply()` 并写同一个
   * `renderer.toneMappingExposure`，值为 `ppExposure`(全局 1.0) 对 `skyExposure`(per-type 0.5~0.6)。
   * 后处理一开即夺走属主，造成约 1.8× 亮度跳变——这才是「MMD 亮瞎」的真因
   * （per-type 亮度参数实为空）。现口径：`renderer.toneMappingExposure = skyExposure × ppExposure`，
   * 由 sky 侧统一写入（`sky-capability.ts|applyExposure`），本叶只负责 tone mapping 与色彩空间。
   */
  applyToneMapping(): void {
    this.renderer.toneMapping = toneMappingValue(envState.ppToneMapping);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /**
   * 归还输出设置给构造前的值。
   *
   * [ADR-250 §2.3] 曝光已不在本 cap 属主范围内——`toneMappingExposure` 由 sky 独占
   * （`skyExposure × ppExposure`），故此处**只归还 toneMapping / outputColorSpace**。
   *
   * [2026-10-11 逐字段归属] 原实现以 `if (skyOwns) return;` **整块提前退出**——
   * 作者担心「盲还原会把 sky 当前值打回默认，制造『关后处理却让天空跳变』」。
   * 但**「sky 在场」≠「sky 是 toneMapping 的当前持有者」**：
   *   - sky 只写 **ACESFilmic**（定值，见 `sky-capability.ts|apply`）；
   *   - 本 cap 写 `toneMappingValue(envState.ppToneMapping)`（用户可选 none/linear/
   *     reinhard/aces/cineon）。
   * 当用户选的**不是** aces 时（如 reinhard），renderer 上的值就是**本 cap 写的**、
   * 与 sky 无关——此时提前退出 = 本 cap 放弃归还自己写的值，**残留**成第三种状态
   * （既非 sky 的 ACES，也非构造前快照）。实测复现：sky 开 → pp 开选 reinhard →
   * 关 pp ⇒ renderer 停在 Reinhard 而非快照值。
   *
   * 正解 = **逐字段归属判定**（与下方 outputColorSpace、`frustum-cull.ts|_culled` 的
   * 抑制态归属同范式）：**「renderer 上仍是本 cap 写的值」才归还**。
   * 若 renderer 上是 sky 的 ACES（≠ 本 cap 写值）→ 判定「非持有者」自然跳过，
   * 原提前退出想保住的那个场景**由判据本身覆盖**，无需整块退出。
   */
  restoreOutputSettings(): void {
    if (this.renderer.toneMapping === toneMappingValue(envState.ppToneMapping)) {
      this.renderer.toneMapping = this.prevToneMapping;
    }
    // outputColorSpace 同样按**字段各自的归属**归还——本叶在 applyToneMapping 里写的是
    // 常量 `THREE.SRGBColorSpace`，故「renderer 上仍是 SRGB」才说明我们仍是持有者
    if (this.renderer.outputColorSpace === THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = this.prevOutputColorSpace as THREE.ColorSpace;
    }
  }

  /** 会话级字段复位（cap.dispose 委托；对齐 [锐评 P1-2/P2-5] 的复用实例泄漏防护） */
  dispose(): void {
    this.disposeComposer();
    // 还原输出设置（原 cap.dispose 顺序：disposeComposer → restoreOutputSettings——只归还
    // toneMapping/colorSpace，曝光归 sky 不触碰；sky 在场让位，见 restoreOutputSettings 注释）
    this.restoreOutputSettings();
    // 尺寸凭据复位：新会话不继承上个会话的降档值（复用实例时惰性创建会按旧尺寸建缓冲）
    this.lastW = 0;
    this.lastH = 0;
    this.lastPixelRatio = 0;
  }
}
