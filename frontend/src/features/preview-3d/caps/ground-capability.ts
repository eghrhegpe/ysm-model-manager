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
  restoreFields,
  createListenerSet,
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
import { dbg } from "../../../utils/debug/debug.ts";

/** 程序化表面纹理边长（plain/grid/checker 共用；512² 够细且重建成本低） */
const SURFACE_TEX_SIZE = 512;
/** matSource 合法值白名单（loadState 校验用） */
const GROUND_SURFACE_MODES: readonly GroundSurfaceMode[] = [
  "none", "solid", "plain", "grid", "checker", "texture", "stripes", "diamond", "marble",
];

/** 地面参数（表面材质 + 网格；水面已拆分为独立 WaterCapability） */
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
}

export const DEFAULT_GROUND_PARAMS: GroundParams = {
  ...DEFAULT_GROUND_SURFACE_PARAMS, // mat* 材质字段（matSource 默认 none）
  size: 80,
  divisions: 60,
  colorCenter: 0x555577,
  colorGrid: 0x2a2a3a,
  visible: true,
};

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "🌐";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private surface: THREE.Mesh; // 表面材质层（spec 单源驱动；matSource=none 时隐藏）
  private surfaceMat: THREE.MeshStandardMaterial | null = null; // 当前表面材质（重建时换新）
  private surfaceTex: THREE.Texture | null = null; // 当前挂载纹理（自建才 dispose）
  private surfaceSpec: GroundSurfaceSpec | null = null; // 当前 spec（重建判别基准）
  private customTex: THREE.Texture | null = null; // 自定义贴图缓存（独立于材质生命周期）
  private customTexName = ""; // 自定义贴图文件名（菜单 hint + token）
  private params: GroundParams;
  private enabled: boolean;
  /** 参数变更监听（menu 局部刷新用）；仅材质来源切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<GroundParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_GROUND_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.grid = this.createGridHelper();
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

  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.surface.parent) this.scene.add(this.surface);
  }

  /** 地面显隐开关（表面层跟随；水面由 water.enabled 独立控制，不再跟随 grid.visible） */
  setVisible(v: boolean): void {
    this.params.visible = v;
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
    // 门控须随 enabled 重算：surface.visible = enabled × params.visible × 模式非 none。
    // 只挂卸场景而不重算会留下陈旧值——「禁用期间改材质（refreshSurface 按 enabled=false
    // 重算成 false）→ 再启用时 apply() 只挂回、不恢复门控」会让表面层挂在场景里却不可见，
    // 表现为地面材质凭空消失。与 setVisible 路径保持对称（setVisible 亦走此重算）。
    this.updateSurfaceVisible();
  }

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
    if (this.params.matSource === mode) return; // 同值早退：避免无意义材质重建 + 菜单刷新
    this.params.matSource = mode;
    this.refreshSurface();
    this.notify(); // 材质来源切换改变表面材质分组可见性（none 隐藏全部材质控件），通知菜单局部刷新
  }

  /** 订阅参数变更（材质来源切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
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
    return [...gcBuildMain(this), ...gcBuildMaterialGroup(this)];
  }

  /** 保存状态到 localStorage（mat 字段纯数据可持久化；texture 二进制不存） */
  saveState(): void {
    persistState(this.id, {
      visible: this.params.visible,
      enabled: this.enabled,
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
    });
  }

  /** 从 localStorage 恢复状态（texture 模式二进制未持久化 → 回退 plain；V1→V2 自动迁移） */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    restoreFields(state, {
      enabled: {
        boolean: (v) => { this.enabled = v; },
      },
      visible: {
        boolean: (v) => {
          this.params.visible = v;
          this.grid.visible = v;
        },
      },
      matSource: {
        string: (v) => {
          if (GROUND_SURFACE_MODES.includes(v as GroundSurfaceMode)) {
            this.params.matSource =
              v === "texture" && !this.customTex ? "plain" : (v as GroundSurfaceMode);
          }
        },
      },
      matColor: { number: (v) => { this.params.matColor = v; } },
      matLineColor: { number: (v) => { this.params.matLineColor = v; } },
      matColor2: { number: (v) => { this.params.matColor2 = v; } },
      matGridSize: { number: (v) => { this.params.matGridSize = v; } },
      matOpacity: { number: (v) => this.setMatOpacity(v) },
      matScale: { number: (v) => this.setMatScale(v) },
      matRotationDeg: { number: (v) => this.setMatRotation(v) },
      matDensity: { number: (v) => this.setMatDensity(v) },
      matAngleDeg: { number: (v) => this.setMatAngle(v) },
      matRoughness: { number: (v) => this.setMatRoughness(v) },
      matMetalness: { number: (v) => this.setMatMetalness(v) },
    });
  }

  /** 移除并释放（GridHelper 材质可能是数组，遍历 dispose；surface 连同纹理一并释放） */
  dispose(): void {
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    if (this.surface.parent) this.surface.parent.remove(this.surface);
    this.grid.geometry.dispose();
    const mat = this.grid.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
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

const MAT_GROUP = "preview.groundGroupMaterial";

function gcSliderDef(
  id: string,
  labelKey: string,
  fallback: string,
  slider: { min: number; max: number; step: number; unit?: string },
  getValue: () => number,
  setValue: (v: number) => void,
  visible?: () => boolean,
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
    ...(visible ? { visible } : {}),
  };
}

