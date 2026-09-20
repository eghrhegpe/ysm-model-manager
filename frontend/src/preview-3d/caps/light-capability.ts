// ===== LightCapability — 3D 预览个人灯光系统（ADR-177 编排器）=====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。
// [ADR-246 D1] postprocess 空壳引擎已删除——原「双引擎切换」抽象从未有任何体积光 pass 落地，
// 只带来「选了就关掉体积光」的欺骗性控件与 3 条绕 bug 回归用例；现回归单引擎（cone）。
//
// 职责拆分（ADR-177，2026-09-04）：
//   - 灯光对象管理（key/fill/rim/ambient/spotlight + 阴影协作）保留本类（核心职责①）
//   - 体积光锥体② → light-cone.ts（VolumetricCone）
//   - 预设数据③ → light-presets.ts（ADR-281 后不再经本文件 `export *` 转发，消费方直引具体叶）
//   - 嵌套 ↔ 扁平参数映射 flattenLightParams → light-presets.ts（P3 下沉：纯映射样板，不触 cap 状态）
//   - 菜单 UI 定义④ → light-controls.ts（buildLightNodes）
//   - 状态持久化⑤ 保留本类（触达大量私有字段，顺序语义敏感）
//
// 设计要点（对齐 SkyCapability / GroundCapability 的能力模式）：
//   - 默认经典三点布光（key/fill/rim DirectionalLight）+ AmbientLight
//   - Spotlight 从对象正上方打下（聚光灯），cone + penumbra 可调 + SpotLightHelper 线框可视（ADR-246 D3）
//   - 体积光锥：真锥体网格 + Fresnel 视角边缘辉光（轻量，无 post-process 管线），
//     朝向由 spotlight → 靶点方向驱动（默认俯视灯下恒垂直向下）
//   - 按模型类别预设（对齐 SkyCapability.setPreset 模式）
//   - 本类不持有 backend 引用，纯 Three.js 侧逻辑
//   - target（对象中心）可动态更新，聚光灯 + 体积光锥随之重新定位
//   - ADR-196 刀2：参数真值源从 this.params 迁到 envState 单例

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import {
  registerEnvCallback,
  resumeEnvCallbacks,
  suspendEnvCallbacks,
} from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { VolumetricCone } from "./light-cone.ts";
import { buildLightNodes, LIGHT_MASTER_NODE_ID } from "./light-controls.ts";
import { buildLightPersistPayload, restoreLightParams } from "./light-persist.ts";
import {
  DEFAULT_LIGHT_PARAMS,
  type DeepPartial,
  flattenLightParams,
  LIGHT_SLOTS,
  type LightInstanceParams,
  type LightParams,
  type LightSlot,
  lightEnvKeys,
  readLightParams as readLightParamsFrom,
  type VolumetricParams,
} from "./light-presets.ts";
import {
  getTypedCap,
  persistState,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

/** 方位角 + 仰角 → 3D 位置（radius 为单位长度；预览灯光与截图渲染共用同一套公式——光系统统一性） */
export function lightDirToPosition(p: LightInstanceParams, radius: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(p.azimuth);
  const el = THREE.MathUtils.degToRad(p.elevation);
  const h = radius * Math.cos(el); // 水平分量
  const y = radius * Math.sin(el); // 垂直分量
  return new THREE.Vector3(h * Math.sin(az), y, h * Math.cos(az));
}

/** three.js 物理光照下 SpotLight 距离衰减。
 *  ⚠️ 这是**手抄快照**，非 three 导出 API：对齐 three r165+ 的
 *  `getDistanceAttenuation`（r165 已移除 useLegacyLights，SpotLight.intensity 单位是坎德拉）。
 *  three 历史上改过该公式——**升级 three 时必须复核本函数**，否则预览照度与实际渲染静默分叉。
 *  ✅ 已机器强制（非仅注释提醒）：`light-attenuation-mirror.test.ts` 直读 three 随包发布的
 *  GLSL 原文（lights_pars_begin.glsl）校验本镜像的三个结构锚点，升级后公式变动即测试红。
 *  falloff = 1/pow(d, decay) × cutoffWindow(distance, cutoff)。
 *  用途：把 UI 暴露的「到达目标处照度(lx)」反推回需设的 candela，使聚光灯强度不随目标高度漂移。 */
export function spotDistanceAttenuation(
  lightDistance: number,
  cutoff: number,
  decay: number,
): number {
  const base = 1 / Math.max(lightDistance ** decay, 0.01);
  const cutoffF = cutoff > 0 ? Math.max(0, Math.min(1, 1 - (lightDistance / cutoff) ** 4)) ** 2 : 1;
  return base * cutoffF;
}

/** PMREM 环境光开启时 ambient 让位系数（双间接光叠加防过亮/互相稀释——
 *  [doc:adr-126-p5] 光系统统一性 #3）。预览（refreshAmbientFromSky）与截图
 *  （preview-3d/screenshot-lights.ts toScreenshotLights，ADR-136 归位）共用——
 *  ×0.5 单一事实源，改一处两处同步。
 *  模块常量不导出：外部唯一入口是 attenuateAmbientForSky()（knip 零未引用导出） */
const SKY_ENV_AMBIENT_ATTENUATION = 0.5;

/** ambient 强度按 sky 环境开关套让位系数（镜像 AmbientParams 应用，公式单源） */
export function attenuateAmbientForSky(intensity: number, skyEnvOn: boolean): number {
  return intensity * (skyEnvOn ? SKY_ENV_AMBIENT_ATTENUATION : 1);
}

// ======== ADR-196：嵌套 ↔ 扁平映射 ========

/** 从 envState 读取单盏灯参数（缺省读单例 envState）。
 *  真值映射体在 light-presets.readLightParams——本包装只为让本模块内调用省掉 envState 形参。 */
function readLightParams(which: LightSlot, state: EnvState = envState): LightInstanceParams {
  return readLightParamsFrom(state, which);
}

/** 从 envState 读取体积光参数 */
function readVolParams(state: EnvState = envState): VolumetricParams {
  return {
    enabled: state.lightVolumetricEnabled,
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
// 由 light-presets 的 FLATTEN_MAP 派生（lightEnvKeys）——新增字段不再需同步维护本表。
// 灯内部按字段决定「重建灯对象」（type 变化）还是「原地更新」。

/** 三槽位的通用别名（本模块旧名，语义同 LightSlot） */
export type LightKey = LightSlot;

function lightChangeSet(which: LightSlot): Set<EnvStateKey> {
  return new Set(lightEnvKeys(which));
}

const KEY_CHANGES = lightChangeSet("key");
const FILL_CHANGES = lightChangeSet("fill");
const RIM_CHANGES = lightChangeSet("rim");

const VOL_PARAM_CHANGES: Set<EnvStateKey> = new Set([
  "lightVolumetricOpacity",
  "lightVolumetricFogPower",
  "lightVolumetricEdgeFade",
  "lightVolumetricBaseStrength",
  "lightVolumetricTipStrength",
]);

/** 影响锥体几何（形状/存在性）的字段：type/enabled/angle/penumbra 变化才需 dispose+重建；
 *  颜色/强度/距离/衰减只动 uniforms，方位角/仰角只动 transform。
 *  （旧实现：任意 spotlight 字段变更都整组重建，拖滑块即 GC 抖动。） */
const CONE_GEO_CHANGES: Set<EnvStateKey> = new Set([
  "lightKeyType",
  "lightFillType",
  "lightRimType",
  "lightKeyEnabled",
  "lightFillEnabled",
  "lightRimEnabled",
  "lightKeyAngle",
  "lightFillAngle",
  "lightRimAngle",
  "lightKeyPenumbra",
  "lightFillPenumbra",
  "lightRimPenumbra",
]);

/** 只改变光源位置（不影响锥形）的字段 → 锥体 syncPosition */
const CONE_MOVE_CHANGES: Set<EnvStateKey> = new Set([
  "lightKeyAzimuth",
  "lightFillAzimuth",
  "lightRimAzimuth",
  "lightKeyElevation",
  "lightFillElevation",
  "lightRimElevation",
]);

function hasAny(changed: Set<EnvStateKey>, keys: Set<EnvStateKey>): boolean {
  for (const k of keys) if (changed.has(k)) return true;
  return false;
}

// [light-gizmo] 方向光灯可视化辅助配色：与灯光颜色解耦，仅用于在视口区分三盏灯的来向，
// 让「开/关 + 从哪照来」一眼可见（与聚光灯 SpotLightHelper 线框锥同语义的视觉锚点）。
const DIR_HELPER_COLORS = {
  key: 0xffd9a0,
  fill: 0x6fb1ff,
  rim: 0xff77cc,
} as const;

export class LightCapability implements SceneCapability {
  readonly id = "light";
  readonly labelKey = "preview.lighting";
  readonly icon = "hint";
  readonly descKey = "preview.lightingDesc";

  private scene: THREE.Scene;
  private caps?: SceneCapabilityLookup;
  private enabled: boolean;
  private target: THREE.Vector3; // 对象中心，聚光灯瞄准点
  private targetHeight: number; // 聚光灯位于对象上方的高度

  // 灯光对象（[light-type-switch] 三盏统一实例，各可 directional/point/spot）
  private keyLight: THREE.Light;
  private fillLight: THREE.Light;
  private rimLight: THREE.Light;
  private ambientLight: THREE.AmbientLight;
  /** 聚光灯瞄准点（仅 type=spot 的灯使用；全局共享一个隐形 Object3D） */
  private spotTarget: THREE.Object3D;

  // 体积光锥（ADR-177：实现下沉 VolumetricCone，本类仅委派）
  private cone: VolumetricCone;

  // [light-gizmo] 每盏灯一个 helper（类型相关的线框）——类型切换时重建
  private keyHelper: THREE.Object3D | null = null;
  private fillHelper: THREE.Object3D | null = null;
  private rimHelper: THREE.Object3D | null = null;
  // [ADR-282] `currentPreset` / `manualPreset` 已退役：灯光与模型类别解耦，不再有预设名可记。
  // 旧职责：ADR-085 S2 记录真实预设名、ADR-126 P5 粗粒度「手动优先」——
  // 后者与 shouldOverwrite 的按 key 保护重复，改为后者独当（见 ADR-282 §1.5）。

  /** [light-type-switch] 菜单「编辑灯光」的选择态（运行时态，不入 envState/持久化） */
  private activeLight: LightKey = "key";

  // ADR-196：取消订阅函数
  private unsubscribeEnv: () => void;

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
    this.enabled = opts.enabled ?? true;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.targetHeight = opts.targetHeight ?? 8;

    // 聚光灯瞄准点（隐形 Object3D，所有 spot 灯共享）
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.name = "ysm-light-spot-target";
    this.spotTarget.position.copy(this.target);

    // 从 envState 读取初始值（ADR-196：真值源迁移）
    // [light-type-switch] 三盏灯统一实例化：createLight 按各盏灯的 type 建对应 Three 对象
    this.keyLight = this.createLight(readLightParams("key"), "key");
    this.fillLight = this.createLight(readLightParams("fill"), "fill");
    this.rimLight = this.createLight(readLightParams("rim"), "rim");
    // [light-gizmo] 每盏灯配一个类型相关 helper（颜色区分），visible 绑 enabled
    this.keyHelper = this.createHelper(
      this.keyLight,
      DIR_HELPER_COLORS.key,
      "ysm-light-key-helper",
    );
    this.fillHelper = this.createHelper(
      this.fillLight,
      DIR_HELPER_COLORS.fill,
      "ysm-light-fill-helper",
    );
    this.rimHelper = this.createHelper(
      this.rimLight,
      DIR_HELPER_COLORS.rim,
      "ysm-light-rim-helper",
    );
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
    // key/fill/rim：类型变化 → 重建；其余 → 原地更新
    if (hasAny(changed, KEY_CHANGES)) this.syncLight("key", state);
    if (hasAny(changed, FILL_CHANGES)) this.syncLight("fill", state);
    if (hasAny(changed, RIM_CHANGES)) this.syncLight("rim", state);

    // ambient：总是刷新（依赖 caps 查询器的 sky 环境开关，非纯 envState 派生）
    this.refreshAmbientFromSky(state);

    // 体积光锥三路分派：几何变更 → dispose+重建；位置变更 → syncPosition；uniform 变更 → updateUniforms
    // （旧实现：任意字段变更都整组重建，拖滑块即 GC 抖动）
    const volToggled = changed.has("lightVolumetricEnabled");
    const coneGeo = hasAny(changed, CONE_GEO_CHANGES);
    const coneMove = hasAny(changed, CONE_MOVE_CHANGES);
    const lightTouched =
      hasAny(changed, KEY_CHANGES) || hasAny(changed, FILL_CHANGES) || hasAny(changed, RIM_CHANGES);
    if (volToggled || coneGeo) {
      this.rebuildConeIfNeeded(state);
    } else {
      // 快路径：光源参数变了只刷 uniforms；位置变了再补一次 transform 同步
      const spot = this.getSpotLightForCone();
      if (spot) {
        if (coneMove) {
          const dir = new THREE.Vector3();
          this.getSpotDir(spot.light, dir);
          this.cone.syncPosition(spot.light.position, dir);
        }
        if (lightTouched || hasAny(changed, VOL_PARAM_CHANGES)) {
          this.cone.updateUniforms(readLightParams(spot.which, state), readVolParams(state));
        }
      }
    }
  }

  /* ----- 单盏灯同步：类型变化重建，否则原地更新 ----- */

  private syncLight(which: LightKey, state: EnvState): void {
    const p = readLightParams(which, state);
    const current = this.getLight(which);
    const currentType = this.getLightType(current);

    if (p.type !== currentType) {
      // 类型切换：dispose 旧灯 + 旧 helper → 重建（MikuMikuAR 同款）
      this.disposeLight(which);
      const next = this.createLight(p, which);
      // createLight 内建的是原始强度；spot 需经衰减补偿重算（与原地更新路径同源）
      this.applyLightParams(next, p);
      this.setLight(which, next);
      this.setHelper(
        which,
        this.createHelper(next, DIR_HELPER_COLORS[which], `ysm-light-${which}-helper`),
      );
      if (this.enabled) {
        this.mountLight(which);
        this.mountHelper(which);
      }
      // 锥体重建由调用方负责（onEnvChanged 走 CONE_GEO_CHANGES；loadState 走第④步）
      return;
    }

    this.applyLightParams(current, p);
    this.syncHelper(which, p);
  }

  private getLight(which: LightKey): THREE.Light {
    return which === "key" ? this.keyLight : which === "fill" ? this.fillLight : this.rimLight;
  }

  private setLight(which: LightKey, light: THREE.Light): void {
    if (which === "key") this.keyLight = light;
    else if (which === "fill") this.fillLight = light;
    else this.rimLight = light;
  }

  private getLightType(light: THREE.Light): LightInstanceParams["type"] {
    if (light instanceof THREE.SpotLight) return "spot";
    if (light instanceof THREE.PointLight) return "point";
    return "directional";
  }

  /* ----- 灯光工厂（[light-type-switch] 按 type 建对应 Three 对象） ----- */

  /** 灯位 = 模型中心 + 方位角/仰角方向 × targetHeight。
   *  半径用 targetHeight（switch-preview 设为 `max(maxDim*0.8, 6)`）而非固定值，
   *  使大模型的光源不会陷在网格内部；同时保留旧独立聚光灯「距靶点 = targetHeight」
   *  的 candela 补偿距离语义。spot/point 跟随模型中心；directional 靠 target 同步平移。 */
  private lightPosition(p: LightInstanceParams): THREE.Vector3 {
    return lightDirToPosition(p, this.targetHeight).add(this.target);
  }

  private createLight(p: LightInstanceParams, which: LightKey): THREE.Light {
    const pos = this.lightPosition(p);
    let light: THREE.Light;
    if (p.type === "spot") {
      const spot = new THREE.SpotLight(
        p.color,
        p.intensity,
        p.distance,
        THREE.MathUtils.degToRad(p.angle),
        p.penumbra,
        p.decay,
      );
      spot.position.copy(pos);
      spot.target = this.spotTarget;
      light = spot;
    } else if (p.type === "point") {
      const point = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay);
      point.position.copy(pos);
      light = point;
    } else {
      const dir = new THREE.DirectionalLight(p.color, p.intensity);
      dir.position.copy(pos);
      // 方向 = position − target；target 跟随模型中心 → 方向恒等于方位角/仰角向量
      dir.target.position.copy(this.target);
      light = dir;
    }
    light.visible = p.enabled;
    // 灯本体与 helper 同口径按**槽位**命名（`which`），三盏同为 spot 也不再重名——
    // 旧实现按类型命名（`ysm-light-${p.type}`）在 types 已切口径不一致，且多 spot 同框时重名，
    // 未来任何「按名查灯」逻辑都会踩雷；helper 早已按槽位命名，此处对齐。
    light.name = `ysm-light-${which}`;
    return light;
  }

  /** 原地更新已有灯的参数（类型不变时）。返回值包含需要同步 helper 的信息。 */
  private applyLightParams(light: THREE.Light, p: LightInstanceParams): void {
    light.color.setHex(p.color);
    light.visible = p.enabled;
    light.position.copy(this.lightPosition(p));
    // DirectionalLight 方向 = position − target；target 跟随模型中心才能保证方向语义
    if (light instanceof THREE.DirectionalLight) light.target.position.copy(this.target);

    if (light instanceof THREE.SpotLight) {
      // UI intensity 语义 = 「到达目标处照度」→ 反推 candela（防距离衰减吃强度）
      const d = Math.max(light.position.distanceTo(this.spotTarget.position), 0.01);
      const falloff = spotDistanceAttenuation(d, p.distance, p.decay);
      light.intensity = falloff > 0 ? p.intensity / falloff : p.intensity;
      light.distance = p.distance;
      light.angle = THREE.MathUtils.degToRad(p.angle);
      light.penumbra = p.penumbra;
      light.decay = p.decay;
      light.target = this.spotTarget;
    } else if (light instanceof THREE.PointLight) {
      light.intensity = p.intensity;
      light.distance = p.distance;
      light.decay = p.decay;
    } else {
      light.intensity = p.intensity;
    }
  }

  /** 类型相关 helper 工厂 */
  private createHelper(light: THREE.Light, color: number, name: string): THREE.Object3D {
    let h: THREE.Object3D;
    if (light instanceof THREE.SpotLight) h = new THREE.SpotLightHelper(light, color);
    else if (light instanceof THREE.PointLight) h = new THREE.PointLightHelper(light, 1, color);
    else h = new THREE.DirectionalLightHelper(light as THREE.DirectionalLight, 2, color);
    h.name = name;
    h.visible = light.visible;
    return h;
  }

  private getHelper(which: LightKey): THREE.Object3D | null {
    return which === "key" ? this.keyHelper : which === "fill" ? this.fillHelper : this.rimHelper;
  }

  private setHelper(which: LightKey, h: THREE.Object3D): void {
    if (which === "key") this.keyHelper = h;
    else if (which === "fill") this.fillHelper = h;
    else this.rimHelper = h;
  }

  /** helper 显隐跟随 enabled + 几何重算 */
  private syncHelper(which: LightKey, p: LightInstanceParams): void {
    const h = this.getHelper(which);
    if (!h) return;
    h.visible = p.enabled;
    const updatable = h as unknown as { update?: () => void };
    updatable.update?.();
  }

  /* ----- 公共 API ----- */

  apply(): void {
    if (!this.enabled) {
      this.detach();
      return;
    }
    this.mountLight("key");
    this.mountLight("fill");
    this.mountLight("rim");
    if (!this.ambientLight.parent) this.scene.add(this.ambientLight);
    // 聚光灯瞄准点需要挂到场景图，否则 SpotLight 定向失效
    if (!this.spotTarget.parent) this.scene.add(this.spotTarget);
    this.mountHelper("key");
    this.mountHelper("fill");
    this.mountHelper("rim");
    this.rebuildConeIfNeeded(envState);
  }

  /** 把单盏灯（+ 其 DirectionalLight target）挂到场景 */
  private mountLight(which: LightKey): void {
    const light = this.getLight(which);
    if (!light.parent) this.scene.add(light);
    if (light instanceof THREE.DirectionalLight && !light.target.parent) {
      this.scene.add(light.target);
    }
  }

  /** 把单盏灯的 helper 挂到场景并同步显隐 */
  private mountHelper(which: LightKey): void {
    const h = this.getHelper(which);
    if (!h) return;
    if (!h.parent) this.scene.add(h);
    h.visible = readLightParams(which).enabled;
    (h as unknown as { update?: () => void }).update?.();
  }

  /** 释放单盏灯与 helper（类型切换前调用） */
  private disposeLight(which: LightKey): void {
    const light = this.getLight(which);
    if (light.parent) light.parent.remove(light);
    if (light instanceof THREE.DirectionalLight && light.target.parent) {
      light.target.parent.remove(light.target);
    }
    light.dispose();

    const h = this.getHelper(which);
    if (h) {
      if (h.parent) h.parent.remove(h);
      (h as unknown as { dispose?: () => void }).dispose?.();
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else this.detach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTarget(v: THREE.Vector3): void {
    this.target.copy(v);
    this.spotTarget.position.copy(this.target);
    // 三盏灯位置基于 target 重算（方位角/仰角不变），强度/朝向同步
    for (const which of LIGHT_SLOTS) {
      const light = this.getLight(which);
      const p = readLightParams(which);
      this.applyLightParams(light, p);
      this.syncHelper(which, p);
    }
    this.rebuildConeIfNeeded(envState);
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  /* ShadowCapability 跨能力协作：取得当前挂到场景的三盏灯，统一设置 shadow 参数；
   * 不返回内部引用副本，避免 ShadowCapability 直接写 private 字段。 */
  getLights(): THREE.Light[] {
    return [this.keyLight, this.fillLight, this.rimLight];
  }

  /** 返回体积光锥的驱动 spot 灯 + 其槽位，无则 null。
   *  优先级：当前编辑的灯（activeLight）若是启用的 spot → 它；
   *  否则回退槽位顺序（key→fill→rim）第一盏启用的 spot。
   *  ⚠️ 驱动源依赖 activeLight，故 setActiveLight 变更时必须主动收敛锥体（已内联）。 */
  getSpotLightForCone(): { light: THREE.SpotLight; which: LightKey } | null {
    // 当前编辑的灯若是启用的 spot，优先驱动锥体（与用户心智：我在调的那盏灯）一致；
    // 否则回退到槽位顺序（key→fill→rim）第一盏启用的 spot。
    const active = this.activeLight;
    const activeLight = this.getLight(active);
    if (activeLight instanceof THREE.SpotLight && activeLight.visible) {
      return { light: activeLight, which: active };
    }
    for (const which of LIGHT_SLOTS) {
      const light = this.getLight(which);
      if (light instanceof THREE.SpotLight && light.visible) return { light, which };
    }
    return null;
  }

  /** 靶点高度（= 灯光定位半径 + 锥长）。截图侧需读取以保持与预览同构。 */
  getTargetHeight(): number {
    return this.targetHeight;
  }

  setTargetHeight(h: number): void {
    this.targetHeight = h;
    // 高度变化只影响 spot 灯到目标的物理距离 → 重算 candela 补偿 + 锥体定位
    for (const which of LIGHT_SLOTS) {
      const light = this.getLight(which);
      const p = readLightParams(which);
      this.applyLightParams(light, p);
      this.syncHelper(which, p);
    }
    this.rebuildConeIfNeeded(envState);
  }

  /** [ADR-282] 把三盏灯 + 体积光重置为规范默认值。
   *  锚点 = `DEFAULT_LIGHT_PARAMS`（与 envState schema 初始值同源，模型无关）——
   *  语义：「重置」= 回到「从没动过」的状态。
   *  不再有任何按模型类别的预设：灯光是场景属性，Three.js 层面无「模型类别」概念；
   *  唯一合法的模型相关输入是包围盒（驱动灯位/坎德拉补偿），已由 setTarget/setTargetHeight 动态处理。
   *  `source: "manual"`：用户显式重置与拖滑块同源——重置后的值受 shouldOverwrite 保护。 */
  resetLightParams(): void {
    setEnvState(flattenLightParams(DEFAULT_LIGHT_PARAMS), { source: "manual" });
    // callback 负责 syncLight + 锥体重建（含 volumetric.enabled 变 false 时卸载）
  }

  /**
   * 体积光锥与当前 envState 同步：[light-type-switch] 锥体由第一盏启用的 spot 灯驱动。
   * 无 spot 灯 / 体积光未开 → 卸载；有则挂载并定位。
   */
  private rebuildConeIfNeeded(state: EnvState = envState): void {
    const spot = this.getSpotLightForCone();
    const volOn = state.lightVolumetricEnabled;
    if (!spot || !volOn) {
      if (this.cone.isMounted()) this.cone.detach();
      return;
    }
    const p = readLightParams(spot.which, state);
    const pos = spot.light.position;
    const dir = new THREE.Vector3();
    this.getSpotDir(spot.light, dir);
    this.cone.rebuild(this.targetHeight, p, readVolParams(state), pos, dir);
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
    const { baseStrength, tipStrength } = readVolParams();
    if (baseStrength <= 0) return 0;
    return Math.min(1, Math.max(0, tipStrength / baseStrength));
  }

  /** [ADR-246 D2] 按 base 派生 tip（比值写入路径）——base 不变，tip = base × ratio。
   *  入参 clamp 到 [0,1] 与 getter 值域对等（程序化调用传越界值不写脏数据）。 */
  setVolumetricTipRatio(ratio: number): void {
    const { baseStrength } = readVolParams();
    const clamped = Math.min(1, Math.max(0, ratio));
    this.setVolumetric({ tipStrength: baseStrength * clamped });
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

  /** 切换当前编辑的灯槽位。
   *  ⚠️ 不写 envState（UI 焦点态，不入存档/派发），但**会主动收敛锥体**：
   *  getSpotLightForCone 优先取 activeLight，若此处不收敛，切换编辑灯后驱动源已变、
   *  锥体却停在旧灯上（无派发 = 无 rebuild），要等下次碰任意灯光参数才跟上——
   *  「切了没反应」比旧实现的固定顺序更难预期。 */
  setActiveLight(which: LightKey): void {
    const prev = this.activeLight;
    this.activeLight = which;
    // 驱动源变了才重建（同槽位重复设值不空转）；rebuildConeIfNeeded 自带「非 spot/未启用即隐藏」语义
    if (prev !== which) this.rebuildConeIfNeeded(envState);
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（能力总开关）-------- */
  /** 能力总开关节点 id（LIGHT_MASTER_NODE_ID 常量）：已升场景组根视图 headerToggle +
   *  面板首行统一经 filter 移除（复用 envCapSubNodes 同一剔除逻辑，防一二级双份）。
   *  [锐评根治 2026-10] 原裸字符串与 light-controls 产节点处两处手抄，现同源一常量。 */
  getMasterNodeId(): string {
    return LIGHT_MASTER_NODE_ID;
  }

  /** 完整参数面板节点树：light-enabled 能力总开关 + light-key 平铺 toggle + 参数组 folder（8 控件）。
   *  能力总开关是 light-enabled（isEnabled/setEnabled）；light-key 是主灯 params 开关。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildLightNodes(this);
  }

  /** 保存状态到 localStorage（参数映射下沉 light-persist.ts；私有运行时态在此编排） */
  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      ...buildLightPersistPayload(),
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    // ① [ADR-282] 原「预设先套用」步骤已删：灯光与模型类别解耦，不再有 manualPreset/
    //    currentPreset 可恢复。旧存档中这两个键现为死数据——restoreState 对未知键宽容，
    //    不报错也不算错（灯光值已由 restoreLightParams 全量恢复）。
    // ② 用户显式保存的灯开关 + ②.b 全量参数恢复（纯数据映射，下沉 light-persist.ts；
    //    顺序敏感：必须在预设套用之后——后恢复的用户值优先于预设，ADR-126 P5 同口径）。
    //    ⚠️ 重入治理（ADR-281 收口）：restoreLightParams 内部的 setEnvState 会**同步**触发
    //    onEnvChanged；挂起回调后恢复路径只写 envState，本调用末尾统一应用一次——
    //    消除「callback 先拿旧类型灯重建一次、回到③又跑一遍」的双跑窗口；新增字段时
    //    ③即唯一同步入口，不再有隐性双入口。
    suspendEnvCallbacks();
    try {
      restoreLightParams(state);
    } finally {
      resumeEnvCallbacks();
    }
    // ③ 类型可能因恢复而变化（旧存档迁移：key 灯 → spot）→ 逐盏重建 Three 对象
    for (const which of LIGHT_SLOTS) {
      this.syncLight(which, envState);
    }
    // ④ 体积光锥按恢复后的 spot/volumetric 双开态重建 + 挂载
    this.rebuildConeIfNeeded(envState);
    // ⑤ helper 挂场景 + 显隐随恢复后的开关（单独 loadState 路径也会静默缺 helper）
    this.mountHelper("key");
    this.mountHelper("fill");
    this.mountHelper("rim");
  }

  /** ambient 应用单一出口（预览/截图同构）：ambient 强度/颜色属 light 组 envState 字段，
   *  环境开关让位系数（×0.5）由 sky 私有态经构造注入的查询器读取——二者在此汇合。
   *  触发方有二：①sky.setEnvironmentEnabled 会主动调本方法（sky-capability.ts:483），
   *  确保翻转环境开关时立即重算；②light 组任意键变动的 onEnvChanged 也调用——因
   *  lightAmbientIntensity/Color 是 light 组字段，回调里刷它本就正当。两路幂等、语义一致，
   *  无「漏刷」窗口（旧注释称「灯组回调是补刷唯一时机」，sky 主动通知落地后已不成立）。 */
  refreshAmbientFromSky(state: EnvState = envState): void {
    const skyEnvOn = getTypedCap(this.caps, "sky")?.isEnvironmentEnabled() ?? false;
    this.ambientLight.color.setHex(state.lightAmbientColor);
    this.ambientLight.intensity = attenuateAmbientForSky(state.lightAmbientIntensity, skyEnvOn);
  }

  /** 射束方向（世界，光源 → 靶点）——体积光锥朝向锚，结果写入调用方拥有的 `out`。
   *  旧实现把「恒垂直向下」写死进锥体几何，聚光灯一旦可倾斜锥体即与真实光锥脱钩；
   *  统一从 spot 灯/靶点算方向后，默认俯视灯下恒为 (0,-1,0)（旧行为不变），倾斜灯自动跟随。
   *  显式 `out` 形参（而非返回内部暂存向量）：调用方拥有结果生命周期，
   *  消除「外部长期持有即串改」的隐式契约；未归一化，VolumetricCone 内部归一化。 */
  private getSpotDir(light: THREE.SpotLight, out: THREE.Vector3): void {
    out.copy(this.spotTarget.position).sub(light.position);
  }

  private detach(): void {
    const objs: (THREE.Object3D | null | undefined)[] = [
      this.keyLight,
      this.fillLight,
      this.rimLight,
      this.ambientLight,
      this.keyLight instanceof THREE.DirectionalLight ? this.keyLight.target : null,
      this.fillLight instanceof THREE.DirectionalLight ? this.fillLight.target : null,
      this.rimLight instanceof THREE.DirectionalLight ? this.rimLight.target : null,
      this.spotTarget,
      this.keyHelper,
      this.fillHelper,
      this.rimHelper,
    ];
    objs
      .filter((o): o is THREE.Object3D => o !== null && o !== undefined)
      .forEach((o) => {
        if (o.parent) o.parent.remove(o);
      });
    this.cone.detach();
  }

  dispose(): void {
    this.unsubscribeEnv();
    this.detach();
    this.cone.dispose();
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    this.ambientLight.dispose();
    // [light-gizmo] helper 释放（几何/材质归 three，dispose 幂等）
    (this.keyHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
    (this.fillHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
    (this.rimHelper as unknown as { dispose?: () => void } | null)?.dispose?.();
  }
}
