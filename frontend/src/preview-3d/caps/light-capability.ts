// ===== LightCapability — 3D 预览个人灯光系统（ADR-177 编排器）=====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。
// [ADR-246 D1] postprocess 空壳引擎已删除——原「双引擎切换」抽象从未有任何体积光 pass 落地，
// 只带来「选了就关掉体积光」的欺骗性控件与 3 条绕 bug 回归用例；现回归单引擎（cone）。
//
// 职责拆分（ADR-177，2026-09-04）：
//   - 灯光对象管理（key/fill/rim/ambient/spotlight + 阴影协作）保留本类（核心职责①）
//   - 体积光锥体② → light-cone.ts（VolumetricCone）
//   - 预设数据③ → light-presets.ts（经 export * 重导出，外部 import 零改动）
//   - 嵌套 ↔ 扁平参数映射 flattenLightParams → light-presets.ts（P3 下沉：纯映射样板，不触 cap 状态）
//   - 菜单 UI 定义④ → light-controls.ts（buildLightNodes）
//   - 状态持久化⑤ 保留本类（触达大量私有字段，顺序语义敏感）
//
// 设计要点（对齐 SkyCapability / GroundCapability 的能力模式）：
//   - 默认经典三点布光（key/fill/rim DirectionalLight）+ AmbientLight
//   - Spotlight 从对象正上方打下（聚光灯），cone + penumbra 可调 + SpotLightHelper 线框可视（ADR-246 D3）
//   - 体积光锥：两交叉 PlaneGeometry + Cone 遮罩 shader（轻量，无 post-process 管线）
//   - 按模型类别预设（对齐 SkyCapability.setPreset 模式）
//   - 本类不持有 backend 引用，纯 Three.js 侧逻辑
//   - target（对象中心）可动态更新，聚光灯 + 体积光锥随之重新定位
//   - ADR-196 刀2：参数真值源从 this.params 迁到 envState 单例

import * as THREE from "three";
import { deferred } from "@/preview-3d/deferred.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import {
  type ModelType,
  pickModelDefaultFields,
  toModelType,
} from "@/preview-3d/state/model-defaults.ts";
import { VolumetricCone } from "./light-cone.ts";
import { buildLightNodes } from "./light-controls.ts";
import { buildLightPersistPayload, restoreLightParams } from "./light-persist.ts";
import {
  type DeepPartial,
  type DirectionalLightParams,
  flattenLightParams,
  type LightParams,
  type SpotlightParams,
  type VolumetricParams,
} from "./light-presets.ts";
import {
  getTypedCap,
  persistState,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

/** 本文件导出的全部参数类型 / 预设数据均来自 light-presets.ts，重导出以维持外部 import 零改动 */
export * from "./light-presets.ts";

/** 方位角 + 仰角 → 3D 位置（radius 为单位长度；预览灯光与截图渲染共用同一套公式——光系统统一性） */
export function lightDirToPosition(p: DirectionalLightParams, radius: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(p.azimuth);
  const el = THREE.MathUtils.degToRad(p.elevation);
  const h = radius * Math.cos(el); // 水平分量
  const y = radius * Math.sin(el); // 垂直分量
  return new THREE.Vector3(h * Math.sin(az), y, h * Math.cos(az));
}

/** three.js 物理光照下 SpotLight 距离衰减（与 three 的 getDistanceAttenuation 逐字对齐，
 *  r165+ 已移除 useLegacyLights，SpotLight.intensity 单位是坎德拉，到达处照度 = intensity × falloff）。
 *  lightDistance 处 falloff = 1/pow(d, decay) × cutoffWindow(distance, cutoff)。
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

/** 从 envState 读取方向灯参数 */
function readDirParams(
  which: "key" | "fill" | "rim",
  state: EnvState = envState,
): DirectionalLightParams {
  const prefix = `light${which.charAt(0).toUpperCase()}${which.slice(1)}` as const;
  return {
    enabled: state[`${prefix}Enabled` as keyof EnvState] as boolean,
    color: state[`${prefix}Color` as keyof EnvState] as number,
    intensity: state[`${prefix}Intensity` as keyof EnvState] as number,
    azimuth: state[`${prefix}Azimuth` as keyof EnvState] as number,
    elevation: state[`${prefix}Elevation` as keyof EnvState] as number,
  };
}

/** 从 envState 读取聚光灯参数 */
function readSpotParams(state: EnvState = envState): SpotlightParams {
  return {
    enabled: state.lightSpotEnabled,
    color: state.lightSpotColor,
    intensity: state.lightSpotIntensity,
    angle: state.lightSpotAngle,
    penumbra: state.lightSpotPenumbra,
    distance: state.lightSpotDistance,
    decay: state.lightSpotDecay,
  };
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
    key: readDirParams("key", state),
    fill: readDirParams("fill", state),
    rim: readDirParams("rim", state),
    ambient: {
      color: state.lightAmbientColor,
      intensity: state.lightAmbientIntensity,
    },
    spotlight: readSpotParams(state),
    volumetric: readVolParams(state),
  };
}

