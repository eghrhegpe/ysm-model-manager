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

import * as THREE from "three";
// ADR-297：倒影复用官方 Reflector（reflector-capability 同先例）——不允许自写镜像相机/斜裁剪。
import { Reflector } from "three/addons/objects/Reflector.js";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { assertRevisionRange, reportPatchIssue } from "@/preview-3d/shader-patches/patch-guard.ts";
import {
  registerEnvCallback,
  resumeEnvCallbacks,
  suspendEnvCallbacks,
} from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, isSsrRenderActive, setEnvState } from "@/preview-3d/state/env-state.ts";
import { type EnvStateKey, getPresetKeys } from "@/preview-3d/state/env-state-schema.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import {
  type EnvPlacement,
  oneOf,
  persistState,
  restoreBySchema,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";
// ADR-257：形态「如何组装渲染体 / 如何解释尺寸与水位」已下沉到可注册的策略表，
// cap 只持有 WaterBody 并按语义 role 取用部件，不再出现 `mode ===` 判别联合。
import {
  clampPoolRoundness,
  getWaterBodyStrategy,
  INNER_WALL_OPACITY_FACTOR,
  type WaterBody,
  type WaterBodyStrategy,
  type WaterBuildContext,
  type WaterPartRole,
  type WaterTopMesh,
} from "./water-body-strategies.ts";
import { buildWaterNodes } from "./water-menu.ts";
import type { WaterMode } from "./water-state.ts";
import { WATER_MODES, WATER_WAVE_SEGMENTS } from "./water-state.ts";

export type { WaterMode };

// [shader-patch 守卫] water 的 REVISION 断言在**材质构造期**执行（见 buildWaveWaterMaterial）。
// 原实现挂在 onBeforeCompile + 模块级 once flag：`waterRevisionChecked` 是进程级单例，
// 多实例（多 tab / 场景重建）下只有首个实例真正被审计，语义也难推理——现每实例每次构造断言，
// 构造频率是用户操作级（模式切换 / pool 结构字段变更），开销可忽略。
/* ===== ADR-286：water 参数应用分派表 =====
 * 原为 applyChangedParams 里的逐键 if 瀑布；现按 changed 逐键查表派发：
 *  - `Record<WaterParamKey, …>` 编译期强制 water 组每键表态——缺键即红；
 *  - `waterEnabled` / `waterMode` / `waterWaveSpeed` 的空条目是**结构性声明**（非疏漏）：
 *    分别由回调的 syncWaterVisibility / rebuildWaterContainer / update 累加速度承接，此处无材质应用；
 *  - 派发序无关结果的保证有两条：多数条目各写各自不相交的字段/uniform；结构三键
 *    （size/poolHeight/wallThickness）共享 applyStructuralProfile 写域，但它是**读 envState
 *    全量的幂等执行器**（重复调用 no-op），且其余条目不触碰 transform——故乱序仍收敛
 *    （守卫 = 乱序全量 patch ≡ 单键逐发快照一致）；派生量（effectiveOpacity）由 envState 现算；
 *  - 形态门控（wetnessGated / supportsVolumeOptics / 空 targets 数组）一律查 strategy，不写 mode 分支。 */
type WaterParamKey = Extract<EnvStateKey, `water${string}`>;
type WaterApplyCtx = {
  water: WaterBody;
  strategy: WaterBodyStrategy;
  targets: (role: WaterPartRole) => THREE.Mesh[];
  /** 顶水面（承载波浪材质）：各形态 build 期统一塞入，恒存在 */
  top: WaterTopMesh;
  setUniform: (mat: THREE.Material | undefined, name: WaterUniformName, value: number) => void;
};
/** 结构参数三键共享：查表执行 transformLinks（幂等，重复调用 no-op） */
function applyStructuralProfile(ctx: WaterApplyCtx): void {
  ctx.strategy.applyProfile(ctx.water, {
    size: envState.waterSize,
    poolHeight: envState.waterPoolHeight,
    wallThickness: envState.waterPoolWallThickness,
  });
}
// [锐评 W-3] 分派表键名显式字面量——供契约测试与 getPresetKeys("water") 做字面同步核查。
// WaterParamKey 派生类型（Extract<EnvStateKey, `water${string}`>）无法反向 import 回 schema，
// 故键名集合在此以字面量登记，测试比对字面量与 schema 键集，任一侧加键忘另一侧即红。
export const WATER_PARAM_APPLIER_KEYS = [
  "waterEnabled",
  "waterMode",
  "waterWaveSpeed",
  "waterWetness",
  "waterOpacity",
  "waterColor",
  "waterNormalStrength",
  "waterPoolWallColor",
  "waterPoolRoundness",
  "waterClarity",
  "waterSize",
  "waterPoolHeight",
  "waterPoolWallThickness",
  "waterChoppiness",
  "waterLevel",
  "waterReflectionEnabled",
  "waterReflectionStrength",
  "waterReflectionResolution",
  "waterReflectionClipBias",
  "waterReflectDisableWhenSSR",
] as const;
/** 结构性空条目（无材质应用）：可见性/形态/波纹速度/倒影门控均由回调或逐帧渲染循环承接，
 *  此处零材质写。同一函数身份供反向机检——空条目全集 == 结构承接 ∪ 逐帧现读登记表
 *  （`WATER_NOOP_APPLIER_KEYS`），新增空键必须在两处登记之一表态，否则契约测试即红。 */
