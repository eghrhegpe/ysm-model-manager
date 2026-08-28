// ===== GroundCapability：地面能力（ADR-073 同款 caps/ 能力模式）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + 表面材质层（spec 单源，见 ground-surface-spec.ts）+ 水面叠加层；
// apply() 挂入场景，dispose() 移除并释放，作用域不泄漏到其它预览
// （对齐 SkyCapability 生命周期口径）。实现 SceneCapability 统一接口，
// 支持注册表自动发现 + 菜单控件 + 持久化。

import * as THREE from "three";
import { safeDispose } from "../safe-dispose.ts";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";
import {
  DEFAULT_GROUND_SURFACE_PARAMS,
  buildGroundSurfaceSpec,
  groundSurfaceNeedsRebuild,
  generateSurfacePixels,
  applyGroundSurfaceStructural,
  applyGroundSurfaceAppearance,
  type GroundMaterialParams,
  type GroundSurfaceMode,
  type GroundSurfaceSpec,
  type GroundSurfaceStructuralSpec,
} from "./ground-surface-spec.ts";
import { dbg } from "../../debug/debug.ts";

/** 程序化表面纹理边长（plain/grid/checker 共用；512² 够细且重建成本低） */
const SURFACE_TEX_SIZE = 512;
/** matSource 合法值白名单（loadState 校验用） */
const GROUND_SURFACE_MODES: readonly GroundSurfaceMode[] = [
  "none", "solid", "plain", "grid", "checker", "texture", "stripes", "diamond", "marble",
];

/** 水面呈现模式：film=贴地薄水膜；pool=立体水池（有侧壁 + 高度） */
export type WaterMode = "film" | "pool";
const WATER_MODES: readonly WaterMode[] = ["film", "pool"];