// ======== 变更分组（callback 分派用） ========

const DIR_KEY_CHANGES = new Set([
  "lightKeyEnabled",
  "lightKeyColor",
  "lightKeyIntensity",
  "lightKeyAzimuth",
  "lightKeyElevation",
]);
const DIR_FILL_CHANGES = new Set([
  "lightFillEnabled",
  "lightFillColor",
  "lightFillIntensity",
  "lightFillAzimuth",
  "lightFillElevation",
]);
const DIR_RIM_CHANGES = new Set([
  "lightRimEnabled",
  "lightRimColor",
  "lightRimIntensity",
  "lightRimAzimuth",
  "lightRimElevation",
]);
const SPOT_CHANGES = new Set([
  "lightSpotEnabled",
  "lightSpotColor",
  "lightSpotIntensity",
  "lightSpotAngle",
  "lightSpotPenumbra",
  "lightSpotDistance",
  "lightSpotDecay",
]);
const VOL_PARAM_CHANGES = new Set([
  "lightVolumetricOpacity",
  "lightVolumetricFogPower",
  "lightVolumetricEdgeFade",
  "lightVolumetricBaseStrength",
  "lightVolumetricTipStrength",
]);

function hasAny(changed: Set<string>, keys: Set<string>): boolean {
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

  // 灯光对象
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private spotlight: THREE.SpotLight;
  private spotlightTarget: THREE.Object3D; // 隐形目标，SpotLight 瞄准

  // 体积光锥（ADR-177：实现下沉 VolumetricCone，本类仅委派）
  private cone: VolumetricCone;

  // [ADR-246 D3] 聚光灯线框 helper（空间参照：锥角/朝向/位置一眼可见）
  private spotHelper: THREE.SpotLightHelper;

  // [light-gizmo] 方向光灯可视化辅助（key/fill/rim）：开关 + 来向一眼可见，与 spotHelper 同生命周期
  private keyHelper: THREE.DirectionalLightHelper;
  private fillHelper: THREE.DirectionalLightHelper;
  private rimHelper: THREE.DirectionalLightHelper;

  // ADR-085 S2：记录当前预设名，消灭 fillLighting 启发式派生
  private currentPreset: ModelType = "default";
  /** 手动 preset 记忆（light-preset select 显式选择；非空时自动套模型预设不覆盖——[doc:adr-126-p5] 手动优先） */
  private manualPreset: ModelType | null = null;

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

    // 从 envState 读取初始值（ADR-196：真值源迁移）
    this.keyLight = this.createDirectional(readDirParams("key"));
    this.fillLight = this.createDirectional(readDirParams("fill"));
    this.rimLight = this.createDirectional(readDirParams("rim"));
    // [light-gizmo] 三盏方向光灯各配一个 DirectionalLightHelper（颜色区分），visible 绑 enabled，
    // 让「开/关 + 从哪照来」一眼可见——此前方向光无任何空间锚点，开关只能靠模型受光变化猜。
    this.keyHelper = this.createDirHelper(
      this.keyLight,
      DIR_HELPER_COLORS.key,
      "ysm-light-key-helper",
    );
    this.fillHelper = this.createDirHelper(
      this.fillLight,
      DIR_HELPER_COLORS.fill,
      "ysm-light-fill-helper",
    );
    this.rimHelper = this.createDirHelper(
      this.rimLight,
      DIR_HELPER_COLORS.rim,
      "ysm-light-rim-helper",
    );
    this.ambientLight = new THREE.AmbientLight(
      envState.lightAmbientColor,
      envState.lightAmbientIntensity,
    );

    // 聚光灯：位于对象正上方，向下照射
    const sp = readSpotParams();
    this.spotlight = new THREE.SpotLight(
      sp.color,
      sp.intensity,
      sp.distance,
      THREE.MathUtils.degToRad(sp.angle),
      sp.penumbra,
      sp.decay,
    );
    this.spotlight.position.set(this.target.x, this.target.y + this.targetHeight, this.target.z);
    this.spotlightTarget = new THREE.Object3D();
    this.spotlightTarget.name = "ysm-light-spot-target";
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.target = this.spotlightTarget;
    // 校正：构造期未应用 enabled → spotlight.visible 默认 true（UI 关灯却仍亮，直到首次 env 变更才同步）。
    // 与 createDirectional 补齐 visible 同源；applySpotlightToThree 内统一重算强度。
    this.spotlight.visible = sp.enabled;

    // 初始化体积光锥（ADR-177：委派 VolumetricCone；未同时启用则不产出锥组）
    this.cone = new VolumetricCone(this.scene);
    this.cone.rebuild(this.targetHeight, sp, readVolParams(), this.spotlight.position);

    // [ADR-246 D3] 聚光灯线框 helper：空间参照（调锥角时看得见锥在哪）。
    // 初始按 envState 的聚光灯开关定显隐；apply() 时挂场景，detach() 时移除。
    this.spotHelper = new THREE.SpotLightHelper(this.spotlight);
    this.spotHelper.name = "ysm-light-spot-helper";
    this.spotHelper.visible = envState.lightSpotEnabled;

    // ADR-196：订阅 envState 变更 → 分派到 Three 应用（只接收 light 组的键）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, state) => {
        this.onEnvChanged(changed, state);
      },
      "light",
    );
  }

  /* ----- envState 变更回调：分派到 Three 应用 ----- */

  private onEnvChanged(changed: Set<string>, state: EnvState): void {
    // key/fill/rim 方向灯
    if (hasAny(changed, DIR_KEY_CHANGES)) {
      this.updateDirectional(this.keyLight, readDirParams("key", state));
      this.syncDirHelper(this.keyHelper, readDirParams("key", state));
    }
    if (hasAny(changed, DIR_FILL_CHANGES)) {
      this.updateDirectional(this.fillLight, readDirParams("fill", state));
      this.syncDirHelper(this.fillHelper, readDirParams("fill", state));
    }
    if (hasAny(changed, DIR_RIM_CHANGES)) {
      this.updateDirectional(this.rimLight, readDirParams("rim", state));
      this.syncDirHelper(this.rimHelper, readDirParams("rim", state));
    }

    // ambient：总是刷新（依赖 caps 查询器的 sky 环境开关，非纯 envState 派生）
    this.refreshAmbientFromSky(state);

    // spotlight → 应用属性 + rebuild 锥组 + 挂载态
    if (hasAny(changed, SPOT_CHANGES)) {
      this.applySpotlightToThree(state);
      this.cone.rebuild(
        this.targetHeight,
        readSpotParams(state),
        readVolParams(state),
        this.spotlight.position,
      );
      if (state.lightVolumetricEnabled && state.lightSpotEnabled) {
        if (!this.cone.isMounted()) this.cone.attach(this.spotlight.position);
      }
    }

    // volumetric → rebuild（若 volumetric 刚启用且 spotlight 已开）+ 更新 uniforms + 挂载态
    const volEnabledChanged = changed.has("lightVolumetricEnabled");
    if (volEnabledChanged && state.lightVolumetricEnabled && state.lightSpotEnabled) {
      // volumetric 从关到开且 spotlight 已开 → 需要 rebuild 锥组（spotlight 之前的 rebuild 因 volumetric 关跳过）
      this.cone.rebuild(
        this.targetHeight,
        readSpotParams(state),
        readVolParams(state),
        this.spotlight.position,
      );
    } else if (volEnabledChanged || hasAny(changed, VOL_PARAM_CHANGES)) {
      this.cone.updateUniforms(readSpotParams(state), readVolParams(state));
    }
    if (volEnabledChanged) {
      if (state.lightVolumetricEnabled && state.lightSpotEnabled && this.cone.hasGroup()) {
        if (!this.cone.isMounted()) this.cone.attach(this.spotlight.position);
      } else {
        if (this.cone.isMounted()) this.cone.detach();
      }
    }
  }

  /* ----- 方向灯方向更新 ----- */

  private createDirectional(p: DirectionalLightParams): THREE.DirectionalLight {
    const dl = new THREE.DirectionalLight(p.color, p.intensity);
    dl.position.copy(lightDirToPosition(p, 5));
    dl.visible = p.enabled;
    return dl;
  }

  private updateDirectional(light: THREE.DirectionalLight, p: DirectionalLightParams): void {
    light.color.setHex(p.color);
    light.intensity = p.intensity;
    light.position.copy(lightDirToPosition(p, 5));
    light.visible = p.enabled;
  }

  /** 方向光灯 helper 工厂：size=2 的线框（灯位 → 目标），配色区分三盏灯 */
  private createDirHelper(
    light: THREE.DirectionalLight,
    color: number,
    name: string,
  ): THREE.DirectionalLightHelper {
    const h = new THREE.DirectionalLightHelper(light, 2, color);
    h.name = name;
    h.visible = light.visible;
    return h;
  }

  /** 方向光灯 helper 显隐跟随 enabled，并在方向/位置变化后重算几何（与 spotHelper.update 同语义） */
  private syncDirHelper(h: THREE.DirectionalLightHelper, p: DirectionalLightParams): void {
    h.visible = p.enabled;
    h.update();
  }

  /* ----- 公共 API ----- */

  apply(): void {
    if (!this.enabled) {
      this.detach();
      return;
    }
    if (!this.keyLight.parent) this.scene.add(this.keyLight);
    if (!this.fillLight.parent) this.scene.add(this.fillLight);
    if (!this.rimLight.parent) this.scene.add(this.rimLight);
    if (!this.ambientLight.parent) this.scene.add(this.ambientLight);
    // DirectionalLight.target 默认 Object3D(0,0,0)，没 add 到 scene 时 light.shadow.camera 不会跟随 target 位置更新
    // （shadow 需要 target 在 scene 图里，才能在世界坐标内正确定向 shadow frustum）
    if (!this.keyLight.target.parent) this.scene.add(this.keyLight.target);
    if (!this.fillLight.target.parent) this.scene.add(this.fillLight.target);
    if (!this.rimLight.target.parent) this.scene.add(this.rimLight.target);
    if (this.spotlightTarget && !this.spotlightTarget.parent) this.scene.add(this.spotlightTarget);
    if (!this.spotlight.parent) this.scene.add(this.spotlight);
    // [ADR-246 D3] helper 与聚光灯同生命周期挂场景
    if (!this.spotHelper.parent) this.scene.add(this.spotHelper);
    this.spotHelper.visible = envState.lightSpotEnabled;
    this.spotHelper.update();
    // [light-gizmo] 方向光灯 helper 与方向光灯同生命周期挂场景，visible 随 envState 开关
    if (!this.keyHelper.parent) this.scene.add(this.keyHelper);
    if (!this.fillHelper.parent) this.scene.add(this.fillHelper);
    if (!this.rimHelper.parent) this.scene.add(this.rimHelper);
    this.keyHelper.visible = envState.lightKeyEnabled;
    this.fillHelper.visible = envState.lightFillEnabled;
    this.rimHelper.visible = envState.lightRimEnabled;
    this.keyHelper.update();
    this.fillHelper.update();
    this.rimHelper.update();
    if (envState.lightVolumetricEnabled && envState.lightSpotEnabled && this.cone.hasGroup()) {
      if (!this.cone.isMounted()) this.cone.attach(this.spotlight.position);
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
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.position.set(this.target.x, this.target.y + this.targetHeight, this.target.z);
    if (this.cone.hasGroup()) {
      this.cone.syncPosition(this.spotlight.position);
    }
    // [ADR-246 D3] 聚光灯移位后线框同步（否则 helper 停在旧位置误导）
    this.spotHelper.update();
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  /* ShadowCapability 跨能力协作：取得当前挂到场景的方向灯（3 盏）与聚光灯，统一设置 shadow 参数；
   * 不返回内部引用副本，避免 ShadowCapability 直接写 private 字段。 */
  getDirectionalLights(): THREE.DirectionalLight[] {
    return [this.keyLight, this.fillLight, this.rimLight];
  }
  getSpotLight(): THREE.SpotLight {
    return this.spotlight;
  }

  setTargetHeight(h: number): void {
    this.targetHeight = h;
    this.spotlight.position.set(this.target.x, this.target.y + h, this.target.z);
    // rebuildCone 会 dispose 旧锥组并换成全新实例（新实例默认脱离场景），故先记挂载态，
    // 重建后按原状态回挂 + 重新定位——否则挂载态下改高度会让体积光锥凭空消失。
    // 只恢复「重建前已挂载」的情形，不凭空新增挂载（未开启体积光时不应出现锥组）。
    const wasMounted = this.cone.isMounted();
    this.cone.rebuild(
      this.targetHeight,
      readSpotParams(),
      readVolParams(),
      this.spotlight.position,
    );
    if (wasMounted && this.cone.hasGroup()) this.cone.attach(this.spotlight.position);
    // [ADR-246 D3] 高度变化 → 聚光灯移位 → 线框同步
    this.spotHelper.update();
    // 聚光灯移位后到目标的物理距离变化 → 重算 candela 补偿（否则目标处照度随高度漂移）
    this.applySpotlightToThree();
  }

  /** 按模型类别套用预设；opts.manual（light-preset select 入口）记手动选择——手动优先 */
  applyModelPreset(modelType: ModelType, opts?: { manual?: boolean }): void {
    if (opts?.manual) {
      this.manualPreset = modelType;
    } else if (this.manualPreset) {
      return; // [doc:adr-126-p5] 自动套模型预设被手动选择压制
    }
    this.currentPreset = modelType; // ADR-085 S2：记录真实预设名
    // ADR-196：统一数据源 MODEL_DEFAULTS，表驱动挑选 light 相关键写入 envState
    // ambient 排除（测试契约「ambient 不在合并范围，保留」）：键表刻意不含
    // lightAmbientColor/Intensity，切模型不静默重置用户 ambient 微调。
    const picked = pickModelDefaultFields(modelType, [
      "lightKeyEnabled",
      "lightKeyColor",
      "lightKeyIntensity",
      "lightKeyAzimuth",
      "lightKeyElevation",
      "lightFillEnabled",
      "lightFillColor",
      "lightFillIntensity",
      "lightFillAzimuth",
      "lightFillElevation",
      "lightRimEnabled",
      "lightRimColor",
      "lightRimIntensity",
      "lightRimAzimuth",
      "lightRimElevation",
      "lightSpotEnabled",
      "lightSpotColor",
      "lightSpotIntensity",
      "lightSpotAngle",
      "lightSpotPenumbra",
      "lightSpotDistance",
      "lightSpotDecay",
      "lightVolumetricEnabled",
      "lightVolumetricOpacity",
      "lightVolumetricFogPower",
      "lightVolumetricEdgeFade",
      "lightVolumetricBaseStrength",
      "lightVolumetricTipStrength",
    ]);
    if (Object.keys(picked).length > 0) {
      // source 双轨：自动套模型预设走 "auto-model"（与 sky/fog/shadow 同语义，
      // 后续 auto-atmosphere 可再覆盖——写 "manual" 会让预设永久压制昼夜循环，
      // env-state.shouldOverwrite manual 优先级最高，锐评 §二 行为 bug）；
      // opts.manual（light-preset select 用户显式选择 / loadState 恢复）才写 "manual"。
      setEnvState(picked, { source: opts?.manual ? "manual" : "auto-model" });
    }
  }

  /**
   * 锥组挂载态与当前 envState 同步（applyModelPreset / loadState 复用）。
   * 只在锥组已挂载时处理卸载与定位。
   */
  private syncConeMount(): void {
    if (this.cone.hasGroup() && this.cone.isMounted()) {
      if (!envState.lightVolumetricEnabled || !envState.lightSpotEnabled) {
        this.cone.detach();
      }
      this.cone.syncPosition(this.spotlight.position);
    }
  }

  /** 聚光灯参数更新（经 envState） */
  setSpotlight(p: Partial<SpotlightParams>): void {
    setEnvState(flattenLightParams({ spotlight: p }), { source: "manual" });
    // callback 处理 Three 应用 + rebuild + 挂载态
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

  /** 当前预设名（ADR-085 S2：fillLighting 只读初始化，消灭启发式派生） */
  getCurrentPreset(): string {
    return this.currentPreset;
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（能力总开关）-------- */
  /** 能力总开关节点 id（light-enabled）：已升场景组根视图 headerToggle +
   *  面板首行统一经 filter 移除（复用 envCapSubNodes 同一剔除逻辑，防一二级双份）。 */
  getMasterNodeId(): string {
    return "light-enabled";
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
      currentPreset: this.currentPreset,
      manualPreset: this.manualPreset,
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    // ① 预设先套用（内含锥组挂载判定）。必须在灯开关恢复之前：
    //    预设以 envState 为准，后恢复的开关才会生效。
    if (typeof state.manualPreset === "string") {
      // [doc:adr-126-p5] 手动优先跨会话保持（重建/刷新不丢）；存储串经 toModelType
      // 校验（脏数据回退 default），不裸 cast
      this.manualPreset = toModelType(state.manualPreset);
      this.applyModelPreset(this.manualPreset, { manual: true });
    } else if (typeof state.currentPreset === "string") {
      this.applyModelPreset(toModelType(state.currentPreset));
    }
    // ② 用户显式保存的灯开关 + ②.b 全量参数恢复（纯数据映射，下沉 light-persist.ts；
    //    顺序敏感：必须在预设套用之后——后恢复的用户值优先于预设，ADR-126 P5 同口径）
    restoreLightParams(state);
    // ③ 开关被覆盖回用户值后，锥组挂载态需随之同步
    this.syncConeMount();
    // ④ 锥组按恢复后的 params 重建 + 挂载（[ADR-246 D1] 原「引擎恢复」步骤删除——
    //    单引擎后无引擎维度；此处只按用户保存的 volumetric/spotlight 双开态决定，
    //    不强制翻转任何开关）。
    if (envState.lightVolumetricEnabled && envState.lightSpotEnabled) {
      this.cone.rebuild(
        this.targetHeight,
        readSpotParams(),
        readVolParams(),
        this.spotlight.position,
      );
      if (this.cone.hasGroup() && !this.cone.isMounted()) {
        this.cone.attach(this.spotlight.position);
      }
    }
    // ⑤ helper 挂场景 + 显隐随恢复后的聚光灯开关。
    //    显式挂载（不复用「组合根随后必调 apply()」的隐式约定——单独 loadState 的路径
    //    会静默缺少 helper）。
    if (!this.spotHelper.parent) this.scene.add(this.spotHelper);
    this.spotHelper.visible = envState.lightSpotEnabled;
    this.spotHelper.update();
    // [light-gizmo] 方向光灯 helper 挂场景 + 显隐随恢复后的开关（单独 loadState 路径也会静默缺 helper）
    if (!this.keyHelper.parent) this.scene.add(this.keyHelper);
    if (!this.fillHelper.parent) this.scene.add(this.fillHelper);
    if (!this.rimHelper.parent) this.scene.add(this.rimHelper);
    this.keyHelper.visible = envState.lightKeyEnabled;
    this.fillHelper.visible = envState.lightFillEnabled;
    this.rimHelper.visible = envState.lightRimEnabled;
    this.keyHelper.update();
    this.fillHelper.update();
    this.rimHelper.update();
  }

  /** sky 环境光开关变化时重算 ambient（防 ×0.5 衰减过期——sky.setEnvironmentEnabled 侧调；
   *  也由 callback 复用——ambient 应用单一出口，预览/截图同构）。
   *  sky 环境开关经构造注入的查询器读取（全局版 isSkyEnvironmentOn 在组合根 registry）；
   *  让位系数/公式走 attenuateAmbientForSky 单源 */
  refreshAmbientFromSky(state: EnvState = envState): void {
    const skyEnvOn = getTypedCap(this.caps, "sky")?.isEnvironmentEnabled() ?? false;
    this.ambientLight.color.setHex(state.lightAmbientColor);
    this.ambientLight.intensity = attenuateAmbientForSky(state.lightAmbientIntensity, skyEnvOn);
  }

  private applySpotlightToThree(state: EnvState = envState): void {
    this.spotlight.color.setHex(state.lightSpotColor);
    // 单位补偿：UI intensity 语义 = 「到达目标处的照度(lx)」（所见即所得）；
    // 物理模式 SpotLight 单位是坎德拉，须除以到目标的衰减系数。聚光灯固定在 target 正上方，
    // 距离 = 聚光灯→目标距离（随 setTargetHeight 改变，本函数在其后调用，天然跟随，不再漂移）。
    const d = Math.max(this.spotlight.position.distanceTo(this.spotlightTarget.position), 0.01);
    const falloff = spotDistanceAttenuation(d, state.lightSpotDistance, state.lightSpotDecay);
    this.spotlight.intensity =
      falloff > 0 ? state.lightSpotIntensity / falloff : state.lightSpotIntensity;
    this.spotlight.distance = state.lightSpotDistance;
    this.spotlight.angle = THREE.MathUtils.degToRad(state.lightSpotAngle);
    this.spotlight.penumbra = state.lightSpotPenumbra;
    this.spotlight.decay = state.lightSpotDecay;
    this.spotlight.visible = state.lightSpotEnabled;
    // [ADR-246 D3] helper 跟随聚光灯开关显隐（关灯即收起线框，不残留误导性参照）；
    // 参数（angle/penumbra/distance）变化后必须 update() 才反映到线框几何。
    this.spotHelper.visible = state.lightSpotEnabled;
    this.spotHelper.update();
  }

  private detach(): void {
    [
      this.keyLight,
      this.fillLight,
      this.rimLight,
      this.ambientLight,
      this.keyLight?.target ?? null,
      this.fillLight?.target ?? null,
      this.rimLight?.target ?? null,
      this.spotlight,
      this.spotlightTarget,
      this.spotHelper,
      this.keyHelper,
      this.fillHelper,
      this.rimHelper,
    ]
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
    this.spotHelper.dispose();
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    this.ambientLight.dispose();
    this.spotlight.dispose();
    // [light-gizmo] helper 释放（几何/材质归 three，dispose 幂等）
    this.keyHelper.dispose();
    this.fillHelper.dispose();
    this.rimHelper.dispose();
    // R1-P2-6：spotlightTarget 是隐形 Object3D（无几何/材质），detach 已从场景移除；
    // 显式置空引用，防止后续误用
    this.spotlightTarget = deferred<THREE.Object3D>();
  }
}