const NOOP_APPLIER: (ctx: WaterApplyCtx) => void = () => {};
const WATER_PARAM_APPLIERS: Record<WaterParamKey, (ctx: WaterApplyCtx) => void> = {
  waterEnabled: NOOP_APPLIER, // 可见性由回调 syncWaterVisibility 单独承接
  waterMode: NOOP_APPLIER, // 形态切换由回调 rebuildWaterContainer 承接，不入本表
  waterWaveSpeed: NOOP_APPLIER, // [锐评 3.3] 无材质应用——消费点在 update() 逐帧现读 envState（登记于 WATER_FRAME_READ_KEYS）
  waterWetness: ({ strategy, top, setUniform }) => {
    if (!strategy.wetnessGated) return;
    const eff = envState.waterOpacity * envState.waterWetness;
    top.material.opacity = eff;
    setUniform(top.material, "uBaseOpacity", eff);
  },
  waterOpacity: ({ strategy, targets, top, setUniform }) => {
    // 顶水面 + 池内壁（ADR-257 审核 Item 6：内壁透明度必须随 waterOpacity 跟随，
    // 否则拖透明度滑块时水面与池壁脱节；内壁套 INNER_WALL_OPACITY_FACTOR 与构建期一致）
    const eff = strategy.wetnessGated
      ? envState.waterOpacity * envState.waterWetness
      : envState.waterOpacity;
    top.material.opacity = eff;
    setUniform(top.material, "uBaseOpacity", eff);
    for (const m of targets("wallInner")) {
      (m.material as THREE.MeshPhysicalMaterial).opacity =
        envState.waterOpacity * INNER_WALL_OPACITY_FACTOR;
    }
  },
  waterColor: ({ targets }) => {
    for (const m of [...targets("surface"), ...targets("wallInner")]) {
      const mat = m.material as THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
      if ("color" in mat) mat.color.setHex(envState.waterColor);
    }
  },
  waterNormalStrength: ({ top, setUniform }) => {
    // 微细节法线强度（GPU 侧就地生效，无贴图重算、无 needsUpdate）
    setUniform(top.material, "uDetailStrength", envState.waterNormalStrength);
  },
  waterPoolWallColor: ({ targets }) => {
    // 池底 + 外壁（film 下两者皆空数组，天然 no-op）
    for (const m of [...targets("floor"), ...targets("wallOuter")]) {
      (m.material as THREE.MeshStandardMaterial).color.setHex(envState.waterPoolWallColor);
    }
  },
  waterPoolRoundness: ({ strategy, top, setUniform }) => {
    // 形态门控与构造期同源（`supportsRoundness`）：film 水膜无容器，写圆角会凭空裁掉四角。
    // 构造期靠 buildMaterial 的 forPool 恒 0，运行期必须显式查 strategy——否则 pool 专属参数
    // 会经存档恢复 / 预设套用 / 其他 cap 直写 envState 泄漏进 film 材质（2026-09 修复）。
    if (!strategy.supportsRoundness) return;
    // 经 clampPoolRoundness——与构造期同一钳制，防存档恢复/其他 cap 直写 envState 时越界值漏进 uniform
    setUniform(top.material, "uRoundness", clampPoolRoundness(envState.waterPoolRoundness));
  },
  waterClarity: ({ strategy, targets, top }) => {
    // 仅启用体积光学的形态，避免把 film 水膜变透光体
    if (!strategy.supportsVolumeOptics) return;
    for (const m of [...targets("surface"), ...targets("wallInner")]) {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if ("transmission" in mat) {
        mat.transmission = m === top ? envState.waterClarity : envState.waterClarity * 0.5;
        mat.needsUpdate = true;
      }
    }
  },
  waterSize: (ctx) => {
    applyStructuralProfile(ctx);
    // uSize / uHalfSize 属波浪 shader 的共享 uniform（跨形态一致），故仍留在 cap 而非下沉
    ctx.setUniform(ctx.top.material, "uSize", envState.waterSize);
    ctx.setUniform(ctx.top.material, "uHalfSize", envState.waterSize / 2);
  },
  waterPoolHeight: (ctx) => {
    applyStructuralProfile(ctx);
    // 池深同时是顶水面的体积光学光程（ADR-257：「容器内水的光程」由容器深度派生）。
    // 派生量必须随 poolHeight 重算，否则拖池深滑块观感裂缝；仅 supportsVolumeOptics 有意义。
    if (!ctx.strategy.supportsVolumeOptics) return;
    ctx.top.material.thickness = Math.max(0.01, envState.waterPoolHeight * 0.5);
  },
  waterPoolWallThickness: (ctx) => {
    applyStructuralProfile(ctx);
    // 壁厚同时是池内壁的体积光学光程（材质属性，与几何无关）
    for (const m of ctx.targets("wallInner")) {
      (m.material as THREE.MeshPhysicalMaterial).thickness = envState.waterPoolWallThickness;
    }
  },
  waterChoppiness: ({ top, setUniform }) => {
    setUniform(top.material, "uChoppiness", envState.waterChoppiness);
  },
  waterLevel: ({ water, strategy }) => {
    // ADR-257：水面 position.y（film/pool 通用，零重建）——旧语义抬水面须重建 10 个 mesh，如今一个标量
    strategy.applyLevel(water, envState.waterLevel);
  },
  // ADR-297 倒影五键：结构性空条目——门控/权重/RT 边长/镜面高度/裁剪偏置全部由
  // renderReflection / ensureReflector 逐帧现读 envState（真值源单一，派发侧零材质写，
  // waterWaveSpeed 同口径，均登记于 WATER_FRAME_READ_KEYS）。clipBias 虽烘进 Reflector 闭包不可就地改，但「弃载体懒建」
  // 收敛在 ensureReflector 的现读比对里（锐评 F-2），派发侧同样无需动作。
  waterReflectionEnabled: NOOP_APPLIER,
  waterReflectionStrength: NOOP_APPLIER,
  waterReflectionResolution: NOOP_APPLIER,
  waterReflectionClipBias: NOOP_APPLIER,
  waterReflectDisableWhenSSR: NOOP_APPLIER,
};

// [锐评 3.1 守卫] 水 shader uniform 名的**唯一登记点**。
// 历史：uniform 名在 onBeforeCompile 手抄一遍（初始化）、setUniform 再用 string key 写回——
// 两份词典手抄，拼错即静默失败（guard 只防「uniform 不存在」，不防 typo）。
// 现收编：本表是全量登记，setUniform 的 name 形参收窄为 WaterUniformName（编译期防 typo），
// 测试「 injected uniform ⊆ WATER_UNIFORM_NAMES ∧ WATER_UNIFORM_NAMES ⊆ injected 」（双向）锁同步。
export const WATER_UNIFORM_NAMES = [
  // 波浪/形态（onBeforeCompile 初始化 + setUniform 写回）
  "uTime",
  "uSize",
  "uHalfSize",
  "uBaseOpacity",
  "uRoundness",
  "uChoppiness",
  "uDetailStrength",
  // ADR-297 倒影三件套（onBeforeCompile 初始化 + renderReflection/applyReflectionUniforms 每帧写）
  "uReflTex",
  "uReflMatrix",
  "uReflStrength",
] as const;