export interface WaterParams {
  /** 水面是否独立启用（总开关，与地面 visible 无关；默认 true） */
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

export interface GroundParams extends GroundMaterialParams {
  /** 地面网格尺寸（世界单位） */
  size: number;
  /** 网格分段 */
  divisions: number;
  /** 中心轴线颜色 */
  colorCenter: number;
  /** 网格线颜色 */
  colorGrid: number;
  /** 地面初始可见 */
  visible: boolean;
  /** 水面参数（嵌套：未来继续加水属性不需要改 GroundParams 顶层签名） */
  water: WaterParams;
}

export const DEFAULT_GROUND_PARAMS: GroundParams = {
  ...DEFAULT_GROUND_SURFACE_PARAMS, // mat* 材质字段（matSource 默认 none）
  size: 80,
  divisions: 60,
  colorCenter: 0x555577,
  colorGrid: 0x2a2a3a,
  visible: true,
  water: { ...DEFAULT_WATER_PARAMS },
};

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "🌐";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  /** 水面容器：film 模式是 Mesh，pool 模式是 Group（含顶/底/四壁）；name 恒为 "ysm-ground-water" */
  private water: THREE.Object3D;
  private waterTime: { value: number }; // 水面波纹动画 time uniform（波速倍率 = waveSpeed）
  private surface: THREE.Mesh; // 表面材质层（spec 单源驱动；matSource=none 时隐藏）
  private surfaceMat: THREE.MeshStandardMaterial | null = null; // 当前表面材质（重建时换新）
  private surfaceTex: THREE.Texture | null = null; // 当前挂载纹理（自建才 dispose）
  private surfaceSpec: GroundSurfaceSpec | null = null; // 当前 spec（重建判别基准）
  private customTex: THREE.Texture | null = null; // 自定义贴图缓存（独立于材质生命周期）
  private customTexName = ""; // 自定义贴图文件名（菜单 hint + token）
  private params: GroundParams;
  private enabled: boolean;

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<GroundParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    // 合并 params.water（嵌套对象浅合并：保证传参部分覆盖默认不丢其他字段）
    const waterMerged = { ...DEFAULT_WATER_PARAMS, ...(opts.params?.water ?? {}) };
    const optsWithoutWater = { ...(opts.params ?? {}) } as Partial<GroundParams>;
    delete (optsWithoutWater as { water?: unknown }).water;
    this.params = { ...DEFAULT_GROUND_PARAMS, ...optsWithoutWater, water: waterMerged };
    this.enabled = opts.enabled ?? true;
    this.waterTime = { value: 0 };
    this.grid = this.createGridHelper();
    this.water = this.rebuildWaterContainer(true);
    this.surface = this.createSurfaceMesh();
  }

  private createGridHelper(): THREE.GridHelper {
    const grid = new THREE.GridHelper(
      this.params.size,
      this.params.divisions,
      this.params.colorCenter,
      this.params.colorGrid,
    );
    grid.visible = this.params.visible;
    grid.name = "ysm-ground";
    return grid;
  }

  // ── 水材质（波浪 shader + 法线贴图）：film 顶 / pool 顶 共用，避免技术分叉 ──
  private buildWaveWaterMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial {
    const w = this.params.water;
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
    if (this.params.water.mode === "film" && (this.water as THREE.Mesh).isMesh) {
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
    const h = Math.max(0.01, this.params.water.poolHeight);
    const w = this.params.water;
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
    if (!initial) this.disposeWater();
    const container = this.params.water.mode === "pool"
      ? this.createPoolGroup()
      : this.createFilmMesh();
    // 初始化或模式切换后的可见性：由 syncWaterVisibility 统一裁决
    this.water = container;
    this.syncWaterVisibility();
    // 如果旧 water 本来就在场景里（apply 过），重建完重新挂进去
    if (!initial && this.enabled && this.grid.parent) {
      this.scene.add(this.water);
    }
    return this.water;
  }

  /** 水面可见性：enabled（能力级） ∧ water.enabled（子域开关） ∧（film → wetness>0；pool → 恒开） */
  private syncWaterVisibility(): void {
    const w = this.params.water;
    const filmOn = w.mode === "film" && w.wetness > 0;
    const poolOn = w.mode === "pool";
    const shouldShow = w.enabled && (filmOn || poolOn);
    this.water.visible = shouldShow;
  }

  private createSurfaceMesh(): THREE.Mesh {
    const surfaceGeo = new THREE.PlaneGeometry(this.params.size, this.params.size);
    const surface = new THREE.Mesh(surfaceGeo);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.005;
    surface.name = "ysm-ground-surface";
    this.surface = surface; // 先挂成员再刷新（refreshSurface→rebuildSurface 会解引用 this.surface）
    this.refreshSurface();
    return surface;
  }

  /** 推进水面波纹动画（render loop 调用） */
  update(dt: number): void {
    if (!this.enabled || !this.params.water.enabled || !this.water.visible) return;
    this.waterTime.value += dt * this.params.water.waveSpeed;
  }

  /** 挂入场景（对齐 SkyCapability.apply 口径） */
  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.water.parent) this.scene.add(this.water);
    if (!this.surface.parent) this.scene.add(this.surface);
  }

  /** 地面显隐开关（表面层跟随；水面由 water.enabled 独立控制，不再跟随 grid.visible） */
  setVisible(v: boolean): void {
    this.params.visible = v;
    this.grid.visible = v;
    this.updateSurfaceVisible();
    this.syncWaterVisibility();
  }

  getVisible(): boolean {
    return this.grid.visible;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.grid.parent) this.grid.parent.remove(this.grid);
      if (this.water.parent) this.water.parent.remove(this.water);
      if (this.surface.parent) this.surface.parent.remove(this.surface);
    }
  }

  // ── 水面：独立开关 / 形态切换 ──
  setWaterEnabled(v: boolean): void {
    this.params.water.enabled = v;
    this.syncWaterVisibility();
  }
  getWaterEnabled(): boolean { return this.params.water.enabled; }

  setWaterMode(m: WaterMode): void {
    if (this.params.water.mode === m) return;
    this.params.water.mode = m;
    this.rebuildWaterContainer(false);
    // 首次切 pool 时，film 语义的 wetness 不再直接控制 opacity，但仍保留值以允许切回 film
  }
  getWaterMode(): WaterMode { return this.params.water.mode; }

  // ── 水面参数（film + pool 通用）──
  setWetness(v: number): void {
    this.params.water.wetness = Math.max(0, Math.min(1, v));
    if (this.params.water.mode === "film") {
      const top = this.water as THREE.Mesh; // film 模式 this.water 恒为 Mesh
      const mat = top.material as THREE.MeshPhysicalMaterial;
      mat.opacity = this.params.water.waterOpacity * this.params.water.wetness;
      // 反射回 uniform：onBeforeCompile 注入的 uBaseOpacity 是 snapshot，material.opacity 变化同步
      if ((mat as unknown as { userData: { shader?: THREE.WebGLProgramParametersWithUniforms } }).userData?.shader?.uniforms?.uBaseOpacity) {
        (mat as unknown as { userData: { shader: { uniforms: { uBaseOpacity: { value: number } } } } }).userData.shader.uniforms.uBaseOpacity.value = mat.opacity;
      }
    }
    this.syncWaterVisibility();
  }
  getWetness(): number { return this.params.water.wetness; }

  setWaterColor(hex: number): void {
    this.params.water.waterColor = hex;
    // film：顶层 mesh；pool：顶 mesh + 四壁 inner mesh
    const targets = this.params.water.mode === "film"
      ? [this.water as THREE.Mesh]
      : this.collectWaterMeshes().filter((m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"));
    for (const m of targets) {
      const mat = m.material as THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
      if ("color" in mat) mat.color.setHex(hex);
    }
  }
  getWaterColor(): number { return this.params.water.waterColor; }

  setWaterOpacity(v: number): void {
    this.params.water.waterOpacity = Math.max(0, Math.min(1, v));
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshPhysicalMaterial;
      const newOp = this.params.water.mode === "film"
        ? this.params.water.waterOpacity * this.params.water.wetness
        : this.params.water.waterOpacity;
      mat.opacity = newOp;
    }
  }
  getWaterOpacity(): number { return this.params.water.waterOpacity; }

  // ── 法线贴图强度（顶层水面）──
  setNormalStrength(v: number): void {
    this.params.water.normalStrength = Math.max(0, Math.min(1, v));
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshStandardMaterial;
      mat.normalScale?.set(this.params.water.normalStrength, this.params.water.normalStrength);
    }
  }
  getNormalStrength(): number { return this.params.water.normalStrength; }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number): void {
    this.params.water.poolHeight = Math.max(0.01, v);
    if (this.params.water.mode === "pool") this.rebuildWaterContainer(false); // 几何高度需要重排
  }
  getPoolHeight(): number { return this.params.water.poolHeight; }

  setPoolWallThickness(v: number): void {
    this.params.water.poolWallThickness = Math.max(0.01, v);
    if (this.params.water.mode === "pool") this.rebuildWaterContainer(false);
  }
  getPoolWallThickness(): number { return this.params.water.poolWallThickness; }

  setPoolWallColor(hex: number): void {
    this.params.water.poolWallColor = hex;
    // pool 底 + 四壁 outer：同步改色；pool 非生效时先存参数，下次 rebuild 会用上
    const meshes = this.collectWaterMeshes();
    for (const m of meshes) {
      if (m.name.endsWith("-outer") || m.name === "ysm-water-bottom") {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.setHex(hex);
      }
    }
  }
  getPoolWallColor(): number { return this.params.water.poolWallColor; }

  setPoolRoundness(v: number): void {
    this.params.water.poolRoundness = Math.max(0, Math.min(0.5, v));
    // 直接修改 uniform：material 的 userData.shader（若已编译）中的 uRoundness
    const top = this.findTopWater();
    if (top) {
      const mat = top.material as THREE.MeshPhysicalMaterial;
      const shader = (mat as unknown as { userData: { shader?: { uniforms: { uRoundness?: { value: number } } } } }).userData?.shader;
      if (shader?.uniforms?.uRoundness) shader.uniforms.uRoundness.value = this.params.water.poolRoundness;
    }
  }
  getPoolRoundness(): number { return this.params.water.poolRoundness; }

  setWaveSpeed(v: number): void { this.params.water.waveSpeed = Math.max(0, v); }
  getWaveSpeed(): number { return this.params.water.waveSpeed; }
  setClarity(v: number): void {
    this.params.water.clarity = Math.max(0, Math.min(1, v));
    // pool 顶 mesh + inner walls 已构建 → 需要改 material.transmission；否则下次 buildWaveWaterMaterial 时天然使用新值
    if (this.params.water.mode === "pool") {
      const targets = this.collectWaterMeshes().filter(
        (m) => m.name === "ysm-water-top" || m.name.endsWith("-inner"),
      );
      for (const m of targets) {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        if ("transmission" in mat) {
          mat.transmission = m.name === "ysm-water-top" ? this.params.water.clarity : this.params.water.clarity * 0.5;
          mat.needsUpdate = true;
        }
      }
    }
  }
  getClarity(): number { return this.params.water.clarity; }

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

  // ══ 表面材质层（spec 单源，借鉴 MikuMikuAR ADR-226）══
  // 所有 mat* setter 只改 params 后调 refreshSurface()；
  // structural 变化 → rebuildSurface（新材质+新纹理），appearance 变化 → applyGroundSurfaceAppearance 原地。
  // 禁止绕过 refreshSurface 直接 mutate 材质（合约测试锁死两路径等价性）。

  /** 程序化像素 → DataTexture（SRGB：albedo 语义；RepeatWrapping 平铺） */
  private makeGeneratedTexture(st: GroundSurfaceStructuralSpec): THREE.DataTexture {
    const px = generateSurfacePixels(st, SURFACE_TEX_SIZE);
    const tex = new THREE.DataTexture(px, SURFACE_TEX_SIZE, SURFACE_TEX_SIZE, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** 当前贴图身份 token（自定义贴图用「文件名:尺寸」，程序化为 ""） */
  private currentTextureToken(): string {
    if (!this.customTex) return "";
    const img = this.customTex.image as { width?: number; height?: number } | undefined;
    return `${this.customTexName}:${img?.width ?? 0}x${img?.height ?? 0}`;
  }

  /** 重建路径：按 spec 建全新材质与纹理（旧的自建纹理释放，customTex 缓存不动） */
  private rebuildSurface(spec: GroundSurfaceSpec): void {
    const st = { ...spec.structural };
    let tex: THREE.Texture | null = null;
    if (st.mode === "texture") {
      tex = this.customTex ?? this.makeGeneratedTexture({ ...st, mode: "solid" }); // 无缓存先占位纯色
    } else if (st.mode !== "solid" && st.mode !== "none") {
      tex = this.makeGeneratedTexture(st);
    } // solid/none：color 直出，无贴图

    if (this.surfaceMat) {
      if (this.surfaceTex && this.surfaceTex !== this.customTex) {
        safeDispose(this.surfaceTex);
      }
      this.surfaceMat.dispose();
    }
    this.surfaceTex = tex;
    this.surfaceMat = new THREE.MeshStandardMaterial();
    applyGroundSurfaceStructural(this.surfaceMat, st, tex);
    applyGroundSurfaceAppearance(this.surfaceMat, spec, this.params.size);
    this.surface.material = this.surfaceMat;
  }

  /** 唯一变更入口：判别重建/原地并落地（所有 setter 的必经之路） */
  private refreshSurface(): void {
    const next = buildGroundSurfaceSpec(this.params, this.currentTextureToken());
    if (!this.surfaceSpec || groundSurfaceNeedsRebuild(this.surfaceSpec, next)) {
      this.rebuildSurface(next);
    } else if (this.surfaceMat) {
      applyGroundSurfaceAppearance(this.surfaceMat, next, this.params.size);
    }
    this.surfaceSpec = next;
    this.updateSurfaceVisible();
  }

  /** 显隐门控：总开关 × 网格显隐 × 模式非 none（水面层独立于表面层） */
  private updateSurfaceVisible(): void {
    this.surface.visible =
      this.enabled && this.params.visible && this.params.matSource !== "none";
  }

  /** 自定义贴图加载完成入口（openTexturePicker 异步解码后调用；测试直接注入） */
  acceptLoadedTexture(tex: THREE.Texture, name: string): void {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.customTex) {
      safeDispose(this.customTex);
    }
    this.customTex = tex;
    this.customTexName = name;
    this.params.matSource = "texture";
    this.refreshSurface();
  }

  /** 清除自定义贴图缓存并回退 plain（texture 模式时） */
  clearCustomTexture(): void {
    const wasAttached = this.surfaceTex === this.customTex;
    if (this.customTex) {
      safeDispose(this.customTex);
      this.customTex = null;
      this.customTexName = "";
    }
    if (this.params.matSource === "texture") this.params.matSource = "plain";
    if (wasAttached) this.surfaceTex = null; // 重建时不再误判归属
    this.refreshSurface();
  }

  /** 文件选择器（对齐 environment-capability customHdr 口径：不持久化二进制） */
  private openTexturePicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader().loadAsync(url)
        .then((tex) => this.acceptLoadedTexture(tex, file.name))
        .catch(() => dbg("ground-tex-load-fail", { name: file.name }))
        .finally(() => URL.revokeObjectURL(url));
    };
    input.click();
  }

  // ── 材质参数 setter/getter（全部经 refreshSurface 单路径落地）──
  getMatSource(): GroundSurfaceMode {
    return this.params.matSource;
  }
  setMatSource(mode: GroundSurfaceMode): void {
    this.params.matSource = mode;
    this.refreshSurface();
  }
  setMatColor(hex: number): void {
    this.params.matColor = hex;
    this.refreshSurface();
  }
  setMatLineColor(hex: number): void {
    this.params.matLineColor = hex;
    this.refreshSurface();
  }
  setMatGridSize(n: number): void {
    this.params.matGridSize = Math.max(2, Math.round(n));
    this.refreshSurface();
  }
  getMatOpacity(): number {
    return this.params.matOpacity;
  }
  setMatOpacity(v: number): void {
    this.params.matOpacity = Math.max(0, Math.min(1, v));
    this.refreshSurface();
  }
  getMatScale(): number {
    return this.params.matScale;
  }
  setMatScale(v: number): void {
    this.params.matScale = Math.max(0.25, Math.min(8, v));
    this.refreshSurface();
  }
  getMatRotation(): number {
    return this.params.matRotationDeg;
  }
  setMatRotation(deg: number): void {
    this.params.matRotationDeg = ((deg % 360) + 360) % 360;
    this.refreshSurface();
  }
  getMatRoughness(): number {
    return this.params.matRoughness;
  }
  setMatRoughness(v: number): void {
    this.params.matRoughness = Math.max(0, Math.min(1, v));
    this.refreshSurface();
  }
  getMatMetalness(): number {
    return this.params.matMetalness;
  }
  setMatMetalness(v: number): void {
    this.params.matMetalness = Math.max(0, Math.min(1, v));
    this.refreshSurface();
  }
  getMatColor2(): number {
    return this.params.matColor2;
  }
  setMatColor2(hex: number): void {
    this.params.matColor2 = hex;
    this.refreshSurface();
  }
  getMatDensity(): number {
    return this.params.matDensity;
  }
  setMatDensity(v: number): void {
    this.params.matDensity = Math.max(0.25, Math.min(8, v));
    this.refreshSurface();
  }
  getMatAngle(): number {
    return this.params.matAngleDeg;
  }
  setMatAngle(deg: number): void {
    this.params.matAngleDeg = ((deg % 360) + 360) % 360;
    this.refreshSurface();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return [...gcBuildMain(this), ...gcBuildWaterGroup(this), ...gcBuildMaterialGroup(this)];
  }

  /** 保存状态到 localStorage（mat 字段纯数据可持久化；texture 二进制不存） */
  saveState(): void {
    persistState(this.id, {
      visible: this.params.visible,
      enabled: this.enabled,
      water: { ...this.params.water },
      matSource: this.params.matSource === "texture" ? "texture" : this.params.matSource,
      matColor: this.params.matColor,
      matLineColor: this.params.matLineColor,
      matColor2: this.params.matColor2,
      matGridSize: this.params.matGridSize,
      matOpacity: this.params.matOpacity,
      matScale: this.params.matScale,
      matRotationDeg: this.params.matRotationDeg,
      matDensity: this.params.matDensity,
      matAngleDeg: this.params.matAngleDeg,
      matRoughness: this.params.matRoughness,
      matMetalness: this.params.matMetalness,
      // V1→V2 迁移兼容：保留旧字段（V2 仍能被 V1 loadState 读到水相关字段做兜底）
      wetness: this.params.water.wetness,
      waterColor: this.params.water.waterColor,
      waterOpacity: this.params.water.waterOpacity,
      normalStrength: this.params.water.normalStrength,
    });
  }

  /** 从 localStorage 恢复状态（texture 模式二进制未持久化 → 回退 plain；V1→V2 自动迁移） */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.visible === "boolean") {
      this.params.visible = state.visible;
      this.grid.visible = state.visible;
    }
    // V2 新格式：state.water 嵌套对象（优先走）
    if (state.water && typeof state.water === "object") {
      const w = state.water as Partial<WaterParams>;
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
    } else {
      // V1 兼容：扁平字段存在则回写（注意 setWetness 现在内部判 film 生效）
      if (typeof state.wetness === "number") this.setWetness(state.wetness);
      if (typeof state.waterColor === "number") this.setWaterColor(state.waterColor);
      if (typeof state.waterOpacity === "number") this.setWaterOpacity(state.waterOpacity);
      if (typeof state.normalStrength === "number") this.setNormalStrength(state.normalStrength);
    }
    // ── 材质字段：白名单校验 + texture 无缓存回退 ──
    if (typeof state.matSource === "string" && GROUND_SURFACE_MODES.includes(state.matSource as GroundSurfaceMode)) {
      this.params.matSource =
        state.matSource === "texture" && !this.customTex ? "plain" : (state.matSource as GroundSurfaceMode);
    }
    if (typeof state.matColor === "number") this.params.matColor = state.matColor;
    if (typeof state.matLineColor === "number") this.params.matLineColor = state.matLineColor;
    if (typeof state.matColor2 === "number") this.params.matColor2 = state.matColor2;
    if (typeof state.matGridSize === "number") this.params.matGridSize = state.matGridSize;
    if (typeof state.matOpacity === "number") this.setMatOpacity(state.matOpacity);
    if (typeof state.matScale === "number") this.setMatScale(state.matScale);
    if (typeof state.matRotationDeg === "number") this.setMatRotation(state.matRotationDeg);
    if (typeof state.matDensity === "number") this.setMatDensity(state.matDensity);
    if (typeof state.matAngleDeg === "number") this.setMatAngle(state.matAngleDeg);
    if (typeof state.matRoughness === "number") this.setMatRoughness(state.matRoughness);
    if (typeof state.matMetalness === "number") this.setMatMetalness(state.matMetalness);
  }

  /** 移除并释放（GridHelper 材质可能是数组，遍历 dispose；surface 连同纹理一并释放） */
  dispose(): void {
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    if (this.water.parent) this.water.parent.remove(this.water);
    if (this.surface.parent) this.surface.parent.remove(this.surface);
    this.grid.geometry.dispose();
    const mat = this.grid.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
    // water：统一走递归 dispose（兼容 film/pool 两种容器）
    this.disposeWater();
    // 表面层：材质 + 当前挂载纹理 + 自定义贴图缓存全部释放
    this.surface.geometry.dispose();
    if (this.surfaceMat) {
      if (this.surfaceTex && this.surfaceTex !== this.customTex) {
        safeDispose(this.surfaceTex);
      }
      this.surfaceMat.dispose();
      this.surfaceMat = null;
    }
    if (this.customTex) {
      safeDispose(this.customTex);
      this.customTex = null;
    }
  }
}