function gcColorDef(
  id: string,
  labelKey: string,
  fallback: string,
  getValue: () => number,
  setValue: (v: number) => void,
  visible?: () => boolean,
): MenuControlDef {
  return {
    id,
    kind: "color",
    labelKey,
    fallback,
    group: MAT_GROUP,
    getValue,
    setValue: (v) => setValue(v as number),
    ...(visible ? { visible } : {}),
  };
}

function gcButtonDef(
  id: string,
  labelKey: string,
  fallback: string,
  button: MenuControlDef["button"],
  visible?: () => boolean,
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
    ...(visible ? { visible } : {}),
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
    gcColorDef("ground-mat-color", "preview.groundMatColor", "底色", () => self.params.matColor, (v) => cap.setMatColor(v), () => cap.getMatSource() !== "none"),
    gcColorDef("ground-mat-color2", "preview.groundMatColor2", "副色", () => cap.getMatColor2(), (v) => cap.setMatColor2(v), () => cap.getMatSource() !== "none"),
    gcColorDef("ground-mat-line-color", "preview.groundMatLineColor", "线色", () => self.params.matLineColor, (v) => cap.setMatLineColor(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-grid-size", "preview.groundMatGridSize", "格数", { min: 2, max: 32, step: 1 }, () => self.params.matGridSize, (v) => cap.setMatGridSize(Math.round(v)), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-density", "preview.groundMatDensity", "纹理密度", { min: 0.25, max: 8, step: 0.25 }, () => cap.getMatDensity(), (v) => cap.setMatDensity(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-angle", "preview.groundMatAngle", "纹理角度", { min: 0, max: 360, step: 5, unit: "°" }, () => cap.getMatAngle(), (v) => cap.setMatAngle(v), () => cap.getMatSource() !== "none"),
    gcButtonDef("ground-mat-texture", "preview.groundMatPick", "选择贴图", {
      textKey: "preview.groundMatPick",
      getHint: () => self.customTexName || "",
      variant: "primary",
      action: () => self.openTexturePicker(),
    }, () => cap.getMatSource() === "texture"),
    gcButtonDef("ground-mat-clear", "preview.groundMatClear", "清除贴图", {
      textKey: "preview.groundMatClear",
      variant: "ghost",
      action: () => cap.clearCustomTexture(),
    }, () => cap.getMatSource() === "texture"),
    gcSliderDef("ground-mat-opacity", "preview.groundMatOpacity", "表面不透明度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatOpacity(), (v) => cap.setMatOpacity(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-scale", "preview.groundMatScale", "纹理缩放", { min: 0.25, max: 8, step: 0.25 }, () => cap.getMatScale(), (v) => cap.setMatScale(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-rotation", "preview.groundMatRotation", "纹理旋转", { min: 0, max: 360, step: 5, unit: "°" }, () => cap.getMatRotation(), (v) => cap.setMatRotation(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-roughness", "preview.groundMatRoughness", "粗糙度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatRoughness(), (v) => cap.setMatRoughness(v), () => cap.getMatSource() !== "none"),
    gcSliderDef("ground-mat-metalness", "preview.groundMatMetalness", "金属度", { min: 0, max: 1, step: 0.05 }, () => cap.getMatMetalness(), (v) => cap.setMatMetalness(v), () => cap.getMatSource() !== "none"),
  ];
}