/** setUniform 的合法 uniform 名（WATER_UNIFORM_NAMES 的类型投影）——拼错编译即红 */
export type WaterUniformName = (typeof WATER_UNIFORM_NAMES)[number];

/** [锐评 3.5] clipBias 重建死区（单位 = clipBias 自定义量级，非米制）。
 *  schema `waterReflectionClipBias` 滑杆 step=0.1，拖满 0→10 有 ~100 个离散值——
 *  每个都触发 Reflector + RT 重建的话，单次拖动会重建百次（几何/材质/RT 三件全建）。
 *  死区 0.05：|Δbias| < 0.05 时镜像裁剪面位移肉眼不可感，跳过重建（保住内嵌 carry）。
 *  与既有纪律一致：bias 实质变化（F-2 的 1.5 偏离 = Δ1.5）仍重建。 */
export const REFLECTOR_CLIP_BIAS_TOLERANCE = 0.05;

/**
 * [锐评 3.3] 「无材质应用、由 render-loop 逐帧现读 envState」的 water 键登记表。
 * 背景：`applyChangedParams` 分派表里这类键只有空条目（`NOOP_APPLIER` 身份），
 * 消费点在逐帧渲染循环现读 envState——若不显式登记，维护者看到空条目只能人肉
 * grep `update()` 才知去向（隐性约定）。本表把「这类键存在、且消费点必在渲染循环」
 * 变成可验证的结构证据：
 *  - 契约测试①断言「本表条目 ∈ WATER_PARAM_APPLIER_KEYS」（登记不悬空）；
 *  - 契约测试③反向闭包断言「分派表空条目全集 == 结构承接 ∪ 本表」（见
 *    WATER_NOOP_APPLIER_KEYS）——新加空键不在此登记即红；
 *  - 新加同类键（未来若有大水面仍需逐帧读 envState 的推导量）须在此登记。
 * 键与消费点：`waterWaveSpeed` = `update(dt)` 顶部逐帧累加（无条件）；
 * ADR-297 倒影五键 = `renderReflection / ensureReflector / applyReflectionUniforms`
 * （均自 update 驱动；宿主 renderer/camera 缺席时倒影子系统整体失效、无载体即不读，
 * 逐帧现读属性不变——门控键 `waterReflectDisableWhenSSR` 读 pp 键现算，同纪律）。
 * 行为实证：waveSpeed 见 [锐评 3.3] ②用例；倒影五键见 ADR-297 用例组
 * （「水位/分辨率/强度逐帧现读」「[锐评 F-2] clipBias 弃载体重建」「[锐评 3.5] 死区」
 * 「SSR 抑制真值表」「无宿主/默认关」门控用例）。
 */
export const WATER_FRAME_READ_KEYS = [
  "waterWaveSpeed",
  "waterReflectionEnabled",
  "waterReflectionStrength",
  "waterReflectionResolution",
  "waterReflectionClipBias",
  "waterReflectDisableWhenSSR",
] as const;

/** [锐评 3.3 ③ 反向闭包] 分派表空条目（NOOP_APPLIER 身份命中）键全集——机器派生，不手写。
 *  契约测试断言其与「结构承接（waterEnabled/waterMode，回调 syncWaterVisibility /
 *  rebuildWaterContainer 承接）∪ WATER_FRAME_READ_KEYS」集合相等：新增空键必须二选一
 *  登记（结构承接改注释归因，或入逐帧现读表），否则即红。 */