function gcBuildMain(cap: GroundCapability): MenuControlDef[] {
  return [
    {
      id: "ground-visible",
      kind: "toggle",
      labelKey: "preview.ground",
      fallback: "地面",
      getValue: () => cap.getVisible(),
      setValue: (v) => cap.setVisible(v as boolean),
    },
  ];
}

function gcBuildWaterGroup(cap: GroundCapability): MenuControlDef[] {
  const WATER_GROUP = "preview.groundGroupWater";
  const wSlider = (
    id: string,
    labelKey: string,
    fallback: string,
    slider: { min: number; max: number; step: number; unit?: string },
    getValue: () => number,
    setValue: (v: number) => void,
  ): MenuControlDef => ({
    id, kind: "slider", labelKey, fallback, group: WATER_GROUP, slider,
    getValue, setValue: (v) => setValue(v as number),
  });
  const wColor = (
    id: string, labelKey: string, fallback: string,
    getValue: () => number, setValue: (v: number) => void,
  ): MenuControlDef => ({
    id, kind: "color", labelKey, fallback, group: WATER_GROUP,
    getValue, setValue: (v) => setValue(v as number),
  });
  return [
    {
      id: "ground-water-enabled",
      kind: "toggle",
      labelKey: "preview.groundWaterEnabled",
      fallback: "启用水面",
      group: WATER_GROUP,
      getValue: () => cap.getWaterEnabled(),
      setValue: (v) => cap.setWaterEnabled(v as boolean),
    },
    {
      id: "ground-water-mode",
      kind: "select",
      labelKey: "preview.groundWaterMode",
      fallback: "水面形态",
      group: WATER_GROUP,
      select: [
        { value: "film", label: "薄膜" },
        { value: "pool", label: "水池" },
      ],
      getValue: () => cap.getWaterMode(),
      setValue: (v) => cap.setWaterMode(v as WaterMode),
    },
    {
      id: "ground-wetness",
      kind: "slider",
      labelKey: "preview.groundWetness",
      fallback: "湿润度",
      group: WATER_GROUP,
      slider: { min: 0, max: 1, step: 0.05 },
      getValue: () => cap.getWetness(),
      setValue: (v) => cap.setWetness(v as number),
    },
    wColor("ground-water-color", "preview.groundWaterColor", "水色", () => cap.getWaterColor(), (v) => cap.setWaterColor(v)),
    wSlider(
      "ground-water-opacity", "preview.groundWaterOpacity", "不透明度",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getWaterOpacity(), (v) => cap.setWaterOpacity(v),
    ),
    wSlider(
      "ground-normal-strength", "preview.groundNormalStrength", "法线强度",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getNormalStrength(), (v) => cap.setNormalStrength(v),
    ),
    wSlider(
      "ground-wave-speed", "preview.groundWaveSpeed", "波速",
      { min: 0, max: 3, step: 0.05, unit: "x" },
      () => cap.getWaveSpeed(), (v) => cap.setWaveSpeed(v),
    ),
    wSlider(
      "ground-water-clarity", "preview.groundWaterClarity", "水体通透度",
      { min: 0, max: 1, step: 0.05 },
      () => cap.getClarity(), (v) => cap.setClarity(v),
    ),
    // ── 水池专属 ──
    wSlider(
      "ground-pool-height", "preview.groundPoolHeight", "水池高度",
      { min: 0.01, max: 5, step: 0.05, unit: "m" },
      () => cap.getPoolHeight(), (v) => cap.setPoolHeight(v),
    ),
    wSlider(
      "ground-pool-wall-thickness", "preview.groundPoolWallThickness", "池壁厚度",
      { min: 0.01, max: 2, step: 0.01, unit: "m" },
      () => cap.getPoolWallThickness(), (v) => cap.setPoolWallThickness(v),
    ),
    wColor("ground-pool-wall-color", "preview.groundPoolWallColor", "池壁颜色",
      () => cap.getPoolWallColor(), (v) => cap.setPoolWallColor(v)),
    wSlider(
      "ground-pool-roundness", "preview.groundPoolRoundness", "边缘圆角",
      { min: 0, max: 0.5, step: 0.01 },
      () => cap.getPoolRoundness(), (v) => cap.setPoolRoundness(v),
    ),
  ];
}

