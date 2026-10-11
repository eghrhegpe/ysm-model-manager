// ===== LightCapability — 3D 预览个人灯光系统（ADR-177 编排器）=====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。
// [ADR-246 D1] postprocess 空壳引擎已删除——原「双引擎切换」抽象从未有任何体积光 pass 落地，
// 只带来「选了就关掉体积光」的欺骗性控件与 3 条绕 bug 回归用例；现回归单引擎（cone）。
//
// 职责拆分（ADR-177，2026-09-04）：
//   - 灯光对象管理（key/fill/rim/ambient + 阴影协作）保留本类（核心职责①）
//   - 体积光锥体② → light-cone.ts（VolumetricCone）
//   - 预设数据③ → light-params.ts（ADR-281 后不再经本文件 `export *` 转发，消费方直引具体叶）
//   - 嵌套 ↔ 扁平参数映射 flattenLightParams → light-params.ts（P3 下沉：纯映射样板，不触 cap 状态）
//   - 菜单 UI 定义④ → light-controls.ts（buildLightNodes）
//   - 状态持久化⑤ 保留本类（触达大量私有字段，顺序语义敏感）
//
// 设计要点（对齐 SkyCapability / GroundCapability 的能力模式）：
//   - 默认经典三点布光（key/fill/rim 三槽位统一实例，各可切 directional/point/spot——
//     [light-type-switch] ADR-280 起原第四盏独立 Spotlight 并入槽位）+ AmbientLight
//   - 体积光锥：真锥体网格 + Fresnel 视角边缘辉光（轻量，无 post-process 管线），
//     驱动源由 lightVolumetricDriver schema 键显式决定（ADR-290：auto = 槽位顺序第一盏
//     启用 spot），朝向由该 spot 灯 → 靶点方向驱动（默认俯视灯下恒垂直向下）
//   - [ADR-282] 灯光与模型类别解耦：无任何按类别预设，「重置」锚定 DEFAULT_LIGHT_PARAMS
//   - 本类不持有 backend 引用，纯 Three.js 侧逻辑
//   - target（对象中心）可动态更新，各槽位 spot 灯 + 体积光锥随之重新定位
//   - ADR-196 刀2：参数真值源从 this.params 迁到 envState 单例

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import {
  registerEnvCallback,
  withEnvCallbacksSuspended,
} from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { envShouldYieldSlot } from "./environment-ownership.ts";
import { VolumetricCone } from "./light-cone.ts";
import { buildLightNodes, LIGHT_MASTER_NODE_ID } from "./light-controls.ts";
// [ADR-329 刀②] 灯实例/helper/target 生命周期叶（构造装配 + 方法委托，签名零变更）
import { LightInstances } from "./light-instances.ts";
import {
  attenuateAmbientForSky,
  volumetricTipFromRatio,
  volumetricTipRatioFor,
} from "./light-math.ts";
import {
  type DeepPartial,
  FLATTEN_MAP,
  flattenLightParams,
  LIGHT_SLOTS,
  type LightInstanceParams,
  type LightParams,
  type LightSlot,
  lightEnvKeys,
  lightResetPatch,
  readLightParams as readLightParamsFrom,
  type VolumetricParams,
} from "./light-params.ts";
import { buildLightPersistPayload, restoreLightParams } from "./light-persist.ts";
// [横向铺叶层直测] helper 可见性谓词下沉 `light-visible.ts`（三支合取单一事实源 + 三支各断一支判别样本）
//   ——该谓词随 helper 群一并迁入 light-instances.ts（cap 侧不再消费）。
import {
  getTypedCap,
  persistState,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

// 3 个纯函数（lightDirToPosition / spotDistanceAttenuation / attenuateAmbientForSky）已下沉
// light-math.ts（2026-10-05：截图侧直 import 本大类只为取纯函数，会级联触发能力注册表副作用链）。
// 本文件**不再重导出**它们——需要时请从 light-math.ts 直引，保持叶消费，避免把截图拉回本文件。

// [ADR-329 刀② 2026-10-11] 灯实例 / helper / target 生命周期已下沉
// `light-instances.ts` 的 `LightInstances`，本 cap 退化为**状态编排薄壳**：
//   - 持有 instances 叶实例（构造装配接口同前：scene/target/targetHeight/caps）；
//   - 保留：enabled 门、onEnvChanged 分派（结构性重建委托叶 syncLight）、锥体（VolumetricCone
//     已独立叶，此处仅编排挂载时机）、ambient（refreshAmbientFromSky 依赖 caps 查询器的 sky
//     让位判据，属状态编排面）、setter 群、getMenuNodes、持久化、activeLight；
//   - **跨 cap 协作刻意留 cap**：类型切换后请求 shadow cap 重跑 apply() 是状态编排语义，
//     叶不该知道 shadow 的存在（叶以 rebuildHook 回调形式承接）；
//   - 灯/helper/Three 对象细节一律在叶——**勿**把灯字段或创建逻辑搬回本 cap。

// ======== ADR-196：嵌套 ↔ 扁平映射 ========

/** 从 envState 读取单盏灯参数（缺省读单例 envState）。
 *  真值映射体在 light-params.readLightParams——本包装只为让本模块内调用省掉 envState 形参。 */
function readLightParams(which: LightSlot, state: EnvState = envState): LightInstanceParams {
  return readLightParamsFrom(state, which);
}

/** 从 envState 读取体积光参数 */
function readVolParams(state: EnvState = envState): VolumetricParams {
  return {
    enabled: state.lightVolumetricEnabled,
    driver: state.lightVolumetricDriver,
    opacity: state.lightVolumetricOpacity,
    fogPower: state.lightVolumetricFogPower,
    edgeFade: state.lightVolumetricEdgeFade,
    baseStrength: state.lightVolumetricBaseStrength,
    tipStrength: state.lightVolumetricTipStrength,
  };
}

/** 从 envState 组装完整 LightParams（getParams 用） */
function getParamsFromEnvState(state: EnvState = envState): LightParams {
  return {
    key: readLightParams("key", state),
    fill: readLightParams("fill", state),
    rim: readLightParams("rim", state),
    ambient: {
      color: state.lightAmbientColor,
      intensity: state.lightAmbientIntensity,
    },
    volumetric: readVolParams(state),
  };
}

// ======== 变更分组（callback 分派用） ========
// [light-type-switch] 三盏灯结构统一：每盏灯的变更集 = 该槽位的全部 envState 键，
// 由 light-params 的 FLATTEN_MAP 派生（lightEnvKeys）——新增字段不再需同步维护本表。
// 灯内部按字段决定「重建灯对象」（type 变化）还是「原地更新」。

/** 三槽位的通用别名（本模块旧名，语义同 LightSlot） */
export type LightKey = LightSlot;

function lightChangeSet(which: LightSlot): Set<EnvStateKey> {
  return new Set(lightEnvKeys(which));
}

const KEY_CHANGES = lightChangeSet("key");
const FILL_CHANGES = lightChangeSet("fill");
const RIM_CHANGES = lightChangeSet("rim");

// [S1 收口 2026-10-04] 手写键表与 FLATTEN_MAP 脱节问题在此收口：
//   - VOL_PARAM_CHANGES 原手抄 5 键，现从 FLATTEN_MAP.volumetric 派生（白名单排除
//     enabled/driver 两个「存在性」键——它们属锥体重建分支而非 uniforms 更新）。
//   - CONE_GEO / CONE_MOVE 同样派生：字段全集取 FLATTEN_MAP 槽位值域，归属由下方
//     `satisfies` 字段表声明（改字段名即编译红；新增字段须显式归类到三集之一）。
//   - 对照闸 assertConeChangeSetConsistent：派生结果不得产出 FLATTEN_MAP 之外的键，
//     且槽位字段全集必须被「几何 ∪ 位置 ∪ uniform」穷尽——强制「改字段全集必须核对」。

/** 体积光 uniforms 变更键集：从 FLATTEN_MAP.volumetric 派生（白名单排除 enabled/driver）。
 *  导出供测试对照——确保「派生的就是期望的」，防派生逻辑自身跑偏。 */
export function volParamKeys(): Set<EnvStateKey> {
  const { enabled, driver, ...rest } = FLATTEN_MAP.volumetric;
  return new Set<EnvStateKey>(Object.values(rest));
}

const VOL_PARAM_CHANGES: Set<EnvStateKey> = volParamKeys();

/** 按字段子集从 FLATTEN_MAP 三槽位值域派生扁平键集（单源，零手抄键字符串） */
function lightSlotFieldKeys(fields: readonly (keyof LightInstanceParams)[]): Set<EnvStateKey> {
  const out = new Set<EnvStateKey>();
  for (const which of LIGHT_SLOTS) {
    const m = FLATTEN_MAP[which];
    for (const f of fields) out.add(m[f]);
  }
  return out;
}

/** 影响锥体几何（形状/存在性）的字段：type/enabled/angle/penumbra 变化才需 dispose+重建；
 *  颜色/强度/距离/衰减只动 uniforms，方位角/仰角只动 transform。
 *  （旧实现：任意 spotlight 字段变更都整组重建，拖滑块即 GC 抖动。） */
const CONE_GEO_FIELDS = [
  "type",
  "enabled",
  "angle",
  "penumbra",
] as const satisfies readonly (keyof LightInstanceParams)[];
const CONE_GEO_CHANGES: Set<EnvStateKey> = lightSlotFieldKeys(CONE_GEO_FIELDS);

/** 只改变光源位置（不影响锥形）的字段 → 锥体 syncPosition */
const CONE_MOVE_FIELDS = [
  "azimuth",
  "elevation",
] as const satisfies readonly (keyof LightInstanceParams)[];
const CONE_MOVE_CHANGES: Set<EnvStateKey> = lightSlotFieldKeys(CONE_MOVE_FIELDS);

/** 槽位字段中既不动几何也不动位置、只走 uniforms 快路径（lightTouched 分支）的字段——
 *  与上两集构成字段全集的三分法，缺一即对照闸红。 */
const CONE_UNIFORM_FIELDS = [
  "color",
  "intensity",
  "distance",
  "decay",
] as const satisfies readonly (keyof LightInstanceParams)[];

/** [S1 对照闸] 派生键表与 FLATTEN_MAP 的双向对账：
 *  ①派生结果不得含 FLATTEN_MAP 之外的键（改映射结构而派生没跟上 → 幽灵键/漏键，启动即红）；
 *  ②每个槽位字段必须归入几何/位置/uniform 之一（新增字段漏归类 → 点名报错，强制人工核对）。
 *  纯派生自 FLATTEN_MAP，正常情况下恒通过；本闸拦截的是「字段全集变了而派生没跟着改」。 */
function assertConeChangeSetConsistent(): void {
  const universe = new Set<EnvStateKey>([
    ...LIGHT_SLOTS.flatMap((w) => Object.values(FLATTEN_MAP[w])),
    ...Object.values(FLATTEN_MAP.volumetric),
  ]);
  const derived = new Set<EnvStateKey>([
    ...CONE_GEO_CHANGES,
    ...CONE_MOVE_CHANGES,
    ...volParamKeys(),
    ...lightSlotFieldKeys(CONE_UNIFORM_FIELDS),
  ]);
  for (const k of derived) {
    if (!universe.has(k)) {
      throw new Error(`[light] 派生变更集出现 FLATTEN_MAP 之外的键：${k}`);
    }
  }
  for (const which of LIGHT_SLOTS) {
    for (const k of Object.values(FLATTEN_MAP[which])) {
      if (!derived.has(k)) {
        throw new Error(
          `[light] 灯光字段 ${k} 未归类到锥体变更集（几何/位置/uniform）——新增字段须显式归类`,
        );
      }
    }
  }
}
assertConeChangeSetConsistent();

/** [ADR-293] 触发菜单刷新（subscribe notify）的离散键集：点击式开关/选择——总开关、
 *  三槽位类型/开关、体积光开关/驱动源、helper 线框开关；连续滑块（intensity/azimuth/
 *  angle…）一律不入：拖动中途重建面板会让滑块指针捕获脱靶（fog 的 near/far 教训，
 *  subscribe 契约）。type/enabled/driver 键由 FLATTEN_MAP 派生，零裸字面量。 */
const DISCRETE_NOTIFY_KEYS: Set<EnvStateKey> = new Set<EnvStateKey>([
  "lightEnabled",
  "lightHelperVisible",
  ...LIGHT_SLOTS.flatMap((w) => [FLATTEN_MAP[w].type, FLATTEN_MAP[w].enabled]),
  FLATTEN_MAP.volumetric.enabled,
  FLATTEN_MAP.volumetric.driver,
]);

function hasAny(changed: Set<EnvStateKey>, keys: Set<EnvStateKey>): boolean {
  for (const k of keys) if (changed.has(k)) return true;
  return false;
}

// [light-gizmo] DIR_HELPER_COLORS（方向灯辅助配色）随 helper 群迁入
// light-instances.ts 的 DIR_HELPER_COLORS（仅 helper 工厂消费，cap 不再持有）。

export class LightCapability implements SceneCapability {
  readonly id = "light";
  /** [暗线 C1 收口] 面板渲染 id（core.ts dock 绑定）≠ cap id：面板用 lighting / cap 用 light */
  readonly panelId = "lighting";
  readonly labelKey = "preview.lighting";
  readonly icon = "hint";
  readonly descKey = "preview.lightingDesc";

  private scene: THREE.Scene;
  private caps?: SceneCapabilityLookup;
  /** [ADR-293] 启用意图唯一真值源 = envState.lightEnabled（对齐 ADR-250 pp / ADR-196 fog
   *  口径：本 cap 不再持有 enabled 字段）。私有字段时代绕开 setEnvState 的钳制/优先级/
   *  派发纪律，灯组写路径在此双轨并行——收口。 */
  private get enabled(): boolean {
    return envState.lightEnabled;
  }

  // [ADR-329 刀②] 三槽位灯实例 + helper + target 生命周期的属主（叶）。
  // public API（getLights/setTarget/setTargetHeight/apply/detach/dispose…）全部委托，签名零变更。
  private readonly instances: LightInstances;
  /** 环境光（属主留在 cap：refreshAmbientFromSky 消费 caps 查询器的 sky 让位判据，属编排面） */
  private readonly ambientLight: THREE.AmbientLight;
  /** 体积光锥（ADR-177：实现下沉 VolumetricCone，本类仅编排挂载时机） */
  private readonly cone: VolumetricCone;

  // [light-type-switch] 菜单「编辑灯光」的选择态（运行时态，不入 envState/持久化）
  private activeLight: LightKey = "key";

  // ADR-196：取消订阅函数
  private unsubscribeEnv: () => void;
  /** [ADR-293] 参数变更监听（菜单局部刷新，对齐 fog/ground/water 先例）：
   *  仅离散键变更 notify——subscribe 契约见 DISCRETE_NOTIFY_KEYS */
  private readonly listenerSet = createListenerSet();

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
    target?: THREE.Vector3;
    targetHeight?: number;
    /** cap 间协调查询器（组合根 createAll 注入）——ambient 衰减读 sky 环境开关 */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    if (opts.caps !== undefined) this.caps = opts.caps;
    // [ADR-293] 总开关入 schema（对齐 ADR-250 pp 口径）：显式传值才写状态层，
    // 不传则尊重 envState 现值（含用户存档恢复的顺序）。
    // ⚠️ 顺序敏感：此处 setEnvState 发生在 registerEnvCallback **之前**，订阅者尚未
    // 就位，挂载/卸载副作用不会自动触发——场景对象由组合根随后的 apply() 落地。
    if (opts.enabled !== undefined) {
      setEnvState({ lightEnabled: opts.enabled }, { source: "manual" });
    }

    // [ADR-329 刀②] 三盏灯 + spot 瞄准点 + 三副 helper 由叶一次性装配（读 envState 初值）
    this.instances = new LightInstances({
      scene: this.scene,
      ...(opts.target !== undefined ? { target: opts.target } : {}),
      ...(opts.targetHeight !== undefined ? { targetHeight: opts.targetHeight } : {}),
      isMasterOn: () => this.enabled,
    });
    this.ambientLight = new THREE.AmbientLight(
      envState.lightAmbientColor,
      envState.lightAmbientIntensity,
    );

    // 初始化体积光锥（ADR-177：委派 VolumetricCone；未同时启用则不产出锥组）
    this.cone = new VolumetricCone(this.scene);
    this.rebuildConeIfNeeded(envState);

    // ADR-196：订阅 envState 变更 → 分派到 Three 应用（只接收 light 组的键）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, state) => {
        this.onEnvChanged(changed, state);
      },
      "light",
    );
    // 注：构造期即注册 light 组回调；loadState 期间经 suspendEnvCallbacks 挂起，
    // 避免 restoreLightParams 同步 setEnvState 重入触发 onEnvChanged（见 loadState）。
  }

  /* ----- envState 变更回调：分派到 Three 应用 ----- */

  private onEnvChanged(changed: Set<EnvStateKey>, state: EnvState): void {
    // [ADR-293] 总开关翻转：场景灯 + 瞄准点 + helper + 锥体整体挂/卸的副作用在此分派
    //（setEnabled 只写状态层，不再直调 apply/detach——绕开状态层的旁路退场）。
    // 必须置于逐灯同步之前：开闸时对象先进场，后续分支作用在已挂载对象上。
    if (changed.has("lightEnabled")) {
      if (this.enabled) this.apply();
      else this.detach();
    }

    // key/fill/rim：类型变化 → 重建；其余 → 原地更新
    if (hasAny(changed, KEY_CHANGES)) this.syncLight("key", state);
    if (hasAny(changed, FILL_CHANGES)) this.syncLight("fill", state);
    if (hasAny(changed, RIM_CHANGES)) this.syncLight("rim", state);

    // [ADR-293] helper 可见性翻转：三副线框重新套显隐门禁（灯本体与锥体不动）
    if (changed.has("lightHelperVisible")) {
      // [ADR-329 刀②] helper 显隐属主在叶
      for (const which of LIGHT_SLOTS) this.instances.syncHelper(which);
    }

    // ambient：总是刷新（依赖 caps 查询器的 sky 环境开关，非纯 envState 派生）
    this.refreshAmbientFromSky(state);

    // 体积光锥三路分派：几何变更 → dispose+重建；位置变更 → syncPosition；uniform 变更 → updateUniforms
    // （旧实现：任意字段变更都整组重建，拖滑块即 GC 抖动）
    // [ADR-290] driver 变更同 enabled 级别：驱动源换了 = 附着体/存在性变，走重建非 uniforms
    const volToggled =
      changed.has("lightVolumetricEnabled") || changed.has("lightVolumetricDriver");
    const coneGeo = hasAny(changed, CONE_GEO_CHANGES);
    const coneMove = hasAny(changed, CONE_MOVE_CHANGES);
    const lightTouched =
      hasAny(changed, KEY_CHANGES) || hasAny(changed, FILL_CHANGES) || hasAny(changed, RIM_CHANGES);
    if (volToggled || coneGeo) {
      this.rebuildConeIfNeeded(state);
    } else {
      // 快路径：光源参数变了只刷 uniforms；位置变了再补一次 transform 同步
      const spot = this.getSpotLightForCone(state);
      if (spot) {
        if (coneMove) {
          const dir = new THREE.Vector3();
          this.instances.spotDir(spot.light, dir);
          this.cone.syncPosition(spot.light.position, dir);
        }
        if (lightTouched || hasAny(changed, VOL_PARAM_CHANGES)) {
          this.cone.updateUniforms(readLightParams(spot.which, state), readVolParams(state));
        }
      }
    }

    // [ADR-293] 离散键 notify（subscribe 契约，对齐 fog 的 fogMode 先例）：外部写
    //（跨会话共享 cap 的程序化写入）时面板值与场景同步。⚠️ 本调用处于 setEnvState
    // 同步派发栈内，面板订阅者 menu.refresh() 会同步重入 schema 渲染——安全前提是
    // 双保险：listener-set 快照迭代（notify 只触达在册时刻）+ rebindSceneCapSubs
    // (menu,cap) 幂等（重渲染不重订阅）。缺任一即自激重建死循环（复核 P0 立法，
    // 回归测试见 preview-state.test.ts「面板重入收敛」）。
    if (hasAny(changed, DISCRETE_NOTIFY_KEYS)) this.listenerSet.notify();
  }

  /* ----- 单盏灯同步：类型变化重建，否则原地更新（委托叶；shadow 重入留 cap） ----- */

  /**
   * [ADR-329 刀②] 单盏灯与 envState 对齐——重建/原地更新判据在叶；本方法只保留
   * **跨 cap 善后**：类型切换后请 shadow cap 重跑 apply()（裸新灯不碰 castShadow/shadow.*，
   * 而 ShadowCapability 只订阅 "shadow" 组，派发永不到它——见叶内注释全文）。
   * 锥体重建由调用方负责（onEnvChanged 走 CONE_GEO_CHANGES；loadState 走第④步）。
   */
  private syncLight(which: LightKey, state: EnvState): void {
    this.instances.syncLight(which, state, this.enabled, () =>
      getTypedCap(this.caps, "shadow")?.apply(),
    );
  }

  /* ----- 公共 API ----- */

  apply(): void {
    if (!this.enabled) {
      this.detach();
      return;
    }
    // [ADR-329 刀②] 三盏灯 + spot 瞄准点 + 三副 helper 的挂载委托叶
    this.instances.mountAll();
    if (!this.ambientLight.parent) this.scene.add(this.ambientLight);
    this.rebuildConeIfNeeded(envState);
  }

  setEnabled(v: boolean): void {
    // [ADR-293] 唯一写路径 = setEnvState（对齐 ADR-250 pp 口径）——挂/卸副作用由
    // onEnvChanged 的 lightEnabled 分支分派，本方法不再直调 apply/detach。
    setEnvState({ lightEnabled: v }, { source: "manual" });
  }

  isEnabled(): boolean {
    // [ADR-293] 真值源 = envState.lightEnabled（私有字段退场）
    return envState.lightEnabled;
  }

  /** [ADR-293] helper 线框可见性总闸（视口 gizmo 显隐；不关断灯本体，不影响截图） */
  setHelperVisible(v: boolean): void {
    setEnvState({ lightHelperVisible: v }, { source: "manual" });
  }

  isHelperVisible(): boolean {
    return envState.lightHelperVisible;
  }

  /** [ADR-293] 参数变更订阅（菜单局部刷新）：仅离散键变更触发——
   *  连续滑块恒不 notify（subscribe 契约，见 DISCRETE_NOTIFY_KEYS），对齐 fog/water */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  setTarget(v: THREE.Vector3): void {
    // [ADR-329 刀②] 靶点平移委托叶（叶内同步 spotTarget + 三盏灯位置/朝向 + candela 补偿 + helper）
    this.instances.setTarget(v);
    this.rebuildConeIfNeeded(envState);
  }

  getTarget(): THREE.Vector3 {
    return this.instances.getTarget();
  }

  /* ShadowCapability 跨能力协作：取得当前挂到场景的三盏灯，统一设置 shadow 参数；
   * 不返回内部引用副本，避免 ShadowCapability 直接写 private 字段。 */
  getLights(): THREE.Light[] {
    // [ADR-329 刀②] 三盏灯属主在叶
    return this.instances.lights();
  }

  /** 返回体积光锥的驱动 spot 灯 + 其槽位，无则 null。
   *  [ADR-290] 驱动源由 schema 键 lightVolumetricDriver 显式决定，与 activeLight 焦点态无关：
   *   - "auto"（缺省）：按槽位顺序（key→fill→rim）第一盏启用的 spot；
   *   - "key"/"fill"/"rim"：严格绑定该槽位——它不是启用的 spot 则无锥（**不回落**，
   *     回落会让「钉 fill 却看到锥体贴 key」的幽灵行为复活）。
   *  旧实现在此优先读 this.activeLight（不入存档的运行时焦点态）→ 同一份存档跨会话
   *  锥体贴到不同灯，是渲染输入未 schema 化的债，本决策清偿。 */
  getSpotLightForCone(
    state: EnvState = envState,
  ): { light: THREE.SpotLight; which: LightKey } | null {
    const driver = state.lightVolumetricDriver;
    if (driver !== "auto") {
      // [ADR-329 刀②] 灯实例属主在叶
      const light = this.instances.getLight(driver);
      return light instanceof THREE.SpotLight && light.visible ? { light, which: driver } : null;
    }
    for (const which of LIGHT_SLOTS) {
      const light = this.instances.getLight(which);
      if (light instanceof THREE.SpotLight && light.visible) return { light, which };
    }
    return null;
  }

  /** 靶点高度（= 灯光定位半径 + 锥长）。截图侧需读取以保持与预览同构。 */
  getTargetHeight(): number {
    return this.instances.getTargetHeight();
  }

  setTargetHeight(h: number): void {
    // [ADR-329 刀②] 高度变更只影响 spot 灯到目标的物理距离 → 叶内重算 candela 补偿 + 锥体定位
    this.instances.setTargetHeight(h);
    this.rebuildConeIfNeeded(envState);
  }

  /** [ADR-282] 把三盏灯 + 环境光 + 体积光 + [2026-10-04] 线框开关重置为规范默认值。
   *  写入集唯一来源 = `lightResetPatch()`（参数面锚 `DEFAULT_LIGHT_PARAMS`，与 envState schema
   *  初始值同源、模型无关，另含 `lightHelperVisible`）——语义：「重置」= 回到「从没动过」的状态。
   *  ⚠️ 旧实现只写 `flattenLightParams(DEFAULT_LIGHT_PARAMS)`，漏 `lightHelperVisible`
   *  （线框不在 FLATTEN_MAP）→ 老档（恒携带 helperVisible:true）点重置后线框照画，而
   *  ADR-293-d1 §后果承诺本按钮是「老用户回到新规范态的出口」——文档对该维空转，2026-10-04
   *  探针实证（写入集无 helper 键、重置后仍 true）后收口。总开关 `lightEnabled` 刻意不在
   *  重置作用域：它是会话总闸，重置参数不替用户开灯。
   *  不再有任何按模型类别的预设：灯光是场景属性，Three.js 层面无「模型类别」概念；
   *  唯一合法的模型相关输入是包围盒（驱动灯位/坎德拉补偿），已由 setTarget/setTargetHeight 动态处理。
   *  `source: "manual"`：用户显式重置与拖滑块同源——重置后的值受 shouldOverwrite 保护。
   *  [S1 留痕 2026-10-04] ⚠️ 该 manual 源打 39 键会把灯组键全标为「手动」，会话内
   *  auto-atmosphere 氛围预设因此不能再写灯——这是既有语义（2026-10-04 审查确认，
   *  用户裁定保持现状）。后续若改走 auto-model 需同步补回归锁（见本文件 light* 键
   *  来源纪律测试）。 */
  resetLightParams(): void {
    setEnvState(lightResetPatch(), { source: "manual" });
    // callback 负责 syncLight + 锥体重建（含 volumetric.enabled 变 false 时卸载）+ helper 显隐
  }

  /**
   * 体积光锥与当前 envState 同步：[ADR-290] 锥体由 lightVolumetricDriver 选定的 spot 灯驱动
   * （auto = 槽位顺序第一盏启用 spot；显式槽位 = 严格绑定，不满足前提即无锥）。
   * 无驱动灯 / 体积光未开 → 卸载；有则挂载并定位。
   * [ADR-293] 再加总开关门禁：master off 时灯不在场景，锥体若照挂就是无源天光柱——
   * 旧实现在「总开关关 + 翻体积光开关」路径下会悬浮一只锥（本轮锐评附带发现）。
   */
  private rebuildConeIfNeeded(state: EnvState = envState): void {
    const spot = this.getSpotLightForCone(state);
    const volOn = state.lightVolumetricEnabled;
    if (!this.enabled || !spot || !volOn) {
      if (this.cone.isMounted()) this.cone.detach();
      return;
    }
    const p = readLightParams(spot.which, state);
    const pos = spot.light.position;
    const dir = new THREE.Vector3();
    this.instances.spotDir(spot.light, dir);
    this.cone.rebuild(this.instances.getTargetHeight(), p, readVolParams(state), pos, dir);
    // rebuild 产出的新锥组默认脱离场景——volume 开启且有锥组时挂载
    if (this.cone.hasGroup() && !this.cone.isMounted()) {
      this.cone.attach(pos, dir);
    }
  }
  /** 单盏灯参数更新（[light-type-switch] 菜单统一设置栏调用） */
  setLightParams(which: LightKey, p: Partial<LightInstanceParams>): void {
    setEnvState(flattenLightParams({ [which]: p } as DeepPartial<LightParams>), {
      source: "manual",
    });
  }

  /** 体积光锥参数更新（经 envState） */
  setVolumetric(p: Partial<VolumetricParams>): void {
    setEnvState(flattenLightParams({ volumetric: p }), { source: "manual" });
    // callback 处理 uniforms + 挂载态
  }

  /** [ADR-246 D2] 上下亮度比（tip/base）读取——菜单「上下亮度比」滑块的 getter。
   *  值域闭合 [0,1]：base 为 0 时比值无意义返回 0（除零守卫）；tip>base 的存量数据 clamp 到 1
   *  ——否则滑块 thumb 被 clampPct 压到 100% 而显示值与真实值不符，用户首拖即被静默改写 tip。 */
  getVolumetricTipRatio(): number {
    // [下沉 light-math.ts] 纯算术 + 除零/clamp 守卫已在叶层直测
    const { baseStrength, tipStrength } = readVolParams();
    return volumetricTipRatioFor(baseStrength, tipStrength);
  }

  /** [ADR-246 D2] 按 base 派生 tip（比值写入路径）——base 不变，tip = base × ratio。
   *  入参 clamp 到 [0,1] 与 getter 值域对等（程序化调用传越界值不写脏数据）。 */
  setVolumetricTipRatio(ratio: number): void {
    // [下沉 light-math.ts] clamp 派生 tip（叶层直测）
    const { baseStrength } = readVolParams();
    this.setVolumetric({ tipStrength: volumetricTipFromRatio(baseStrength, ratio) });
  }

  /** 合并式参数更新（只覆盖给定字段，经 envState） */
  setParams(p: DeepPartial<LightParams>): void {
    setEnvState(flattenLightParams(p), { source: "manual" });
    // callback 处理全部 Three 应用 + 锥组 rebuild + 挂载态
  }

  getParams(): LightParams {
    return getParamsFromEnvState();
  }

  /** [light-type-switch] 当前编辑的灯槽位（菜单统一设置条读写） */
  getActiveLight(): LightKey {
    return this.activeLight;
  }

  /** 切换当前编辑的灯槽位（纯 UI 焦点态）。
   *  [ADR-290] 与锥体彻底脱钩：驱动源改由 lightVolumetricDriver schema 键决定，
   *  不再读 activeLight，故此处无需收敛锥体。原「切编辑灯即重建锥体」的内联逻辑
   *  是渲染输出隐式挂钩不可存档焦点态的补丁，随本决策退役。 */
  setActiveLight(which: LightKey): void {
    this.activeLight = which;
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（能力总开关）-------- */
  /** 能力总开关节点 id（LIGHT_MASTER_NODE_ID 常量）：已升场景组根视图 headerToggle +
   *  面板首行统一经 filter 移除（复用 envCapSubNodes 同一剔除逻辑，防一二级双份）。
   *  [锐评根治 2026-10] 原裸字符串与 light-controls 产节点处两处手抄，现同源一常量。 */
  getMasterNodeId(): string {
    return LIGHT_MASTER_NODE_ID;
  }

  /** 完整参数面板节点树（映射体在 light-controls.ts buildLightNodes）：
   *  light-enabled 能力总开关 + light-select 编辑槽位 + light-helper 线框开关 +
   *  参数组 folder（统一设置条/环境光/聚光体积卡/重置）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildLightNodes(this);
  }

  /** 保存状态到 localStorage（[ADR-293] 总开关/helper 可见性已入 envState，
   *  持久化 payload 全部由 envState 纯读派生，映射体在 light-persist.ts） */
  saveState(): void {
    persistState(this.id, buildLightPersistPayload());
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    // ① [ADR-282] 原「预设先套用」步骤已删：灯光与模型类别解耦，不再有 manualPreset/
    //    currentPreset 可恢复。旧存档中这两个键现为死数据——restoreState 对未知键宽容，
    //    不报错也不算错（灯光值已由 restoreLightParams 全量恢复）。
    // ② 用户显式保存的灯开关 + ②.b 全量参数恢复（纯数据映射，下沉 light-persist.ts；
    //    [ADR-293] 能力总开关/线框可见性亦并入该批——顶层 enabled/helperVisible 键
    //    格式与旧存档兼容，缺键 = 不写，落 envState 现值（新会话现值即 schema 默认））。
    //    ⚠️ 重入治理（ADR-281 收口）：restoreLightParams 内部的 setEnvState 会**同步**触发
    //    onEnvChanged；挂起回调后恢复路径只写 envState，本调用末尾统一应用一次——
    //    消除「callback 先拿旧类型灯重建一次、回到③又跑一遍」的双跑窗口；新增字段时
    //    ③即唯一同步入口，不再有隐性双入口。
    withEnvCallbacksSuspended(() => {
      restoreLightParams(state);
    });
    // ③ 类型可能因恢复而变化（旧存档迁移：key 灯 → spot）→ 逐盏重建 Three 对象
    for (const which of LIGHT_SLOTS) {
      this.syncLight(which, envState);
    }
    // ④ 体积光锥按恢复后的 spot/volumetric 双开态重建 + 挂载
    this.rebuildConeIfNeeded(envState);
    // ⑤ helper 挂场景 + 显隐随恢复后的开关（单独 loadState 路径也会静默缺 helper）
    for (const which of LIGHT_SLOTS) {
      this.instances.mountHelper(which);
    }
    // ⑥ [ADR-293 复核加固] 末尾补一次 notify：suspend 窗内恢复不派发（重入治理本意），
    //    代价是同宿主复用（二次 createSceneInfra 的 loadAll）时若灯光面板恰开着，
    //    离散值与场景脱节——此处补一帧面板刷新。安全前提：notify 重入面板渲染的自激
    //    已被双保险掐灭（listener-set 快照迭代 + rebindSceneCapSubs 幂等，复核 P0）。
    this.listenerSet.notify();
  }

  /** ambient 应用单一出口（预览/截图同构）：ambient 强度/颜色属 light 组 envState 字段，
   *  IBL 在场判据与让位系数（×0.5）在此汇合。
   *  触发方有三：①sky.setSkyIblSelfHoldEnabled 主动调本方法；②light 组任意键变动的
   *  onEnvChanged（lightAmbientIntensity/Color 是 light 组字段，回调里刷它正当）；
   *  ③env.setEnabled（判据换源后必需）。三路幂等、语义一致，无「漏刷」窗口。 */
  refreshAmbientFromSky(state: EnvState = envState): void {
    // [锐评 X-3 2026-10-04] 让位判据换成**真供图者**：`scene.environment` 的唯一写者是 env cap
    //（ADR-292 D1），而 sky 的 `skyEnvironment` 已自宣退役（只门控天空自持兜底路，见其注释）。
    // 读旧开关会在 `envSource=preset` + `skyEnvironment=false` 时「IBL 已供图却不让位」⇒ 双间接光过亮，
    // 反向组合则误压 ambient。判据与 D10 路由器同源：**env cap 在场且启用 ⇒ IBL 真在场**。
    // [锐评 2026-10-08 P0] 本行的判据语义与截图侧共用「IBL 是否真供图」这一口径。
    // ⚠️ 但**取数路径刻意不同**：预览走构造注入的 `this.caps`（ctx seam），截图走组合根
    // `scene-capability-registry.ts|isIblActive`（全局单例）。改本行为直引 registry 会重建
    // registry↔light 模块环（历史上正是为断此环把 isSkyEnvironmentOn 上移到 registry）。
    // [锐评 2026-10-08 P1-2] 判据本身下沉 `environment-ownership.ts|envShouldYieldSlot`
    // （D10 让权判据单一事实源，与 sky 三处同源）——两条取数路径共用**同一个问法**。
    const iblOn = envShouldYieldSlot(getTypedCap(this.caps, "environment"));
    this.ambientLight.color.setHex(state.lightAmbientColor);
    this.ambientLight.intensity = attenuateAmbientForSky(state.lightAmbientIntensity, iblOn);
  }

  // [ADR-329 刀②] 射束方向 getSpotDir 已随 spotTarget 一并迁入叶（light-instances.ts|spotDir）——
  //  它是纯 Three 读（spotTarget.position − light.position），依赖 spotTarget 归属。

  private detach(): void {
    // [ADR-329 刀②] 三盏灯 + spot 瞄准点 + 三副 helper 的卸载委托叶
    //（⚠️ 各自 DirectionalLight.target 与共享 spotTarget 是两回事，清单不可简化——叶内注释有详述）
    this.instances.detach();
    // ambient 属主在 cap（让位判据来自 sky/environment 编排面，非灯实例面）
    if (this.ambientLight.parent) this.ambientLight.parent.remove(this.ambientLight);
    this.cone.detach();
  }

  dispose(): void {
    this.unsubscribeEnv();
    this.detach();
    this.cone.dispose();
    this.instances.dispose();
    this.ambientLight.dispose();
  }
}
