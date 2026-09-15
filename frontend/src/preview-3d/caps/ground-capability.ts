// ===== GroundCapability：地面能力（ADR-196 迁移至 envState）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + 表面材质层（spec 单源，见 ground-surface-spec.ts）+ 水面叠加层；
// apply() 挂入场景，dispose() 移除并释放，作用域不泄漏到其它预览。

import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { buildGroundNodes } from "./ground-menu.ts";
import {
  applyGroundSurfaceAppearance,
  applyGroundSurfaceStructural,
  buildGroundSurfaceSpec,
  type GroundSurfaceMode,
  type GroundSurfaceSpec,
  type GroundSurfaceStructuralSpec,
  generateSurfacePixels,
  groundSurfaceNeedsRebuild,
} from "./ground-surface-spec.ts";
import {
  GROUND_LAYER_OFFSETS,
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";

/** 程序化表面纹理边长（plain/grid/checker 共用；512² 够细且重建成本低） */
const SURFACE_TEX_SIZE = 512;
/** matSource 合法值白名单（loadState 校验用） */
const GROUND_SURFACE_MODES: readonly GroundSurfaceMode[] = [
  "none",
  "solid",
  "plain",
  "grid",
  "checker",
  "texture",
  "stripes",
  "diamond",
  "marble",
];

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
    this.surface = this.createSurfaceMesh();

    // ADR-196：订阅 envState 变更（只接收 ground 组的键，dispatcher 前置过滤）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      () => {
        // 任何 ground 组字段变更都触发 refreshSurface（dispatcher 已过滤，无需再判断 changed）
        this.refreshSurface();
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

  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.surface.parent) this.scene.add(this.surface);
  }

  /** 地面显隐开关（表面层跟随；水面由 water.enabled 独立控制，不再跟随 grid.visible） */
  setVisible(v: boolean): void {
    setEnvState({ groundVisible: v }, { source: "manual" });
    this.grid.visible = v;
    this.updateSurfaceVisible();
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
    }
    this.updateSurfaceVisible();
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
    } else if (st.mode !== "solid" && st.mode !== "none") {
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
      matSource: envState.groundMatSource,
      matColor: envState.groundMatColor,
      matLineColor: envState.groundMatLineColor,
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
      this.enabled && envState.groundVisible && envState.groundMatSource !== "none";
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
    setEnvState({ groundMatSource: "texture" }, { source: "manual" });
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
    if (envState.groundMatSource === "texture")
      setEnvState({ groundMatSource: "plain" }, { source: "manual" });
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

  // ── 材质参数 setter/getter（全部经 refreshSurface 单路径落地）──
  getMatSource(): GroundSurfaceMode {
    return envState.groundMatSource as GroundSurfaceMode;
  }
  setMatSource(mode: GroundSurfaceMode): void {
    if (envState.groundMatSource === mode) return;
    setEnvState({ groundMatSource: mode }, { source: "manual" });
    this.refreshSurface();
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
  setMatLineColor(hex: number): void {
    setEnvState({ groundMatLineColor: hex }, { source: "manual" });
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
  getMatLineColor(): number {
    return envState.groundMatLineColor;
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
  setMatDensity(v: number): void {
    setEnvState({ groundMatDensity: Math.max(0.25, Math.min(8, v)) }, { source: "manual" });
    this.refreshSurface();
  }
  getMatAngle(): number {
    return envState.groundMatAngleDeg;
  }
  setMatAngle(deg: number): void {
    setEnvState({ groundMatAngleDeg: ((deg % 360) + 360) % 360 }, { source: "manual" });
    this.refreshSurface();
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

  /** 保存状态到 localStorage（mat 字段纯数据可持久化；texture 二进制不存） */
  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      groundVisible: envState.groundVisible,
      groundMatSource:
        envState.groundMatSource === "texture" ? "texture" : envState.groundMatSource,
      groundSize: envState.groundSize,
      groundDivisions: envState.groundDivisions,
      groundColorCenter: envState.groundColorCenter,
      groundColorGrid: envState.groundColorGrid,
      groundMatColor: envState.groundMatColor,
      groundMatLineColor: envState.groundMatLineColor,
      groundMatColor2: envState.groundMatColor2,
      groundMatGridSize: envState.groundMatGridSize,
      groundMatOpacity: envState.groundMatOpacity,
      groundMatScale: envState.groundMatScale,
      groundMatRotationDeg: envState.groundMatRotationDeg,
      groundMatDensity: envState.groundMatDensity,
      groundMatAngleDeg: envState.groundMatAngleDeg,
      groundMatRoughness: envState.groundMatRoughness,
      groundMatMetalness: envState.groundMatMetalness,
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
      "matLineColor",
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
    if (!("groundSize" in gs) && legacyGroundKeys.some((k) => k in gs)) {
      const map: Record<string, string> = {
        visible: "groundVisible",
        size: "groundSize",
        divisions: "groundDivisions",
        colorCenter: "groundColorCenter",
        colorGrid: "groundColorGrid",
        matSource: "groundMatSource",
        matColor: "groundMatColor",
        matLineColor: "groundMatLineColor",
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
        if (k in gs) migrated[map[k]] = gs[k];
      }
      state = migrated;
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
      groundMatSource: oneOf(GROUND_SURFACE_MODES, (v) =>
        setEnvState(
          { groundMatSource: v === "texture" && !this.customTex ? "plain" : v },
          { source: "manual" },
        ),
      ),
      groundSize: { number: (v) => setEnvState({ groundSize: v }, { source: "manual" }) },
      groundDivisions: { number: (v) => setEnvState({ groundDivisions: v }, { source: "manual" }) },
      groundColorCenter: {
        number: (v) => setEnvState({ groundColorCenter: v }, { source: "manual" }),
      },
      groundColorGrid: { number: (v) => setEnvState({ groundColorGrid: v }, { source: "manual" }) },
      groundMatColor: { number: (v) => setEnvState({ groundMatColor: v }, { source: "manual" }) },
      groundMatLineColor: {
        number: (v) => setEnvState({ groundMatLineColor: v }, { source: "manual" }),
      },
      groundMatColor2: { number: (v) => setEnvState({ groundMatColor2: v }, { source: "manual" }) },
      groundMatGridSize: {
        number: (v) => setEnvState({ groundMatGridSize: v }, { source: "manual" }),
      },
      groundMatOpacity: { number: (v) => this.setMatOpacity(v) },
      groundMatScale: { number: (v) => this.setMatScale(v) },
      groundMatRotationDeg: { number: (v) => this.setMatRotation(v) },
      groundMatDensity: { number: (v) => this.setMatDensity(v) },
      groundMatAngleDeg: { number: (v) => this.setMatAngle(v) },
      groundMatRoughness: { number: (v) => this.setMatRoughness(v) },
      groundMatMetalness: { number: (v) => this.setMatMetalness(v) },
    });
  }

  /** 移除并释放 */
  dispose(): void {
    this.unsubscribeEnv();
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    if (this.surface.parent) this.surface.parent.remove(this.surface);
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
  }
}
