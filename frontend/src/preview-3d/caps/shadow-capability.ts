// ===== ShadowCapability — 3D 预览阴影系统 =====
// 跨能力协作：不重新创建光源，只改造 LightCapability 已挂场景的 3 盏 DirectionalLight + SpotLight。
// 跨能力连接：preview-core 构造能力后 `shadowCap.setLightCap(lightCap)` 注入引用。
//
// 设计要点：
//   - renderer.shadowMap 开关 + 软/硬阴影（PCFSoft / Basic）
//   - 统一 DirectionalLight.shadow cameraSize（正交相机 ±size 视锥体，默认 15 覆盖大部分场景）
//   - SpotLight.shadow 用 PerspectiveCamera（自动根据 spot.angle 配 fov，不用手动）
//   - mapSize / bias / normalBias 可调（修复阴影 acne / 缝合面漏光）
//   - mesh castShadow / receiveShadow 全量设置 + dispose 还原（快照原状态，不破坏外部预设）
//   - 默认 enabled=false：阴影有显著 GPU 开销，用户明确开启

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";
import type { LightCapability } from "./light-capability.ts";

/* ============ 参数类型 ============ */

export interface ShadowParams {
  /** 阴影总开关（默认 false：性能优先） */
  enabled: boolean;
  /** 阴影类型：hard（BasicShadowMap 硬阴影）/ soft（PCFSoftShadowMap 软阴影） */
  type: "hard" | "soft";
  /** shadow map 分辨率（方向灯/聚光灯共用），越大越清晰 */
  mapSize: number;
  /** shadow acne 修复（负值，越大越抑制 acne 但易产生 Peter-Panning） */
  bias: number;
  /** 法线偏移（防止阴影缝合面漏光/漏阴） */
  normalBias: number;
  /** 方向灯 shadow camera（正交）视锥大小，± 值；越大覆盖范围越广但精度下降 */
  cameraSize: number;
}

export const DEFAULT_SHADOW_PARAMS: ShadowParams = {
  enabled: false,
  type: "hard",
  mapSize: 1024,
  bias: -0.0005,
  normalBias: 0.02,
  cameraSize: 15,
};

/** 预设（setPreset 套用到不同模型类别） */
export const SHADOW_PRESETS: Record<string, Partial<ShadowParams> | undefined> = {
  default: { type: "hard" },
  // v1.14: 启用 enabled:true；建筑类仍保持关闭以省 GPU
  prop: { enabled: true, type: "soft", mapSize: 2048, cameraSize: 10 },
  small: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 12 },
  architecture: { enabled: false, type: "hard", mapSize: 1024, cameraSize: 40 },
  scene: { enabled: false, type: "hard", mapSize: 1024, cameraSize: 30 },
  character: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 15 },
  creature: { enabled: true, type: "soft", mapSize: 1024, cameraSize: 18 },
};

const MAP_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "512", label: "512（性能优先）" },
  { value: "1024", label: "1024（均衡）" },
  { value: "2048", label: "2048（清晰）" },
  { value: "4096", label: "4096（精细）" },
];

/* ============ getMenuControls 拆分：2 个包级函数（前缀 shc 防冲突） ============ */

function shcBuildMain(cap: ShadowCapability): MenuControlDef[] {
  return [
    {
      id: "shadow-enabled",
      kind: "toggle",
      labelKey: "preview.shadow",
      fallback: "阴影",
      hintKey: "preview.shadowEnabledHint",
      getValue: () => cap.isEnabled(),
      setValue: (v) => cap.setEnabled(v as boolean),
    },
    {
      id: "shadow-soft",
      kind: "toggle",
      labelKey: "preview.shadowSoft",
      fallback: "软阴影",
      group: "preview.shadowGroupParams",
      getValue: () => cap.isSoft(),
      setValue: (v) => cap.setSoft(v as boolean),
    },
    {
      id: "shadow-map-size",
      kind: "select",
      labelKey: "preview.shadowMapSize",
      fallback: "分辨率",
      hintKey: "preview.shadowMapSizeDesc",
      group: "preview.shadowGroupParams",
      select: MAP_SIZE_OPTIONS,
      getValue: () => String(cap.getMapSize()),
      setValue: (v) => cap.setMapSize(Number(v)),
    },
  ];
}

