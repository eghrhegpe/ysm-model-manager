// ===== GroundCapability：地面能力（ADR-196 迁移至 envState）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + 表面材质层（spec 单源，见 ground-surface-spec.ts）+ 水面叠加层；
// apply() 挂入场景，dispose() 移除并释放，作用域不泄漏到其它预览。

import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, registerEnvStateMiddleware, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { buildGroundNodes } from "./ground-menu.ts";
import {
  applyGroundSurfaceAppearance,
  applyGroundSurfaceStructural,
  applyOverlayMaterial,
  buildGroundOverlaySpec,
  buildGroundSurfaceSpec,
  GROUND_CANVAS_STYLES,
  GROUND_MATERIAL_PRESET_IDS,
  GROUND_MATERIAL_PRESETS,
  GROUND_OVERLAY_STYLES,
  GROUND_SOURCE_KINDS,
  type GroundCanvasStyle,
  type GroundMaterialPreset,
  type GroundOverlaySpec,
  type GroundOverlayStyle,
  type GroundSourceKind,
  type GroundSurfaceSpec,
  type GroundSurfaceStructuralSpec,
  generateOverlayPixels,
  generateSurfacePixels,
  groundMatSourceFromAxes,
  groundSurfaceNeedsRebuild,
  LEGACY_CANVAS_PATTERNS,
  type LegacyGroundMatSource,
  migrateGroundMatSource,
  OVERLAY_TEX_SIZE,
  overlayNeedsRebuild,
  textureRepeat,
} from "./ground-surface-spec.ts";
import {
  type EnvPlacement,
  GROUND_LAYER_OFFSETS,
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";

/** 程序化表面纹理边长（plain/grid/checker 共用；512² 够细且重建成本低） */
const SURFACE_TEX_SIZE = 512;
// matSource 合法值白名单（loadState 校验用）——ADR-249：
// 原本地重复定义一份（与 ground-surface-spec.ts 导出的 GROUND_SURFACE_MODES 同内容），
// 属常量双源（同类病例：MikuMikuAR bd65c02f）。现统一 import spec 侧单一事实源。
/**
 * ADR-254：材质预设关心的 envState 字段（**精确白名单**，禁止前缀匹配）。
 * 与 `GROUND_MATERIAL_PRESETS` 写入的字段一一对应；改其中任一字段即视为「脱离预设」。
 * 刻意**不含** groundSize / groundVisible / groundOverlay 系列 / groundMatOpacity 等预设不管的字段——
 * 否则改这些会误清预设标记（邻座 `_WATER_KEYS` 精确清单教训）。
 */
export const GROUND_MATERIAL_PRESET_KEYS = [
  "groundCanvasStyle",
  "groundMatColor",
  "groundMatColor2",
  "groundMatDensity",
  "groundMatGridSize",
  "groundMatAngleDeg",
] as const satisfies readonly (keyof EnvState)[];

// 收口置位：不依赖每个 setter 自觉。预设点击自带 groundMaterialPreset，故不会被误清。
registerEnvStateMiddleware((patch) => {
  if (patch.groundMaterialPreset !== undefined) return undefined;
  const touched = GROUND_MATERIAL_PRESET_KEYS.some((k) => patch[k] !== undefined);
  return touched ? { groundMaterialPreset: "custom" } : undefined;
});

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "web";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private surface: THREE.Mesh;
  private surfaceMat: THREE.MeshStandardMaterial | null = null;
  private surfaceTex: THREE.Texture | null = null;
  private surfaceSpec: GroundSurfaceSpec | null = null;
  private customTex: THREE.Texture | null = null;
  private customTexName = "";
  // ADR-249 §2.3 叠加层：独立透明格线 mesh
  private overlay: THREE.Mesh;
  private overlayMat: THREE.MeshStandardMaterial | null = null;
  private overlayTex: THREE.Texture | null = null;
  private overlaySpec: GroundOverlaySpec | null = null;
  private enabled: boolean;
  /** 参数变更监听（menu 局部刷新用）；仅材质来源切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.enabled = opts.enabled ?? true;
    this.grid = this.createGridHelper();
    this.overlay = this.createOverlayMesh();
    this.surface = this.createSurfaceMesh();

    // ADR-196：订阅 envState 变更（只接收 ground 组的键，dispatcher 前置过滤）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      () => {
        // 任何 ground 组字段变更都触发 refreshSurface + refreshOverlay
        this.refreshSurface();
        this.refreshOverlay();
      },
      "ground",
    );
  }

  private createGridHelper(): THREE.GridHelper {
    const grid = new THREE.GridHelper(
      envState.groundSize,
      envState.groundDivisions,
      envState.groundColorCenter,
      envState.groundColorGrid,
    );
    grid.visible = envState.groundVisible;
    grid.name = "ysm-ground";
    return grid;
  }

  private createSurfaceMesh(): THREE.Mesh {
    const surfaceGeo = new THREE.PlaneGeometry(envState.groundSize, envState.groundSize);
    const surface = new THREE.Mesh(surfaceGeo);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = GROUND_LAYER_OFFSETS.groundSurface;
    surface.name = "ysm-ground-surface";
    this.surface = surface;
    this.refreshSurface();
    return surface;
  }

  private createOverlayMesh(): THREE.Mesh {
    const overlayGeo = new THREE.PlaneGeometry(envState.groundSize, envState.groundSize);
    const overlay = new THREE.Mesh(overlayGeo);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = GROUND_LAYER_OFFSETS.groundOverlay;
    overlay.name = "ysm-ground-overlay";
    overlay.visible = false;
    this.overlay = overlay;
    this.refreshOverlay();
    return overlay;
  }

  /** 叠加层唯一变更入口：判别重建/原地并落地（与 refreshSurface 同构） */
  private refreshOverlay(): void {
    const next = buildGroundOverlaySpec({
      overlayStyle: envState.groundOverlay,
      overlayColor: envState.groundOverlayColor,
      overlaySize: envState.groundOverlaySize,
      overlayOpacity: envState.groundOverlayOpacity,
    });

    if (next.style === "none") {
      // 叠加层关闭：释放纹理，隐藏 mesh。
      // 仅在「曾激活 → none」的过渡分支做销毁：稳态 none 时每次 ground 组变更都会重入
      // 本回调，无谓置 needsUpdate 会强制材质重传（review 268cc3c21 P3-4）
      if (this.overlaySpec && this.overlaySpec.style !== "none") {
        if (this.overlayTex) {
          safeDispose(this.overlayTex);
          this.overlayTex = null;
        }
        if (this.overlayMat) {
          this.overlayMat.map = null;
          this.overlayMat.needsUpdate = true;
        }
      }
      this.overlay.visible = false;
      this.overlaySpec = next;
      return;
    }

    if (!this.overlaySpec || overlayNeedsRebuild(this.overlaySpec, next)) {
      this.rebuildOverlay(next);
    } else if (this.overlayMat) {
      this.overlayMat.opacity = next.opacity;
      this.overlayMat.needsUpdate = true;
    }
    this.overlay.visible = this.enabled && envState.groundVisible;
    this.overlaySpec = next;
  }

  private rebuildOverlay(spec: GroundOverlaySpec): void {
    if (this.overlayTex) {
      safeDispose(this.overlayTex);
      this.overlayTex = null;
    }
    this.overlayTex = this.makeOverlayTexture(spec);
    if (!this.overlayMat) {
      this.overlayMat = new THREE.MeshStandardMaterial();
    }
    applyOverlayMaterial(this.overlayMat, spec, this.overlayTex);
    this.overlay.material = this.overlayMat;
  }

  /** 叠加层纹理边长 / 世界格重复：与 surface 同口径（textureRepeat = meshSize/TILE/scale），
   * 让「叠加格数」滑杆与世界密度一致，而非只改贴图像素（review 268cc3c21 P2-3） */
  private makeOverlayTexture(spec: GroundOverlaySpec): THREE.DataTexture | null {
    const px = generateOverlayPixels(spec.style, OVERLAY_TEX_SIZE, spec.color, spec.size);
    if (px.length === 0) return null;
    const tex = new THREE.DataTexture(px, OVERLAY_TEX_SIZE, OVERLAY_TEX_SIZE, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rep = textureRepeat(envState.groundSize, Math.max(1, spec.size));
    tex.repeat.set(rep, rep);
    tex.needsUpdate = true;
    return tex;
  }

  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.surface.parent) this.scene.add(this.surface);
    if (!this.overlay.parent) this.scene.add(this.overlay);
  }

  /** 地面显隐开关（表面层/叠加层均跟随；水面由 water.enabled 独立控制，不再跟随 grid.visible） */
  setVisible(v: boolean): void {
    setEnvState({ groundVisible: v }, { source: "manual" });
    this.grid.visible = v;
    this.updateSurfaceVisible();
    // 叠加层同步跟随（无条件赋值）：不跟随会留「地面已隐、格线还漂」的半隐形残影
    // （surface 层同形历史缺陷，见本文件 L616-617 注释；review 268cc3c21 P2-2）
    this.overlay.visible = v && this.enabled;
  }

  getVisible(): boolean {
    return this.grid.visible;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.grid.parent) this.grid.parent.remove(this.grid);
      if (this.surface.parent) this.surface.parent.remove(this.surface);
      if (this.overlay.parent) this.overlay.parent.remove(this.overlay);
    }
    this.updateSurfaceVisible();
    // 重挂/摘取后 overlay.visible 需重算（保留旧值会 stale：setEnabled(true) 后
    // 若 groundVisible 此前为 false，overlay 会被 apply 重挂却仍 visible=false；
    // review 268cc3c21 P3-5）
    this.refreshOverlay();
  }

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

    if (this.surfaceMat) {
      this.surfaceMat.dispose();
      if (this.surfaceTex && this.surfaceTex !== this.customTex) {
        safeDispose(this.surfaceTex);
      }
      this.surfaceTex = null;
    }

    let tex: THREE.Texture | null = null;
    if (st.mode === "texture") {
      tex = this.customTex ?? this.makeGeneratedTexture({ ...st, mode: "solid" });
      // ADR-254 §2.5：`plain` 与 `solid` 都是平坦 matColor，同一输出不留两条实现路径——
      // plain 也走 tex=null（材质直出 color），不再生成一张均匀贴图。
    } else if (st.mode !== "solid" && st.mode !== "none" && st.mode !== "plain") {
      tex = this.makeGeneratedTexture(st);
    }

    this.surfaceTex = tex;
    this.surfaceMat = new THREE.MeshStandardMaterial();
    applyGroundSurfaceStructural(this.surfaceMat, st, tex);
    applyGroundSurfaceAppearance(this.surfaceMat, spec, envState.groundSize);
    this.surface.material = this.surfaceMat;
  }

  /** 唯一变更入口：判别重建/原地并落地（所有 setter 的必经之路） */
  private refreshSurface(): void {
    const matParams = {
      // ADR-249 §2.1 拆轴：matSource 由两个轴派生（legacy 字段已废弃）。
      matSource: groundMatSourceFromAxes(envState.groundSourceKind, envState.groundCanvasStyle),
      matColor: envState.groundMatColor,
      matColor2: envState.groundMatColor2,
      matGridSize: envState.groundMatGridSize,
      matOpacity: envState.groundMatOpacity,
      matScale: envState.groundMatScale,
      matRotationDeg: envState.groundMatRotationDeg,
      matDensity: envState.groundMatDensity,
      matAngleDeg: envState.groundMatAngleDeg,
      matRoughness: envState.groundMatRoughness,
      matMetalness: envState.groundMatMetalness,
    };
    const next = buildGroundSurfaceSpec(matParams, this.currentTextureToken());
    if (!this.surfaceSpec || groundSurfaceNeedsRebuild(this.surfaceSpec, next)) {
      this.rebuildSurface(next);
    } else if (this.surfaceMat) {
      applyGroundSurfaceAppearance(this.surfaceMat, next, envState.groundSize);
    }
    this.surfaceSpec = next;
    this.updateSurfaceVisible();
  }

  /** 显隐门控：总开关 × 网格显隐 × 模式非 none（水面层独立于表面层） */
  private updateSurfaceVisible(): void {
    this.surface.visible =
      this.enabled && envState.groundVisible && envState.groundSourceKind !== "none";
  }

  /** 自定义贴图加载完成入口 */
  acceptLoadedTexture(tex: THREE.Texture, name: string): void {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.customTex) {
      safeDispose(this.customTex);
    }
    this.customTex = tex;
    this.customTexName = name;
    setEnvState({ groundSourceKind: "texture" }, { source: "manual" });
  }

  /** 清除自定义贴图缓存并回退 plain（texture 模式时） */
  clearCustomTexture(): void {
    const wasAttached = this.surfaceTex === this.customTex;
    if (this.customTex) {
      safeDispose(this.customTex);
      this.customTex = null;
      this.customTexName = "";
    }
    if (envState.groundSourceKind === "texture")
      setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "plain" }, { source: "manual" });
    if (wasAttached) this.surfaceTex = null;
    this.refreshSurface();
  }

  /** 文件选择器（对齐 environment-capability customHdr 口径：不持久化二进制） */
  openTexturePicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (): void => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader()
        .loadAsync(url)
        .then((tex) => this.acceptLoadedTexture(tex, file.name))
        .catch(() => dbg("ground-tex-load-fail", { name: file.name }))
        .finally(() => URL.revokeObjectURL(url));
    };
    input.click();
  }

  // ── 材质预设（ADR-254）：选材质 = 套用「形状 + 配色」完整预设 ──
  getMaterialPreset(): GroundMaterialPreset {
    return envState.groundMaterialPreset;
  }
  /**
   * 选材质预设：一次性写入形状与配色（**同一事务**，避免中间态）。
   * `custom` 是显示项（表示已手改），手选它不做事。
   * 本调用自带 `groundMaterialPreset`，故不会被中间件误清为 custom。
   */
  setMaterialPreset(preset: GroundMaterialPreset): void {
    if (preset === "custom") return;
    const def = GROUND_MATERIAL_PRESETS[preset];
    setEnvState(
      {
        groundMaterialPreset: preset,
        groundCanvasStyle: def.canvasStyle,
        groundMatColor: def.matColor,
        groundMatColor2: def.matColor2,
        groundMatDensity: def.matDensity,
        groundMatGridSize: def.matGridSize,
        groundMatAngleDeg: def.matAngleDeg,
      },
      { source: "manual" },
    );
    this.refreshSurface();
    this.notify();
  }

  // ── 材质参数 setter/getter（全部经 refreshSurface 单路径落地）──
  getSourceKind(): GroundSourceKind {
    return envState.groundSourceKind;
  }
  setSourceKind(kind: GroundSourceKind): void {
    if (envState.groundSourceKind === kind) return;
    setEnvState({ groundSourceKind: kind }, { source: "manual" });
    this.refreshSurface();
    this.notify();
  }
  getCanvasStyle(): GroundCanvasStyle {
    return envState.groundCanvasStyle;
  }
  setCanvasStyle(style: GroundCanvasStyle): void {
    if (envState.groundCanvasStyle === style) return;
    setEnvState({ groundCanvasStyle: style }, { source: "manual" });
    this.refreshSurface();
    this.notify();
  }

  // ── 叠加层 setter（ADR-249 §2.3）──
  getOverlayStyle(): GroundOverlayStyle {
    return envState.groundOverlay;
  }
  setOverlayStyle(style: GroundOverlayStyle): void {
    if (envState.groundOverlay === style) return;
    setEnvState({ groundOverlay: style }, { source: "manual" });
    this.refreshOverlay();
    this.notify();
  }
  getOverlayColor(): number {
    return envState.groundOverlayColor;
  }
  setOverlayColor(hex: number): void {
    if (envState.groundOverlayColor === hex) return;
    setEnvState({ groundOverlayColor: hex }, { source: "manual" });
    this.refreshOverlay();
    this.notify();
  }
  getOverlaySize(): number {
    return envState.groundOverlaySize;
  }
  setOverlaySize(n: number): void {
    const clamped = Math.max(2, Math.min(64, Math.round(n)));
    if (envState.groundOverlaySize === clamped) return;
    setEnvState({ groundOverlaySize: clamped }, { source: "manual" });
    this.refreshOverlay();
    this.notify();
  }
  getOverlayOpacity(): number {
    return envState.groundOverlayOpacity;
  }
  setOverlayOpacity(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    if (envState.groundOverlayOpacity === clamped) return;
    setEnvState({ groundOverlayOpacity: clamped }, { source: "manual" });
    this.refreshOverlay();
    this.notify();
  }

  /** 订阅参数变更（材质来源切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }
  setMatColor(hex: number): void {
    setEnvState({ groundMatColor: hex }, { source: "manual" });
    this.refreshSurface();
  }
  setMatGridSize(n: number): void {
    setEnvState({ groundMatGridSize: Math.max(2, Math.round(n)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatOpacity(): number {
    return envState.groundMatOpacity;
  }
  setMatOpacity(v: number): void {
    setEnvState({ groundMatOpacity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatScale(): number {
    return envState.groundMatScale;
  }
  setMatScale(v: number): void {
    setEnvState({ groundMatScale: Math.max(0.25, Math.min(8, v)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatRotation(): number {
    return envState.groundMatRotationDeg;
  }
  setMatRotation(deg: number): void {
    setEnvState({ groundMatRotationDeg: ((deg % 360) + 360) % 360 }, { source: "manual" });
    this.refreshSurface();
  }
  getMatRoughness(): number {
    return envState.groundMatRoughness;
  }
  setMatRoughness(v: number): void {
    setEnvState({ groundMatRoughness: Math.max(0, Math.min(1, v)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatMetalness(): number {
    return envState.groundMatMetalness;
  }
  setMatMetalness(v: number): void {
    setEnvState({ groundMatMetalness: Math.max(0, Math.min(1, v)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatColor2(): number {
    return envState.groundMatColor2;
  }
  setMatColor2(hex: number): void {
    setEnvState({ groundMatColor2: hex }, { source: "manual" });
    this.refreshSurface();
  }
  /* 菜单 getter */
  getMatColor(): number {
    return envState.groundMatColor;
  }
  getMatGridSize(): number {
    return envState.groundMatGridSize;
  }
  getCustomTexName(): string {
    return this.customTexName;
  }
  getMatDensity(): number {
    return envState.groundMatDensity;
  }
  setMatDensity(v: number, opts?: { skipMiddleware?: boolean }): void {
    setEnvState(
      { groundMatDensity: Math.max(0.25, Math.min(8, v)) },
      { source: "manual", ...opts },
    );
    this.refreshSurface();
  }
  getMatAngle(): number {
    return envState.groundMatAngleDeg;
  }
  setMatAngle(deg: number, opts?: { skipMiddleware?: boolean }): void {
    setEnvState({ groundMatAngleDeg: ((deg % 360) + 360) % 360 }, { source: "manual", ...opts });
    this.refreshSurface();
  }
  /** 存档恢复：委托同一 setter + skipMiddleware（还原非手改，不触发「脱离预设」标记，ADR-254）。
   *  委托而非独立方法：clamp/取模 边界单一事实源，避免与用户 setter 双写漂移。 */
  private setMatDensityRestore(v: number): void {
    this.setMatDensity(v, { skipMiddleware: true });
  }
  private setMatAngleRestore(deg: number): void {
    this.setMatAngle(deg, { skipMiddleware: true });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  getMenuNodes(): PreviewMenuNode[] {
    return buildGroundNodes(this);
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力主开关节点 id：env 面板据此升 headerToggle + body 剔除同源 */
  getMasterNodeId(): string {
    return "ground-visible";
  }

  /** 环境面板归属（ADR-268）：基础卡次位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "basic", order: 20 };
  }

  /** 保存状态到 localStorage（mat 字段纯数据可持久化；texture 二进制不存） */
  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      groundVisible: envState.groundVisible,
      // ADR-249 §2.5.1 拆轴：原 groundMatSource 单键拆为两轴持久化。
      groundSourceKind: envState.groundSourceKind,
      groundCanvasStyle: envState.groundCanvasStyle,
      groundSize: envState.groundSize,
      groundDivisions: envState.groundDivisions,
      groundColorCenter: envState.groundColorCenter,
      groundColorGrid: envState.groundColorGrid,
      groundMatColor: envState.groundMatColor,
      groundMatColor2: envState.groundMatColor2,
      groundMatGridSize: envState.groundMatGridSize,
      groundMatOpacity: envState.groundMatOpacity,
      groundMatScale: envState.groundMatScale,
      groundMatRotationDeg: envState.groundMatRotationDeg,
      groundMatDensity: envState.groundMatDensity,
      groundMatAngleDeg: envState.groundMatAngleDeg,
      groundMatRoughness: envState.groundMatRoughness,
      groundMatMetalness: envState.groundMatMetalness,
      // ADR-254：预设状态是持久化的可见事实（名实相符），不持久化则重启后
      // loadState 恢复配色会被中间件误判为手改 → 恒显示「自定义」
      groundMaterialPreset: envState.groundMaterialPreset,
      // ADR-249 §2.3 叠加层持久化
      groundOverlay: envState.groundOverlay,
      groundOverlayColor: envState.groundOverlayColor,
      groundOverlaySize: envState.groundOverlaySize,
      groundOverlayOpacity: envState.groundOverlayOpacity,
    });
  }

  /** 从 localStorage 恢复状态（texture 模式二进制未持久化 → 回退 plain） */
  loadState(): void {
    let state = restoreState(this.id);
    if (!state) return;
    // legacy 旧键迁移——ADR-196 前 ground 持久化为
    // {visible, size, divisions, colorCenter, colorGrid, matSource, matColor...}
    // （无 ground 前缀），迁移后只读前缀键且 migrateEnvState 空透传 → 升级用户的
    // 网格尺寸/线色/材质源设置静默回默认。判据用 groundSize（saveState 恒写前缀
    // 代表键）缺失 + 任一旧键存在；只映射实际存在的旧键。
    const legacyGroundKeys = [
      "visible",
      "size",
      "divisions",
      "colorCenter",
      "colorGrid",
      "matSource",
      "matColor",
      "matColor2",
      "matGridSize",
      "matOpacity",
      "matScale",
      "matDensity",
      "matAngleDeg",
      "matRoughness",
      "matMetalness",
    ] as const;
    const gs = state as Record<string, unknown>; // 非空副本（重赋值丢失收窄）
    // ADR-252：旧线色/格数需搬入叠加层（图案由 surface 迁至 overlay 时带走样式参数）
    const legacyLineColor =
      typeof gs.matLineColor === "number"
        ? gs.matLineColor
        : typeof gs.groundMatLineColor === "number"
          ? gs.groundMatLineColor
          : undefined;
    const legacyGridSize =
      typeof gs.matGridSize === "number"
        ? gs.matGridSize
        : typeof gs.groundMatGridSize === "number"
          ? gs.groundMatGridSize
          : undefined;
    if (!("groundSize" in gs) && legacyGroundKeys.some((k) => k in gs)) {
      const map: Record<string, string> = {
        visible: "groundVisible",
        size: "groundSize",
        divisions: "groundDivisions",
        colorCenter: "groundColorCenter",
        colorGrid: "groundColorGrid",
        // matSource 旧单枚举 → 三轴（在循环后单独处理）
        matColor: "groundMatColor",
        matColor2: "groundMatColor2",
        matGridSize: "groundMatGridSize",
        matOpacity: "groundMatOpacity",
        matScale: "groundMatScale",
        matDensity: "groundMatDensity",
        matAngleDeg: "groundMatAngleDeg",
        matRoughness: "groundMatRoughness",
        matMetalness: "groundMatMetalness",
      };
      const migrated: Record<string, unknown> = {};
      for (const k of legacyGroundKeys) {
        if (k in gs && k !== "matSource") migrated[map[k]] = gs[k];
      }
      // 新前缀键保底透传：legacy 判据是「缺 groundSize + 有任一旧键」，混合存档
      // （部分字段已升级）若整对象替换会把已前缀化的字段静默丢弃（审核回归实测：
      // {visible, groundCanvasStyle} 混合 → canvasStyle 丢失）。旧键已由上方 map
      // 处理，这里只透传 ground 前缀的新键（旧键均不带 ground 前缀，无冲突）。
      for (const [k, v] of Object.entries(gs)) {
        if (k.startsWith("ground") && !(k in migrated)) migrated[k] = v;
      }
      // ADR-249 §2.1 + ADR-252：旧单枚举 matSource 拆为来源轴 + 材质轴 + 叠加层
      if ("matSource" in gs) {
        const m = migrateGroundMatSource(String(gs.matSource) as LegacyGroundMatSource);
        migrated.groundSourceKind = m.sourceKind;
        if (m.canvasStyle) migrated.groundCanvasStyle = m.canvasStyle;
        if (m.overlayStyle) {
          // 旧图案值 → 叠加层，并把线色/格数一并搬过去（视觉等价）
          migrated.groundOverlay = m.overlayStyle;
          if (legacyLineColor !== undefined) migrated.groundOverlayColor = legacyLineColor;
          if (legacyGridSize !== undefined) migrated.groundOverlaySize = legacyGridSize;
        }
      }
      state = migrated;
    }

    // ADR-252：ADR-249 时代的存档——`groundCanvasStyle` 可能仍是已废弃的几何图案值。
    // 拆为「canvasStyle=plain + overlay=<同名>」，并搬运线色/格数（视觉等价）。
    {
      const st = state as Record<string, unknown>;
      const rawStyle = st.groundCanvasStyle;
      if (
        typeof rawStyle === "string" &&
        (LEGACY_CANVAS_PATTERNS as readonly string[]).includes(rawStyle)
      ) {
        st.groundCanvasStyle = "plain";
        if (st.groundOverlay === undefined || st.groundOverlay === "none") {
          st.groundOverlay = rawStyle;
        }
        if (legacyLineColor !== undefined && st.groundOverlayColor === undefined) {
          st.groundOverlayColor = legacyLineColor;
        }
        if (legacyGridSize !== undefined && st.groundOverlaySize === undefined) {
          st.groundOverlaySize = legacyGridSize;
        }
      }
    }
    restoreFields(state, {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
      groundVisible: {
        // 改走 setVisible——原绑定只写 envState，
        // env 回调 changed 键集不含 groundVisible → grid.visible 停在构造默认 true，
        // 「隐藏地面」存档重启后网格重现（半隐形地面：surface 隐藏 grid 仍显示）
        boolean: (v) => this.setVisible(v),
      },
      groundSourceKind: oneOf(GROUND_SOURCE_KINDS, (v) =>
        setEnvState({ groundSourceKind: v }, { source: "manual", skipMiddleware: true }),
      ),
      // ADR-254：恢复路径全部 skipMiddleware——存档还原是**非用户手改**写入，
      // 配色/形状还原不得触发「手改即 custom」中间件（实测：逐字段恢复会把
      // 用户选的预设恒打成 custom，名实不符）。preset 单独 oneOf 恢复；
      // 旧存档缺该字段 → 回退 plain（与 schema 默认一致，保守兜底）。
      groundMaterialPreset: oneOf([...GROUND_MATERIAL_PRESET_IDS, "custom"] as const, (v) =>
        setEnvState({ groundMaterialPreset: v }, { source: "manual", skipMiddleware: true }),
      ),
      groundCanvasStyle: oneOf(GROUND_CANVAS_STYLES, (v) =>
        setEnvState({ groundCanvasStyle: v }, { source: "manual", skipMiddleware: true }),
      ),
      groundSize: { number: (v) => setEnvState({ groundSize: v }, { source: "manual" }) },
      groundDivisions: { number: (v) => setEnvState({ groundDivisions: v }, { source: "manual" }) },
      groundColorCenter: {
        number: (v) => setEnvState({ groundColorCenter: v }, { source: "manual" }),
      },
      groundColorGrid: { number: (v) => setEnvState({ groundColorGrid: v }, { source: "manual" }) },
      groundMatColor: {
        number: (v) =>
          setEnvState({ groundMatColor: v }, { source: "manual", skipMiddleware: true }),
      },
      groundMatColor2: {
        number: (v) =>
          setEnvState({ groundMatColor2: v }, { source: "manual", skipMiddleware: true }),
      },
      groundMatGridSize: {
        number: (v) =>
          setEnvState({ groundMatGridSize: v }, { source: "manual", skipMiddleware: true }),
      },
      groundMatOpacity: { number: (v) => this.setMatOpacity(v) },
      groundMatScale: { number: (v) => this.setMatScale(v) },
      groundMatRotationDeg: { number: (v) => this.setMatRotation(v) },
      groundMatDensity: { number: (v) => this.setMatDensityRestore(v) },
      groundMatAngleDeg: { number: (v) => this.setMatAngleRestore(v) },
      groundMatRoughness: { number: (v) => this.setMatRoughness(v) },
      groundMatMetalness: { number: (v) => this.setMatMetalness(v) },
      // ADR-249 §2.3 叠加层恢复
      groundOverlay: oneOf(GROUND_OVERLAY_STYLES, (v) =>
        setEnvState({ groundOverlay: v }, { source: "manual" }),
      ),
      groundOverlayColor: {
        number: (v) => setEnvState({ groundOverlayColor: v }, { source: "manual" }),
      },
      groundOverlaySize: { number: (v) => this.setOverlaySize(v) },
      groundOverlayOpacity: { number: (v) => this.setOverlayOpacity(v) },
    });
  }

  /** 移除并释放 */
  dispose(): void {
    this.unsubscribeEnv();
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    if (this.surface.parent) this.surface.parent.remove(this.surface);
    if (this.overlay.parent) this.overlay.parent.remove(this.overlay);
    this.grid.geometry.dispose();
    const mat = this.grid.material;
    if (Array.isArray(mat))
      mat.forEach((m) => {
        m.dispose();
      });
    else mat.dispose();
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
    // ADR-249 §2.3：叠加层资源释放（owner = GroundCapability，非 customTex）
    if (this.overlayTex) {
      safeDispose(this.overlayTex);
      this.overlayTex = null;
    }
    if (this.overlayMat) {
      this.overlayMat.dispose();
      this.overlayMat = null;
    }
    this.overlay.geometry.dispose();
    this.overlaySpec = null;
  }
}
