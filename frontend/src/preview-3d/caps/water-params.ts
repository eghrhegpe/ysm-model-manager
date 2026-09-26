// ===== [ADR-286 分派表 / ADR-315 D1] water 参数应用分派表（自 water-capability.ts 拆出真缝）=====
// 原为 applyChangedParams 里的逐键 if 瀑布；现按 changed 逐键查表派发：
//  - `Record<WaterParamKey, …>` 编译期强制 water 组每键表态——缺键即红；
//  - `waterEnabled` / `waterMode` / `waterWaveSpeed` 的空条目是**结构性声明**（非疏漏）：
//    分别由回调的 syncWaterVisibility / rebuildWaterContainer / update 累加速度承接，此处无材质应用；
//  - 派发序无关结果的保证有两条：多数条目各写各自不相交的字段/uniform；结构三键
//    （size/poolHeight/wallThickness）共享 applyStructuralProfile 写域，但它是**读 envState
//    全量的幂等执行器**（重复调用 no-op），且其余条目不触碰 transform——故乱序仍收敛
//    （守卫 = 乱序全量 patch ≡ 单键逐发快照一致）；派生量（effectiveOpacity）由 envState 现算；
//  - 形态门控（wetnessGated / supportsVolumeOptics / 空 targets 数组）一律查 strategy，不写 mode 分支。
//
// 契约登记（原水注释原样保留）：
//  - [锐评 W-3] WATER_PARAM_APPLIER_KEYS 键名显式字面量——供契约测试与 getPresetKeys("water") 做字面同步核查。
//  - [锐评 3.1] WATER_UNIFORM_NAMES 是水 shader uniform 名的**唯一登记点**——setUniform 的 name
//    形参收窄为 WaterUniformName（编译期防 typo），测试双向锁同步。
//  - [锐评 3.3] WATER_FRAME_READ_KEYS 登记表——「无材质应用、由 render-loop 逐帧现读 envState」的键。
//  - [锐评 3.3 ③] WATER_NOOP_APPLIER_KEYS 反向闭包——分派表空条目全集，机器派生不手写。
import type * as THREE from "three";
import { envState } from "@/preview-3d/state/env-state.ts";
import type { EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import {
  clampPoolRoundness,
  INNER_WALL_OPACITY_FACTOR,
  type WaterBody,
  type WaterBodyStrategy,
  type WaterPartRole,
  type WaterTopMesh,
} from "./water-body-strategies.ts";

type WaterParamKey = Extract<EnvStateKey, `water${string}`>;
type WaterApplyCtx = {
  water: WaterBody;
  strategy: WaterBodyStrategy;
  targets: (role: WaterPartRole) => THREE.Mesh[];
  /** 顶水面（承载波浪材质）：各形态 build 期统一塞入，恒存在 */
  top: WaterTopMesh;
  setUniform: (mat: THREE.Material | undefined, name: WaterUniformName, value: number) => void;
};

// ADR-315 D1 拆出导出（water-capability applyChangedParams 装配 ctx 消费）：
export type { WaterApplyCtx, WaterParamKey };

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
export const WATER_PARAM_APPLIERS: Record<WaterParamKey, (ctx: WaterApplyCtx) => void> = {
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