function shcBuildQuality(cap: ShadowCapability): MenuControlDef[] {
  return [
    {
      id: "shadow-bias",
      kind: "slider",
      labelKey: "preview.shadowBias",
      fallback: "阴影偏移",
      hintKey: "preview.shadowBiasDesc",
      group: "preview.shadowGroupParams",
      slider: { min: -0.01, max: 0.001, step: 0.0001 },
      getValue: () => cap.getBias(),
      setValue: (v) => cap.setBias(v as number),
    },
    {
      id: "shadow-normal-bias",
      kind: "slider",
      labelKey: "preview.shadowNormalBias",
      fallback: "法线偏移",
      hintKey: "preview.shadowNormalBiasDesc",
      group: "preview.shadowGroupParams",
      slider: { min: 0, max: 0.1, step: 0.005 },
      getValue: () => cap.getNormalBias(),
      setValue: (v) => cap.setNormalBias(v as number),
    },
    {
      id: "shadow-camera-size",
      kind: "slider",
      labelKey: "preview.shadowCameraSize",
      fallback: "视锥大小",
      hintKey: "preview.shadowCameraSizeDesc",
      group: "preview.shadowGroupParams",
      slider: { min: 5, max: 80, step: 1 },
      getValue: () => cap.getCameraSize(),
      setValue: (v) => cap.setCameraSize(v as number),
    },
  ];
}

/** 预设与模型类别的映射（无则落回 default） */
const PRESET_BY_MODEL: Record<string, keyof typeof SHADOW_PRESETS> = {
  // 角色别名→character preset (soft shadow + 1024 res)
  mmd: "character",
  vrm: "character",
  ysm: "character",
  litematic: "character",
  prop: "prop",
  small: "small",
  architecture: "architecture",
  scene: "scene",
  character: "character",
  creature: "creature",
};

/* ============ 快照类型：dispose 还原灯与 mesh 的原 shadow 状态 ============ */

interface LightShadowSnapshot {
  castShadow: boolean;
  mapSize: { x: number; y: number };
  bias: number;
  normalBias: number;
}
interface MeshShadowSnapshot {
  castShadow: boolean;
  receiveShadow: boolean;
}

/* ============ ShadowCapability ============ */

export class ShadowCapability implements SceneCapability {
  readonly id = "shadow";
  readonly labelKey = "preview.shadow";
  readonly icon = "🌑";
  readonly descKey = "preview.shadowDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: ShadowParams;
  private enabled: boolean;
  /** loadState 是否成功载入过；setPreset 有它时不覆盖用户会话（避免每次新会话回到预设） */
  private isStateLoaded = false;

  /** 跨能力：外部注入 LightCapability 实例，取灯 */
  private lightCap: LightCapability | null = null;

  /** 兼容 mount-preview-core 旧接口：未注入 LightCapability 时直接 syncLights() 传入原始灯对象缓存 */
  private legacyLights: Array<THREE.DirectionalLight | THREE.SpotLight> = [];

  // 构造时刻快照（dispose 还原）
  private prevShadowMapEnabled: boolean;
  private prevShadowMapType: THREE.ShadowMapType;

  // apply 时刻快照（灯与 mesh）
  private dirLightSnaps: Map<THREE.DirectionalLight, LightShadowSnapshot> = new Map();
  private spotSnap: LightShadowSnapshot | null = null;
  private _spotRef: THREE.SpotLight | null = null;
  private _spotSnapsList: Array<[THREE.SpotLight, LightShadowSnapshot]> = [];
  private meshSnaps: Map<THREE.Object3D, MeshShadowSnapshot> = new Map();

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<ShadowParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = { ...DEFAULT_SHADOW_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;
    this.prevShadowMapEnabled = this.renderer.shadowMap.enabled;
    this.prevShadowMapType = this.renderer.shadowMap.type;
  }

  /* -------- 跨能力注入 / mount-preview-core 兼容接口 -------- */

  setLightCap(cap: LightCapability | null): void {
    this.lightCap = cap;
    if (this.enabled) this.apply();
  }