// ── 菜单控件工厂（消除 gcBuildWaterGroup/gcBuildMaterialGroup 重复字面量）──
const MAT_GROUP = "preview.groundGroupMaterial";

function gcSliderDef(
  id: string,
  labelKey: string,
  fallback: string,
  slider: { min: number; max: number; step: number; unit?: string },
  getValue: () => number,
  setValue: (v: number) => void,
): MenuControlDef {
  return {
    id,
    kind: "slider",
    labelKey,
    fallback,
    group: MAT_GROUP,
    slider,
    getValue,
    setValue: (v) => setValue(v as number),
  };
}

function gcColorDef(
  id: string,
  labelKey: string,
  fallback: string,
  getValue: () => number,
  setValue: (v: number) => void,
): MenuControlDef {
  return {
    id,
    kind: "color",
    labelKey,
    fallback,
    group: MAT_GROUP,
    getValue,
    setValue: (v) => setValue(v as number),
  };
}

function gcButtonDef(
  id: string,
  labelKey: string,
  fallback: string,
  button: MenuControlDef["button"],
): MenuControlDef {
  return {
    id,
    kind: "button",
    labelKey,
    fallback,
    group: MAT_GROUP,
    button,
    getValue: () => null,
    setValue: () => {},
  };
}

function gcBuildMaterialGroup(cap: GroundCapability): MenuControlDef[] {
  const self = cap as unknown as {
    params: { matColor: number; matLineColor: number; matGridSize: number };
    customTexName: string;
    openTexturePicker(): void;
  };
  return [
    {
      id: "ground-mat-source",
      kind: "select",
      labelKey: "preview.groundMatSource",
      fallback: "表面材质",
      group: MAT_GROUP,
      select: [
        { value: "none", label: "无" },
        { value: "solid", label: "纯色" },
        { value: "plain", label: "素面" },
        { value: "grid", label: "网格" },
        { value: "checker", label: "棋盘" },
        { value: "stripes", label: "条纹" },
        { value: "diamond", label: "菱格" },
        { value: "marble", label: "大理石" },
        { value: "texture", label: "自定义贴图" },
      ],
      getValue: () => cap.getMatSource(),
      setValue: (v) => cap.setMatSource(v as GroundSurfaceMode),
    },
    gcColorDef("ground-mat-color", "preview.groundMatColor", "底色", () => self.params.matColor, (v) => cap.setMatColor(v)),
    gcColorDef("ground-mat-color2", "preview.groundMatColor2", "副色", () => cap.getMatColor2(), (v) => cap.setMatColor2(v)),
    gcColorDef("ground-mat-line-color", "preview.groundMatLineColor", "线色", () => self.params.matLineColor, (v) => cap.setMatLineColor(v)),
    gcSliderDef("ground-mat-grid-size", "preview.groundMatGridSize", "格数", { min: 2, max: 32, step: 1 }, () => self.params.matGridSize, (v) => cap.setMatGridSize(Math.round(v))),
    gcSliderDef("ground-mat-density", "preview.groundMatDensity", "纹理密度", { min: 0.25, max: 8, step: 0.25 }, () => cap.getMatDensity(), (v) => cap.setMatDensity(v)),
    gcSliderDef("ground-mat-angle", "preview.groundMatAngle", "纹理角度", { min: 0, max: 360, step: 5, unit: "°" }, () => cap.getMatAngle(), (v) => cap.setMatAngle(v)),
    gcButtonDef("ground-mat-texture", "preview.groundMatPick", "选择贴图", {
      textKey: "preview.groundMatPick",
      getHint: () => self.customTexName || "",
      variant: "primary",
      action: () => self.openTexturePicker(),
    }),
    gcButtonDef("ground-mat-clear", "preview.groundMatClear", "清除贴图", {
      textKey: "preview.groundMatClear",
      variant: "ghost",
      action: () => cap.clearCustomTexture(),
    }),
    gcSliderDef("ground-mat-opacity", "preview.groundMatOpacity", "表面不透明度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatOpacity(), (v) => cap.setMatOpacity(v)),
    gcSliderDef("ground-mat-scale", "preview.groundMatScale", "纹理缩放", { min: 0.25, max: 8, step: 0.25 }, () => cap.getMatScale(), (v) => cap.setMatScale(v)),
    gcSliderDef("ground-mat-rotation", "preview.groundMatRotation", "纹理旋转", { min: 0, max: 360, step: 5, unit: "°" }, () => cap.getMatRotation(), (v) => cap.setMatRotation(v)),
    gcSliderDef("ground-mat-roughness", "preview.groundMatRoughness", "粗糙度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatRoughness(), (v) => cap.setMatRoughness(v)),
    gcSliderDef("ground-mat-metalness", "preview.groundMatMetalness", "金属度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatMetalness(), (v) => cap.setMatMetalness(v)),
  ];
}
