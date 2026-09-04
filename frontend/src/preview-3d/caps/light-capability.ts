// ===== LightCapability — 3D 预览个人灯光系统（ADR-177 编排器）=====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。后续可平滑升级 post-process 体积光管线。
//
// 职责拆分（ADR-177，2026-09-04）：
//   - 灯光对象管理（key/fill/rim/ambient/spotlight + 阴影协作）保留本类（核心职责①）
//   - 体积光锥体② → light-cone.ts（VolumetricCone）
//   - 预设数据③ → light-presets.ts（经 export * 重导出，外部 import 零改动）
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

import * as THREE from "three";
import { VolumetricCone } from "./light-cone.ts";
import { getLightMenuControls } from "./light-controls.ts";
import {
  DEFAULT_LIGHT_PARAMS,
  type DeepPartial,
  type DirectionalLightParams,
  deepMergeLightParams,
  LIGHT_PRESETS,
  type LightParams,
  type SpotlightParams,
  type VolumetricParams,
} from "./light-presets.ts";
import {
  type MenuControlDef,
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

export class LightCapability implements SceneCapability {
  readonly id = "light";
  readonly labelKey = "preview.lighting";
  readonly icon = "💡";
  readonly descKey = "preview.lightingDesc";

  private scene: THREE.Scene;
  private caps?: SceneCapabilityLookup;
  private params: LightParams;
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

  // 体积光锥引擎（预留：后续支持 postprocess 模式）
  private volumetricEngine: "cone" | "postprocess" = "cone";

  // ADR-085 S2：记录当前预设名，消灭 fillLighting 启发式派生
  private currentPreset: string = "default";
  /** 手动 preset 记忆（light-preset select 显式选择；非空时自动套模型预设不覆盖——[doc:adr-126-p5] 手动优先） */
  private manualPreset: string | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: DeepPartial<LightParams>;
    enabled?: boolean;
    target?: THREE.Vector3;
    targetHeight?: number;
    /** cap 间协调查询器（组合根 createAll 注入）——ambient 衰减读 sky 环境开关 */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    if (opts.caps !== undefined) this.caps = opts.caps;
    this.params = deepMergeLightParams(DEFAULT_LIGHT_PARAMS, opts.params ?? {});
    this.enabled = opts.enabled ?? true;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.targetHeight = opts.targetHeight ?? 8;

    this.keyLight = this.createDirectional(this.params.key);
    this.fillLight = this.createDirectional(this.params.fill);
    this.rimLight = this.createDirectional(this.params.rim);
    this.ambientLight = new THREE.AmbientLight(
      this.params.ambient.color,
      this.params.ambient.intensity,
    );

    // 聚光灯：位于对象正上方，向下照射
    this.spotlight = new THREE.SpotLight(
      this.params.spotlight.color,
      this.params.spotlight.intensity,
      this.params.spotlight.distance,
      degToRad(this.params.spotlight.angle),
      this.params.spotlight.penumbra,
      this.params.spotlight.decay,
    );
    this.spotlight.position.set(this.target.x, this.target.y + this.targetHeight, this.target.z);
    this.spotlightTarget = new THREE.Object3D();
    this.spotlightTarget.name = "ysm-light-spot-target";
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.target = this.spotlightTarget;

    // 初始化体积光锥（ADR-177：委派 VolumetricCone；未同时启用则不产出锥组）
    this.cone = new VolumetricCone(this.scene);
    this.cone.rebuild(
      this.targetHeight,
      this.params.spotlight,
      this.params.volumetric,
      this.spotlight.position,
    );
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
    if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.cone.hasGroup()) {
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
      this.params.spotlight,
      this.params.volumetric,
      this.spotlight.position,
    );
    if (wasMounted && this.cone.hasGroup()) this.cone.attach(this.spotlight.position);
  }

  /** 按模型类别套用预设；opts.manual（light-preset select 入口）记手动选择——手动优先 */
  setPreset(modelType: string, opts?: { manual?: boolean }): void {
    if (opts?.manual) {
      this.manualPreset = modelType;
    } else if (this.manualPreset) {
      return; // [doc:adr-126-p5] 自动套模型预设被手动选择压制（切模型/重建预览不覆盖用户偏好）
    }
    const preset = LIGHT_PRESETS[modelType] ?? LIGHT_PRESETS.default;
    this.currentPreset = modelType; // ADR-085 S2：记录真实预设名
    this.params = deepMergeLightParams(this.params, preset);
    this.syncLightsFromParams();
    this.cone.rebuild(
      this.targetHeight,
      this.params.spotlight,
      this.params.volumetric,
      this.spotlight.position,
    );
    this.syncConeMount();
  }

  /**
   * 锥组挂载态与当前 params 同步（setPreset / loadState 复用）。
   * 只在锥组已挂载时处理卸载与定位——挂载动作由 setSpotlight / setVolumetric /
   * setVolumetricEngine 负责（本方法不重挂：外层守卫已保证 cone 已挂载，
   * 曾经的 else-if 重挂分支是死代码，已删）。
   */
  private syncConeMount(): void {
    if (this.cone.hasGroup() && this.cone.isMounted()) {
      // 启用状态关闭 → 卸载（锥组仍在场景中时）
      if (!this.params.volumetric.enabled || !this.params.spotlight.enabled) {
        this.cone.detach();
      }
      this.cone.syncPosition(this.spotlight.position);
    }
  }

  /** 聚光灯参数更新 */
  setSpotlight(p: Partial<SpotlightParams>): void {
    Object.assign(this.params.spotlight, p);
    const sp = this.params.spotlight;
    this.spotlight.color.setHex(sp.color);
    this.spotlight.intensity = sp.intensity;
    this.spotlight.distance = sp.distance;
    this.spotlight.angle = degToRad(sp.angle);
    this.spotlight.penumbra = sp.penumbra;
    this.spotlight.decay = sp.decay;
    this.spotlight.visible = sp.enabled;
    this.cone.rebuild(
      this.targetHeight,
      this.params.spotlight,
      this.params.volumetric,
      this.spotlight.position,
    );
    if (this.cone.isMounted()) {
      this.cone.syncPosition(this.spotlight.position);
    } else if (this.params.volumetric.enabled) {
      this.cone.attach(this.spotlight.position);
    }
  }

  /** 体积光锥参数更新（含 enable/disable 切换） */
  setVolumetric(p: Partial<VolumetricParams>): void {
    Object.assign(this.params.volumetric, p);
    this.cone.updateUniforms(this.params.spotlight, this.params.volumetric);
    if (p.enabled !== undefined) {
      if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.cone.hasGroup()) {
        if (!this.cone.isMounted()) this.cone.attach(this.spotlight.position);
      } else {
        if (this.cone.isMounted()) this.cone.detach();
      }
    }
  }

  /** 切换体积光锥引擎（预留：当前仅 "cone"） */
  setVolumetricEngine(engine: "cone" | "postprocess"): void {
    this.volumetricEngine = engine;
    // postprocess 模式暂不渲染体积光锥，同步关闭 volumetric.enabled 避免 toggle 状态矛盾
    if (engine === "postprocess") {
      this.params.volumetric.enabled = false;
      if (this.cone.isMounted()) this.cone.detach();
    } else if (engine === "cone" && this.params.spotlight.enabled) {
      // 切回 cone：重新启用 volumetric 并重建锥组
      this.params.volumetric.enabled = true;
      this.cone.rebuild(
        this.targetHeight,
        this.params.spotlight,
        this.params.volumetric,
        this.spotlight.position,
      );
      if (this.cone.hasGroup() && !this.cone.isMounted()) {
        this.cone.attach(this.spotlight.position);
      }
    }
  }

  getVolumetricEngine(): "cone" | "postprocess" {
    return this.volumetricEngine;
  }

  /** 合并式参数更新（只覆盖给定字段） */
  setParams(p: DeepPartial<LightParams>): void {
    this.params = deepMergeLightParams(this.params, p);
    this.syncLightsFromParams();
    this.cone.rebuild(
      this.targetHeight,
      this.params.spotlight,
      this.params.volumetric,
      this.spotlight.position,
    );
    if (this.cone.hasGroup() && this.params.volumetric.enabled && this.params.spotlight.enabled) {
      if (!this.cone.isMounted()) this.cone.attach(this.spotlight.position);
    } else if (this.cone.isMounted()) {
      this.cone.detach();
    }
  }

  getParams(): LightParams {
    return deepMergeLightParams(DEFAULT_LIGHT_PARAMS, this.params);
  }

  /** 当前预设名（ADR-085 S2：fillLighting 只读初始化，消灭启发式派生） */
  getCurrentPreset(): string {
    return this.currentPreset;
  }

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return getLightMenuControls(this);
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      keyEnabled: this.params.key.enabled,
      fillEnabled: this.params.fill.enabled,
      rimEnabled: this.params.rim.enabled,
      // 方向灯全量持久化（azimuth/elevation/color/intensity），跨会话不丢方向/强度/颜色
      key: { ...this.params.key },
      fill: { ...this.params.fill },
      rim: { ...this.params.rim },
      // ambient color 也持久化（旧实现只存 intensity）
      ambient: { ...this.params.ambient },
      // spotlight 全量参数持久化（旧实现只存 enabled 布尔）
      spotlight: { ...this.params.spotlight },
      // volumetric 全量参数持久化（旧实现只存 enabled 布尔）
      volumetric: { ...this.params.volumetric },
      volumetricEngine: this.volumetricEngine,
      currentPreset: this.currentPreset,
      manualPreset: this.manualPreset,
    });
  }

  /** 从 localStorage 恢复状态 */
  /** 恢复方向灯全量字段（key/fill/rim），逐字段 typeof 校验后写入。 */
  private restoreDir(which: "key" | "fill" | "rim", saved: unknown): void {
    if (!saved || typeof saved !== "object") return;
    const s = saved as Record<string, unknown>;
    const dst = this.params[which];
    if (typeof s.enabled === "boolean") dst.enabled = s.enabled;
    if (typeof s.color === "number") dst.color = s.color;
    if (typeof s.intensity === "number") dst.intensity = s.intensity;
    if (typeof s.azimuth === "number") dst.azimuth = s.azimuth;
    if (typeof s.elevation === "number") dst.elevation = s.elevation;
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.ambientIntensity === "number")
      this.params.ambient.intensity = state.ambientIntensity;
    // ① 预设先套用（内含 rebuildCone / 锥组挂载判定）。必须在灯开关恢复之前：
    //    deepMergeLightParams(this.params, preset) 以预设为准，后恢复的开关才会生效。
    if (typeof state.manualPreset === "string") {
      this.manualPreset = state.manualPreset; // [doc:adr-126-p5] 手动优先跨会话保持（重建/刷新不丢）
      this.setPreset(state.manualPreset, { manual: true });
    } else if (typeof state.currentPreset === "string") {
      this.setPreset(state.currentPreset);
    }
    // ② 用户显式保存的灯开关优先于模型预设（ADR-126 P5「手动优先」同口径）。
    //    旧实现把这一步放在 setPreset 之前，导致开关被预设值静默覆盖——跨会话丢失。
    if (typeof state.keyEnabled === "boolean") this.params.key.enabled = state.keyEnabled;
    if (typeof state.fillEnabled === "boolean") this.params.fill.enabled = state.fillEnabled;
    if (typeof state.rimEnabled === "boolean") this.params.rim.enabled = state.rimEnabled;
    if (typeof state.spotlightEnabled === "boolean")
      this.params.spotlight.enabled = state.spotlightEnabled;
    if (typeof state.volumetricEnabled === "boolean")
      this.params.volumetric.enabled = state.volumetricEnabled;
    // ②.b 全量参数恢复（旧实现只存布尔/单一字段，跨会话丢方向/颜色/强度/锥角等）。
    //     字段名与 params 对象一致；逐字段 typeof 校验后写入，非法值跳过。
    //     不在此调 apply()：保持现有行为，依赖外部统一 apply。
    this.restoreDir("key", state.key);
    this.restoreDir("fill", state.fill);
    this.restoreDir("rim", state.rim);
    if (state.ambient && typeof state.ambient === "object") {
      const amb = state.ambient as Record<string, unknown>;
      if (typeof amb.intensity === "number") this.params.ambient.intensity = amb.intensity;
      if (typeof amb.color === "number") this.params.ambient.color = amb.color;
    }
    if (state.spotlight && typeof state.spotlight === "object") {
      const sp = state.spotlight as Record<string, unknown>;
      if (typeof sp.enabled === "boolean") this.params.spotlight.enabled = sp.enabled;
      if (typeof sp.color === "number") this.params.spotlight.color = sp.color;
      if (typeof sp.intensity === "number") this.params.spotlight.intensity = sp.intensity;
      if (typeof sp.angle === "number") this.params.spotlight.angle = sp.angle;
      if (typeof sp.penumbra === "number") this.params.spotlight.penumbra = sp.penumbra;
      if (typeof sp.distance === "number") this.params.spotlight.distance = sp.distance;
      if (typeof sp.decay === "number") this.params.spotlight.decay = sp.decay;
    }
    if (state.volumetric && typeof state.volumetric === "object") {
      const vm = state.volumetric as Record<string, unknown>;
      if (typeof vm.enabled === "boolean") this.params.volumetric.enabled = vm.enabled;
      if (typeof vm.opacity === "number") this.params.volumetric.opacity = vm.opacity;
      if (typeof vm.fogPower === "number") this.params.volumetric.fogPower = vm.fogPower;
      if (typeof vm.edgeFade === "number") this.params.volumetric.edgeFade = vm.edgeFade;
      if (typeof vm.baseStrength === "number")
        this.params.volumetric.baseStrength = vm.baseStrength;
      if (typeof vm.tipStrength === "number") this.params.volumetric.tipStrength = vm.tipStrength;
    }
    // ③ 开关被覆盖回用户值后，锥组挂载态需随之同步（setPreset 的判定基于覆盖前的预设值）
    this.syncConeMount();
    // ④ 引擎最后恢复：仅 "postprocess" 走 setVolumetricEngine——其「postprocess ⇒
    //    volumetric 关闭」一致性约束是有意的；"cone" 恢复引擎字段，且当恢复后的
    //    params 真启用（volumetric + spotlight 均开）时重建并挂载锥组——setVolumetricEngine
    //    的 cone 分支被弃用后，这是 loadState 中唯一的锥组挂载路径（审核复核 P1：
    //    纯字段赋值会让保存 volumetric=true 的会话在 loadState 后锥组静默消失）。
    //    不强制翻转 volumetric.enabled——只按②恢复的用户值判定，与「用户保存的
    //    开关优先」不变量一致。
    if (state.volumetricEngine === "postprocess") {
      this.setVolumetricEngine("postprocess");
    } else if (state.volumetricEngine === "cone") {
      this.volumetricEngine = "cone";
      if (this.params.volumetric.enabled && this.params.spotlight.enabled) {
        this.cone.rebuild(
          this.targetHeight,
          this.params.spotlight,
          this.params.volumetric,
          this.spotlight.position,
        );
        if (this.cone.hasGroup() && !this.cone.isMounted()) {
          this.cone.attach(this.spotlight.position);
        }
      }
    }
    this.syncLightsFromParams();
  }

  /** sky 环境光开关变化时重算 ambient（防 ×0.5 衰减过期——sky.setEnvironmentEnabled 侧调；
   *  也由 syncLightsFromParams 复用——ambient 应用单一出口，预览/截图同构）。
   *  sky 环境开关经构造注入的查询器读取（全局版 isSkyEnvironmentOn 在组合根 registry）；
   *  让位系数/公式走 attenuateAmbientForSky 单源 */
  refreshAmbientFromSky(): void {
    const skyEnvOn =
      (
        this.caps?.getById("sky") as { isEnvironmentEnabled?: () => boolean } | null | undefined
      )?.isEnvironmentEnabled?.() ?? false;
    this.ambientLight.color.setHex(this.params.ambient.color);
    this.ambientLight.intensity = attenuateAmbientForSky(this.params.ambient.intensity, skyEnvOn);
  }

  private syncLightsFromParams(): void {
    this.updateDirectional(this.keyLight, this.params.key);
    this.updateDirectional(this.fillLight, this.params.fill);
    this.updateDirectional(this.rimLight, this.params.rim);
    // [doc:adr-126-p5] 双间接光协调：PMREM 环境光（IBL）开启时 ambient 自动衰减（×0.5）——
    // 两套间接光叠加会过亮/互相稀释，环境贴图开则 ambient 让位（光系统统一性 #3）
    this.refreshAmbientFromSky();
    this.setSpotlight({ ...this.params.spotlight });
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
