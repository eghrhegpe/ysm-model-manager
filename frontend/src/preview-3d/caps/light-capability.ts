// ===== LightCapability — 3D 预览个人灯光系统 =====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。后续可平滑升级 post-process 体积光管线。
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
import {
  type SceneCapability,
  type SceneCapabilityLookup,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { safeDispose } from "../safe-dispose.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";

/** 角度(度)→弧度；内联等价 THREE.MathUtils.degToRad，避免对 three 测试 mock 强依赖 MathUtils 导出 */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** 递归 Partial：允许任意深度只传子集字段 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/* ============ 参数类型 ============ */

export interface DirectionalLightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 方位角（度，0=+X 东，90=+Z 南，180=-X 西，270=-Z 北；Y-up 坐标系） */
  azimuth: number;
  /** 仰角（度，0=水平，90=正上；负值=地面下） */
  elevation: number;
}

export interface AmbientLightParams {
  color: number;
  intensity: number;
}

export interface SpotlightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 锥角半角（度，越大越宽） */
  angle: number;
  /** 半影（0=硬边，1=全软边） */
  penumbra: number;
  /** 衰减距离 */
  distance: number;
  /** 衰减指数（0=无衰减，2=经典物理衰减） */
  decay: number;
}

export interface VolumetricParams {
  enabled: boolean;
  /** 最大透明度 */
  opacity: number;
  /** 空气散射幂次（越大衰减越陡，越集中底部） */
  fogPower: number;
  /** 边缘羽化（0=无，1=完全透明边缘） */
  edgeFade: number;
  /** 底部强度（光落在对象上） */
  baseStrength: number;
  /** 顶部强度（光源附近） */
  tipStrength: number;
}

export interface LightParams {
  key: DirectionalLightParams;
  fill: DirectionalLightParams;
  rim: DirectionalLightParams;
  ambient: AmbientLightParams;
  spotlight: SpotlightParams;
  volumetric: VolumetricParams;
}

/* ============ 默认值与预设 ============ */

const DEFAULT_KEY: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 1.2, azimuth: 30, elevation: 45,
};
const DEFAULT_FILL: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 0.4, azimuth: -30, elevation: 20,
};
const DEFAULT_RIM: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 0.3, azimuth: 180, elevation: 25,
};
const DEFAULT_AMBIENT: AmbientLightParams = { color: 0xffffff, intensity: 0.5 };
const DEFAULT_SPOTLIGHT: SpotlightParams = {
  enabled: false, color: 0xffffff, intensity: 2.0, angle: 25, penumbra: 0.3, distance: 30, decay: 1.5,
};
const DEFAULT_VOLUMETRIC: VolumetricParams = {
  enabled: false, opacity: 0.45, fogPower: 1.5, edgeFade: 0.4, baseStrength: 0.9, tipStrength: 0.25,
};

export const DEFAULT_LIGHT_PARAMS: LightParams = {
  key: { ...DEFAULT_KEY },
  fill: { ...DEFAULT_FILL },
  rim: { ...DEFAULT_RIM },
  ambient: { ...DEFAULT_AMBIENT },
  spotlight: { ...DEFAULT_SPOTLIGHT },
  volumetric: { ...DEFAULT_VOLUMETRIC },
};