export const WATER_NOOP_APPLIER_KEYS = (
  Object.keys(WATER_PARAM_APPLIERS) as WaterParamKey[]
).filter((k) => WATER_PARAM_APPLIERS[k] === NOOP_APPLIER);

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
  /** ADR-297：倒影载体——官方 Reflector 但**不挂进场景**：只借它「镜像相机 + 斜裁剪 + 整场渲进 RT」
   *  的管线，反射贴图不靠镜面展示、由水 shader 自采样（投影 + 斜率扰动 + fresnel）。首次活跃懒建。 */
  private reflector: Reflector | null = null;
  /** [锐评 F-2] 懒建时烙进的 clipBias（schema waterReflectionClipBias，默认 3 = 原裸字面量值）。
   *  bias 烘在 Reflector.onBeforeRender 闭包里（r185 源码实证），无法就地改 uniform——
   *  ensureReflector 现读 envState 与之比对，不一致即弃载体、下拍以新 bias 重建。 */
  private reflectorClipBias = -1;
  /** 逐帧临时量：matrixWorld⁻¹（官方 textureMatrix 末位乘了镜面变换，输入是镜面局部坐标；
   *  水 shader 喂世界坐标，须右乘 M⁻¹ 剥回世界空间口径） */
  private readonly reflWorldInv = new THREE.Matrix4();
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
        // wetness 与 enabled 都参与可见性门控（wetnessGated 形态下 0 即隐），末位统一重算
        if (changed.has("waterWetness") || changed.has("waterEnabled")) {
          this.syncWaterVisibility();
        }
        // [ADR-297] 倒影主开关参与 reflect 组三从控显隐（visibleWhen 吃
        // env.waterReflectionEnabled 快照）——须 notify 触发 dock 重渲染，fog setMode 先例同法。
        if (changed.has("waterReflectionEnabled")) this.notify();
      },
      "water",
    );
  }

  // ── 水材质（波浪 shader + fragment 程序化微细节法线，ADR-271）：film 顶 / pool 顶 共用，避免技术分叉 ──
  private buildWaveWaterMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial {
    // [shader-patch 守卫] REVISION 断言：water 锚点是渲染管线稳定 chunk 标记，给宽松范围
    // [185,190)，升级审计后再收窄。失配即 throw → registry 工厂兜底使本 cap 缺失，拒绝静默降级。
    assertRevisionRange({
      module: "water-patch",
      allowed: ["185", "186", "187", "188", "189"],
    });
    // 升级到 MeshPhysicalMaterial：pool 模式用 transmission/thickness 体现「水体厚度感」，film 仍降级为原视觉
    const mat = new THREE.MeshPhysicalMaterial({
      color: envState.waterColor,
      transparent: true,
      opacity: envState.waterOpacity * (opts.forPool ? 1 : envState.waterWetness),
      roughness: 0.15,
      metalness: opts.forPool ? 0.0 : 0.3,
      depthWrite: false,
      transmission: opts.forPool ? envState.waterClarity : 0,
      // ADR-257：语义重述为「容器内水的光程」——由容器深度派生，随 poolHeight 变化、
      // 不随 waterLevel 变化（它是容器属性，不描述水面位置）。
      thickness: opts.forPool ? Math.max(0.01, envState.waterPoolHeight * 0.5) : 0,
      clearcoat: opts.forPool ? 0.8 : 0,
      clearcoatRoughness: 0.1,
    });

    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      mat.userData.shader = shader;
      shader.uniforms.uTime = this.waterTime;
      shader.uniforms.uRoundness = {
        value: opts.forPool ? clampPoolRoundness(envState.waterPoolRoundness) : 0,
      };
      shader.uniforms.uHalfSize = { value: envState.waterSize / 2 };
      shader.uniforms.uSize = { value: envState.waterSize };
      shader.uniforms.uChoppiness = { value: envState.waterChoppiness };
      // 微细节法线强度（原 normalScale 槽位的替代；值域 0-1，由 water 组键 `waterNormalStrength`
      // 驱动——菜单控件 water-normal-strength；旧「ground-normal-strength 驱动」为水面拆分前口径）
      shader.uniforms.uDetailStrength = { value: envState.waterNormalStrength };
      shader.uniforms.uBaseOpacity = { value: mat.opacity };
      // ADR-297 倒影三件套：贴图 + 镜面投影矩阵 + 权重。默认 0 = 混合块整体跳过——
      // 开关只翻 uniform，不触发 program 重编译；值由 renderReflection 逐帧驱动。
      shader.uniforms.uReflTex = { value: null as THREE.Texture | null };
      shader.uniforms.uReflMatrix = { value: new THREE.Matrix4() };
      shader.uniforms.uReflStrength = { value: 0 };
      // [ADR-297] 新材质编译入场时若镜像已在场（如形态切换后的重编译），同一拍即重绑
      // 三 uniform——不等下一帧 renderReflection 补挂，倒影零滞后。
      if (this.reflector && this.reflectionActive()) {
        this.applyReflectionUniforms(shader, this.reflector);
      }
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uSize;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         uniform float uRoundness;
         uniform float uChoppiness;
         varying vec3 vWorldPos_wave;
         varying float vFoam;
         varying vec2 vWaveSlope_wave;
         const int GERSTNER_COUNT = 6;
         float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
         // Gerstner 余摆线：返回**物体空间位移**；out 碎波泡沫 + out 物体空间法线。
         // 方向/相位由 wave index hash 播种，freq*=1.19 amp*=0.82 几何级数；
         // 陡度钳制 per-wave σ·k ≤ 0.8/N → Σ ≤ 0.8 防自交。
         //
         // ⚠️ 尺度约定（2026-09-18 实证修正，两处换算缺一不可）：
         // 波场定义在世界水平尺度上——p = position.xy * uSize 即世界水平坐标（水面 mesh 为
         // 单位平面 × scale(uSize,uSize,1)，故局部 1 单位 = 世界 uSize 单位；高度轴 scale.z=1 同尺度）。
         //   · 位移：水平分量是**世界量**，加进局部坐标前须 /sizeSafe；高度分量 scale.z=1 无需换算。
         //   · 法线：解析式给出的是「世界水平偏导」，而 objectNormal 必须是**物体空间法线**——
         //     各向异性缩放经 normalMatrix（逆缩放）还原，故水平分量须 ×sizeSafe。
         // 修正前二者同时漏换算（几何法线偏离解析值平均 94°、最大 179°＝大面积翻面；
         // 修正后 2.4°/7.0°，仅剩一阶近似残差）——数值实证脚本与结论见 ADR-257 §6.4。
         vec3 gerstner(vec2 p, out float foam, out vec3 nrm) {
           vec3 disp = vec3(0.0);
           float jxx = 0.0, jzz = 0.0, jxz = 0.0;
           nrm = vec3(0.0);
           // 防除零：/uSize 遇 0 会产生 NaN 几何，故取正下界；setter（≥1）与 loadState 恢复
           // 另有入口钳制（两道防线，语义不同：此处只求非零）。
           float sizeSafe = max(uSize, 0.001);
            // 采样抗锯齿（2026-09-22）：顶点间距 = uSize / 分段数（唯一事实源
            // WATER_WAVE_SEGMENTS，几何装配与此处同源）。波长 λ 的可呈现性取决于每波长
            // 顶点数 λ/s：逼近奈奎斯特极限 2 时欠采样混叠成游走摩尔纹（300 m 大水面
            // 高频波频闪的病灶）。逐波淡出：≥6 顶点/波长全保留，2–6 线性消退；
            // 1‰ 下界保 wa 恒 > 0——steep 项含 1/wa，恰零会炸 Inf×0 = NaN。
            float spacing = sizeSafe / float(${WATER_WAVE_SEGMENTS});
           for (int i = 0; i < GERSTNER_COUNT; i++) {
             float fi = float(i);
             float ang = hash11(fi + 1.0) * 6.2831853;
             vec2 dir = vec2(cos(ang), sin(ang));
             float freq = 0.25 * pow(1.19, fi);
             float amp = min(0.6 * pow(0.82, fi) / freq, 0.5);
             // 衰减须在 wa/steep 派生之前：位移 / 解析法线 / 泡沫 Jacobian 同源于 amp，
             // 一处淡出三处一致（法线不会声称一个位移里不存在的高频斜率）。
             float waveLen = 6.2831853 / freq;
             float aa = max(smoothstep(2.0, 6.0, waveLen / spacing), 0.001);
             amp *= aa;
             float speed = sqrt(9.8 * freq);
             float wa = freq * amp;
             float steep = clamp(uChoppiness * 0.8 / (wa * float(GERSTNER_COUNT)), 0.0, 0.8 / (wa * float(GERSTNER_COUNT)));
             float phase = freq * dot(dir, p) - speed * uTime;
             float c = cos(phase), s = sin(phase);
             disp.x += steep * amp * dir.x * c / sizeSafe;
             disp.y += steep * amp * dir.y * c / sizeSafe;
             disp.z += amp * s;
             // 泡沫掩码 = 水平压缩量：偏导按位移项逐项取（Jacobian 启发式）
             jxx += steep * wa * dir.x * dir.x * c;
             jzz += steep * wa * dir.y * dir.y * c;
             jxz += steep * wa * dir.x * dir.y * c;
             // 法线偏导：世界水平偏导 -Σ D·WA·C → 物体空间须 ×size；高度轴 -Σ Q·WA·S 同尺度
             nrm.x -= dir.x * wa * c * sizeSafe;
             nrm.y -= dir.y * wa * c * sizeSafe;
             nrm.z -= steep * wa * s;
           }
           nrm.z += 1.0;
           nrm = normalize(nrm);
           float J = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
           foam = smoothstep(0.0, -0.25, J);
           return disp;
         }`,
      );
      // 解析法线覆盖：必须在 beginnormal_vertex **之后**（objectNormal 由该 chunk 声明）、
      // defaultnormal_vertex **之前**（后者经 normalMatrix 变换并对背面翻转）。
      // 此处只能用 position 属性——transformed 尚未在 begin_vertex 定义。
      // gerstner 交付的 nrm 已是物体空间法线（尺度换算见其头注），可直接赋给 objectNormal。
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
         {
           float gnf;
           vec3 ysmWaveNormal;
           gerstner(position.xy * uSize, gnf, ysmWaveNormal);
           objectNormal = ysmWaveNormal;
           vWaveSlope_wave = ysmWaveNormal.xy;
         }`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec2 wpos = transformed.xy * uSize;
         float gf;
         vec3 gWaveNormalUnused;
         vec3 gdisp = gerstner(wpos, gf, gWaveNormalUnused);
         transformed.x += gdisp.x;
         transformed.y += gdisp.y;
         transformed.z += gdisp.z;
         vFoam = gf;
         vec4 worldPosWave = modelMatrix * vec4(transformed, 1.0);
         vWorldPos_wave = worldPosWave.xyz;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         uniform float uDetailStrength;
         uniform sampler2D uReflTex;
         uniform mat4 uReflMatrix;
         uniform float uReflStrength;
         varying vec3 vWorldPos_wave;
         varying float vFoam;
         varying vec2 vWaveSlope_wave;`,
      );
      // 微细节法线（GPU 程序化，替代原 256² CPU DataTexture + normalMap 槽）：
      // 三组方向正弦沟槽求偏导，参数与原 generateNormalMap 逐项同源（0.08/0.8、0.05/1.1、0.03/1.6）——
      // 搬迁只换执行位置，不换谱线，故观感连续。
      // p 取世界水平坐标 ×2：复刻原贴图的世界映射（覆盖 [-uSize, uSize]，宽 2×size）。
      // 注入点必须在 normal_fragment_maps **之后**——fragment 的 normal 是**视图空间**量，
      // 由 three 在 normal_fragment_begin 产出、normal_fragment_maps 消费完毕后方可使用。
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 dp = vWorldPos_wave.xz * 2.0;
           vec2 dd1 = normalize(vec2(1.0, 0.3));
           vec2 dd2 = normalize(vec2(-0.4, 1.0));
           vec2 dd3 = normalize(vec2(0.2, -0.8));
           float dh1 = 0.08 * cos(dot(dp, dd1) * 0.8);
           float dh2 = 0.05 * cos(dot(dp, dd2) * 1.1);
           float dh3 = 0.03 * cos(dot(dp, dd3) * 1.6);
           float dhdx = dh1 * dd1.x * 0.8 + dh2 * dd2.x * 1.1 + dh3 * dd3.x * 1.6;
           float dhdz = dh1 * dd1.y * 0.8 + dh2 * dd2.y * 1.1 + dh3 * dd3.y * 1.6;
           // 扰动先在世界空间构造（水面朝上，切向即水平面），再经 viewMatrix 送入视图空间
           vec3 detailWorld = vec3(-dhdx, 0.0, -dhdz) * uDetailStrength;
           normal = normalize(normal + (viewMatrix * vec4(detailWorld, 0.0)).xyz);
         }`,
      );
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", "void main() {\n");
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         // 圆角边缘衰减：抬到函数作用域算一次——alpha 与倒影权重共用（倒影边缘=水体边缘，同步淡出）
         float fade = 1.0;
         if (uRoundness > 0.0) {
           vec2 p = vWorldPos_wave.xz;
           float md = max(abs(p.x), abs(p.y));
           float edge = uHalfSize - uRoundness * uHalfSize;
           fade = 1.0 - smoothstep(edge, uHalfSize, md);
           gl_FragColor.a *= fade;
         }
         // 碎波泡沫：Jacobian<0 处 mix 白沫（不依赖反射，单 pass 廉价）
         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.92, 0.95, 0.98), vFoam * 0.55);
         // ADR-297 水面模型倒影：世界坐标投影进镜像相机裁剪空间采样反射 RT——uReflMatrix
         // 已含官方 bias（末位右乘 M⁻¹ 剥回世界口径）→ 除 w 即 uv。RT 内容为线性空间
         // （three 仅对 canvas 输出做 tone map），采样值过同源 linearToOutputTexel 编到
         // 与已过 colorspace 的底色同域再混。uReflStrength=0 整块跳过：开关只翻 uniform。
         if (uReflStrength > 0.0) {
           vec4 rc = uReflMatrix * vec4(vWorldPos_wave, 1.0);
           if (rc.w > 0.0) {
             // Gerstner 解析斜率（物体空间切向，与光照法线同源）扰动 uv：倒影随波摆动
             vec2 ruv = clamp(rc.xy / rc.w + vWaveSlope_wave * 0.08, vec2(0.002), vec2(0.998));
             vec3 refl = linearToOutputTexel(vec4(texture2D(uReflTex, ruv).rgb, 1.0)).rgb;
             // fresnel：掠射增强反射，正视保持水体通透（权重下限 0.25）
             float ndv = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
             float rw = min(uReflStrength * fade * (0.25 + 0.75 * ndv * ndv * ndv), 1.0);
             gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, rw);
           }
         }
         gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);`,
      );
      // [shader-patch 守卫] 注入检测：多次无条件 replace 原本零检测（失配全静默）。
      // 现检查三处关键符号是否落地——vertex 的 wave 函数 / beginnormal 的法线覆盖 /
      // fragment 的 uRoundness 裁剪段，任一缺失即告警（console 兜底），不再静默降级
      const vertexOk = shader.vertexShader.includes("vec3 gerstner(");
      const normalOk = shader.vertexShader.includes("objectNormal = ysmWaveNormal;");
      const fragOk = shader.fragmentShader.includes("uRoundness");
      // 微细节法线落地检查：normal 覆写点在场（贴图链路已删，此处失配即是静默丢细节）
      const detailOk = shader.fragmentShader.includes("normal = normalize(normal +");
      // [ADR-297] 倒影混合块落地检查：失配 = 倒影静默消失，与其余四项同病
      const reflOk = shader.fragmentShader.includes("if (uReflStrength > 0.0) {");
      if (!vertexOk || !normalOk || !fragOk || !detailOk || !reflOk) {
        reportPatchIssue(
          "water",
          `water onBeforeCompile 锚点失配（vertex=${vertexOk ? "ok" : "miss"} normal=${normalOk ? "ok" : "miss"} fragment=${fragOk ? "ok" : "miss"} detail=${detailOk ? "ok" : "miss"} refl=${reflOk ? "ok" : "miss"}），水面波浪法线 / 微细节 / 波纹 / 圆角 / 倒影 / 透明度 clamp 可能失效。请检查 three 渲染管线 chunk 标记是否变更。`,
          "warn",
        );
      }
    };
    mat.needsUpdate = true;
    return mat;
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
        const asPhysical = mat as THREE.MeshPhysicalMaterial & {
          transmissionRenderTarget?: THREE.WebGLRenderTarget | null;
        };
        const trt = asPhysical?.transmissionRenderTarget;
        if (trt) {
          trt.texture.dispose();
          trt.dispose();
        }
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

  /** 水面可见性：waterEnabled ∧（受 wetness 门控的形态还需 wetness>0）。
   *  单一 gate（fog 先例同法，2026-09-22）：能力启停 === waterEnabled，
   *  真值源唯一 envState——原私有 `this.enabled` 恒 true 且被 legacy 存档误写中毒，已退役。 */
  private syncWaterVisibility(): void {
    const strategy = getWaterBodyStrategy(envState.waterMode);
    const gatePassed = strategy.wetnessGated ? envState.waterWetness > 0 : true;
    this.water.root.visible = envState.waterEnabled && gatePassed;
  }

  /** 推进水面波纹动画（render loop 调用）。visible 已含 waterEnabled 语义，单判即可。
   *  ADR-297：反射 RT 渲染同受此门控——水面不可见时倒影无意义，一并免掉整场重渲。 */
  update(dt: number): void {
    if (!this.water.root.visible) return;
    this.waterTime.value += dt * envState.waterWaveSpeed;
    this.renderReflection();
  }

  // ── ADR-297：水面模型倒影（隐藏 Reflector 借官方 RT + 水 shader 投影采样）──

  /** 倒影门控：总开关 ∧（SSR 抑制启用时 SSR 不活跃）∧ 宿主在场。
   *  ⚠️ pp* 键属 postprocessing 组，water 回调收不到派发——此处不另订第二路订阅，
   *  逐帧现读 envState 现算（真值源仍是 envState 单处，单门纪律不破）。 */
  private reflectionActive(): boolean {
    if (!envState.waterReflectionEnabled) return false;
    if (envState.waterReflectDisableWhenSSR && isSsrRenderActive()) return false;
    return this.renderer !== null && this.camera !== null;
  }

  /** 镜面载体懒建 / RT 原位扩缩（边长比对 O(1)，不重建 Reflector）。
   *  **不入场景**：主渲染零开销、零拾取污染；onBeforeRender 用 scope.matrixWorld 算镜像，
   *  故调用前须手动 updateMatrixWorld（无父链可赖）。
   *  [锐评 F-2] clipBias 现读 schema 键 `waterReflectionClipBias`（默认 3 = 原裸字面量，
   *  观感零变化）；bias 烘进 onBeforeRender 闭包不可就地改——现读值与懒建时烙进的
   *  `reflectorClipBias` 不一致即弃旧建新（RT/材质具名释放，不泄漏）。 */
  private ensureReflector(): Reflector {
    const bias = envState.waterReflectionClipBias;
    // [锐评 3.5] clipBias 死区：偏差 < REFLECTOR_CLIP_BIAS_TOLERANCE 时视为未变、跳过重建。
    // 背景：`water-reflection-clip-bias` 滑杆 step=0.1，拖动 0→10 会产生 ~100 个离散值——
    // 每个都触发「弃载体 → 新 Reflector → 新 RT」整场重建（昂贵：几何 + 材质 + RT 纹理）。
    // 而 |Δbias| < 0.05 时投影裁剪面的位移肉眼不可感（clipBias 是投影视空间量，非米制）。
    // 死区仍保留「bias 实质变化 → 重建」语义（diff=0 与 diff=0.04 都不重建，符合预期）。
    if (
      this.reflector &&
      Math.abs(this.reflectorClipBias - bias) >= REFLECTOR_CLIP_BIAS_TOLERANCE
    ) {
      this.disposeReflector();
    }
    if (!this.reflector) {
      this.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
        clipBias: bias,
        textureWidth: envState.waterReflectionResolution,
        textureHeight: envState.waterReflectionResolution,
      });
      this.reflectorClipBias = bias;
      // 镜面朝上 = 水面平面（裁剪平面即该平面的无限延展，1×1 尺寸不参与数学）
      this.reflector.rotation.x = -Math.PI / 2;
    }
    const rt = this.reflector.getRenderTarget();
    const res = envState.waterReflectionResolution;
    if (rt.width !== res) rt.setSize(res, res);
    return this.reflector;
  }

  /** 弃倒影载体（RT + 材质 + 几何具名释放）：bias 重建与 dispose 共用同一出口。
   *  Reflector 不入场景，disposeWater 的 traverse 遍历不到，必须在此点名释放。 */
  private disposeReflector(): void {
    this.reflector?.dispose();
    this.reflector = null;
    this.reflectorClipBias = -1;
  }

  /** 每帧一次反射 RT 渲染 + 水 shader 三 uniform 落地。
   *  ⚠️ 渲染期间临时隐藏整个水根：① 防水体进自身镜像（双层水）；② 防 pool 顶面
   *  transmission pass（three 内部再渲一遍不透明场景）在镜像通路里嵌套整场渲染。
   *  已知限制（ADR-297 记录）：RT 渲染发生在 render-host 主相机剔除之前，镜像视锥内容
   *  不受主相机 cull 影响（多渲不漏渲）；掠射角下官方「背对早退」跳帧，倒影滞后一帧再补。 */
  private renderReflection(): void {
    const shader = (
      this.water.top.material.userData as { shader?: THREE.WebGLProgramParametersWithUniforms }
    ).shader;
    if (!this.reflectionActive()) {
      // 非活跃：权重归零（开关只翻 uniform，不触发 program 重编译；混合块整体跳过）
      if (shader) (shader.uniforms.uReflStrength as { value: number }).value = 0;
      return;
    }
    const renderer = this.renderer as THREE.WebGLRenderer;
    const camera = this.camera as THREE.PerspectiveCamera;
    const reflector = this.ensureReflector();
    // 镜面即水面：clip 平面 = Reflector 平面本身，水位升降一个标量跟随
    reflector.position.y = envState.waterLevel;
    reflector.updateMatrixWorld(true);
    // controls 更新在上一帧尾，官方读 camera.matrixWorld 前须刷新（否则镜像滞后一帧抖动）
    camera.updateMatrixWorld();
    const prevVisible = this.water.root.visible;
    this.water.root.visible = false;
    try {
      // Reflector 自有实现只吃三参（Object3D 契约的 geometry/material/group 三尾参不参与
      // 镜像数学，见 Reflector.js onBeforeRender 函数体）；声明层继承六参签名，此处收窄
      const drive = reflector.onBeforeRender as unknown as (
        r: THREE.WebGLRenderer,
        s: THREE.Scene,
        c: THREE.Camera,
      ) => void;
      drive.call(reflector, renderer, this.scene, camera);
    } finally {
      this.water.root.visible = prevVisible;
    }
    // shader 未编译时由 onBeforeCompile 尾部的同源调用补挂（不另等一帧）
    if (shader) this.applyReflectionUniforms(shader, reflector);
  }

  /** RT 贴图 + 强度 + 世界→RT uv 矩阵一次落地（renderReflection 帧路与 onBeforeCompile
   *  补挂路共用——新材质编译入场的同一拍即重绑，不滞后一帧）。
   *  [锐评 L-3 收口] 原 `setReflectionUniforms(shader, strength)` 是「写死 0 归零」与
   *  「现读强度赋值」两条路各写一遍的公共出口，归零路唯一调用点即此处内联，两函数
   *  一合并（少一层跳转，强度真值源仍唯一 = envState.waterReflectionStrength）。 */
  private applyReflectionUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms,
    reflector: Reflector,
  ): void {
    const u = shader.uniforms;
    (u.uReflTex as { value: THREE.Texture | null }).value = reflector.getRenderTarget().texture;
    (u.uReflStrength as { value: number }).value = envState.waterReflectionStrength;
    // 官方 textureMatrix = bias·P·V·M(镜面)（输入为镜面局部坐标）；水 shader 喂世界坐标，
    // 右乘 M⁻¹ 剥除镜面自身变换。bias 已在矩阵内 → 除 w 后直接是 uv（0..1）。
    const texMat = (reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix
      .value as THREE.Matrix4;
    this.reflWorldInv.copy(reflector.matrixWorld).invert();
    (u.uReflMatrix as { value: THREE.Matrix4 }).value.multiplyMatrices(texMat, this.reflWorldInv);
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
  setWaterEnabled(v: boolean): void {
    setEnvState({ waterEnabled: v }, { source: "manual" });
  }
  getWaterEnabled(): boolean {
    return envState.waterEnabled;
  }

  setWaterMode(m: WaterMode): void {
    if (envState.waterMode === m) return;
    setEnvState({ waterMode: m }, { source: "manual" });
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

  setWetness(v: number): void {
    setEnvState({ waterWetness: v }, { source: "manual" });
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
  setNormalStrength(v: number): void {
    setEnvState({ waterNormalStrength: v }, { source: "manual" });
  }
  getNormalStrength(): number {
    return envState.waterNormalStrength;
  }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number): void {
    setEnvState({ waterPoolHeight: v }, { source: "manual" });
  }
  getPoolHeight(): number {
    return envState.waterPoolHeight;
  }

  setPoolWallThickness(v: number): void {
    setEnvState({ waterPoolWallThickness: v }, { source: "manual" });
  }
  getPoolWallThickness(): number {
    return envState.waterPoolWallThickness;
  }

  setPoolWallColor(hex: number): void {
    setEnvState({ waterPoolWallColor: hex }, { source: "manual" });
  }
  getPoolWallColor(): number {
    return envState.waterPoolWallColor;
  }

  setPoolRoundness(v: number): void {
    setEnvState({ waterPoolRoundness: v }, { source: "manual" });
  }
  getPoolRoundness(): number {
    return envState.waterPoolRoundness;
  }

  setWaveSpeed(v: number): void {
    setEnvState({ waterWaveSpeed: v }, { source: "manual" });
  }
  getWaveSpeed(): number {
    return envState.waterWaveSpeed;
  }

  setChoppiness(v: number): void {
    setEnvState({ waterChoppiness: v }, { source: "manual" });
  }
  getChoppiness(): number {
    return envState.waterChoppiness;
  }

  // ── 水面高度（ADR-257：跨形态通用，与容器彻底解耦）──
  setLevel(v: number): void {
    setEnvState({ waterLevel: v }, { source: "manual" });
  }
  getLevel(): number {
    return envState.waterLevel;
  }

  // ── 水面尺寸（ADR-272：两形态均零重建，故与 waterLevel 同列 form 组）──
  // ADR-283：下界 ≥1 / 上界 300 / NaN → 1 由 schema `range` 在唯一写入口统一钳制，setter 不再自备。
  setWaterSize(v: number): void {
    setEnvState({ waterSize: v }, { source: "manual" });
  }
  getWaterSize(): number {
    return envState.waterSize;
  }

  setClarity(v: number): void {
    setEnvState({ waterClarity: v }, { source: "manual" });
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
    persistState(this.id, state);
  }

  /** 从 localStorage 恢复状态。
   *  恢复段挂起派发（suspendEnvCallbacks，fog/ground/light 同法）：逐字段 setter 只写
   *  envState，末尾 rebuildWaterContainer 一次性从 envState 全量落地——消除「~15 次派发 ×
   *  mode 键中途重建」的重入窗口。resume 放 finally：计数逃逸会让全仓派发静默假死。
   *  ⚠️ 顶层 `enabled` 键（2026-09-22 私有门退役前的能力级幽灵键）不再消费：单门收口后
   *  水面开关唯一真值源 = waterEnabled（嵌套 dialect 的 enabled 子域开关由下方双轨表吸收）。 */
  loadState(): void {
    let state = restoreState(this.id) as Record<string, unknown> | null;
    // legacy.water 解包后 state.water 不存在 → 下方
    // nested 判定误判 flat → 子域开关 enabled 不写 setWaterEnabled（envState.
    // waterEnabled 保持默认 true）——「用户关水」偏好升级后丢失，重开能力水面重现
    let fromNestedLegacy = false;
    if (!state) {
      const legacy = restoreState("ground") as Record<string, unknown> | null;
      if (legacy) {
        const lw = legacy.water;
        if (lw && typeof lw === "object") {
          state = lw as Record<string, unknown>;
          fromNestedLegacy = true;
        } else if (
          typeof legacy.wetness === "number" ||
          typeof legacy.waterColor === "number" ||
          typeof legacy.waterOpacity === "number" ||
          typeof legacy.normalStrength === "number"
        ) {
          state = {
            wetness: legacy.wetness,
            waterColor: legacy.waterColor,
            waterOpacity: legacy.waterOpacity,
            normalStrength: legacy.normalStrength,
          };
        }
      }
    }
    if (!state) return;
    suspendEnvCallbacks();
    try {
      restoreFields(state, {
        // legacy `size` 键（ADR-272 前旧名）——值一律交回唯一写入口 `setWaterSize`，
        // 不在此处自备钳制（ADR-283 收口：值域单一事实源 = schema `range`）。
        // 历史：此处曾自钳 `Number.isFinite(v) ? Math.max(1, v) : 1`——
        //   ① 与 setEnvState 的 clampFieldValue 重复（同是钳到 ≥1）；
        //   ② 且只覆盖下界，与 schema `range [1,300]` 口径不齐（自钳只算半个执法者）；
        //   ③ `Number.isFinite` 分支不可达：存档过 JSON 边界后 NaN/Infinity 已变 null。
        // 现存唯一例外是 shader 侧 `max(uSize, 0.001)`（防除零，语义不同，保留）。
        size: { number: (v) => this.setWaterSize(v) },
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
      // restoreBySchema 只接 number/boolean 两类 canonical 键；枚举 / 子域开关 / legacy 旧方言
      // 仍由下方手写还原器承接（存档兼容层，不自动）。
      restoreBySchema(w, getPresetKeys("water"));
      restoreFields(w, {
        // 子域开关：仅当取到嵌套对象时 w.enabled 才是子域开关（顶层 enabled=已退役的
        // 能力级幽灵键，不再消费——见本方法头注）。flat 格式的 waterEnabled 已由上方
        // restoreBySchema 经 schema 键集恢复，此处仅留嵌套 legacy 的 enabled 别名。
        ...(nested ? { enabled: { boolean: (v) => this.setWaterEnabled(v) } } : {}),
        // 新旧键双轨（restoreFields 对缺失键安全跳过；实际存档只含一种方言）
        mode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
        waterMode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
        // legacy 旧方言别名（ADR-272/257 前的旧名；写侧已规范为 water*）——仅兼容旧存档，不自动
        wetness: { number: (v) => this.setWetness(v) },
        normalStrength: { number: (v) => this.setNormalStrength(v) },
        waveSpeed: { number: (v) => this.setWaveSpeed(v) },
        choppiness: { number: (v) => this.setChoppiness(v) },
        level: { number: (v) => this.setLevel(v) },
        clarity: { number: (v) => this.setClarity(v) },
        poolHeight: { number: (v) => this.setPoolHeight(v) },
        poolWallThickness: { number: (v) => this.setPoolWallThickness(v) },
        poolWallColor: { number: (v) => this.setPoolWallColor(v) },
        poolRoundness: { number: (v) => this.setPoolRoundness(v) },
      });
      // ADR-257 迁移：旧存档没有 waterLevel 键（旧语义里「水面 y == 池深 h」）。
      // pool 用户兜底为 waterPoolHeight 以保持原有观感；film 用户沿用默认 0.01（与旧硬编码一致）。
      // 注：mode/waterMode 在上方 restoreFields 中已先行还原，故此处读到的 waterMode 即存档形态。
      const hadLevelKey = w.level !== undefined || w.waterLevel !== undefined;
      if (!hadLevelKey && envState.waterMode === "pool") {
        this.setLevel(envState.waterPoolHeight);
      }
    } finally {
      resumeEnvCallbacks();
    }
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
