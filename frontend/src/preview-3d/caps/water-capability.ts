// ===== WaterCapability：水面能力（2026-08-28 从 GroundCapability 解耦为独立能力）=====
// 独立前水面是 GroundCapability 的「双子域」；拆分后成为环境面板一等公民（与 sky/ground 平级）。
// 波浪 shader 注入（onBeforeCompile）+ 程序化法线贴图（generateNormalMap）仍为水面专属技术基盘，
// 不与他人共享，故不另抽共享模块（YAGNI）。实现 SceneCapability 统一接口，
// 由 scene-capability-registry 自动发现 + 菜单控件 + 持久化。

import * as THREE from "three";
import { safeDispose } from "../safe-dispose.ts";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
  createListenerSet,
} from "./scene-capability.ts";

/** 水面呈现模式：film=贴地薄水膜；pool=立体水池（有侧壁 + 高度） */
export type WaterMode = "film" | "pool";
const WATER_MODES: readonly WaterMode[] = ["film", "pool"];

export interface WaterParams {
  /** 水面平面尺寸（世界单位；默认对齐地面 size=80，保证视觉一致） */
  size: number;
  /** 水面是否独立启用（总开关；默认 true） */
  enabled: boolean;
  /** 水面呈现模式 */
  mode: WaterMode;
  /** 湿润度 0=干 1=完全湿润；film 模式下相当于乘 opacity 的遮罩 */
  wetness: number;
  /** 水面颜色（film/pool 顶部共用） */
  waterColor: number;
  /** 水面不透明度 0=透明 1=不透明 */
  waterOpacity: number;
  /** 波浪法线强度 0=无效果 1=完全按波浪法线 */
  normalStrength: number;
  /** （pool）水池高度（从 y=0 起的正高度，世界单位） */
  poolHeight: number;
  /** （pool）池壁厚度（太小会 z-fighting；≥0.05） */
  poolWallThickness: number;
  /** （pool）池壁外侧面颜色（与水面形成内外对比） */
  poolWallColor: number;
  /** （pool）边缘羽化/圆角半径 0~0.5（0=直角；材质级，无几何重建成本） */
  poolRoundness: number;
  /** 波纹动画速度倍率（1=原速；0=静止） */
  waveSpeed: number;
  /** 水体通透度（物理 transmission：0=完全浑浊，1=完全透射） */
  clarity: number;
}

export const DEFAULT_WATER_PARAMS: WaterParams = {
  size: 80,
  enabled: true,
  mode: "film",
  wetness: 0.15,
  waterColor: 0x335577,
  waterOpacity: 0.25,
  normalStrength: 0.08,
  poolHeight: 0.3,
  poolWallThickness: 0.15,
  poolWallColor: 0x1a2a44,
  poolRoundness: 0,
  waveSpeed: 1.0,
  clarity: 0.6,
};

export class WaterCapability implements SceneCapability {
  readonly id = "water";
  readonly labelKey = "preview.water";
  readonly icon = "💧";
  readonly descKey = "preview.waterDesc";

