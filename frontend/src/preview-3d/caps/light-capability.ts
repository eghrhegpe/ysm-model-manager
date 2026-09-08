// ===== LightCapability — 3D 预览个人灯光系统（ADR-177 编排器）=====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。后续可平滑升级 post-process 体积光管线。
//
// 职责拆分（ADR-177，2026-09-04）：
//   - 灯光对象管理（key/fill/rim/ambient/spotlight + 阴影协作）保留本类（核心职责①）
//   - 体积光锥体② → light-cone.ts（VolumetricCone）
//   - 预设数据③ → light-presets.ts（经 export * 重导出，外部 import 零改动）
//   - 嵌套 ↔ 扁平参数映射 flattenLightParams → light-presets.ts（P3 下沉：纯映射样板，不触 cap 状态）
//   - 菜单 UI 定义④ → light-controls.ts（getLightMenuControls）
//   - 状态持久化⑤ 保留本类（触达大量私有字段，顺序语义敏感）
//
// 设计要点（对齐 SkyCapability / GroundCapability 的能力模式）：
//   - 默认经典三点布光（key/fill/rim DirectionalLight）+ AmbientLight
//   - Spotlight 从对象正上方打下（聚光灯），cone + penumbra 可调
//   - 体积光锥：两交叉 PlaneGeometry + Cone 遮罩 shader（轻量，无 post-process 管线）
//   - 按模型类别预设（对齐 SkyCapability.setPreset 模式）
//   - 预留 setVolumetricEngine("cone" | "postprocess") 枚举，后续升级不动对外 API
//   - 本类不持有 backend 引用，纯 Three.js 侧逻辑
//   - target（对象中心）可动态更新，聚光灯 + 体积光锥随之重新定位
//   - ADR-196 刀2：参数真值源从 this.params 迁到 envState 单例

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import { MODEL_DEFAULTS } from "@/preview-3d/state/model-defaults.ts";
import { VolumetricCone } from "./light-cone.ts";
import { buildLightNodes } from "./light-controls.ts";
import {
  type DeepPartial,
  type DirectionalLightParams,
  flattenLightParams,
  type LightParams,
  type SpotlightParams,
  type VolumetricParams,
} from "./light-presets.ts";
import {
  persistState,
  restoreState,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";

/** 本文件导出的全部参数类型 / 预设数据均来自 light-presets.ts，重导出以维持外部 import 零改动 */
export * from "./light-presets.ts";

/** 角度(度)→弧度；内联等价 THREE.MathUtils.degToRad，避免对 three 测试 mock 强依赖 MathUtils 导出 */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** 方位角 + 仰角 → 3D 位置（radius 为单位长度；预览灯光与截图渲染共用同一套公式——光系统统一性） */
export function lightDirToPosition(p: DirectionalLightParams, radius: number): THREE.Vector3 {
  const az = degToRad(p.azimuth);
  const el = degToRad(p.elevation);
  const h = radius * Math.cos(el); // 水平分量
  const y = radius * Math.sin(el); // 垂直分量
  return new THREE.Vector3(h * Math.sin(az), y, h * Math.cos(az));
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

export class LightCapability implements SceneCapability {
  readonly id = "light";
  readonly labelKey = "preview.lighting";
  readonly icon = "💡";
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

  // 体积光锥引擎（运行时态，不入 envState）
  private volumetricEngine: "cone" | "postprocess" = "cone";

  // ADR-085 S2：记录当前预设名，消灭 fillLighting 启发式派生
  private currentPreset: string = "default";
  /** 手动 preset 记忆（light-preset select 显式选择；非空时自动套模型预设不覆盖——[doc:adr-126-p5] 手动优先） */
  private manualPreset: string | null = null;

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
      degToRad(sp.angle),
      sp.penumbra,
      sp.decay,
    );
    this.spotlight.position.set(this.target.x, this.target.y + this.targetHeight, this.target.z);
    this.spotlightTarget = new THREE.Object3D();
    this.spotlightTarget.name = "ysm-light-spot-target";
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.target = this.spotlightTarget;

    // 初始化体积光锥（ADR-177：委派 VolumetricCone；未同时启用则不产出锥组）
    this.cone = new VolumetricCone(this.scene);
    this.cone.rebuild(this.targetHeight, sp, readVolParams(), this.spotlight.position);

    // ADR-196：订阅 envState 变更 → 分派到 Three 应用
    this.unsubscribeEnv = registerEnvCallback(this, (changed, state) => {
      this.onEnvChanged(changed, state);
    });
  }

  /* ----- envState 变更回调：分派到 Three 应用 ----- */

  private onEnvChanged(changed: Set<string>, state: EnvState): void {
    // key/fill/rim 方向灯
    if (hasAny(changed, DIR_KEY_CHANGES)) {
      this.updateDirectional(this.keyLight, readDirParams("key", state));
    }
    if (hasAny(changed, DIR_FILL_CHANGES)) {
      this.updateDirectional(this.fillLight, readDirParams("fill", state));
    }
    if (hasAny(changed, DIR_RIM_CHANGES)) {
      this.updateDirectional(this.rimLight, readDirParams("rim", state));
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
    return dl;
  }

  private updateDirectional(light: THREE.DirectionalLight, p: DirectionalLightParams): void {
    light.color.setHex(p.color);
    light.intensity = p.intensity;
    light.position.copy(lightDirToPosition(p, 5));
    light.visible = p.enabled;
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
  }

  /** 按模型类别套用预设；opts.manual（light-preset select 入口）记手动选择——手动优先 */
  applyModelPreset(modelType: string, opts?: { manual?: boolean }): void {
    if (opts?.manual) {
      this.manualPreset = modelType;
    } else if (this.manualPreset) {
      return; // [doc:adr-126-p5] 自动套模型预设被手动选择压制
    }
    const preset =
      MODEL_DEFAULTS[modelType as keyof typeof MODEL_DEFAULTS] ?? MODEL_DEFAULTS.default;
    this.currentPreset = modelType; // ADR-085 S2：记录真实预设名
    // ADR-196：统一数据源 MODEL_DEFAULTS；读所有 light 相关键写入 envState。
    const partial: Partial<EnvState> = {};
    const src = preset as Record<string, unknown>;
    for (const key of [
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
      // code_review 80e6379dd #3（P2）：ambient 排除——旧 LIGHT_PRESETS 合并范围
      // 刻意不含 ambient（测试契约「ambient 不在合并范围，保留」，用户可调滑杆），
      // 新 30 键表曾含 lightAmbientColor/Intensity → 切模型静默重置用户 ambient 微调
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
    ] as const) {
      if (src[key] !== undefined) (partial as Record<string, unknown>)[key] = src[key];
    }
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "manual" });
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

  /** 切换体积光锥引擎（预留：当前仅 "cone"） */
  setVolumetricEngine(engine: "cone" | "postprocess"): void {
    this.volumetricEngine = engine;
    if (engine === "postprocess") {
      // postprocess 模式暂不渲染体积光锥，同步关闭 volumetric.enabled 避免 toggle 状态矛盾
      setEnvState({ lightVolumetricEnabled: false }, { source: "manual" });
      // callback 处理 detach
    } else if (engine === "cone" && envState.lightSpotEnabled) {
      // 切回 cone：重新启用 volumetric 并重建锥组
      setEnvState({ lightVolumetricEnabled: true }, { source: "manual" });
      // callback 处理 rebuild + attach
    }
  }

  getVolumetricEngine(): "cone" | "postprocess" {
    return this.volumetricEngine;
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

  /** 完整参数面板节点树：light-key 平铺 toggle + 参数组 folder（8 控件）。
   *  light 无能力总开关（无 getMasterToggle）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildLightNodes(this);
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      keyEnabled: envState.lightKeyEnabled,
      fillEnabled: envState.lightFillEnabled,
      rimEnabled: envState.lightRimEnabled,
      // 方向灯全量持久化（azimuth/elevation/color/intensity），跨会话不丢方向/强度/颜色
      key: {
        enabled: envState.lightKeyEnabled,
        color: envState.lightKeyColor,
        intensity: envState.lightKeyIntensity,
        azimuth: envState.lightKeyAzimuth,
        elevation: envState.lightKeyElevation,
      },
      fill: {
        enabled: envState.lightFillEnabled,
        color: envState.lightFillColor,
        intensity: envState.lightFillIntensity,
        azimuth: envState.lightFillAzimuth,
        elevation: envState.lightFillElevation,
      },
      rim: {
        enabled: envState.lightRimEnabled,
        color: envState.lightRimColor,
        intensity: envState.lightRimIntensity,
        azimuth: envState.lightRimAzimuth,
        elevation: envState.lightRimElevation,
      },
      ambient: {
        color: envState.lightAmbientColor,
        intensity: envState.lightAmbientIntensity,
      },
      spotlight: {
        enabled: envState.lightSpotEnabled,
        color: envState.lightSpotColor,
        intensity: envState.lightSpotIntensity,
        angle: envState.lightSpotAngle,
        penumbra: envState.lightSpotPenumbra,
        distance: envState.lightSpotDistance,
        decay: envState.lightSpotDecay,
      },
      volumetric: {
        enabled: envState.lightVolumetricEnabled,
        opacity: envState.lightVolumetricOpacity,
        fogPower: envState.lightVolumetricFogPower,
        edgeFade: envState.lightVolumetricEdgeFade,
        baseStrength: envState.lightVolumetricBaseStrength,
        tipStrength: envState.lightVolumetricTipStrength,
      },
      volumetricEngine: this.volumetricEngine,
      currentPreset: this.currentPreset,
      manualPreset: this.manualPreset,
    });
  }

  /** 从 localStorage 恢复状态 */
  /** 恢复方向灯全量字段（key/fill/rim），逐字段 typeof 校验后写入 envState。 */
  private restoreDir(which: "key" | "fill" | "rim", saved: unknown): void {
    if (!saved || typeof saved !== "object") return;
    const s = saved as Record<string, unknown>;
    const prefix = `light${which.charAt(0).toUpperCase()}${which.slice(1)}`;
    const assignments: Record<string, unknown> = {};
    if (typeof s.enabled === "boolean") assignments[`${prefix}Enabled`] = s.enabled;
    if (typeof s.color === "number") assignments[`${prefix}Color`] = s.color;
    if (typeof s.intensity === "number") assignments[`${prefix}Intensity`] = s.intensity;
    if (typeof s.azimuth === "number") assignments[`${prefix}Azimuth`] = s.azimuth;
    if (typeof s.elevation === "number") assignments[`${prefix}Elevation`] = s.elevation;
    if (Object.keys(assignments).length > 0) {
      setEnvState(assignments as Partial<EnvState>, { source: "manual" });
    }
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.ambientIntensity === "number") {
      setEnvState({ lightAmbientIntensity: state.ambientIntensity }, { source: "manual" });
    }
    // ① 预设先套用（内含 rebuildCone / 锥组挂载判定）。必须在灯开关恢复之前：
    //    预设以 envState 为准，后恢复的开关才会生效。
    if (typeof state.manualPreset === "string") {
      this.manualPreset = state.manualPreset; // [doc:adr-126-p5] 手动优先跨会话保持（重建/刷新不丢）
      this.applyModelPreset(state.manualPreset, { manual: true });
    } else if (typeof state.currentPreset === "string") {
      this.applyModelPreset(state.currentPreset);
    }
    // ② 用户显式保存的灯开关优先于模型预设（ADR-126 P5「手动优先」同口径）。
    if (typeof state.keyEnabled === "boolean") {
      setEnvState({ lightKeyEnabled: state.keyEnabled }, { source: "manual" });
    }
    if (typeof state.fillEnabled === "boolean") {
      setEnvState({ lightFillEnabled: state.fillEnabled }, { source: "manual" });
    }
    if (typeof state.rimEnabled === "boolean") {
      setEnvState({ lightRimEnabled: state.rimEnabled }, { source: "manual" });
    }
    if (typeof state.spotlightEnabled === "boolean") {
      setEnvState({ lightSpotEnabled: state.spotlightEnabled }, { source: "manual" });
    }
    if (typeof state.volumetricEnabled === "boolean") {
      setEnvState({ lightVolumetricEnabled: state.volumetricEnabled }, { source: "manual" });
    }
    // ②.b 全量参数恢复
    this.restoreDir("key", state.key);
    this.restoreDir("fill", state.fill);
    this.restoreDir("rim", state.rim);
    if (state.ambient && typeof state.ambient === "object") {
      const amb = state.ambient as Record<string, unknown>;
      const assignments: Record<string, unknown> = {};
      if (typeof amb.intensity === "number") assignments.lightAmbientIntensity = amb.intensity;
      if (typeof amb.color === "number") assignments.lightAmbientColor = amb.color;
      if (Object.keys(assignments).length > 0) {
        setEnvState(assignments as Partial<EnvState>, { source: "manual" });
      }
    }
    if (state.spotlight && typeof state.spotlight === "object") {
      const sp = state.spotlight as Record<string, unknown>;
      const assignments: Record<string, unknown> = {};
      if (typeof sp.enabled === "boolean") assignments.lightSpotEnabled = sp.enabled;
      if (typeof sp.color === "number") assignments.lightSpotColor = sp.color;
      if (typeof sp.intensity === "number") assignments.lightSpotIntensity = sp.intensity;
      if (typeof sp.angle === "number") assignments.lightSpotAngle = sp.angle;
      if (typeof sp.penumbra === "number") assignments.lightSpotPenumbra = sp.penumbra;
      if (typeof sp.distance === "number") assignments.lightSpotDistance = sp.distance;
      if (typeof sp.decay === "number") assignments.lightSpotDecay = sp.decay;
      if (Object.keys(assignments).length > 0) {
        setEnvState(assignments as Partial<EnvState>, { source: "manual" });
      }
    }
    if (state.volumetric && typeof state.volumetric === "object") {
      const vm = state.volumetric as Record<string, unknown>;
      const assignments: Record<string, unknown> = {};
      if (typeof vm.enabled === "boolean") assignments.lightVolumetricEnabled = vm.enabled;
      if (typeof vm.opacity === "number") assignments.lightVolumetricOpacity = vm.opacity;
      if (typeof vm.fogPower === "number") assignments.lightVolumetricFogPower = vm.fogPower;
      if (typeof vm.edgeFade === "number") assignments.lightVolumetricEdgeFade = vm.edgeFade;
      if (typeof vm.baseStrength === "number") {
        assignments.lightVolumetricBaseStrength = vm.baseStrength;
      }
      if (typeof vm.tipStrength === "number") {
        assignments.lightVolumetricTipStrength = vm.tipStrength;
      }
      if (Object.keys(assignments).length > 0) {
        setEnvState(assignments as Partial<EnvState>, { source: "manual" });
      }
    }
    // ③ 开关被覆盖回用户值后，锥组挂载态需随之同步
    this.syncConeMount();
    // ④ 引擎最后恢复
    if (state.volumetricEngine === "postprocess") {
      this.setVolumetricEngine("postprocess");
    } else if (state.volumetricEngine === "cone") {
      this.volumetricEngine = "cone";
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
    }
  }

  /** sky 环境光开关变化时重算 ambient（防 ×0.5 衰减过期——sky.setEnvironmentEnabled 侧调；
   *  也由 callback 复用——ambient 应用单一出口，预览/截图同构）。
   *  sky 环境开关经构造注入的查询器读取（全局版 isSkyEnvironmentOn 在组合根 registry）；
   *  让位系数/公式走 attenuateAmbientForSky 单源 */
  refreshAmbientFromSky(state: EnvState = envState): void {
    const skyEnvOn =
      (
        this.caps?.getById("sky") as { isEnvironmentEnabled?: () => boolean } | null | undefined
      )?.isEnvironmentEnabled?.() ?? false;
    this.ambientLight.color.setHex(state.lightAmbientColor);
    this.ambientLight.intensity = attenuateAmbientForSky(state.lightAmbientIntensity, skyEnvOn);
  }

  private applySpotlightToThree(state: EnvState = envState): void {
    this.spotlight.color.setHex(state.lightSpotColor);
    this.spotlight.intensity = state.lightSpotIntensity;
    this.spotlight.distance = state.lightSpotDistance;
    this.spotlight.angle = degToRad(state.lightSpotAngle);
    this.spotlight.penumbra = state.lightSpotPenumbra;
    this.spotlight.decay = state.lightSpotDecay;
    this.spotlight.visible = state.lightSpotEnabled;
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
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    this.ambientLight.dispose();
    this.spotlight.dispose();
    // R1-P2-6：spotlightTarget 是隐形 Object3D（无几何/材质），detach 已从场景移除；
    // 显式置空引用，防止后续误用
    this.spotlightTarget = null as unknown as THREE.Object3D;
  }
}