/** 模型类别预设（对齐 SkyCapability.MODEL_SKY_PRESETS 模式） */
export const LIGHT_PRESETS: Record<string, Partial<LightParams>> = {
  default: { spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false }, volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false } },
  ysm: {
    // 方块哑光，rim增强方块边缘识别
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.45 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30, penumbra: 0.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4, fogPower: 1.2 },
  },
  vrm: {
    // PBR 角色，rim 稍强勾勒轮廓
    key: { ...DEFAULT_KEY, intensity: 1.0 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.6 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.5, angle: 28 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  mmd: {
    // toon 材质易过曝，整体降 30%
    key: { ...DEFAULT_KEY, intensity: 0.85 },
    fill: { ...DEFAULT_FILL, intensity: 0.3 },
    rim: { ...DEFAULT_RIM, intensity: 0.25 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  litematic: {
    // 体素，均匀光照
    key: { ...DEFAULT_KEY, intensity: 1.0, azimuth: 45, elevation: 60 },
    fill: { ...DEFAULT_FILL, intensity: 0.4, azimuth: -45, elevation: 30 },
    rim: { ...DEFAULT_RIM, intensity: 0.3, azimuth: 135, elevation: 30 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  "resourcepack": {
    // MC 方块/物品，顶光稍柔（alias for pack-model 兼容 adapter.id）
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.4 },
    rim: { ...DEFAULT_RIM, intensity: 0.35 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4 },
  },
  "mmd-scene": {
    // 场景模型：光照更均匀，体积光锥启用营造氛围
    key: { ...DEFAULT_KEY, intensity: 1.2 },
    fill: { ...DEFAULT_FILL, intensity: 0.55 },
    rim: { ...DEFAULT_RIM, intensity: 0.4 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.6, angle: 40, penumbra: 0.6 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.35, fogPower: 1.0 },
  },
};

/* ============ 体积光锥 shader（两交叉 PlaneGeometry + Cone 遮罩） ============ */

const VOLUMETRIC_CONE_VERT = `
  varying float vY;
  varying float vX;
  varying float vZ;
  void main() {
    vY = position.y;
    vX = position.x;
    vZ = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUMETRIC_CONE_FRAG = `
  precision highp float;
  varying float vY;
  varying float vX;
  varying float vZ;
  uniform vec3 uColor;
  uniform float uMaxAlpha;
  uniform float uFogPower;
  uniform float uEdgeFade;
  uniform float uHeight;
  uniform float uBaseRadius;
  uniform float uTipStrength;
  uniform float uBaseStrength;

  void main() {
    // h = 0 底部（base），h = 1 顶部（tip）
    float h = (vY + uHeight * 0.5) / uHeight;
    // 当前高度处锥面半径：底部 uBaseRadius → 顶部 0
    float rAtH = uBaseRadius * (1.0 - h);
    float d = sqrt(vX * vX + vZ * vZ);
    if (d > rAtH) discard;
    if (rAtH < 0.0001) discard; // 锥顶退化为点，无内容可渲染

    // 垂直强度：底部与顶部之间的插值
    float vertIntensity = mix(uBaseStrength, uTipStrength, h);
    // 空气散射（fog）：指数衰减从底部到顶部
    float airFalloff = exp(-uFogPower * h);
    // 径向羽化：中心 → 1.0，边缘 → (1 - edgeFade)
    float rNorm = d / rAtH;
    float radialFalloff = 1.0 - rNorm * uEdgeFade;

    float alpha = uMaxAlpha * vertIntensity * airFalloff * radialFalloff;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

interface VolumetricConeUniforms {
  uColor: { value: THREE.Color };
  uMaxAlpha: { value: number };
  uFogPower: { value: number };
  uEdgeFade: { value: number };
  uHeight: { value: number };
  uBaseRadius: { value: number };
  uTipStrength: { value: number };
  uBaseStrength: { value: number };
}

/* ============ LightCapability ============ */

function lcBuildMain(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-key",
      kind: "toggle",
      labelKey: "preview.keyLight",
      fallback: "主灯",
      getValue: () => cap.getParams().key.enabled,
      setValue: (v) => cap.setParams({ key: { enabled: v as boolean } }),
    },
  ];
}

function lcBuildSpotlight(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-fill",
      kind: "toggle",
      labelKey: "preview.fillLight",
      fallback: "补灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().fill.enabled,
      setValue: (v) => cap.setParams({ fill: { enabled: v as boolean } }),
    },
    {
      id: "light-rim",
      kind: "toggle",
      labelKey: "preview.rimLight",
      fallback: "轮廓灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().rim.enabled,
      setValue: (v) => cap.setParams({ rim: { enabled: v as boolean } }),
    },
    {
      id: "light-ambient",
      kind: "slider",
      labelKey: "preview.ambientIntensity",
      fallback: "环境光",
      group: "preview.lightGroupParams",
      slider: { min: 0, max: 2, step: 0.1 },
      getValue: () => cap.getParams().ambient.intensity,
      setValue: (v) => cap.setParams({ ambient: { intensity: v as number } }),
    },
    {
      id: "light-spotlight",
      kind: "toggle",
      labelKey: "preview.spotlight",
      fallback: "聚光灯",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().spotlight.enabled,
      setValue: (v) => cap.setSpotlight({ enabled: v as boolean }),
    },
  ];
}

function lcBuildVolumetric(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-volumetric",
      kind: "toggle",
      labelKey: "preview.volumetric",
      fallback: "体积光",
      group: "preview.lightGroupParams",
      getValue: () => cap.getParams().volumetric.enabled,
      setValue: (v) => cap.setVolumetric({ enabled: v as boolean }),
    },
    {
      id: "light-engine",
      kind: "select",
      labelKey: "preview.volumetricEngine",
      fallback: "锥引擎",
      group: "preview.lightGroupParams",
      select: [
        { value: "cone", label: "锥形" },
        { value: "postprocess", label: "后处理" },
      ],
      getValue: () => cap.getVolumetricEngine(),
      setValue: (v) => cap.setVolumetricEngine(v as "cone" | "postprocess"),
    },
    {
      id: "light-cone-angle",
      kind: "slider",
      labelKey: "preview.coneAngle",
      fallback: "锥角",
      group: "preview.lightGroupParams",
      slider: { min: 10, max: 60, step: 1, unit: "°" },
      getValue: () => cap.getParams().spotlight.angle,
      setValue: (v) => cap.setSpotlight({ angle: v as number }),
    },
  ];
}

