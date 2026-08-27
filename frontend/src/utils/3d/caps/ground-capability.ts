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
  "none", "solid", "plain", "grid", "checker", "texture",
];

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
  /** 湿润度 0=干 1=完全湿润；>0 时叠加半透明水面 Mesh */
  wetness: number;
  /** 水面颜色（湿润时叠加层底色） */
  waterColor: number;
  /** 水面不透明度 0=透明 1=不透明 */
  waterOpacity: number;
  /** 法线贴图强度 0=无效果 1=完全按波浪法线 */
  normalStrength: number;
}

export const DEFAULT_GROUND_PARAMS: GroundParams = {
  ...DEFAULT_GROUND_SURFACE_PARAMS, // mat* 材质字段（matSource 默认 none）
  size: 50,
  divisions: 50,
  colorCenter: 0x444466,
  colorGrid: 0x333355,
  visible: true,
  wetness: 0,
  waterColor: 0x335577,
  waterOpacity: 0.6,
  normalStrength: 0.3,
};

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "🌐";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private water: THREE.Mesh; // 半透明水面叠加层（wetness>0 时显示）
  private waterTime: { value: number }; // 水面波纹动画 time uniform
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
    this.params = { ...DEFAULT_GROUND_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.waterTime = { value: 0 };
    this.grid = this.createGridHelper();
    this.water = this.createWaterMesh();
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

  private createWaterMesh(): THREE.Mesh {
    const waterGeo = new THREE.PlaneGeometry(this.params.size, this.params.size, 32, 32);
    const waterMat = new THREE.MeshStandardMaterial({
      color: this.params.waterColor,
      transparent: true,
      opacity: this.params.waterOpacity * this.params.wetness,
      roughness: 0.2,
      metalness: 0.3,
      depthWrite: false,
    });

    waterMat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms["uTime"] = this.waterTime;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
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
         transformed.z += h;`,
      );
    };
    waterMat.needsUpdate = true;

    const normalMap = this.generateNormalMap(256);
    waterMat.normalMap = normalMap;
    waterMat.normalScale = new THREE.Vector2(this.params.normalStrength, this.params.normalStrength);
    waterMat.needsUpdate = true;

    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.01;
    water.name = "ysm-ground-water";
    water.visible = this.params.wetness > 0;
    return water;
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
    // P3 修复（审核）：能力未启用或水面不可见时跳过 uniform 推进，避免无谓 GPU 开销
    if (!this.enabled || this.params.wetness <= 0 || !this.water.visible) return;
    this.waterTime.value += dt;
  }

  /** 挂入场景（对齐 SkyCapability.apply 口径） */
  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.water.parent) this.scene.add(this.water);
    if (!this.surface.parent) this.scene.add(this.surface);
  }

  /** 地面显隐开关（水面/表面层跟随） */
  setVisible(v: boolean): void {
    this.params.visible = v;
    this.grid.visible = v;
    this.updateSurfaceVisible();
    this.water.visible = v && this.params.wetness > 0;
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

  // ── 水面参数（湿润表面模式）──
  setWetness(v: number): void {
    this.params.wetness = Math.max(0, Math.min(1, v));
    const mat = this.water.material as THREE.MeshStandardMaterial;
    mat.opacity = this.params.waterOpacity * this.params.wetness;
    this.water.visible = this.grid.visible && this.params.wetness > 0;
  }
  getWetness(): number {
    return this.params.wetness;
  }
  setWaterColor(hex: number): void {
    this.params.waterColor = hex;
    (this.water.material as THREE.MeshStandardMaterial).color.setHex(hex);
  }
  getWaterColor(): number {
    return this.params.waterColor;
  }
  setWaterOpacity(v: number): void {
    this.params.waterOpacity = Math.max(0, Math.min(1, v));
    (this.water.material as THREE.MeshStandardMaterial).opacity = this.params.waterOpacity * this.params.wetness;
  }
  getWaterOpacity(): number {
    return this.params.waterOpacity;
  }

  // ── 法线贴图强度 ──
  setNormalStrength(v: number): void {
    this.params.normalStrength = Math.max(0, Math.min(1, v));
    const mat = this.water.material as THREE.MeshStandardMaterial;
    const s = new THREE.Vector2(this.params.normalStrength, this.params.normalStrength);
    mat.normalScale.copy(s);
  }
  getNormalStrength(): number {
    return this.params.normalStrength;
  }

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
      wetness: this.params.wetness,
      waterColor: this.params.waterColor,
      waterOpacity: this.params.waterOpacity,
      normalStrength: this.params.normalStrength,
      matSource: this.params.matSource === "texture" ? "texture" : this.params.matSource,
      matColor: this.params.matColor,
      matLineColor: this.params.matLineColor,
      matGridSize: this.params.matGridSize,
      matOpacity: this.params.matOpacity,
      matScale: this.params.matScale,
      matRotationDeg: this.params.matRotationDeg,
      matRoughness: this.params.matRoughness,
      matMetalness: this.params.matMetalness,
    });
  }

  /** 从 localStorage 恢复状态（texture 模式二进制未持久化 → 回退 plain） */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.visible === "boolean") {
      this.params.visible = state.visible;
      this.grid.visible = state.visible;
    }
    if (typeof state.wetness === "number") this.setWetness(state.wetness);
    if (typeof state.waterColor === "number") this.setWaterColor(state.waterColor);
    if (typeof state.waterOpacity === "number") this.setWaterOpacity(state.waterOpacity);
    if (typeof state.normalStrength === "number") this.setNormalStrength(state.normalStrength);
    // ── 材质字段：白名单校验 + texture 无缓存回退 ──
    if (typeof state.matSource === "string" && GROUND_SURFACE_MODES.includes(state.matSource as GroundSurfaceMode)) {
      this.params.matSource =
        state.matSource === "texture" && !this.customTex ? "plain" : (state.matSource as GroundSurfaceMode);
    }
    if (typeof state.matColor === "number") this.params.matColor = state.matColor;
    if (typeof state.matLineColor === "number") this.params.matLineColor = state.matLineColor;
    if (typeof state.matGridSize === "number") this.params.matGridSize = state.matGridSize;
    if (typeof state.matOpacity === "number") this.setMatOpacity(state.matOpacity);
    if (typeof state.matScale === "number") this.setMatScale(state.matScale);
    if (typeof state.matRotationDeg === "number") this.setMatRotation(state.matRotationDeg);
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
    this.water.geometry.dispose();
    // 审核修复 #4：释放法线贴图 DataTexture（generateNormalMap 生成的 256×256 纹理）
    // 原代码仅 dispose material，normalMap 纹理未释放导致 GPU 内存泄漏
    const waterMat = this.water.material as THREE.MeshStandardMaterial;
    if (waterMat.normalMap) {
      safeDispose(waterMat.normalMap);
    }
    waterMat.dispose();
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
  return [
    {
      id: "ground-wetness",
      kind: "slider",
      labelKey: "preview.groundWetness",
      fallback: "湿润度",
      group: "preview.groundGroupWater",
      slider: { min: 0, max: 1, step: 0.05 },
      getValue: () => cap.getWetness(),
      setValue: (v) => cap.setWetness(v as number),
    },
    {
      id: "ground-water-color",
      kind: "color",
      labelKey: "preview.groundWaterColor",
      fallback: "水色",
      group: "preview.groundGroupWater",
      getValue: () => cap.getWaterColor(),
      setValue: (v) => cap.setWaterColor(v as number),
    },
    {
      id: "ground-water-opacity",
      kind: "slider",
      labelKey: "preview.groundWaterOpacity",
      fallback: "不透明度",
      group: "preview.groundGroupWater",
      slider: { min: 0, max: 1, step: 0.05 },
      getValue: () => cap.getWaterOpacity(),
      setValue: (v) => cap.setWaterOpacity(v as number),
    },
    {
      id: "ground-normal-strength",
      kind: "slider",
      labelKey: "preview.groundNormalStrength",
      fallback: "法线强度",
      group: "preview.groundGroupWater",
      slider: { min: 0, max: 1, step: 0.05 },
      getValue: () => cap.getNormalStrength(),
      setValue: (v) => cap.setNormalStrength(v as number),
    },
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
        { value: "texture", label: "自定义贴图" },
      ],
      getValue: () => cap.getMatSource(),
      setValue: (v) => cap.setMatSource(v as GroundSurfaceMode),
    },
    gcColorDef("ground-mat-color", "preview.groundMatColor", "底色", () => self.params.matColor, (v) => cap.setMatColor(v)),
    gcColorDef("ground-mat-line-color", "preview.groundMatLineColor", "线色", () => self.params.matLineColor, (v) => cap.setMatLineColor(v)),
    gcSliderDef("ground-mat-grid-size", "preview.groundMatGridSize", "格数", { min: 2, max: 32, step: 1 }, () => self.params.matGridSize, (v) => cap.setMatGridSize(Math.round(v))),
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
