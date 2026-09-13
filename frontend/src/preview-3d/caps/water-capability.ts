// ===== WaterCapability：水面能力（ADR-196 迁移至 envState）=====
// 独立前水面是 GroundCapability 的「双子域」；拆分后成为环境面板一等公民（与 sky/ground 平级）。
// 波浪 shader 注入（onBeforeCompile）+ 程序化法线贴图（generateNormalMap）仍为水面专属技术基盘，
// 不与他人共享，故不另抽共享模块（YAGNI）。

import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import {
  GROUND_LAYER_OFFSETS,
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";
import { buildWaterNodes } from "./water-menu.ts";
import type { WaterMode } from "./water-state.ts";
import { WATER_MODES } from "./water-state.ts";

export type { WaterMode };

/** 水面渲染体判别联合：film 单 mesh（root 即顶水面）；pool 为 Group + 预捕获顶水面引用 */
type WaterTopMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
type WaterRenderBody =
  | { mode: "film"; root: WaterTopMesh; mat: THREE.MeshPhysicalMaterial }
  | { mode: "pool"; root: THREE.Group; top: WaterTopMesh; topMat: THREE.MeshPhysicalMaterial };

export class WaterCapability implements SceneCapability {
  readonly id = "water";
  readonly labelKey = "preview.water";
  readonly icon = "💧";
  readonly descKey = "preview.waterDesc";

  private scene: THREE.Scene;
  private water: WaterRenderBody;
  private waterTime: { value: number };
  private enabled: boolean;
  /** 参数变更监听（menu 局部刷新用）；仅模式切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();
  /** 法线贴图实例级缓存 */
  private normalMapCache: THREE.DataTexture | null = null;
  private normalMapCacheSize = -1;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.enabled = opts.enabled ?? true;
    this.waterTime = { value: 0 };
    this.water = this.rebuildWaterContainer(true);

    // ADR-196：订阅 envState 变更——渲染应用统一收敛到此回调：
    // 结构字段（mode/size/池体几何）→ 重建容器；参数字段 → 就地改材质/uniform；
    // 子域开关 → 只切可见性。setter 只负责写 envState（不再各自就地改材质，避免双写）。
    // 只接收 water 组的键（dispatcher 前置过滤）。
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
        const mode = envState.waterMode;
        // mode/size 恒重建；池体几何字段仅在 pool 生效时重建（film 下只存参，切 pool 时一并读取）
        const needsRebuild =
          changed.has("waterMode") ||
          changed.has("waterSize") ||
          ((changed.has("waterPoolHeight") || changed.has("waterPoolWallThickness")) &&
            mode === "pool");
        if (needsRebuild) {
          // code_review 9fe958249 #4（P3 conf 0.90）：rebuildWaterContainer 内部已
          // syncWaterVisibility（L323 由已更新的 envState 重算 visible）——此处重复
          // 调用是纯 no-op，删除（film/pool/wetness 门控单一入口，便于推理）
          this.rebuildWaterContainer(false);
          if (changed.has("waterMode")) this.notify();
          return;
        }
        if (changed.has("waterEnabled")) {
          this.syncWaterVisibility();
          return;
        }
        // 参数字段：就地应用（不重建容器，材质句柄保持稳定）
        this.applyChangedParams(changed);
        if (changed.has("waterWetness")) this.syncWaterVisibility();
      },
      "water",
    );
  }

  // ── 水材质（波浪 shader + 法线贴图）：film 顶 / pool 顶 共用，避免技术分叉 ──
  private buildWaveWaterMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial {
    // 升级到 MeshPhysicalMaterial：pool 模式用 transmission/thickness 体现「水体厚度感」，film 仍降级为原视觉
    const mat = new THREE.MeshPhysicalMaterial({
      color: envState.waterColor,
      transparent: true,
      opacity: envState.waterOpacity * (opts.forPool ? 1 : envState.waterWetness),
      roughness: 0.15,
      metalness: opts.forPool ? 0.0 : 0.3,
      depthWrite: false,
      transmission: opts.forPool ? envState.waterClarity : 0,
      thickness: opts.forPool ? Math.max(0.01, envState.waterPoolHeight * 0.5) : 0,
      clearcoat: opts.forPool ? 0.8 : 0,
      clearcoatRoughness: 0.1,
    });

    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      mat.userData.shader = shader;
      shader.uniforms.uTime = this.waterTime;
      const round = Math.max(0, Math.min(0.5, envState.waterPoolRoundness));
      shader.uniforms.uRoundness = { value: opts.forPool ? round : 0 };
      shader.uniforms.uHalfSize = { value: envState.waterSize / 2 };
      shader.uniforms.uBaseOpacity = { value: mat.opacity };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         varying vec3 vWorldPos_wave;
         float wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
           return amp * sin(dot(p, dir) * freq + uTime * speed);
         }`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec2 wpos = transformed.xy;
         float h = 0.0;
         h += wave(wpos, normalize(vec2(1.0, 0.3)), 0.8, 1.2, 0.08);
         h += wave(wpos, normalize(vec2(-0.4, 1.0)), 1.1, 0.9, 0.05);
         h += wave(wpos, normalize(vec2(0.2, -0.8)), 1.6, 1.5, 0.03);
         transformed.z += h;
         vec4 worldPosWave = modelMatrix * vec4(transformed, 1.0);
         vWorldPos_wave = worldPosWave.xyz;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         varying vec3 vWorldPos_wave;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", "void main() {\n");
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         if (uRoundness > 0.0) {
           vec2 p = vWorldPos_wave.xz;
           float md = max(abs(p.x), abs(p.y));
           float edge = uHalfSize - uRoundness * uHalfSize;
           float fade = 1.0 - smoothstep(edge, uHalfSize, md);
           gl_FragColor.a *= fade;
         }
         gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);`,
      );
    };
    mat.needsUpdate = true;

    const normalMap = this.getNormalMap();
    (mat as THREE.MeshPhysicalMaterial & { normalMap: THREE.DataTexture | null }).normalMap =
      normalMap;
    (mat as THREE.MeshPhysicalMaterial & { normalScale: THREE.Vector2 }).normalScale =
      new THREE.Vector2(envState.waterNormalStrength, envState.waterNormalStrength);
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

  /** 顶水面（波浪材质）：film 即 root 本体；pool 为创建时预捕获的 top 引用 */
  private findTopWater(): WaterTopMesh {
    return this.water.mode === "film" ? this.water.root : this.water.top;
  }

  /** 构造 film 模式水面 */
  private createFilmBody(): Extract<WaterRenderBody, { mode: "film" }> {
    const waterGeo = new THREE.PlaneGeometry(envState.waterSize, envState.waterSize, 32, 32);
    const waterMat = this.buildWaveWaterMaterial({ forPool: false });
    const water: WaterTopMesh = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = GROUND_LAYER_OFFSETS.waterFilm;
    water.name = "ysm-ground-water";
    return { mode: "film", root: water, mat: waterMat };
  }

  /** 构造 pool 模式盒式凹形水池 */
  private createPoolBody(): Extract<WaterRenderBody, { mode: "pool" }> {
    const size = envState.waterSize;
    const half = size / 2;
    const h = Math.max(0.01, envState.waterPoolHeight);
    const group = new THREE.Group();
    group.name = "ysm-ground-water";

    const topGeo = new THREE.PlaneGeometry(size, size, 32, 32);
    const topMat = this.buildWaveWaterMaterial({ forPool: true });
    const top: WaterTopMesh = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = h;
    top.name = "ysm-water-top";
    group.add(top);

    const bottomMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(size, size), bottomMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = GROUND_LAYER_OFFSETS.waterPoolBottom;
    bottom.name = "ysm-water-bottom";
    group.add(bottom);

    const innerMat = new THREE.MeshPhysicalMaterial({
      color: envState.waterColor,
      transparent: true,
      opacity: envState.waterOpacity * 0.85,
      side: THREE.BackSide,
      roughness: 0.1,
      metalness: 0,
      transmission: envState.waterClarity * 0.5,
      thickness: envState.waterPoolWallThickness,
      depthWrite: false,
    });
    const outerMat = new THREE.MeshStandardMaterial({
      color: envState.waterPoolWallColor,
      side: THREE.FrontSide,
      roughness: 0.8,
      metalness: 0,
    });

    const wallPairs: Array<{
      name: string;
      axis: "ns" | "ew";
      pos: THREE.Vector3;
      outerPos: THREE.Vector3;
      rotY?: number;
    }> = [
      {
        name: "ysm-water-wall-n",
        axis: "ns",
        pos: new THREE.Vector3(0, h / 2, -half),
        outerPos: new THREE.Vector3(0, h / 2, -half - envState.waterPoolWallThickness),
      },
      {
        name: "ysm-water-wall-s",
        axis: "ns",
        pos: new THREE.Vector3(0, h / 2, half),
        outerPos: new THREE.Vector3(0, h / 2, half + envState.waterPoolWallThickness),
        rotY: Math.PI,
      },
      {
        name: "ysm-water-wall-e",
        axis: "ew",
        pos: new THREE.Vector3(half, h / 2, 0),
        outerPos: new THREE.Vector3(half + envState.waterPoolWallThickness, h / 2, 0),
        rotY: -Math.PI / 2,
      },
      {
        name: "ysm-water-wall-w",
        axis: "ew",
        pos: new THREE.Vector3(-half, h / 2, 0),
        outerPos: new THREE.Vector3(-half - envState.waterPoolWallThickness, h / 2, 0),
        rotY: Math.PI / 2,
      },
    ];

    for (const pair of wallPairs) {
      const geoSizeW = size;
      const innerGeo = new THREE.PlaneGeometry(geoSizeW, h, 4, 4);
      const outerGeo = new THREE.PlaneGeometry(
        geoSizeW,
        h + Math.max(0.02, envState.waterPoolWallThickness * 0.6),
        4,
        4,
      );
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.name = `${pair.name}-inner`;
      inner.position.copy(pair.pos);
      if (pair.rotY) inner.rotation.y = pair.rotY;
      const outer = new THREE.Mesh(outerGeo, outerMat);
      outer.name = `${pair.name}-outer`;
      outer.position.copy(pair.outerPos);
      if (pair.rotY) outer.rotation.y = pair.rotY;
      group.add(inner, outer);
    }

    return { mode: "pool", root: group, top, topMat };
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

  /** 重建 this.water 根容器 */
  private rebuildWaterContainer(initial = false): WaterRenderBody {
    const wasInScene = !initial && this.water.root.parent != null;
    if (!initial) this.disposeWater();
    this.water = envState.waterMode === "pool" ? this.createPoolBody() : this.createFilmBody();
    this.syncWaterVisibility();
    if (wasInScene && this.enabled) {
      this.scene.add(this.water.root);
    }
    return this.water;
  }

  /** 水面可见性：enabled ∧ water.enabled ∧（film → wetness>0；pool → 恒开） */
  private syncWaterVisibility(): void {
    const filmOn = envState.waterMode === "film" && envState.waterWetness > 0;
    const poolOn = envState.waterMode === "pool";
    const shouldShow = this.enabled && envState.waterEnabled && (filmOn || poolOn);
    this.water.root.visible = shouldShow;
  }

  /** 推进水面波纹动画（render loop 调用） */
  update(dt: number): void {
    if (!this.enabled || !envState.waterEnabled || !this.water.root.visible) return;
    this.waterTime.value += dt * envState.waterWaveSpeed;
  }

  apply(): void {
    if (!this.enabled) return;
    if (!this.water.root.parent) this.scene.add(this.water.root);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
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
    return envState.waterMode as WaterMode;
  }

  // ── 水面参数（film + pool 通用）──
  // 就地渲染应用统一入口（registerEnvCallback 的参数字段分派）：不重建容器，保持材质句柄稳定。
  private applyChangedParams(changed: Set<string>): void {
    const s = envState;
    // wetness（film）：top opacity = waterOpacity * wetness + 同步 uBaseOpacity uniform
    if (changed.has("waterWetness") && this.water.mode === "film") {
      const mat = this.water.mat;
      mat.opacity = s.waterOpacity * s.waterWetness;
      this.syncBaseOpacityUniform(mat, mat.opacity);
    }
    // opacity：film → top opacity × wetness；pool → 直取（不含 wetness）
    if (changed.has("waterOpacity")) {
      const top = this.findTopWater();
      if (top) {
        top.material.opacity =
          this.water.mode === "film" ? s.waterOpacity * s.waterWetness : s.waterOpacity;
      }
    }
    // color：film → root；pool → top + 四壁 inner
    if (changed.has("waterColor")) {
      const targets =
        this.water.mode === "film"
          ? [this.water.root]
          : this.collectWaterMeshes().filter(
              (m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"),
            );
      for (const m of targets) {
        const mat = m.material as THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
        if ("color" in mat) mat.color.setHex(s.waterColor);
      }
    }
    // normalStrength → top normalScale
    if (changed.has("waterNormalStrength")) {
      const top = this.findTopWater();
      if (top) top.material.normalScale?.set(s.waterNormalStrength, s.waterNormalStrength);
    }
    // poolWallColor → 池底 + 四壁 outer
    if (changed.has("waterPoolWallColor")) {
      for (const m of this.collectWaterMeshes()) {
        if (m.name.endsWith("-outer") || m.name === "ysm-water-bottom") {
          (m.material as THREE.MeshStandardMaterial).color.setHex(s.waterPoolWallColor);
        }
      }
    }
    // poolRoundness → top uRoundness uniform
    if (changed.has("waterPoolRoundness")) {
      const top = this.findTopWater();
      if (top) {
        const shader = (
          top.material as unknown as {
            userData: { shader?: { uniforms: { uRoundness?: { value: number } } } };
          }
        ).userData?.shader;
        if (shader?.uniforms?.uRoundness) shader.uniforms.uRoundness.value = s.waterPoolRoundness;
      }
    }
    // clarity（pool）→ top/inner transmission
    if (changed.has("waterClarity") && this.water.mode === "pool") {
      const targets = this.collectWaterMeshes().filter(
        (m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"),
      );
      for (const m of targets) {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        if ("transmission" in mat) {
          mat.transmission = m.name === "ysm-water-top" ? s.waterClarity : s.waterClarity * 0.5;
          mat.needsUpdate = true;
        }
      }
    }
    // waterWaveSpeed：无材质应用（仅 update 累加速度读值）
  }

  private syncBaseOpacityUniform(mat: THREE.MeshPhysicalMaterial, value: number): void {
    const shader = (
      mat as unknown as {
        userData: { shader?: { uniforms?: { uBaseOpacity?: { value: number } } } };
      }
    ).userData?.shader;
    if (shader?.uniforms?.uBaseOpacity) shader.uniforms.uBaseOpacity.value = value;
  }

  setWetness(v: number): void {
    setEnvState({ waterWetness: Math.max(0, Math.min(1, v)) }, { source: "manual" });
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
    setEnvState({ waterOpacity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getWaterOpacity(): number {
    return envState.waterOpacity;
  }

  // ── 法线贴图强度（顶层水面）──
  setNormalStrength(v: number): void {
    setEnvState({ waterNormalStrength: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getNormalStrength(): number {
    return envState.waterNormalStrength;
  }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number): void {
    setEnvState({ waterPoolHeight: Math.max(0.01, v) }, { source: "manual" });
  }
  getPoolHeight(): number {
    return envState.waterPoolHeight;
  }

  setPoolWallThickness(v: number): void {
    setEnvState({ waterPoolWallThickness: Math.max(0.01, v) }, { source: "manual" });
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
    setEnvState({ waterPoolRoundness: Math.max(0, Math.min(0.5, v)) }, { source: "manual" });
  }
  getPoolRoundness(): number {
    return envState.waterPoolRoundness;
  }

  setWaveSpeed(v: number): void {
    setEnvState({ waterWaveSpeed: Math.max(0, v) }, { source: "manual" });
  }
  getWaveSpeed(): number {
    return envState.waterWaveSpeed;
  }
  setClarity(v: number): void {
    setEnvState({ waterClarity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getClarity(): number {
    return envState.waterClarity;
  }

  // ── 程序化法线贴图生成 ──
  private getNormalMap(): THREE.DataTexture {
    if (this.normalMapCache && this.normalMapCacheSize === envState.waterSize) {
      return this.normalMapCache;
    }
    if (this.normalMapCache) safeDispose(this.normalMapCache);
    this.normalMapCache = this.generateNormalMap(256);
    this.normalMapCacheSize = envState.waterSize;
    return this.normalMapCache;
  }

  private generateNormalMap(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const sz = envState.waterSize;

    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        const x = (u / size - 0.5) * sz * 2;
        const y = (v / size - 0.5) * sz * 2;

        let dhdx = 0,
          dhdy = 0;

        const d1 = new THREE.Vector2(1, 0.3).normalize();
        const p1 = new THREE.Vector2(x, y);
        const phase1 = p1.dot(d1) * 0.8;
        dhdx += 0.08 * Math.cos(phase1) * d1.x * 0.8;
        dhdy += 0.08 * Math.cos(phase1) * d1.y * 0.8;

        const d2 = new THREE.Vector2(-0.4, 1).normalize();
        const p2 = new THREE.Vector2(x, y);
        const phase2 = p2.dot(d2) * 1.1;
        dhdx += 0.05 * Math.cos(phase2) * d2.x * 1.1;
        dhdy += 0.05 * Math.cos(phase2) * d2.y * 1.1;

        const d3 = new THREE.Vector2(0.2, -0.8).normalize();
        const p3 = new THREE.Vector2(x, y);
        const phase3 = p3.dot(d3) * 1.6;
        dhdx += 0.03 * Math.cos(phase3) * d3.x * 1.6;
        dhdy += 0.03 * Math.cos(phase3) * d3.y * 1.6;

        const nx = -dhdx;
        const ny = -dhdy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nnx = nx / len;
        const nny = ny / len;

        const idx = (v * size + u) * 4;
        data[idx] = Math.round((nnx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round((nny * 0.5 + 0.5) * 255);
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }

    return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  getMenuNodes(): PreviewMenuNode[] {
    return buildWaterNodes(this);
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      size: envState.waterSize,
      enabled: this.enabled,
      waterEnabled: envState.waterEnabled,
      waterMode: envState.waterMode,
      waterWetness: envState.waterWetness,
      waterColor: envState.waterColor,
      waterOpacity: envState.waterOpacity,
      waterNormalStrength: envState.waterNormalStrength,
      waterClarity: envState.waterClarity,
      waterWaveSpeed: envState.waterWaveSpeed,
      waterPoolHeight: envState.waterPoolHeight,
      waterPoolWallThickness: envState.waterPoolWallThickness,
      waterPoolWallColor: envState.waterPoolWallColor,
      waterPoolRoundness: envState.waterPoolRoundness,
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    let state = restoreState(this.id) as Record<string, unknown> | null;
    // code_review 9fe958249 #2/#3：legacy.water 解包后 state.water 不存在 → 下方
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
    restoreFields(state, {
      enabled: { boolean: (v) => (this.enabled = v) },
      size: { number: (v) => setEnvState({ waterSize: v }, { source: "manual" }) },
    });
    // 归一化：V2/旧格式水面参数在 state.water 嵌套对象；新 flat 存档直接平铺在顶层。
    // 子域开关键随格式不同：V2 嵌套用 enabled；flat 用顶层 waterEnabled。
    const nested = fromNestedLegacy
      ? state // legacy.water 解包内容即嵌套方言（含 enabled 子域开关）
      : state.water && typeof state.water === "object"
        ? (state.water as Record<string, unknown>)
        : null;
    const w = (nested ?? state) as Record<string, unknown>;
    restoreFields(w, {
      // 子域开关：仅当取到嵌套对象时 w.enabled 才是子域开关（顶层 enabled=能力级，已在上方处理）
      ...(nested
        ? { enabled: { boolean: (v) => this.setWaterEnabled(v) } }
        : { waterEnabled: { boolean: (v) => this.setWaterEnabled(v) } }),
      // 新旧键双轨（restoreFields 对缺失键安全跳过；实际存档只含一种方言）
      mode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
      waterMode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
      wetness: { number: (v) => this.setWetness(v) },
      waterWetness: { number: (v) => this.setWetness(v) },
      waterColor: { number: (v) => this.setWaterColor(v) },
      waterOpacity: { number: (v) => this.setWaterOpacity(v) },
      normalStrength: { number: (v) => this.setNormalStrength(v) },
      waterNormalStrength: { number: (v) => this.setNormalStrength(v) },
      waveSpeed: { number: (v) => this.setWaveSpeed(v) },
      waterWaveSpeed: { number: (v) => this.setWaveSpeed(v) },
      clarity: { number: (v) => this.setClarity(v) },
      waterClarity: { number: (v) => this.setClarity(v) },
      poolHeight: { number: (v) => this.setPoolHeight(v) },
      waterPoolHeight: { number: (v) => this.setPoolHeight(v) },
      poolWallThickness: { number: (v) => this.setPoolWallThickness(v) },
      waterPoolWallThickness: { number: (v) => this.setPoolWallThickness(v) },
      poolWallColor: { number: (v) => this.setPoolWallColor(v) },
      waterPoolWallColor: { number: (v) => this.setPoolWallColor(v) },
      poolRoundness: { number: (v) => this.setPoolRoundness(v) },
      waterPoolRoundness: { number: (v) => this.setPoolRoundness(v) },
    });
  }

  /** 移除并释放 */
  dispose(): void {
    this.unsubscribeEnv();
    if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    this.disposeWater();
    if (this.normalMapCache) {
      safeDispose(this.normalMapCache);
      this.normalMapCache = null;
      this.normalMapCacheSize = -1;
    }
  }
}