function lcBuildThreePoint(cap: LightCapability): MenuControlDef[] {
  return [
    {
      id: "light-preset",
      kind: "select",
      labelKey: "preview.lightPreset",
      fallback: "灯光预设",
      group: "preview.lightGroupParams",
      select: [
        { value: "default", label: "默认" },
        { value: RESOURCE_TYPES.YSM, label: "YSM方块" },
        { value: "vrm", label: "VRM角色" },
        { value: "mmd", label: "MMD角色" },
        { value: "litematic", label: "体素" },
        { value: "resourcepack", label: "MC块包" },
      ],
      getValue: () => cap.getCurrentPreset(),
      setValue: (v) => cap.setPreset(v as string, { manual: true }),
    },
  ];
}

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
  private targetHeight: number;  // 聚光灯位于对象上方的高度

  // 灯光对象
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private spotlight: THREE.SpotLight;
  private spotlightTarget: THREE.Object3D; // 隐形目标，SpotLight 瞄准

  // 体积光锥
  private coneGroup: THREE.Group | null = null;
  private coneUniforms: VolumetricConeUniforms | null = null;
  private coneMaterial: THREE.ShaderMaterial | null = null;
  private coneHeight = 0;

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
    this.ambientLight = new THREE.AmbientLight(this.params.ambient.color, this.params.ambient.intensity);

    // 聚光灯：位于对象正上方，向下照射
    this.spotlight = new THREE.SpotLight(
      this.params.spotlight.color,
      this.params.spotlight.intensity,
      this.params.spotlight.distance,
      degToRad(this.params.spotlight.angle),
      this.params.spotlight.penumbra,
      this.params.spotlight.decay,
    );
    this.spotlight.position.set(
      this.target.x,
      this.target.y + this.targetHeight,
      this.target.z,
    );
    this.spotlightTarget = new THREE.Object3D();
    this.spotlightTarget.name = "ysm-light-spot-target";
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.target = this.spotlightTarget;

    // 初始化体积光锥几何（参数化，enable 时挂载）
    this.rebuildCone();
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

  /* ----- 体积光锥 ----- */

  private createVolumetricMaterial(height: number, baseRadius: number): THREE.ShaderMaterial {
    const sp = this.params.spotlight;
    const vm = this.params.volumetric;

    const uniforms: VolumetricConeUniforms = {
      uColor: { value: new THREE.Color(sp.color) },
      uMaxAlpha: { value: vm.opacity },
      uFogPower: { value: vm.fogPower },
      uEdgeFade: { value: vm.edgeFade },
      uHeight: { value: height },
      uBaseRadius: { value: baseRadius },
      uTipStrength: { value: vm.tipStrength },
      uBaseStrength: { value: vm.baseStrength },
    };
    this.coneUniforms = uniforms;

    this.coneMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as Record<string, THREE.IUniform<unknown>>,
      vertexShader: VOLUMETRIC_CONE_VERT,
      fragmentShader: VOLUMETRIC_CONE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return this.coneMaterial;
  }

  private buildConeGroup(mat: THREE.ShaderMaterial, height: number, baseRadius: number): THREE.Group {
    const halfWidth = baseRadius;
    const geom = new THREE.PlaneGeometry(halfWidth * 2, height);

    const plane1 = new THREE.Mesh(geom, mat);
    const plane2 = new THREE.Mesh(geom, mat);
    plane2.rotation.y = Math.PI / 2;

    const group = new THREE.Group();
    group.name = "ysm-light-volumetric-cone";
    group.add(plane1);
    group.add(plane2);

    group.position.copy(this.spotlight.position);
    group.position.y -= height / 2;
    return group;
  }

  /** 根据当前参数重建体积光锥几何 + 材质 */
  private rebuildCone(): void {
    this.disposeCone();

    const sp = this.params.spotlight;
    const vm = this.params.volumetric;
    if (!sp.enabled || !vm.enabled) return;

    const height = this.targetHeight;
    const halfAngle = degToRad(sp.angle);
    const baseRadius = height * Math.tan(halfAngle) * (1.0 + sp.penumbra * 0.5);

    this.coneHeight = height;

    const mat = this.createVolumetricMaterial(height, baseRadius);
    this.updateConeUniforms();
    this.coneGroup = this.buildConeGroup(mat, height, baseRadius);
  }

  private disposeCone(): void {
    if (this.coneGroup) {
      if (this.coneGroup.parent) this.coneGroup.parent.remove(this.coneGroup);
      // 两 plane 共享同一 geometry+material（buildConeGroup），traverse 会重复 dispose
      // 同一实例——P1 double-dispose。用 Set 按 uuid 去重，每个唯一实例只 dispose 一次。
      const seenGeo = new Set<string>();
      const seenMat = new Set<string>();
      this.coneGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        const geo = m.geometry;
        if (geo) {
          const id = geo.uuid;
          if (!seenGeo.has(id)) {
            seenGeo.add(id);
            safeDispose(geo);
          }
        }
        const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const mt of mats) {
            if (!mt) continue;
            const id = mt.uuid;
            if (!seenMat.has(id)) {
              seenMat.add(id);
              tryDisposeMat(mt);
            }
          }
        }
      });
      this.coneGroup = null;
      this.coneUniforms = null;
      this.coneMaterial = null;
    }
  }

  private updateConeUniforms(): void {
    if (!this.coneUniforms || !this.coneMaterial) return;
    const sp = this.params.spotlight;
    const vm = this.params.volumetric;
    this.coneUniforms.uColor.value.setHex(sp.color);
    this.coneUniforms.uMaxAlpha.value = vm.opacity;
    this.coneUniforms.uFogPower.value = vm.fogPower;
    this.coneUniforms.uEdgeFade.value = vm.edgeFade;
    this.coneUniforms.uTipStrength.value = vm.tipStrength;
    this.coneUniforms.uBaseStrength.value = vm.baseStrength;
  }

  /* ----- 公共 API ----- */

  apply(): void {
    if (!this.enabled) { this.detach(); return; }
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
    if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.coneGroup) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
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
    if (this.coneGroup) {
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
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
    const wasMounted = Boolean(this.coneGroup?.parent);
    this.rebuildCone();
    if (wasMounted) this.attachCone();
  }

  /**
   * 把当前锥组挂进场景并对齐聚光灯（幂等：已在场景中则只同步位置）。
   * 供 rebuildCone 换新实例后的回挂使用——rebuildCone 只负责建，不负责挂载。
   */
  private attachCone(): void {
    if (!this.coneGroup) return;
    if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
    this.coneGroup.position.copy(this.spotlight.position);
    this.coneGroup.position.y -= this.coneHeight / 2;
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
    this.rebuildCone();
    this.syncConeMount();
  }

  /**
   * 锥组挂载态与当前 params 同步（setPreset / loadState 复用）。
   * 只在锥组已挂载时处理卸载与定位——挂载动作由 setSpotlight / setVolumetric /
   * setVolumetricEngine 负责（本方法不重挂：外层守卫已保证 coneGroup.parent 非空，
   * 曾经的 else-if 重挂分支是死代码，已删）。
   */
  private syncConeMount(): void {
    if (this.coneGroup && this.coneGroup.parent) {
      // 启用状态关闭 → 卸载（锥组仍在场景中时）
      if (!this.params.volumetric.enabled || !this.params.spotlight.enabled) {
        this.coneGroup.parent.remove(this.coneGroup);
      }
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
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
    this.rebuildCone();
    if (this.coneGroup && this.params.volumetric.enabled) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    }
  }

  /** 体积光锥参数更新（含 enable/disable 切换） */
  setVolumetric(p: Partial<VolumetricParams>): void {
    Object.assign(this.params.volumetric, p);
    this.updateConeUniforms();
    if (p.enabled !== undefined) {
      if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.coneGroup) {
        if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      } else {
        if (this.coneGroup?.parent) this.coneGroup.parent.remove(this.coneGroup);
      }
    }
  }

  /** 切换体积光锥引擎（预留：当前仅 "cone"） */
  setVolumetricEngine(engine: "cone" | "postprocess"): void {
    this.volumetricEngine = engine;
    // postprocess 模式暂不渲染体积光锥，同步关闭 volumetric.enabled 避免 toggle 状态矛盾
    if (engine === "postprocess") {
      this.params.volumetric.enabled = false;
      if (this.coneGroup?.parent) {
        this.coneGroup.parent.remove(this.coneGroup);
      }
    } else if (engine === "cone" && this.params.spotlight.enabled) {
      // 切回 cone：重新启用 volumetric 并重建锥组
      this.params.volumetric.enabled = true;
      this.rebuildCone();
      if (this.coneGroup && !this.coneGroup.parent) {
        this.scene.add(this.coneGroup);
        this.coneGroup.position.copy(this.spotlight.position);
        this.coneGroup.position.y -= this.coneHeight / 2;
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
    this.rebuildCone();
    if (this.coneGroup && this.params.volumetric.enabled && this.params.spotlight.enabled) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    } else if (this.coneGroup?.parent) {
      this.coneGroup.parent.remove(this.coneGroup);
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
    return [...lcBuildMain(this), ...lcBuildSpotlight(this), ...lcBuildVolumetric(this), ...lcBuildThreePoint(this)];
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
    if (typeof state.ambientIntensity === "number") this.params.ambient.intensity = state.ambientIntensity;
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
    if (typeof state.spotlightEnabled === "boolean") this.params.spotlight.enabled = state.spotlightEnabled;
    if (typeof state.volumetricEnabled === "boolean") this.params.volumetric.enabled = state.volumetricEnabled;
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
      if (typeof vm.baseStrength === "number") this.params.volumetric.baseStrength = vm.baseStrength;
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
        this.rebuildCone();
        if (this.coneGroup && !this.coneGroup.parent) {
          this.scene.add(this.coneGroup);
          this.coneGroup.position.copy(this.spotlight.position);
          this.coneGroup.position.y -= this.coneHeight / 2;
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
      (this.caps?.getById("sky") as { isEnvironmentEnabled?: () => boolean } | null | undefined)
        ?.isEnvironmentEnabled?.() ?? false;
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
      this.keyLight, this.fillLight, this.rimLight, this.ambientLight,
      this.keyLight?.target ?? null, this.fillLight?.target ?? null, this.rimLight?.target ?? null,
      this.spotlight, this.spotlightTarget,
    ]
      .filter((o): o is THREE.Object3D => o !== null && o !== undefined)
      .forEach((o) => {
        if (o.parent) o.parent.remove(o);
      });
    if (this.coneGroup?.parent) this.coneGroup.parent.remove(this.coneGroup);
  }

  dispose(): void {
    this.detach();
    this.disposeCone();
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

/* ============ 工具函数 ============ */

function deepMergeLightParams(base: LightParams, override: DeepPartial<LightParams>): LightParams {
  const mergeDir = (a: DirectionalLightParams, b?: Partial<DirectionalLightParams>): DirectionalLightParams =>
    ({ ...a, ...b } as DirectionalLightParams);
  const mergeAmb = (a: AmbientLightParams, b?: Partial<AmbientLightParams>): AmbientLightParams =>
    ({ ...a, ...b } as AmbientLightParams);
  const mergeSpot = (a: SpotlightParams, b?: Partial<SpotlightParams>): SpotlightParams =>
    ({ ...a, ...b } as SpotlightParams);
  const mergeVol = (a: VolumetricParams, b?: Partial<VolumetricParams>): VolumetricParams =>
    ({ ...a, ...b } as VolumetricParams);

  return {
    key: mergeDir(base.key, override.key),
    fill: mergeDir(base.fill, override.fill),
    rim: mergeDir(base.rim, override.rim),
    ambient: mergeAmb(base.ambient, override.ambient),
    spotlight: mergeSpot(base.spotlight, override.spotlight),
    volumetric: mergeVol(base.volumetric, override.volumetric),
  };
}

/** 材质上所有可能持有贴图的属性 key */
const ALL_TEX_KEYS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap"] as const;

function tryDisposeMat(m: THREE.Material): void {
  try {
    for (const key of ALL_TEX_KEYS) {
      const tex = (m as unknown as Record<string, unknown | THREE.Texture | null>)[key];
      if (tex && typeof (tex as THREE.Texture).dispose === "function") {
        safeDispose(tex as THREE.Texture);
      }
    }
    m.dispose();
  } catch (e) {
    // 不再静默吞掉：材质释放失败是 GPU 泄漏的高危信号，留痕便于排查
    dbg("light-cap", { op: "tryDisposeMat-fail", type: m.type, uuid: m.uuid, err: safeErrorMessage(e) });
  }
}