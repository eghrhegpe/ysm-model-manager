// ===== ShadowCapability — 3D 预览阴影系统（ADR-196 迁移至 envState）=====
// 跨能力协作：不重新创建光源，只改造 LightCapability 已挂场景的 3 盏 DirectionalLight + SpotLight。
// 跨能力连接：preview-core 构造能力后 `shadowCap.setLightCap(lightCap)` 注入引用。

import * as THREE from "three";
import type { PreviewMenuNode } from "../menu-node-types.ts";
import type { LightCapability } from "./light-capability.ts";
import {
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";
import { buildShadowNodes } from "./shadow-menu.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "../state/env-state.ts";
import { registerEnvCallback } from "../state/env-dispatcher.ts";

/** 阴影类型合法值 */
const SHADOW_TYPES = ["soft", "hard"] as const;
export type ShadowType = (typeof SHADOW_TYPES)[number];

/** 模型类别到阴影预设 key 的映射 */
const SHADOW_PRESET_BY_MODEL: Record<string, string> = {
  default: "default",
  ysm: "default",
  vrm: "soft",
  mmd: "soft",
  "mmd-scene": "soft",
  litematic: "default",
  resourcepack: "default",
};

export class ShadowCapability implements SceneCapability {
  readonly id = "shadow";
  readonly labelKey = "preview.shadow";
  readonly icon = "🌑";
  readonly descKey = "preview.shadowDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
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
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.enabled = opts.enabled ?? true;
    this.prevShadowMapEnabled = this.renderer.shadowMap.enabled;
    this.prevShadowMapType = this.renderer.shadowMap.type;

    // ADR-196：订阅 envState 变更
    this.unsubscribeEnv = registerEnvCallback(this, (changed, _state) => {
      if (changed.has('shadowType') || changed.has('shadowMapSize') || changed.has('shadowBias') ||
          changed.has('shadowNormalBias') || changed.has('shadowCameraSize')) {
        if (this.enabled) this.apply();
      }
    });
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
    const presetKey = SHADOW_PRESET_BY_MODEL[adapterId] ?? "default";
    if (presetKey === "soft") {
      setEnvState({ shadowType: "soft" }, { source: 'auto-model' });
    } else {
      setEnvState({ shadowType: "hard" }, { source: 'auto-model' });
    }
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
    l.shadow.mapSize.set(envState.shadowMapSize, envState.shadowMapSize);
    l.shadow.bias = envState.shadowBias;
    l.shadow.normalBias = envState.shadowNormalBias;
    const s = envState.shadowCameraSize;
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 0.5;
    cam.far = 100;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }

  /** 应用聚光灯 shadow 参数；SpotLight.shadow.camera 是 PerspectiveCamera */
  private applySpotShadow(s: THREE.SpotLight): void {
    s.castShadow = true;
    s.shadow.mapSize.set(envState.shadowMapSize, envState.shadowMapSize);
    s.shadow.bias = envState.shadowBias;
    s.shadow.normalBias = envState.shadowNormalBias;
    const cam = s.shadow.camera as THREE.PerspectiveCamera;
    cam.near = 0.5;
    cam.far = Math.max(s.distance, 50);
    cam.updateProjectionMatrix();
    s.shadow.needsUpdate = true;
  }

  private applyMeshes(): void {
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }

  private collectLights(): {
    dirs: THREE.DirectionalLight[];
    spots: THREE.SpotLight[];
  } {
    const dirs: THREE.DirectionalLight[] = [];
    const spots: THREE.SpotLight[] = [];
    if (this.lightCap) {
      dirs.push(...this.lightCap.getDirectionalLights());
      const sp = this.lightCap.getSpotLight();
      if (sp) spots.push(sp);
    }
    const seenDirs = new Set<THREE.DirectionalLight>(dirs);
    const seenSpots = new Set<THREE.SpotLight>(spots);
    for (const l of this.legacyLights) {
      if ((l as unknown as THREE.DirectionalLight).isDirectionalLight) {
        const dl = l as THREE.DirectionalLight;
        if (!seenDirs.has(dl)) {
          dirs.push(dl);
          seenDirs.add(dl);
        }
      } else if ((l as unknown as THREE.SpotLight).isSpotLight) {
        const sp = l as THREE.SpotLight;
        if (!seenSpots.has(sp)) {
          spots.push(sp);
          seenSpots.add(sp);
        }
      }
    }
    return { dirs, spots };
  }

  private applyShadows(): void {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type =
      envState.shadowType === "soft" ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
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
    this.restoreSpot();
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
    const sp: THREE.SpotLight | null =
      this._spotRef ?? (this.lightCap ? this.lightCap.getSpotLight() : null);
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
      if (!mesh?.isMesh) continue;
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
    this.restoreMeshes();
    if (!this.enabled) return;
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
    this.disableShadows();
    if (!this.enabled) return;
    this.applyShadows();
  }

  dispose(): void {
    this.unsubscribeEnv();
    this.disableShadows();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.apply();
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  getParams() {
    return {
      enabled: this.enabled,
      type: envState.shadowType,
      mapSize: envState.shadowMapSize,
      bias: envState.shadowBias,
      normalBias: envState.shadowNormalBias,
      cameraSize: envState.shadowCameraSize,
    };
  }

  /* -------- 公共 setters（菜单调用）-------- */

  setMapSize(v: number): void {
    const clamped = [512, 1024, 2048, 4096].includes(v) ? v : envState.shadowMapSize;
    setEnvState({ shadowMapSize: clamped }, { source: 'manual' });
    if (this.enabled) this.apply();
  }
  getMapSize(): number {
    return envState.shadowMapSize;
  }

  /** 菜单用：toggle true → 软阴影；false → 硬阴影 */
  setSoft(v: boolean): void {
    setEnvState({ shadowType: v ? "soft" : "hard" }, { source: 'manual' });
    if (this.enabled) {
      this.renderer.shadowMap.type = v ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
  isSoft(): boolean {
    return envState.shadowType === "soft";
  }

  setBias(v: number): void {
    setEnvState({ shadowBias: v }, { source: 'manual' });
    if (!this.enabled) return;
    const { dirs, spots } = this.collectLights();
    for (const l of dirs) l.shadow.bias = v;
    for (const sp of spots) sp.shadow.bias = v;
  }
  getBias(): number {
    return envState.shadowBias;
  }

  setNormalBias(v: number): void {
    setEnvState({ shadowNormalBias: v }, { source: 'manual' });
    if (!this.enabled) return;
    const { dirs, spots } = this.collectLights();
    for (const l of dirs) l.shadow.normalBias = v;
    for (const sp of spots) sp.shadow.normalBias = v;
  }
  getNormalBias(): number {
    return envState.shadowNormalBias;
  }

  setCameraSize(v: number): void {
    setEnvState({ shadowCameraSize: Math.max(5, Math.min(80, v)) }, { source: 'manual' });
    if (!this.enabled) return;
    const { dirs } = this.collectLights();
    const s = envState.shadowCameraSize;
    for (const l of dirs) {
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      cam.left = -s;
      cam.right = s;
      cam.top = s;
      cam.bottom = -s;
      cam.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
    }
  }
  getCameraSize(): number {
    return envState.shadowCameraSize;
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树——直产 PreviewMenuNode[]（全原生 toggle/select/slider）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildShadowNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      type: envState.shadowType,
      mapSize: envState.shadowMapSize,
      bias: envState.shadowBias,
      normalBias: envState.shadowNormalBias,
      cameraSize: envState.shadowCameraSize,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") {
      this.enabled = state.enabled;
    }
    let typeRestored = false;
    restoreFields(state, {
      type: oneOf(SHADOW_TYPES, (v) => {
        setEnvState({ shadowType: v }, { source: 'manual' });
        typeRestored = true;
      }),
      mapSize: { number: (v) => setEnvState({ shadowMapSize: v }, { source: 'manual' }) },
      bias: { number: (v) => setEnvState({ shadowBias: v }, { source: 'manual' }) },
      normalBias: { number: (v) => setEnvState({ shadowNormalBias: v }, { source: 'manual' }) },
      cameraSize: { number: (v) => setEnvState({ shadowCameraSize: v }, { source: 'manual' }) },
    });
    if (!typeRestored && typeof state.soft === "boolean") {
      setEnvState({ shadowType: state.soft ? "soft" : "hard" }, { source: 'manual' });
    }
    this.isStateLoaded = true;
    this.apply();
  }
}

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
