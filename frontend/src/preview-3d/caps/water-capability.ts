// ===== WaterCapability：水面能力（ADR-196 迁移至 envState）=====
// 独立前水面是 GroundCapability 的「双子域」；拆分后成为环境面板一等公民（与 sky/ground 平级）。
// 波浪 shader 注入（onBeforeCompile）+ 程序化法线（Gerstner 解析法线 + fragment 微细节）仍为水面
// 专属技术基盘，不与他人共享，故不另抽共享模块（YAGNI）。
//
// 2026-09-19（微细节法线 GPU 化，ADR-271）：原 CPU 256² DataTexture + normalMap 槽整条链路已移除，
// fragment 改按世界水平坐标程序化求三组方向沟槽的偏导。收益有二：
//   ① 改 waterSize 不再重算 65536 像素（主线程零开销）；
//   ② 微细节不再受贴图分辨率与插值的限制，getNormalMap/generateNormalMap/缓存字段全部退场。
//
// 2026-09-19（ADR-272）：size 入口放开的第二道前置同时解除——pool 的 size 变更不再重建容器
// （形态策略表新增 `sizeLinks`，逐件 scale/定位），于是 `ground-water-size` 滑块落地。
// 至此「改 size 要重建几何 + 重算法线」两条卡点全消，`waterSize` 不再是只服务存档的死路径。

import type * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import {
  registerEnvCallback,
  withEnvCallbacksSuspended,
} from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { type EnvStateKey, getPresetKeys } from "@/preview-3d/state/env-state-schema.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { oneOf, restoreFields } from "./persist-utils.ts";
import { type EnvPlacement, persistState, type SceneCapability } from "./scene-capability.ts";
// ADR-257：形态「如何组装渲染体 / 如何解释尺寸与水位」已下沉到可注册的策略表，
// cap 只持有 WaterBody 并按语义 role 取用部件，不再出现 `mode ===` 判别联合。
import {
  getWaterBodyStrategy,
  type WaterBody,
  type WaterBuildContext,
} from "./water-body-strategies.ts";
import { buildWaterNodes } from "./water-menu.ts";
import {
  migrateLegacyWaterLevel,
  WATER_SCHEMA_VERSION,
  WATER_SCHEMA_VERSION_KEY,
} from "./water-migrations.ts";
// ADR-315 D1①：分派表 / uniform 登记 / 逐帧现读表（零 THREE 纯表）拆出真缝
import {
  effectiveWaveHeight,
  WATER_PARAM_APPLIERS,
  type WaterApplyCtx,
  type WaterParamKey,
  type WaterUniformName,
} from "./water-params.ts";
// [锐评 P1-0/P3-1 2026-10-08] 水面持久化数据面（RESTORE_SOURCE 三件 + 批量恢复器），
// 自 scene-capability.ts|restoreBySchema 下沉（通用工具箱藏 water 后门类，来源纪律暗门）
import {
  RESTORE_SOURCE,
  resolveWaterRestoreState,
  restoreWaterSchemaKeys,
  type WriteOpts,
  writeOpts,
} from "./water-persist.ts";
// ADR-315 D1②：水面模型倒影子系统（ADR-297 载体 + 逐帧驱动）拆出真缝
import {
  createWaterReflectState,
  disposeReflector,
  reflectionActive,
  renderReflection,
  type WaterReflectCtx,
  type WaterReflectState,
} from "./water-reflect.ts";
// 行数红线治理（ADR-315 后续）：波浪 shader 注入沿真缝拆至 water-shader.ts，
// cap 侧仅经 buildCtx 装配 WaterShaderCtx 调用，不再持有 GLSL 串。
import { buildWaveWaterMaterial } from "./water-shader.ts";
import type { WaterMode } from "./water-state.ts";
import { WATER_MODES } from "./water-state.ts";

// ADR-315 D1：分派表 / uniform 登记 / 逐帧现读表已拆至 water-params.ts（零 THREE 纯表）；
// 倒影子系统已拆至 water-reflect.ts（载体状态经 WaterReflectState 移交）。
// 原 4 组导出符号经本 re-export 垫片保持消费者 import 路径零改动
// （单来源转发，与 ADR-195 刀2 node-types 垫片同口径；反桶契约豁免）。
export {
  WATER_FRAME_READ_KEYS,
  WATER_NOOP_APPLIER_KEYS,
  WATER_PARAM_APPLIER_KEYS,
  WATER_UNIFORM_NAMES,
  type WaterUniformName,
} from "./water-params.ts";
export type { WaterMode };