  /** mount-preview-core L386 旧接口：早期直接传入场景中遍历到的所有方向灯/聚光灯缓存（不要求 LightCapability 注入） */
  syncLights(lights: Array<THREE.DirectionalLight | THREE.SpotLight>): void {
    this.legacyLights = [...lights];
    if (this.enabled) this.apply();
  }

  /** mount-preview-core L663 旧接口：模型加载完对 roots 内所有 mesh 设 castShadow/receiveShadow（与 syncMeshes 等价） */
  applyMeshCasts(roots: THREE.Object3D[]): void {
    this.syncMeshes(roots);
  }

  /** 按模型类别套用预设：若用户尚未从 localStorage 恢复过状态（isStateLoaded=false）则套用，避免覆盖用户上次会话配置 */
  setPreset(adapterId: string): void {
    if (this.isStateLoaded) return;
    const presetKey = PRESET_BY_MODEL[adapterId] ?? "default";
    const preset = SHADOW_PRESETS[presetKey] ?? SHADOW_PRESETS.default;
    if (!preset) return;
    Object.assign(this.params, preset);
  }

  /* -------- 内部：apply 管线 -------- */

  private snapshotDirLights(lights: THREE.DirectionalLight[]): void {
    this.dirLightSnaps.clear();
    for (const l of lights) {
      this.dirLightSnaps.set(l, {
        castShadow: l.castShadow,
        mapSize: { x: l.shadow.mapSize.x, y: l.shadow.mapSize.y },
        bias: l.shadow.bias,
        normalBias: l.shadow.normalBias,
      });
    }
  }
  private snapshotSceneMeshes(root: THREE.Scene): void {
    this.meshSnaps.clear();
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      this.meshSnaps.set(m, { castShadow: !!m.castShadow, receiveShadow: !!m.receiveShadow });
    });
  }

  /** 应用方向灯 shadow 参数；DirectionalLight.shadow.camera 是 OrthographicCamera */
  private applyDirLightShadow(l: THREE.DirectionalLight): void {
    l.castShadow = true;
    l.shadow.mapSize.set(this.params.mapSize, this.params.mapSize);
    l.shadow.bias = this.params.bias;
    l.shadow.normalBias = this.params.normalBias;
    const s = this.params.cameraSize;
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 0.5; cam.far = 100;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }

  /** 应用聚光灯 shadow 参数；SpotLight.shadow.camera 是 PerspectiveCamera */
  private applySpotShadow(s: THREE.SpotLight): void {
    s.castShadow = true;
    s.shadow.mapSize.set(this.params.mapSize, this.params.mapSize);
    s.shadow.bias = this.params.bias;
    s.shadow.normalBias = this.params.normalBias;
    const cam = s.shadow.camera as THREE.PerspectiveCamera;
    cam.near = 0.5; cam.far = Math.max(s.distance, 50);
    cam.updateProjectionMatrix();
    s.shadow.needsUpdate = true;
  }

  private applyMeshes(): void {
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // material.needsUpdate 一般不需要：castShadow/receiveShadow 触发 renderer 内部 uniform 更新
    });
  }

  /**
   * 收集需要配置阴影的灯。**有意不遍历场景**——只认两个显式来源：
   * ① `LightCapability` getter（`setLightCap` 注入）② legacy 缓存（`syncLights()` 传入，
   * 由 mount-preview-core 遍历场景后接线）。
   *
   * 设计理由：3D 场景里可能存在适配器自带、语义各异的灯（补光/特效灯等），
   * 若在此遍历场景统一开 castShadow，会「误伤」这些不该参与阴影计算的灯
   * （性能与观感双损）。故采用**调用方显式接线**的白名单语义。
   *
   * 契约（调用方须知）：适配器若自行往场景加灯，必须经 `setLightCap` 或 `syncLights()`
   * 接线，否则该灯不会被纳入阴影配置（保持其原有 castShadow 值，不被本能力改写）。
   */
  private collectLights(): {
    dirs: THREE.DirectionalLight[];
    spots: THREE.SpotLight[];
  } {
    const dirs: THREE.DirectionalLight[] = [];
    const spots: THREE.SpotLight[] = [];
    // 优先 LightCapability getter（实例明确，不会误伤其他自定义灯）
    if (this.lightCap) {
      dirs.push(...this.lightCap.getDirectionalLights());
      const sp = this.lightCap.getSpotLight();
      if (sp) spots.push(sp);
    }
    // 其次 legacy 缓存（mount-preview-core 遍历场景拿到的，可能与上面重复——去重）
    const seenDirs = new Set<THREE.DirectionalLight>(dirs);
    const seenSpots = new Set<THREE.SpotLight>(spots);
    for (const l of this.legacyLights) {
      if ((l as unknown as THREE.DirectionalLight).isDirectionalLight) {
        const dl = l as THREE.DirectionalLight;
        if (!seenDirs.has(dl)) { dirs.push(dl); seenDirs.add(dl); }
      } else if ((l as unknown as THREE.SpotLight).isSpotLight) {
        const sp = l as THREE.SpotLight;
        if (!seenSpots.has(sp)) { spots.push(sp); seenSpots.add(sp); }
      }
    }
    return { dirs, spots };
  }

  private applyShadows(): void {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.params.type === "soft" ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    this.renderer.shadowMap.needsUpdate = true;

    const { dirs, spots } = this.collectLights();
    this.snapshotDirLights(dirs);
    dirs.forEach((l) => this.applyDirLightShadow(l));
    const spotSnaps: Array<[THREE.SpotLight, LightShadowSnapshot]> = [];
    for (const sp of spots) {
      const snap: LightShadowSnapshot = {
        castShadow: sp.castShadow,
        mapSize: { x: sp.shadow.mapSize.x, y: sp.shadow.mapSize.y },
        bias: sp.shadow.bias,
        normalBias: sp.shadow.normalBias,
      };
      spotSnaps.push([sp, snap]);
      if (sp.visible) this.applySpotShadow(sp);
    }
    // 替换掉原单 Spot 快照：旧逻辑只会记录 1 盏，这里新逻辑与 directionals 相同记录多盏（lightCap 只有一盏 spot，但 legacy 可能有多盏）
    this.restoreSpot(); // 清空旧 spotSnap
    if (spotSnaps.length === 1) {
      this.spotSnap = spotSnaps[0][1];
      this._spotRef = spotSnaps[0][0];
    } else if (spotSnaps.length > 1) {
      this._spotSnapsList = spotSnaps;
    }

    this.snapshotSceneMeshes(this.scene);
    this.applyMeshes();
  }

  /* -------- 还原管线 -------- */

  private restoreDirLights(): void {
    for (const [l, snap] of this.dirLightSnaps.entries()) {
      l.castShadow = snap.castShadow;
      l.shadow.mapSize.set(snap.mapSize.x, snap.mapSize.y);
      l.shadow.bias = snap.bias;
      l.shadow.normalBias = snap.normalBias;
    }
    this.dirLightSnaps.clear();
  }
  private restoreSpot(): void {
    // 多 spot：优先走 _spotSnapsList（legacy 可能有多盏）
    if (this._spotSnapsList && this._spotSnapsList.length > 0) {
      for (const [sp, snap] of this._spotSnapsList) {
        if (!sp) continue;
        sp.castShadow = snap.castShadow;
        sp.shadow.mapSize.set(snap.mapSize.x, snap.mapSize.y);
        sp.shadow.bias = snap.bias;
        sp.shadow.normalBias = snap.normalBias;
      }
      this._spotSnapsList = [];
      this._spotRef = null;
      this.spotSnap = null;
      return;
    }
    // 单 spot：优先 _spotRef（legacy 单盏），其次 lightCap getter
    const sp: THREE.SpotLight | null = this._spotRef ?? (this.lightCap ? this.lightCap.getSpotLight() : null);
    if (sp && this.spotSnap) {
      sp.castShadow = this.spotSnap.castShadow;
      sp.shadow.mapSize.set(this.spotSnap.mapSize.x, this.spotSnap.mapSize.y);
      sp.shadow.bias = this.spotSnap.bias;
      sp.shadow.normalBias = this.spotSnap.normalBias;
    }
    this._spotRef = null;
    this.spotSnap = null;
  }
  private restoreMeshes(): void {
    for (const [m, snap] of this.meshSnaps.entries()) {
      const mesh = m as THREE.Mesh;
      if (!mesh || !mesh.isMesh) continue;
      mesh.castShadow = snap.castShadow;
      mesh.receiveShadow = snap.receiveShadow;
    }
    this.meshSnaps.clear();
  }

  /** 关闭所有 shadow（setEnabled(false) / dispose 共用） */
  private disableShadows(): void {
    this.restoreDirLights();
    this.restoreSpot();
    this.restoreMeshes();
    this.renderer.shadowMap.enabled = this.prevShadowMapEnabled;
    this.renderer.shadowMap.type = this.prevShadowMapType;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* -------- 公共 API：mesh 同步（外部加载完模型后调用，重新扫描 cast/receive + 快照）-------- */

  syncMeshes(roots: THREE.Object3D[]): void {
    // 先还原之前 mesh 的快照（避免后续 accumulate snapshots 越堆越大）
    this.restoreMeshes();
    if (!this.enabled) return;
    // 对 roots 所有子孙设 cast/receive 并写入快照
    const touched = new Set<THREE.Object3D>();
    for (const root of roots) {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        if (touched.has(m)) return;
        touched.add(m);
        this.meshSnaps.set(m, { castShadow: !!m.castShadow, receiveShadow: !!m.receiveShadow });
        m.castShadow = true;
        m.receiveShadow = true;
      });
    }
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.disableShadows(); // 先清理之前 apply 留下的状态（灯/mesh 快照可能已变）
    if (!this.enabled) return;
    this.applyShadows();
  }

  dispose(): void {
    this.disableShadows();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.apply();
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  getParams(): ShadowParams {
    return this.params;
  }

  /* -------- 公共 setters（菜单调用）-------- */

  setMapSize(v: number): void {
    const clamped = [512, 1024, 2048, 4096].includes(v) ? v : DEFAULT_SHADOW_PARAMS.mapSize;
    this.params.mapSize = clamped;
    if (this.enabled) this.apply();
  }
  getMapSize(): number {
    return this.params.mapSize;
  }

  /** 菜单用：toggle true → 软阴影；false → 硬阴影（与 params.type 映射） */
  setSoft(v: boolean): void {
    this.params.type = v ? "soft" : "hard";
    if (this.enabled) {
      this.renderer.shadowMap.type = v ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
  isSoft(): boolean {
    return this.params.type === "soft";
  }

  setBias(v: number): void {
    this.params.bias = v;
    if (!this.enabled) return;
    const { dirs, spots } = this.collectLights();
    for (const l of dirs) l.shadow.bias = v;
    for (const sp of spots) sp.shadow.bias = v;
  }
  getBias(): number {
    return this.params.bias;
  }

  setNormalBias(v: number): void {
    this.params.normalBias = v;
    if (!this.enabled) return;
    const { dirs, spots } = this.collectLights();
    for (const l of dirs) l.shadow.normalBias = v;
    for (const sp of spots) sp.shadow.normalBias = v;
  }
  getNormalBias(): number {
    return this.params.normalBias;
  }

  setCameraSize(v: number): void {
    this.params.cameraSize = Math.max(5, Math.min(80, v));
    if (!this.enabled) return;
    const { dirs } = this.collectLights();
    const s = this.params.cameraSize;
    for (const l of dirs) {
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
    }
  }
  getCameraSize(): number {
    return this.params.cameraSize;
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [...shcBuildMain(this), ...shcBuildQuality(this)];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      type: this.params.type,
      mapSize: this.params.mapSize,
      bias: this.params.bias,
      normalBias: this.params.normalBias,
      cameraSize: this.params.cameraSize,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (typeof state.type === "string" && (state.type === "hard" || state.type === "soft")) {
      this.params.type = state.type;
    } else if (typeof state.soft === "boolean") {
      // 兼容旧 soft 字段（老会话持久化落盘）
      this.params.type = state.soft ? "soft" : "hard";
    }
    if (typeof state.mapSize === "number") this.params.mapSize = state.mapSize;
    if (typeof state.bias === "number") this.params.bias = state.bias;
    if (typeof state.normalBias === "number") this.params.normalBias = state.normalBias;
    if (typeof state.cameraSize === "number") this.params.cameraSize = state.cameraSize;
    this.isStateLoaded = true;
    this.apply();
  }
}