  private scene: THREE.Scene;
  /** 水面容器：film 模式是 Mesh，pool 模式是 Group（含顶/底/四壁）；name 恒为 "ysm-ground-water" */
  private water: THREE.Object3D;
  private waterTime: { value: number }; // 水面波纹动画 time uniform（波速倍率 = waveSpeed）
  private params: WaterParams;
  private enabled: boolean;
  /** 参数变更监听（menu 局部刷新用）；仅模式切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<WaterParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_WATER_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.waterTime = { value: 0 };
    this.water = this.rebuildWaterContainer(true);
  }

  // ── 水材质（波浪 shader + 法线贴图）：film 顶 / pool 顶 共用，避免技术分叉 ──
  private buildWaveWaterMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial {
    const w = this.params;
    // 升级到 MeshPhysicalMaterial：pool 模式用 transmission/thickness 体现「水体厚度感」，film 仍降级为原视觉
    const mat = new THREE.MeshPhysicalMaterial({
      color: w.waterColor,
      transparent: true,
      opacity: w.waterOpacity * (opts.forPool ? 1 : w.wetness), // film 仍 × wetness 做薄水膜遮罩
      roughness: 0.15,
      metalness: opts.forPool ? 0.0 : 0.3,
      depthWrite: false,
      // 仅 pool 透射；film 保持原视觉不启 transmission（避免反射计算额外开销）
      transmission: opts.forPool ? w.clarity : 0,
      thickness: opts.forPool ? Math.max(0.01, w.poolHeight * 0.5) : 0,
      clearcoat: opts.forPool ? 0.8 : 0,
      clearcoatRoughness: 0.1,
    });

    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      mat.userData.shader = shader;
      shader.uniforms["uTime"] = this.waterTime;
      // 边缘羽化（pool 专用）：距离边 d < roundness*size/2 时 opacity 平滑衰减
      const round = Math.max(0, Math.min(0.5, w.poolRoundness));
      shader.uniforms["uRoundness"] = { value: opts.forPool ? round : 0 };
      shader.uniforms["uHalfSize"] = { value: this.params.size / 2 };
      shader.uniforms["uBaseOpacity"] = { value: mat.opacity };
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
      // opacity 注入：fragment 在输出前应用 smoothstep 衰减边缘（只对 roundness > 0 生效；film 不影响）
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         varying vec3 vWorldPos_wave;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        "void main() {\n",
      );
      // 在结尾赋值 opacity 前（Three r185 先由 #include <opaque_fragment> / 透明度分支赋值 diffuseColor.a）做一次覆盖
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         if (uRoundness > 0.0) {
           vec2 p = vWorldPos_wave.xz;
           float md = max(abs(p.x), abs(p.y)); // 切比雪夫距离（长方形边长距边缘）
           float edge = uHalfSize - uRoundness * uHalfSize;
           float fade = 1.0 - smoothstep(edge, uHalfSize, md);
           gl_FragColor.a *= fade;
         }
         // 保证 baseOpacity（由 opacity 属性）被尊重（PhysicalMaterial transmission 路径可能改写 a）
         gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);`,
      );
    };
    mat.needsUpdate = true;

    const normalMap = this.generateNormalMap(256);
    (mat as THREE.MeshPhysicalMaterial & { normalMap: THREE.DataTexture | null }).normalMap = normalMap;
    (mat as THREE.MeshPhysicalMaterial & { normalScale: THREE.Vector2 }).normalScale = new THREE.Vector2(w.normalStrength, w.normalStrength);
    mat.needsUpdate = true;
    return mat;
  }

  /** 遍历收集某个容器（Mesh/Group）下的所有 mesh，用于同步 material 参数 */
  private collectWaterMeshes(root: THREE.Object3D = this.water): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) out.push(m);
    });
    return out;
  }

  /** 从 water 根容器中筛选出「顶水面」（波浪材质）：film 直接 this.water 作为 mesh；pool 下通过 name === "ysm-water-top" 匹配 */
  private findTopWater(): THREE.Mesh | null {
    if (this.params.mode === "film" && (this.water as THREE.Mesh).isMesh) {
      return this.water as THREE.Mesh;
    }
    const meshes = this.collectWaterMeshes(this.water);
    return meshes.find((m) => m.name === "ysm-water-top") ?? null;
  }

  /** 构造 film 模式水面（贴地薄水膜，旧实现语义兼容 + 升级到 PhysicalMaterial 但关闭 transmission） */
  private createFilmMesh(): THREE.Mesh {
    const waterGeo = new THREE.PlaneGeometry(this.params.size, this.params.size, 32, 32);
    const waterMat = this.buildWaveWaterMaterial({ forPool: false });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.01;
    water.name = "ysm-ground-water";
    return water;
  }

  /** 构造 pool 模式盒式凹形水池：顶水面（带波浪）+ 底（贴地）+ 四壁（内外层双材质） */
  private createPoolGroup(): THREE.Group {
    const size = this.params.size;
    const half = size / 2;
    const h = Math.max(0.01, this.params.poolHeight);
    const w = this.params;
    const group = new THREE.Group();
    group.name = "ysm-ground-water";

    // 顶水面（带波浪 shader，位于 y = h）
    const topGeo = new THREE.PlaneGeometry(size, size, 32, 32);
    const topMat = this.buildWaveWaterMaterial({ forPool: true });
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = h;
    top.name = "ysm-water-top";
    group.add(top);

    // 底平面（贴 y=0，用 poolWallColor 实色，放在水里防止外部透过去看到地下空洞）
    const bottomMat = new THREE.MeshStandardMaterial({ color: w.poolWallColor, side: THREE.DoubleSide, roughness: 0.9 });
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(size, size), bottomMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.0001; // 微抬，防与地面 z-fighting
    bottom.name = "ysm-water-bottom";
    group.add(bottom);

    // 内侧水四壁（transmission + 水色，视觉为「水体侧边界」）
    const innerMat = new THREE.MeshPhysicalMaterial({
      color: w.waterColor,
      transparent: true,
      opacity: w.waterOpacity * 0.85,
      side: THREE.BackSide, // BackSide：从池子内部看内壁着色（朝里可见）
      roughness: 0.1,
      metalness: 0,
      transmission: w.clarity * 0.5,
      thickness: w.poolWallThickness,
      depthWrite: false,
    });
    // 外侧池壁（朝外，wallColor，不透明）
    const outerMat = new THREE.MeshStandardMaterial({
      color: w.poolWallColor,
      side: THREE.FrontSide,
      roughness: 0.8,
      metalness: 0,
    });

    // 每壁：inner + outer 两块 mesh 叠加（厚度由位置偏移产生）
    const wallPairs: Array<{
      name: string;
      // 四壁轴向："ns"（沿 x，北/南 z 固定）/ "ew"（沿 z，东/西 x 固定）
      axis: "ns" | "ew";
      pos: THREE.Vector3; // inner 位置
      outerPos: THREE.Vector3; // outer 位置
      rotY?: number; // 0 默认（Plane 默认法向 +z）；90°（π/2）用于 ew 轴墙
    }> = [
      // 北壁（z=-half，面朝 +z 即池内观察者南视方向）
      {
        name: "ysm-water-wall-n", axis: "ns",
        pos: new THREE.Vector3(0, h / 2, -half),
        outerPos: new THREE.Vector3(0, h / 2, -half - w.poolWallThickness),
      },
      // 南壁（z=+half，面朝 -z）
      {
        name: "ysm-water-wall-s", axis: "ns",
        pos: new THREE.Vector3(0, h / 2, half),
        outerPos: new THREE.Vector3(0, h / 2, half + w.poolWallThickness),
        rotY: Math.PI,
      },
      // 东壁（x=+half，面朝 -x）—— Plane 需绕 y 转 -π/2
      {
        name: "ysm-water-wall-e", axis: "ew",
        pos: new THREE.Vector3(half, h / 2, 0),
        outerPos: new THREE.Vector3(half + w.poolWallThickness, h / 2, 0),
        rotY: -Math.PI / 2,
      },
      // 西壁（x=-half，面朝 +x）
      {
        name: "ysm-water-wall-w", axis: "ew",
        pos: new THREE.Vector3(-half, h / 2, 0),
        outerPos: new THREE.Vector3(-half - w.poolWallThickness, h / 2, 0),
        rotY: Math.PI / 2,
      },
    ];

    for (const pair of wallPairs) {
      // 每块 plane：宽 = (ns → size; ew → size)，高 = h（水池高度）
      const geoSizeW = pair.axis === "ns" ? size : size;
      const innerGeo = new THREE.PlaneGeometry(geoSizeW, h, 4, 4);
      const outerGeo = new THREE.PlaneGeometry(geoSizeW, h + Math.max(0.02, w.poolWallThickness * 0.6), 4, 4); // 外壁略高，覆盖顶底接缝
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.name = pair.name + "-inner";
      inner.position.copy(pair.pos);
      if (pair.rotY) inner.rotation.y = pair.rotY;
      const outer = new THREE.Mesh(outerGeo, outerMat);
      outer.name = pair.name + "-outer";
      outer.position.copy(pair.outerPos);
      if (pair.rotY) outer.rotation.y = pair.rotY;
      group.add(inner, outer);
    }

    return group;
  }

  /** 释放旧 water 容器（递归所有子 mesh 的 geometry + material + normalMap），并从 scene 暂移除 */
  private disposeWater(): void {
    if (this.water.parent) this.water.parent.remove(this.water);
    const meshes = this.collectWaterMeshes(this.water);
    for (const m of meshes) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        // 释放 normalMap / transmission / Physical 内部资源（尽量拆安全引用）
        const asStandard = mat as THREE.MeshStandardMaterial & {
          normalMap?: THREE.Texture | null;
        };
        if (asStandard?.normalMap) safeDispose(asStandard.normalMap);
        mat.dispose();
      }
    }
  }

  /**
   * 重建 this.water 根容器（film↔pool 切换入口，new 时初次构建传 initial=true 不 dispose 旧实例）。
   * 重建后保持 name="ysm-ground-water"，scene.add 幂等由 apply() 兜底。
   */
  private rebuildWaterContainer(initial = false): THREE.Object3D {
    // 重建前记录旧容器是否已在场景内（apply 过），重建后需原样挂回
    const wasInScene = !initial && this.water.parent != null;
    if (!initial) this.disposeWater();
    const container = this.params.mode === "pool"
      ? this.createPoolGroup()
      : this.createFilmMesh();
    // 初始化或模式切换后的可见性：由 syncWaterVisibility 统一裁决
    this.water = container;
    this.syncWaterVisibility();
    // 旧 water 本来就在场景里（apply 过）→ 重建完重新挂进去；新容器 parent 此刻为 null，不能靠 parent 判
    if (wasInScene && this.enabled) {
      this.scene.add(this.water);
    }
    return this.water;
  }

  /** 水面可见性：enabled（能力级） ∧ water.enabled（子域开关） ∧（film → wetness>0；pool → 恒开） */
  private syncWaterVisibility(): void {
    const w = this.params;
    const filmOn = w.mode === "film" && w.wetness > 0;
    const poolOn = w.mode === "pool";
    const shouldShow = w.enabled && (filmOn || poolOn);
    this.water.visible = shouldShow;
  }

  /** 推进水面波纹动画（render loop 调用） */
  update(dt: number): void {
    if (!this.enabled || !this.params.enabled || !this.water.visible) return;
    this.waterTime.value += dt * this.params.waveSpeed;
  }

  /** 挂入场景（对齐 SceneCapability.apply 口径） */
  apply(): void {
    if (!this.enabled) return;
    if (!this.water.parent) this.scene.add(this.water);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.water.parent) this.water.parent.remove(this.water);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── 水面：独立开关 / 形态切换 ──
  setWaterEnabled(v: boolean): void {
    this.params.enabled = v;
    this.syncWaterVisibility();
  }
  getWaterEnabled(): boolean { return this.params.enabled; }

  setWaterMode(m: WaterMode): void {
    if (this.params.mode === m) return;
    this.params.mode = m;
    this.rebuildWaterContainer(false);
    // 首次切 pool 时，film 语义的 wetness 不再直接控制 opacity，但仍保留值以允许切回 film
    this.notify(); // 模式切换改变水面分组可见性（pool 控件仅 pool、wetness 仅 film），通知菜单局部刷新
  }

  /** 订阅参数变更（模式切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }
  getWaterMode(): WaterMode { return this.params.mode; }

  // ── 水面参数（film + pool 通用）──
  setWetness(v: number): void {
    this.params.wetness = Math.max(0, Math.min(1, v));
    if (this.params.mode === "film") {
      const top = this.water as THREE.Mesh; // film 模式 this.water 恒为 Mesh
      const mat = top.material as THREE.MeshPhysicalMaterial;
      mat.opacity = this.params.waterOpacity * this.params.wetness;
      // 反射回 uniform：onBeforeCompile 注入的 uBaseOpacity 是 snapshot，material.opacity 变化同步
      if ((mat as unknown as { userData: { shader?: THREE.WebGLProgramParametersWithUniforms } }).userData?.shader?.uniforms?.uBaseOpacity) {
        (mat as unknown as { userData: { shader: { uniforms: { uBaseOpacity: { value: number } } } } }).userData.shader.uniforms.uBaseOpacity.value = mat.opacity;
      }
    }
    this.syncWaterVisibility();
  }
  getWetness(): number { return this.params.wetness; }

  setWaterColor(hex: number): void {
    this.params.waterColor = hex;
    // film：顶层 mesh；pool：顶 mesh + 四壁 inner mesh
    const targets = this.params.mode === "film"
      ? [this.water as THREE.Mesh]
      : this.collectWaterMeshes().filter((m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"));
    for (const m of targets) {
      const mat = m.material as THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
      if ("color" in mat) mat.color.setHex(hex);
    }
  }
  getWaterColor(): number { return this.params.waterColor; }

  setWaterOpacity(v: number): void {
    this.params.waterOpacity = Math.max(0, Math.min(1, v));
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshPhysicalMaterial;
      const newOp = this.params.mode === "film"
        ? this.params.waterOpacity * this.params.wetness
        : this.params.waterOpacity;
      mat.opacity = newOp;
    }
  }
  getWaterOpacity(): number { return this.params.waterOpacity; }

  // ── 法线贴图强度（顶层水面）──
  setNormalStrength(v: number): void {
    this.params.normalStrength = Math.max(0, Math.min(1, v));
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshStandardMaterial;
      mat.normalScale?.set(this.params.normalStrength, this.params.normalStrength);
    }
  }
  getNormalStrength(): number { return this.params.normalStrength; }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number): void {
    this.params.poolHeight = Math.max(0.01, v);
    if (this.params.mode === "pool") this.rebuildWaterContainer(false); // 几何高度需要重排
  }
  getPoolHeight(): number { return this.params.poolHeight; }

  setPoolWallThickness(v: number): void {
    this.params.poolWallThickness = Math.max(0.01, v);
    if (this.params.mode === "pool") this.rebuildWaterContainer(false);
  }
  getPoolWallThickness(): number { return this.params.poolWallThickness; }

  setPoolWallColor(hex: number): void {
    this.params.poolWallColor = hex;
    // pool 底 + 四壁 outer：同步改色；pool 非生效时先存参数，下次 rebuild 会用上
    const meshes = this.collectWaterMeshes();
    for (const m of meshes) {
      if (m.name.endsWith("-outer") || m.name === "ysm-water-bottom") {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.setHex(hex);
      }
    }
  }
  getPoolWallColor(): number { return this.params.poolWallColor; }

  setPoolRoundness(v: number): void {
    this.params.poolRoundness = Math.max(0, Math.min(0.5, v));
    // 直接修改 uniform：material 的 userData.shader（若已编译）中的 uRoundness
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshPhysicalMaterial;
      const shader = (mat as unknown as { userData: { shader?: { uniforms: { uRoundness?: { value: number } } } } }).userData?.shader;
      if (shader?.uniforms?.uRoundness) shader.uniforms.uRoundness.value = this.params.poolRoundness;
    }
  }
  getPoolRoundness(): number { return this.params.poolRoundness; }

  setWaveSpeed(v: number): void { this.params.waveSpeed = Math.max(0, v); }
  getWaveSpeed(): number { return this.params.waveSpeed; }
  setClarity(v: number): void {
    this.params.clarity = Math.max(0, Math.min(1, v));
    // pool 顶 mesh + inner walls 已构建 → 需要改 material.transmission；否则下次 buildWaveWaterMaterial 时天然使用新值
    if (this.params.mode === "pool") {
      const targets = this.collectWaterMeshes().filter(
        (m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"),
      );
      for (const m of targets) {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        if ("transmission" in mat) {
          mat.transmission = m.name === "ysm-water-top" ? this.params.clarity : this.params.clarity * 0.5;
          mat.needsUpdate = true;
        }
      }
    }
  }
  getClarity(): number { return this.params.clarity; }

  // ── 程序化法线贴图生成 ──
  private generateNormalMap(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const sz = this.params.size;

    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        // 归一化到波浪空间
        const x = (u / size - 0.5) * sz * 2;
        const y = (v / size - 0.5) * sz * 2;

        let dhdx = 0, dhdy = 0;

        // Wave 1: dir=(1,0.3) normalized, freq=0.8, amp=0.08
        const d1 = new THREE.Vector2(1, 0.3).normalize();
        const p1 = new THREE.Vector2(x, y);
        const phase1 = p1.dot(d1) * 0.8;
        dhdx += 0.08 * Math.cos(phase1) * d1.x * 0.8;
        dhdy += 0.08 * Math.cos(phase1) * d1.y * 0.8;

        // Wave 2: dir=(-0.4,1) normalized, freq=1.1, amp=0.05
        const d2 = new THREE.Vector2(-0.4, 1).normalize();
        const p2 = new THREE.Vector2(x, y);
        const phase2 = p2.dot(d2) * 1.1;
        dhdx += 0.05 * Math.cos(phase2) * d2.x * 1.1;
        dhdy += 0.05 * Math.cos(phase2) * d2.y * 1.1;

        // Wave 3: dir=(0.2,-0.8) normalized, freq=1.6, amp=0.03
        const d3 = new THREE.Vector2(0.2, -0.8).normalize();
        const p3 = new THREE.Vector2(x, y);
        const phase3 = p3.dot(d3) * 1.6;
        dhdx += 0.03 * Math.cos(phase3) * d3.x * 1.6;
        dhdy += 0.03 * Math.cos(phase3) * d3.y * 1.6;

        // 组合法线：N = (-dh/dx, -dh/dy, 1) 归一化
        const nx = -dhdx;
        const ny = -dhdy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nnx = nx / len;
        const nny = ny / len;

        // 编码到 RGB
        const idx = (v * size + u) * 4;
        data[idx] = Math.round((nnx * 0.5 + 0.5) * 255);       // R
        data[idx + 1] = Math.round((nny * 0.5 + 0.5) * 255);   // G
        data[idx + 2] = 255;                                     // B (朝上)
        data[idx + 3] = 255;                                     // A
      }
    }

    return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  }

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return gcBuildWaterGroup(this);
  }

  /** 保存状态到 localStorage（water 键；legacy "ground" 键的水字段不再由本能力写） */
  saveState(): void {
    persistState(this.id, {
      size: this.params.size,
      enabled: this.enabled,
      water: { ...this.params },
      // V1→V2 迁移兼容：保留旧字段（V2 仍能被 V1 loadState 读到水相关字段做兜底）
      wetness: this.params.wetness,
      waterColor: this.params.waterColor,
      waterOpacity: this.params.waterOpacity,
      normalStrength: this.params.normalStrength,
    });
  }

  /** 从 localStorage 恢复状态（texture 模式二进制未持久化 → 回退 plain；V1→V2 自动迁移） */
  loadState(): void {
    // 优先读本能力专属键 "water"
    let state = restoreState(this.id) as Record<string, unknown> | null;
    // 回退：旧存档水面数据在 "ground" 键里（拆分前），做一次迁移
    if (!state) {
      const legacy = restoreState("ground") as Record<string, unknown> | null;
      if (legacy) {
        const lw = legacy.water;
        if (lw && typeof lw === "object") {
          state = lw as Record<string, unknown>;
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
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.size === "number") this.params.size = state.size;
    // V2 新格式：state.water 嵌套对象（优先走）
    const w = (state.water ?? state) as Partial<WaterParams>;
    if (typeof w.enabled === "boolean") this.setWaterEnabled(w.enabled);
    if (typeof w.mode === "string" && WATER_MODES.includes(w.mode as WaterMode)) {
      this.setWaterMode(w.mode as WaterMode);
    }
    if (typeof w.wetness === "number") this.setWetness(w.wetness);
    if (typeof w.waterColor === "number") this.setWaterColor(w.waterColor);
    if (typeof w.waterOpacity === "number") this.setWaterOpacity(w.waterOpacity);
    if (typeof w.normalStrength === "number") this.setNormalStrength(w.normalStrength);
    if (typeof w.waveSpeed === "number") this.setWaveSpeed(w.waveSpeed);
    if (typeof w.clarity === "number") this.setClarity(w.clarity);
    // pool 专属参数：值先 set；若当前模式非 pool，setter 只存参数不 rebuild
    if (typeof w.poolHeight === "number") this.setPoolHeight(w.poolHeight);
    if (typeof w.poolWallThickness === "number") this.setPoolWallThickness(w.poolWallThickness);
    if (typeof w.poolWallColor === "number") this.setPoolWallColor(w.poolWallColor);
    if (typeof w.poolRoundness === "number") this.setPoolRoundness(w.poolRoundness);
  }

  /** 移除并释放 */
  dispose(): void {
    if (this.water.parent) this.water.parent.remove(this.water);
    this.disposeWater();
  }
}

// ── 菜单控件工厂（水面专属）──
// 按功能分区，使环境面板「水面 ›」下钻为 形态 / 外观 / 水池 / 波纹 四个子区，
// 而非单折叠平铺全部控件；启用水面（enabled）无 group → 作为 cap 根行主控件，不进子区。
const WATER_GROUP_FORM = "preview.waterGroupForm";   // 形态
const WATER_GROUP_LOOK = "preview.waterGroupLook";   // 外观
const WATER_GROUP_POOL = "preview.waterGroupPool";   // 水池
const WATER_GROUP_WAVE = "preview.waterGroupWave";   // 波纹

function gcBuildWaterGroup(cap: WaterCapability): MenuControlDef[] {
  const wSlider = (
    id: string,
    labelKey: string,
    fallback: string,
    group: string,
    slider: { min: number; max: number; step: number; unit?: string },
    getValue: () => number,
    setValue: (v: number) => void,
    visible?: () => boolean,
  ): MenuControlDef => ({
    id, kind: "slider", labelKey, fallback, group, slider,
    getValue, setValue: (v) => setValue(v as number),
    ...(visible ? { visible } : {}),
  });
  const wColor = (
    id: string, labelKey: string, fallback: string, group: string,
    getValue: () => number, setValue: (v: number) => void,
    visible?: () => boolean,
  ): MenuControlDef => ({
    id, kind: "color", labelKey, fallback, group,
    getValue, setValue: (v) => setValue(v as number),
    ...(visible ? { visible } : {}),
  });
  return [
    {
      // 无 group → 成为 cap 根行主控件（与 sky/ground 对齐），下钻子视图不再重复出现
      id: "ground-water-enabled",
      kind: "toggle",
      labelKey: "preview.groundWaterEnabled",
      fallback: "启用水面",
      getValue: () => cap.getWaterEnabled(),
      setValue: (v) => cap.setWaterEnabled(v as boolean),
    },
    // ── 形态 ──
    {
      id: "ground-water-mode",
      kind: "select",
      labelKey: "preview.groundWaterMode",
      fallback: "水面形态",
      group: WATER_GROUP_FORM,
      select: [
        { value: "film", label: "薄膜" },
        { value: "pool", label: "水池" },
      ],
      getValue: () => cap.getWaterMode(),
      setValue: (v) => cap.setWaterMode(v as WaterMode),
    },
    wSlider(
      "ground-wetness", "preview.waterFilmDensity", "水膜浓度", WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getWetness(), (v) => cap.setWetness(v),
      () => cap.getWaterMode() === "film", // 仅薄膜模式：pool 下 wetness 不参与 opacity（见 buildWaveWaterMaterial）
    ),
    // ── 外观 ──
    wColor("ground-water-color", "preview.groundWaterColor", "水色", WATER_GROUP_LOOK,
      () => cap.getWaterColor(), (v) => cap.setWaterColor(v)),
    wSlider(
      "ground-water-opacity", "preview.groundWaterOpacity", "不透明度", WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getWaterOpacity(), (v) => cap.setWaterOpacity(v),
    ),
    wSlider(
      "ground-normal-strength", "preview.groundNormalStrength", "法线强度", WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getNormalStrength(), (v) => cap.setNormalStrength(v),
    ),
    wSlider(
      "ground-water-clarity", "preview.groundWaterClarity", "水体通透度", WATER_GROUP_LOOK,
      { min: 0, max: 1, step: 0.05 },
      () => cap.getClarity(), (v) => cap.setClarity(v),
    ),
    // ── 水池（仅 pool 模式可见；film 下为死控件，故条件隐藏）──
    wSlider(
      "ground-pool-height", "preview.groundPoolHeight", "水池高度", WATER_GROUP_POOL,
      { min: 0.01, max: 5, step: 0.05, unit: "m" },
      () => cap.getPoolHeight(), (v) => cap.setPoolHeight(v),
      () => cap.getWaterMode() === "pool",
    ),
    wSlider(
      "ground-pool-wall-thickness", "preview.groundPoolWallThickness", "池壁厚度", WATER_GROUP_POOL,
      { min: 0.01, max: 2, step: 0.01, unit: "m" },
      () => cap.getPoolWallThickness(), (v) => cap.setPoolWallThickness(v),
      () => cap.getWaterMode() === "pool",
    ),
    wColor("ground-pool-wall-color", "preview.groundPoolWallColor", "池壁颜色", WATER_GROUP_POOL,
      () => cap.getPoolWallColor(), (v) => cap.setPoolWallColor(v),
      () => cap.getWaterMode() === "pool"),
    wSlider(
      "ground-pool-roundness", "preview.groundPoolRoundness", "边缘圆角", WATER_GROUP_POOL,
      { min: 0, max: 0.5, step: 0.01 },
      () => cap.getPoolRoundness(), (v) => cap.setPoolRoundness(v),
      () => cap.getWaterMode() === "pool",
    ),
    // ── 波纹 ──
    wSlider(
      "ground-wave-speed", "preview.groundWaveSpeed", "波速", WATER_GROUP_WAVE,
      { min: 0, max: 3, step: 0.05, unit: "x" },
      () => cap.getWaveSpeed(), (v) => cap.setWaveSpeed(v),
    ),
  ];
}