export class WaterCapability implements SceneCapability {
  readonly id = "water";
  readonly labelKey = "preview.water";
  readonly icon = "ocean";
  readonly descKey = "preview.waterDesc";

  private scene: THREE.Scene;
  private water: WaterBody;
  private waterTime: { value: number };
  /** ADR-297：倒影 RT 渲染驱动需要宿主（registry 传全量 ctx；缺省 = 倒影自动失效） */
  private renderer: THREE.WebGLRenderer | null;
  private camera: THREE.PerspectiveCamera | null;
  // ADR-315 D1②：倒影子系统拆出真缝（water-reflect.ts）；实例级载体状态经 WaterReflectState 移交
  private readonly reflect: WaterReflectState;
  /** 参数变更监听（menu 局部刷新用）；仅模式切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.PerspectiveCamera;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer ?? null;
    this.camera = opts.camera ?? null;
    this.waterTime = { value: 0 };
    this.reflect = createWaterReflectState();
    this.water = this.rebuildWaterContainer(true);

    // ADR-196：订阅 envState 变更——渲染应用统一收敛到此回调：
    // mode 切换 → 重建容器；其余结构参数（size / 池深 / 壁厚）→ 按形态 transformLinks
    // 就地改 transform（ADR-272 扩展后 pool 亦零重建）；参数字段 → 就地改材质/uniform；
    // 子域开关 → 只切可见性。setter 只负责写 envState（不再各自就地改材质，避免双写）。
    // 只接收 water 组的键（dispatcher 前置过滤）。
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
        // 形态自身的切换必然重建；其余结构字段由当前形态自行声明（ADR-257 B 档）——
        // 新增形态无需回来改动本回调。
        const needsRebuild =
          changed.has("waterMode") ||
          getWaterBodyStrategy(envState.waterMode).needsRebuild(changed);
        if (needsRebuild) {
          // rebuildWaterContainer 内部已
          // rebuildWaterContainer 内部已 syncWaterVisibility（由已更新的 envState 重算
          // visible）——此处重复调用是纯 no-op，删除（film/pool/wetness 门控单一入口，便于推理）
          this.rebuildWaterContainer(false);
          if (changed.has("waterMode")) this.notify();
          return;
        }
        // [探针实证修复 2026-09-21] 开关与参数同批写入（氛围/预设快照、程序化批量
        // setEnvState）时，原「开关分支 → return 早退」会吞掉同行其余 water 键的分派：
        // envState 已更新、材质/transform 却停在旧值，画面与状态脱节，直到下一次无关
        // 派发才惰性补上。现参数照常逐键派发（waterEnabled 在分派表里是显式空条目），
        // 可见性统一在派发尾重算一次——开关与参数不再互斥。
        // 参数字段：就地应用（不重建容器，材质句柄保持稳定）
        this.applyChangedParams(changed);
        // [锐评 P2-1] 可见性只在开关变更时重算；wetness 不再参与可见性（仅作 alpha 乘数走分派表）
        if (changed.has("waterEnabled")) {
          this.syncWaterVisibility();
        }
        // [ADR-297] 倒影主开关参与 reflect 组三从控显隐（visibleWhen 吃
        // cap.waterReflectionEnabled 快照）——须 notify 触发 dock 重渲染，fog setMode 先例同法。
        if (changed.has("waterReflectionEnabled")) this.notify();
      },
      "water",
    );
  }

  // ── 波浪 shader 注入（Gerstner 位移 + 解析法线 + 微细节法线 + 圆角衰减 + 倒影混合）──
  // [行数红线治理 · ADR-315 后续] 该实现已沿真缝拆至 water-shader.ts（纯函数 + GLSL 注入串 +
  // 六锚点守卫，实例量经 WaterShaderCtx 惰性传入）；此处仅保留薄转发封装，使 buildCtx 的
  // buildMaterial 契约、既有测试与知识卡指针保持零改动。
  private buildWaveWaterMaterial(opts: {
    forPool: boolean;
    hasWallCeiling: boolean;
  }): THREE.MeshPhysicalMaterial {
    return buildWaveWaterMaterial({
      ...opts,
      ctx: {
        waterTime: this.waterTime,
        reflect: this.reflect,
        reflectionActive: () => this.reflectionActive(),
      },
    });
  }

  /** 遍历收集某个容器（Mesh/Group）下的所有 mesh，用于同步 material 参数 */
  private collectWaterMeshes(root: THREE.Object3D = this.water.root): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) out.push(m);
    });
    return out;
  }

  /**
   * 交给形态策略的装配上下文：材质构造（含波浪 shader 注入）仍留在 cap 侧，
   * strategy 只负责「用这些零件搭出什么样的水体」（ADR-257 B 档）。
   */
  private buildCtx(): WaterBuildContext {
    return {
      buildMaterial: (opts) => this.buildWaveWaterMaterial(opts),
    };
  }

  /** 释放旧 water 容器 */
  private disposeWater(): void {
    if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    const meshes = this.collectWaterMeshes();
    for (const m of meshes) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        // [锐评 2026-10-04 P3-1] 原此处读 `material.transmissionRenderTarget` 手动释放——该属性在
        // three r186 的 MeshPhysicalMaterial 上**不存在**（真身在 renderer 侧：`WebGLRenderer` 的
        // `renderState.state.transmissionRenderTarget[camera.id]`，由 renderer 按相机持有与清理），
        // 故该分支恒不触发（死代码）；锁它的用例靠测试自己伪造该字段通过，属自证式假绿，已一并删除。
        mat.dispose();
      }
    }
  }

  /** 重建 this.water 根容器（形态由策略表决定） */
  private rebuildWaterContainer(initial = false): WaterBody {
    const wasInScene = !initial && this.water.root.parent != null;
    if (!initial) this.disposeWater();
    // ADR-257 B 档：形态不再在此处三元判断，交给注册表——新增形态不影响本函数。
    this.water = getWaterBodyStrategy(envState.waterMode).build(this.buildCtx());
    this.syncWaterVisibility();
    if (wasInScene) {
      this.scene.add(this.water.root);
    }
    return this.water;
  }

  /** 水面可见性：**单门** = `envState.waterEnabled`（fog / shadow / reflector 同法）。
   *  [锐评 2026-10-04 P2-1] 原实现额外与 film 的 `wetness > 0` 相与——那让一级行 master 开关在
   *  wetness=0 时撒谎（显示 ON、场景无水），且与 master 的写值形成「点了又弹回」的双向困惑。
   *  现 wetness 只作 alpha 乘数（浓度 0 ⇒ 全透明），可见性语义唯一且诚实。 */
  private syncWaterVisibility(): void {
    this.water.root.visible = envState.waterEnabled;
  }

  /** 推进水面波纹动画（render loop 调用）。visible 已含 waterEnabled 语义，单判即可。
   *  ADR-297：反射 RT 渲染同受此门控——水面不可见时倒影无意义，一并免掉整场重渲。 */
  update(dt: number): void {
    if (!this.water.root.visible) return;
    this.waterTime.value += dt * envState.waterWaveSpeed;
    this.renderReflection();
  }

  // ── ADR-297 / ADR-315 D1②：水面模型倒影（隐藏 Reflector 借官方 RT + 水 shader 投影采样）──
  // 载体状态（reflector / clipBias / M⁻¹）与驱动逻辑已拆至 water-reflect.ts；
  // cap 侧保留薄封装——实例状态经 this.reflect 移交，逐帧入口仍为 update()。

  /** 倒影门控：总开关 ∧（SSR 抑制启用时 SSR 不活跃）∧ 宿主在场。
   *  ⚠️ pp* 键属 postprocessing 组，water 回调收不到派发——此处不另订第二路订阅，
   *  逐帧现读 envState 现算（真值源仍是 envState 单处，单门纪律不破）。 */
  private reflectionActive(): boolean {
    return reflectionActive(this.reflectCtx());
  }

  /** 倒影消费上下文（顶水面 + 宿主 renderer/camera；update 入口供 shader 编译补挂路复用） */
  private reflectCtx(): WaterReflectCtx {
    return {
      top: this.water.top,
      renderer: this.renderer,
      camera: this.camera,
      update: () => this.renderReflection(),
    };
  }

  /** 每帧一次反射 RT 渲染 + 水 shader 三 uniform 落地（ADR-297 逻辑见 water-reflect.ts） */
  private renderReflection(): void {
    renderReflection(this.reflect, this.water.root, this.scene, this.reflectCtx());
  }

  /** 弃倒影载体（RT + 材质 + 几何具名释放）：bias 重建与 dispose 共用同一出口。
   *  Reflector 不入场景，disposeWater 的 traverse 遍历不到，必须在此点名释放。 */
  private disposeReflector(): void {
    disposeReflector(this.reflect);
  }

  apply(): void {
    if (!this.water.root.parent) this.scene.add(this.water.root);
  }

  // 能力级启停 = waterEnabled 别名（SceneCapability 接口出口；fog/water 单门收口同法）。
  // 不再另有私有开关：真值源唯一，legacy 存档 water.enabled 也只写此一处。
  setEnabled(v: boolean): void {
    this.setWaterEnabled(v);
  }

  isEnabled(): boolean {
    return envState.waterEnabled;
  }

  // ── 水面：独立开关 / 形态切换 ──
  // ADR-196 收口：setter 只写 envState；渲染应用（可见性/重建/材质）统一走 registerEnvCallback。
  // [锐评 P1-0] setter 可选 WriteOpts（ground 同款范式）：菜单控件无参 = 用户手改（manual）；
  // 存档恢复委托站点显式传 RESTORE_SOURCE（auto-model）——省略即手改语义，勿过冲。
  setWaterEnabled(v: boolean, opts?: WriteOpts): void {
    setEnvState({ waterEnabled: v }, writeOpts(opts));
  }
  getWaterEnabled(): boolean {
    return envState.waterEnabled;
  }

  setWaterMode(m: WaterMode, opts?: WriteOpts): void {
    if (envState.waterMode === m) return;
    setEnvState({ waterMode: m }, writeOpts(opts));
  }

  /** 订阅参数变更（模式切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }
  getWaterMode(): WaterMode {
    // [锐评 F-3 顺手] 原 `envState.waterMode as WaterMode` 冗余 cast——schema 推导已是
    // WaterMode（enum values 派生），cast 只会掩盖未来类型漂移，删。
    return envState.waterMode;
  }

  // ── 水面参数（film + pool 通用）──
  // 就地渲染应用统一入口（registerEnvCallback 的参数字段分派）：不重建容器，保持材质句柄稳定。
  // ADR-286：应用逻辑全部在模块级 WATER_PARAM_APPLIERS 分派表（编译期完备 + 形态差异查 strategy），
  // 本方法只负责装配 ctx 并逐键派发。
  private applyChangedParams(changed: Set<EnvStateKey>): void {
    const strategy = getWaterBodyStrategy(envState.waterMode);
    const ctx: WaterApplyCtx = {
      water: this.water,
      strategy,
      targets: (role) => strategy.getTargets(this.water, role),
      top: this.water.top,
      setUniform: this.setUniform,
    };
    for (const key of changed) {
      // dispatcher 已前置过滤为 water 组；类型收窄在此收敛（拼错键 = undefined no-op，
      // 与旧行为「changed.has 不命中即跳过」一致）
      WATER_PARAM_APPLIERS[key as WaterParamKey]?.(ctx);
    }
  }

  /** 顶水面 shader 的 uniform 就地写入——穿透 three 的 userData.shader 后门，统一收口。
   *  原实现每处各写一遍五层 `as unknown as` cast（拼错 uniform 名即静默失效，与 ADR-257 批判的
   *  mesh-name 寻址同病）；守卫：shader 尚未编译或 uniform 名不存在时静默跳过——
   *  调用方均为「值已进 envState」的路径，重建时由 buildMaterial 读 envState 兜底。
   *  [锐评 3.1] name 形参收窄为 WaterUniformName（WATER_UNIFORM_NAMES 类型投影）——
   *  拼错 uniform 名编译即红，不再是 string 黑洞。 */
  private setUniform(mat: THREE.Material | undefined, name: WaterUniformName, value: number): void {
    const u = (
      mat as unknown as {
        userData?: { shader?: { uniforms?: Record<string, { value: number } | undefined> } };
      }
    )?.userData?.shader?.uniforms?.[name];
    if (u) u.value = value;
  }

  setWetness(v: number, opts?: WriteOpts): void {
    setEnvState({ waterWetness: v }, writeOpts(opts));
  }
  getWetness(): number {
    return envState.waterWetness;
  }

  setWaterColor(hex: number): void {
    setEnvState({ waterColor: hex }, { source: "manual" });
  }
  getWaterColor(): number {
    return envState.waterColor;
  }

  setWaterOpacity(v: number): void {
    setEnvState({ waterOpacity: v }, { source: "manual" });
  }
  getWaterOpacity(): number {
    return envState.waterOpacity;
  }

  // ── 微细节法线强度（顶层水面；GPU 程序化，无贴图槽，ADR-271）──
  setNormalStrength(v: number, opts?: WriteOpts): void {
    setEnvState({ waterNormalStrength: v }, writeOpts(opts));
  }
  getNormalStrength(): number {
    return envState.waterNormalStrength;
  }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number, opts?: WriteOpts): void {
    setEnvState({ waterPoolHeight: v }, writeOpts(opts));
  }
  getPoolHeight(): number {
    return envState.waterPoolHeight;
  }

  setPoolWallThickness(v: number, opts?: WriteOpts): void {
    setEnvState({ waterPoolWallThickness: v }, writeOpts(opts));
  }
  getPoolWallThickness(): number {
    return envState.waterPoolWallThickness;
  }

  setPoolWallColor(hex: number, opts?: WriteOpts): void {
    setEnvState({ waterPoolWallColor: hex }, writeOpts(opts));
  }
  getPoolWallColor(): number {
    return envState.waterPoolWallColor;
  }

  setPoolRoundness(v: number, opts?: WriteOpts): void {
    setEnvState({ waterPoolRoundness: v }, writeOpts(opts));
  }
  getPoolRoundness(): number {
    return envState.waterPoolRoundness;
  }

  setWaveSpeed(v: number, opts?: WriteOpts): void {
    setEnvState({ waterWaveSpeed: v }, writeOpts(opts));
  }
  getWaveSpeed(): number {
    return envState.waterWaveSpeed;
  }

  setChoppiness(v: number, opts?: WriteOpts): void {
    setEnvState({ waterChoppiness: v }, writeOpts(opts));
  }
  getChoppiness(): number {
    return envState.waterChoppiness;
  }

  // ── 浪高（ADR-319 D1：入 shader 前经 effectiveWaveHeight 双向往容器钳制）──
  setWaveHeight(v: number): void {
    setEnvState({ waterWaveHeight: v }, { source: "manual" });
  }
  getWaveHeight(): number {
    return envState.waterWaveHeight;
  }

  /** 浪高**实际生效值**（钳后）——供菜单 hint 显示隐藏耦合（锐评 2026-10-04 P1-2）：
   *  滑杆值受水位 / 池深预算钳制（`effectiveWaveHeight`），面板必须有出口告知实际生效多少，
   *  否则 0.15→1.0 整段拖动毫无反应而没有任何解释（85% 行程死区）。 */
  getEffectiveWaveHeight(): number {
    return effectiveWaveHeight(getWaterBodyStrategy(envState.waterMode).hasWallCeiling);
  }

  // ── 水面高度（ADR-257：跨形态通用，与容器彻底解耦）──
  setLevel(v: number, opts?: WriteOpts): void {
    setEnvState({ waterLevel: v }, writeOpts(opts));
  }
  getLevel(): number {
    return envState.waterLevel;
  }

  // ── 水面尺寸（ADR-272：两形态均零重建，故与 waterLevel 同列 form 组）──
  // ADR-283：下界 ≥1 / 上界 300 / NaN → 1 由 schema `range` 在唯一写入口统一钳制，setter 不再自备。
  setWaterSize(v: number, opts?: WriteOpts): void {
    // [锐评 N-2 2026-10-09] 第四网眼收口：原实现是 12 setter 中唯一不接 WriteOpts 者
    //（体内硬编码 manual）——legacy `size` 键委托站点经它恢复即 stamp manual 永久冻键，
    // 模型默认命中被 shouldOverwrite 静默拒写。无参 = 用户手改语义不变（writeOpts 默认 manual）。
    setEnvState({ waterSize: v }, writeOpts(opts));
  }
  getWaterSize(): number {
    return envState.waterSize;
  }

  setClarity(v: number, opts?: WriteOpts): void {
    setEnvState({ waterClarity: v }, writeOpts(opts));
  }
  getClarity(): number {
    return envState.waterClarity;
  }

  // ── 水面模型倒影（ADR-297）──
  // setter 只写 envState（渲染应用由 renderReflection 逐帧现读，WATER_PARAM_APPLIERS 空条目同口径）
  setWaterReflectionEnabled(v: boolean): void {
    setEnvState({ waterReflectionEnabled: v }, { source: "manual" });
  }
  getWaterReflectionEnabled(): boolean {
    return envState.waterReflectionEnabled;
  }

  setWaterReflectionStrength(v: number): void {
    setEnvState({ waterReflectionStrength: v }, { source: "manual" });
  }
  getWaterReflectionStrength(): number {
    return envState.waterReflectionStrength;
  }

  setWaterReflectionResolution(v: number): void {
    setEnvState({ waterReflectionResolution: v }, { source: "manual" });
  }
  getWaterReflectionResolution(): number {
    return envState.waterReflectionResolution;
  }

  // [锐评 F-2] 镜像裁剪偏置（原 ensureReflector 裸字面量 3 的下沉归宿；无菜单 UI，
  // 供预设/程序化写入与将来高级面板出口；变更由 ensureReflector 现读比对承接）
  setWaterReflectionClipBias(v: number): void {
    setEnvState({ waterReflectionClipBias: v }, { source: "manual" });
  }
  getWaterReflectionClipBias(): number {
    return envState.waterReflectionClipBias;
  }

  setWaterReflectDisableWhenSSR(v: boolean): void {
    setEnvState({ waterReflectDisableWhenSSR: v }, { source: "manual" });
  }
  getWaterReflectDisableWhenSSR(): boolean {
    return envState.waterReflectDisableWhenSSR;
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  getMenuNodes(): PreviewMenuNode[] {
    return buildWaterNodes(this);
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力主开关节点 id：env 面板据此升 headerToggle + body 剔除同源 */
  getMasterNodeId(): string {
    return "water-enabled";
  }

  /** 环境面板归属（ADR-268）：基础卡末位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "basic", order: 30 };
  }

  /** 保存状态到 localStorage。
   *  持久化字段 = schema 的 water 组键集（getPresetKeys("water")，含 waterEnabled——
   *  单门收口后它就是能力开关，fog/water 同法，2026-09-22 私有 enabled 退役后不再另落幽灵键）——
   *  不再手抄清单：新增 water 参数只要进 schema，**写侧**自动跟上（评审「一处参数六处接线」收口）。
   *  ⚠️ 读侧不自动：loadState 还原表仍是手写双轨清单，新键须同步登记——
   *  缺口由契约锁兜住：water-capability.test.ts「schema 键全部可 round-trip」（漏登记即红）。
   *  ⚠️ 历史键名 size / pool* 由 loadState 新旧双轨兼容；写侧统一用 water* 规范键。 */
  saveState(): void {
    const state: Record<string, unknown> = {};
    for (const key of getPresetKeys("water")) state[key] = envState[key];
    // [锐评 P1-4] 版本戳：唯一消费者 = loadState 的旧档迁移判据（water-migrations.ts）。
    // 缺它 = 被当作 ADR-319 之前的老档——水位恰为旧默认 0.01 时会被迁移。
    state[WATER_SCHEMA_VERSION_KEY] = WATER_SCHEMA_VERSION;
    persistState(this.id, state);
  }

  /** 从 localStorage 恢复状态。
   *  恢复段挂起派发（suspendEnvCallbacks，fog/ground/light 同法）：逐字段 setter 只写
   *  envState，末尾 rebuildWaterContainer 一次性从 envState 全量落地——消除「~15 次派发 ×
   *  mode 键中途重建」的重入窗口。resume 放 finally：计数逃逸会让全仓派发静默假死。
   *  ⚠️ 顶层 `enabled` 键（2026-09-22 私有门退役前的能力级幽灵键）不再消费：单门收口后
   *  水面开关唯一真值源 = waterEnabled（嵌套 dialect 的 enabled 子域开关由下方双轨表吸收）。 */
  loadState(): void {
    // [行数红线 ADR-315] 存档源 + legacy ground 双轨解析已下沉 water-persist.ts|
    // resolveWaterRestoreState（fromNestedLegacy 语义见该函数头注）；本方法只留恢复编排。
    const resolved = resolveWaterRestoreState();
    if (!resolved) return;
    const { state, fromNestedLegacy } = resolved;
    withEnvCallbacksSuspended(() => {
      restoreFields(state, {
        // legacy `size` 键（ADR-272 前旧名）——值一律交回唯一写入口 `setWaterSize`，
        // 不在此处自备钳制（ADR-283 收口：值域单一事实源 = schema `range`）。
        // 历史：此处曾自钳 `Number.isFinite(v) ? Math.max(1, v) : 1`——
        //   ① 与 setEnvState 的 clampFieldValue 重复（同是钳到 ≥1）；
        //   ② 且只覆盖下界，与 schema `range [1,300]` 口径不齐（自钳只算半个执法者）；
        //   ③ `Number.isFinite` 分支不可达：存档过 JSON 边界后 NaN/Infinity 已变 null。
        // 现存唯一例外是 shader 侧 `max(uSize, 0.001)`（防除零，语义不同，保留）。
        // [锐评 N-2] 委托站点显式传 RESTORE_SOURCE（恢复 = 程序化动作，禁 manual 冻键，
        // P1-0 来源纪律同法）——setter 无参默认 manual 只服务用户手改（水菜单入口）。
        size: { number: (v) => this.setWaterSize(v, RESTORE_SOURCE) },
      });
      // 归一化：V2/旧格式水面参数在 state.water 嵌套对象；新 flat 存档直接平铺在顶层。
      // 子域开关键随格式不同：V2 嵌套用 enabled；flat 用顶层 waterEnabled。
      const nested = fromNestedLegacy
        ? state // legacy.water 解包内容即嵌套方言（含 enabled 子域开关）
        : state.water && typeof state.water === "object"
          ? (state.water as Record<string, unknown>)
          : null;
      const w = (nested ?? state) as Record<string, unknown>;
      // [锐评 P0 收口 2026-09] canonical `water*` 标量键读侧派生化：直接读 schema 键集恢复，
      // 与 saveState（getPresetKeys("water")）同源派生——新增 water 标量键无需再回本处登记。
      // [锐评 P1-0 2026-10-08] 批量恢复器已下沉 water-persist（原 scene-capability.ts|restoreBySchema
      // 硬编码 manual 的暗门随下沉收口：现走 RESTORE_SOURCE=auto-model，与下方委托站点同口径）。
      // restoreWaterSchemaKeys 只接 number/boolean 两类 canonical 键；枚举 / 子域开关 / legacy 旧方言
      // 仍由下方手写还原器承接（存档兼容层，不自动）。
      restoreWaterSchemaKeys(w, getPresetKeys("water"));
      // [锐评 P1-0] 委托站点必须显式传 RESTORE_SOURCE——setter 服务用户手改（无参=manual），
      // 恢复路径若不带 opts 即把手改戳打进 water 组键（ground F-2 同款暗门，L848 注释同病）。
      restoreFields(w, {
        // 子域开关：仅当取到嵌套对象时 w.enabled 才是子域开关（顶层 enabled=已退役的
        // 能力级幽灵键，不再消费——见本方法头注）。flat 格式的 waterEnabled 已由上方
        // restoreWaterSchemaKeys 经 schema 键集恢复，此处仅留嵌套 legacy 的 enabled 别名。
        ...(nested ? { enabled: { boolean: (v) => this.setWaterEnabled(v, RESTORE_SOURCE) } } : {}),
        // 新旧键双轨（restoreFields 对缺失键安全跳过；实际存档只含一种方言）
        mode: oneOf(WATER_MODES, (v) => this.setWaterMode(v, RESTORE_SOURCE)),
        waterMode: oneOf(WATER_MODES, (v) => this.setWaterMode(v, RESTORE_SOURCE)),
        // legacy 旧方言别名（ADR-272/257 前的旧名；写侧已规范为 water*）——仅兼容旧存档，不自动
        wetness: { number: (v) => this.setWetness(v, RESTORE_SOURCE) },
        normalStrength: { number: (v) => this.setNormalStrength(v, RESTORE_SOURCE) },
        waveSpeed: { number: (v) => this.setWaveSpeed(v, RESTORE_SOURCE) },
        choppiness: { number: (v) => this.setChoppiness(v, RESTORE_SOURCE) },
        level: { number: (v) => this.setLevel(v, RESTORE_SOURCE) },
        clarity: { number: (v) => this.setClarity(v, RESTORE_SOURCE) },
        poolHeight: { number: (v) => this.setPoolHeight(v, RESTORE_SOURCE) },
        poolWallThickness: { number: (v) => this.setPoolWallThickness(v, RESTORE_SOURCE) },
        poolWallColor: { number: (v) => this.setPoolWallColor(v, RESTORE_SOURCE) },
        poolRoundness: { number: (v) => this.setPoolRoundness(v, RESTORE_SOURCE) },
      });
      // [锐评 P1-4] ADR-319 D1 默认值抬升对存量存档的追溯：老档（无版本戳）里若记录的是旧默认
      // 0.01，会把波高预算 `effectiveWaveHeight` 钳到 1 cm（浪死平）——迁到现默认；带版本戳的
      // 新档一律不动（用户可自由把水位设成 0.01）。判据与边界见 water-migrations.ts。
      const migratedLevel = migrateLegacyWaterLevel(
        w.waterLevel,
        (state as Record<string, unknown>)[WATER_SCHEMA_VERSION_KEY],
      );
      // [锐评 P1-0] 迁移/兜底同为程序化动作（非用户手改），RESTORE_SOURCE 收口——
      // 否则迁移把 waterLevel 打成 manual，同轨 auto-model 写入静默被拒。
      if (migratedLevel !== undefined) this.setLevel(migratedLevel, RESTORE_SOURCE);
      // ADR-257 迁移：旧存档没有 waterLevel 键（旧语义里「水面 y == 池深 h」，即水填到池顶）。
      // pool 用户兜底取**中池位** `poolHeight × 0.5`——这是预算 `min(level, poolHeight−level)` 的
      // 最大值点（= poolHeight/2），也是新默认 `waterLevel=0.15 / waterPoolHeight=0.3` 的比例。
      // 旧实现兜底取 `poolHeight` 会让预算 = min(h, 0) = 0、浪退化成平面（ADR-319 §3 预警项，
      // 「别让兜底路径绕过新预算」）；旧默认 0.01 的 film 沿用说法已随 ADR-319 D1 抬到 0.15。
      // 注：mode/waterMode 在上方 restoreFields 中已先行还原，故此处读到的 waterMode 即存档形态。
      const hadLevelKey = w.level !== undefined || w.waterLevel !== undefined;
      if (!hadLevelKey && envState.waterMode === "pool") {
        // [锐评 P1-0] 兜底同为程序化动作（非用户手改），RESTORE_SOURCE 收口（同上方迁移站点）。
        this.setLevel(envState.waterPoolHeight * 0.5, RESTORE_SOURCE);
      }
    });
    // 统一应用一次（fog applyFog / ground 同法）：容器重建即从 envState 全量重导——
    // 材质（buildMaterial 读 envState）、结构 transform（applyTransformLinks）、水位与
    // 可见性（rebuildWaterContainer 内 syncWaterVisibility）一条路径闭环，不依赖逐键派发。
    this.rebuildWaterContainer(false);
  }

  /** 移除并释放 */
  dispose(): void {
    this.unsubscribeEnv();
    if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    this.disposeWater();
    // ADR-297：镜面载体不入场景，disposeWater 遍历不到——具名释放（RT/材质/几何，
    // 与 bias 重建路径共用 disposeReflector 出口）
    this.disposeReflector();
  }
}
