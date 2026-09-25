// ===== GroundCapability：地面能力（ADR-196 迁移至 envState）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + 表面材质层（spec 单源，见 ground-surface-spec.ts）+ 水面叠加层；
// apply() 挂入场景，dispose() 移除并释放，作用域不泄漏到其它预览。

import * as THREE from "three";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import {
  registerEnvCallback,
  resumeEnvCallbacks,
  suspendEnvCallbacks,
} from "@/preview-3d/state/env-dispatcher.ts";
import type { WriteSource } from "@/preview-3d/state/env-state.ts";
// ADR-196：统一状态层
import { envState, registerEnvStateMiddleware, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import { clampFieldValue } from "@/preview-3d/state/env-state-schema.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { buildGroundNodes } from "./ground-menu.ts";
import { normalizeGroundLegacyState } from "./ground-migrations.ts";
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
// 来源门（锐评修复 2026-09-21）：「手改」只对 manual 写入成立——auto-atmosphere（氛围
// 预设快照）/ auto-model（模型默认值）携带同批字段属程序化派发，不该把用户预设打成
// custom。存档恢复路径另有显式 skipMiddleware 豁免（loadState 逐字段还原）。
// [G-6 修复 2026-10] 白名单 PRESET_KEYS 刻意不含 groundSourceKind（精确防误清），但手动切
// 来源轴（texture 选贴图 / solid / canvas）同样是「脱离材质预设」动作——不置位则「选了贴图
// → 切回素面」后菜单下拉仍显示旧预设名（名实不符，ADR-254 要消灭的病）。来源轴改为 none
// （彻底无表面层）不置位：素材层级归零，custom 标记无意义；预设点击自带 preset 键天然豁免。
registerEnvStateMiddleware((patch, { source }) => {
  if (source !== "manual") return undefined;
  if (patch.groundMaterialPreset !== undefined) return undefined;
  const sourceKindChanged =
    patch.groundSourceKind !== undefined && patch.groundSourceKind !== "none";
  const touched =
    sourceKindChanged || GROUND_MATERIAL_PRESET_KEYS.some((k) => patch[k] !== undefined);
  return touched ? { groundMaterialPreset: "custom" } : undefined;
});

/**
 * [锐评 F-2] 存档恢复的来源纪律（fog F-2 / light L-1 同口径，2026-09-22 立法）。
 *
 * 恢复是**程序化动作**，不是用户手改：一律 `auto-model`。
 * 反例（原实现）：全写 `manual` → `_writeSource` 把 ground 组键钉成最高优先级，
 * 此后同轨 `auto-model` 写入被 `shouldOverwrite` 静默吞掉（值不变、无报错、无日志，
 * 最难查的一类）。同轨 auto-model→auto-model 放行是唯一可观测判据。
 *
 * 为何要一个常量而非就地手写字面量：恢复站点分**两条路径**——
 *   ① loadState 内直接 `setEnvState(...)`；
 *   ② 委托公开 setter（setMatOpacity / setMatScale / setOverlaySize …），
 *      这些 setter 服务于**用户手改**，必须保持 `manual`。
 * 两条路径若各写各的，F-2 只会修好①而②仍是暗门（且将来新增字段默认走②）。
 * 故委托路径显式传入 `RESTORE_SOURCE`，把「恢复来源」收敛成单一事实源。
 */
const RESTORE_SOURCE = { source: "auto-model" } as const;

/** 写入口的可选覆盖：`skipMiddleware`（存档恢复豁免中间件）+ `source`（恢复来源）。
 *  省略即用户手改语义（manual）。 */
type WriteOpts = { skipMiddleware?: boolean; source?: WriteSource };

/** 组装 setEnvState 的 opts：省略项不写入键（exactOptionalPropertyTypes），
 *  避免 `{source: undefined}` 把默认来源顶掉。 */
function writeOpts(opts?: WriteOpts): { source: WriteSource; skipMiddleware?: boolean } {
  const base: { source: WriteSource; skipMiddleware?: boolean } = {
    source: opts?.source ?? "manual",
  };
  if (opts?.skipMiddleware === true) base.skipMiddleware = true;
  return base;
}

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
  /** 订阅参数变更（menu 局部刷新用）；仅**离散操作** notify——菜单结构只随来源/样式/
   *  叠加层模式等 select/toggle 变化，滑杆与取色器拖动不触发重建。 */
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
    // 参考网格显隐的首次落地（构造期读 envState：enabled × 总开关 × 网格开关）
    this.updateGridVisible();

    // ADR-196：订阅 envState 变更（只接收 ground 组的键，dispatcher 前置过滤）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed) => {
        // ground 组字段变更的唯一落地出口（几何同步 + refreshSurface/Overlay + 网格显隐）。
        // setter 内的手动 refresh 已删（锐评修复 2026-09-20）：旧接线 setter 手动 refresh +
        // 本回调 = 每次击键双刷，全靠 refresh 幂等 + needsRebuild 判别才没炸。
        // 网格必须走本回调：直接 setEnvState 写 groundGridVisible/groundVisible 的路径
        // （存档恢复、预设快照、外部调用）不经 setter；漏同步即「半隐形残影」——
        // 历史同形缺陷：loadState 只写 envState，grid.visible 停在构造默认。
        this.syncGeometry(changed);
        this.refreshSurface();
        this.refreshOverlay();
        this.updateGridVisible();
      },
      "ground",
    );
  }

  /** groundSize/divisions/color 系的几何落地：平面换装 + GridHelper 重建。
   *  这四键无菜单出口但有存档恢复通路，此前只在构造期读一次——恢复写入永不落地，
   *  存档改了尺寸重启仍是旧尺寸（与 gridVisible「存档重启重现」同形病例，
   *  锐评修复 2026-09-20）。GridHelper 无 resize API，直接重建；重建后 visible
   *  由同一回调尾部的 updateGridVisible 收敛，不依赖构造态。 */
  private syncGeometry(changed: Set<EnvStateKey>): void {
    if (changed.has("groundSize")) {
      for (const mesh of [this.surface, this.overlay]) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(envState.groundSize, envState.groundSize);
      }
    }
    if (
      changed.has("groundSize") ||
      changed.has("groundDivisions") ||
      changed.has("groundColorCenter") ||
      changed.has("groundColorGrid")
    ) {
      const parent = this.grid.parent;
      if (parent) parent.remove(this.grid);
      this.grid.geometry.dispose();
      const gridMat = this.grid.material;
      if (Array.isArray(gridMat))
        gridMat.forEach((m) => {
          m.dispose();
        });
      else gridMat.dispose();
      this.grid = this.createGridHelper();
      if (parent) parent.add(this.grid);
    }
  }

  private createGridHelper(): THREE.GridHelper {
    const grid = new THREE.GridHelper(
      envState.groundSize,
      envState.groundDivisions,
      envState.groundColorCenter,
      envState.groundColorGrid,
    );
    // visible 不在此处判定——统一归 updateGridVisible（enabled × groundVisible ×
    // groundGridVisible 三层合取），避免构造期与运行期两套判据漂移
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
      // groundSize 变更（几何已由 syncGeometry 换装）且样式不变时走此原地分支：
      // 世界格重复密度必须跟着重算，否则「格线尺寸」与新地面脱锚。
      if (this.overlayTex) {
        const rep = textureRepeat(envState.groundSize, Math.max(1, next.size));
        this.overlayTex.repeat.set(rep, rep);
      }
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

  /** 地面总显隐开关（参考网格/表面层/叠加层均跟随；水面由 water.enabled 独立控制） */
  setVisible(v: boolean, opts?: WriteOpts): void {
    setEnvState({ groundVisible: v }, writeOpts(opts));
    // 三层显隐同步（含叠加层跟随）已全部归入 ground 回调单路径（锐评修复 2026-09-20）：
    // 旧接线在此手改 overlay.visible 是为堵「地面已隐、格线还漂」残影，
    // 而 refreshOverlay 尾部本就无条件重算 visible，同一判据不需两处表达。
  }

  /** 总开关真值源 = envState.groundVisible。
   *  不再读 this.grid.visible——网格显隐自 2026-09-19 起是三层合取，读它会把
   *  「参考网格关掉」误报成「地面关掉」（本 getter 语义 = 总开关，非网格可见性）。 */
  getVisible(): boolean {
    return envState.groundVisible;
  }

  /** 参考网格（GridHelper 层）独立开关：与表面材质层/叠加层正交——解决
   *  「选了纯色/贴图材质仍关不掉底下 y=0 参考网格」的历史遗留（知识卡「已知遗留 1」）。 */
  setGridVisible(v: boolean, opts?: WriteOpts): void {
    setEnvState({ groundGridVisible: v }, writeOpts(opts));
    // 网格显隐落地归 ground 回调单路径（同值重写仍派发，回调幂等重算无碍）。
  }

  getGridVisible(): boolean {
    return envState.groundGridVisible;
  }

  // ── 参考网格几何参数（锐评 P3 补齐菜单出口 2026-09-21）──
  // 此四键早有渲染接线（syncGeometry → GridHelper 重建 / PlaneGeometry 换装）与持久化，
  // 却零 UI 入口、纯靠存档通路活着；水面尺寸滑杆（waterSize）早已可达，地面反而不能改。
  getSize(): number {
    return envState.groundSize;
  }
  setSize(n: number): void {
    // 取整是数据类型归一（GridHelper/divisions 语义），合法域钳制在唯一写入口（ADR-283）
    setEnvState({ groundSize: Math.round(n) }, { source: "manual" });
  }
  getDivisions(): number {
    return envState.groundDivisions;
  }
  setDivisions(n: number): void {
    setEnvState({ groundDivisions: Math.round(n) }, { source: "manual" });
  }
  getColorCenter(): number {
    return envState.groundColorCenter;
  }
  setColorCenter(hex: number): void {
    setEnvState({ groundColorCenter: hex }, { source: "manual" });
  }
  getColorGrid(): number {
    return envState.groundColorGrid;
  }
  setColorGrid(hex: number): void {
    setEnvState({ groundColorGrid: hex }, { source: "manual" });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.grid.parent) this.grid.parent.remove(this.grid);
      if (this.surface.parent) this.surface.parent.remove(this.surface);
      if (this.overlay.parent) this.overlay.parent.remove(this.overlay);
    }
    this.updateGridVisible();
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

  /** 参考网格显隐门控（三层合取，唯一判据）：能力开关 × 地面总开关 × 网格开关。
   *  ADR-249 遗留的旧网格层原只跟随总开关、无独立出口 → 用户选了表面材质也关不掉
   *  底下那张 y=0 参考网格；拆出 groundGridVisible 单轴后落点全在本方法。 */
  private updateGridVisible(): void {
    this.grid.visible = this.enabled && envState.groundVisible && envState.groundGridVisible;
  }

  /** 表面层显隐门控：能力开关 × 总开关 × 来源非 none（水面层独立于表面层） */
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
    // 落地归 ground 回调单路径：同值重写（texture 态重选图）仍派发（setEnvState 无同值
    // 去重，见 env-state.ts 契约注释），回调 refreshSurface 读新 textureToken → rebuild。
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
    // 显式落地（refresh 单路径的合法例外）：非 texture 态下清缓存不写 envState → 不派发；
    // 且 customTex 摘除是私有态变更、不在 envState 里——不显式 refresh 会留悬空引用。
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
        .catch(() => {
          // 失败对用户可见（锐评修复 2026-09-20：旧行为静默 dbg，选图失败零反馈）；
          // 口径对齐 infra/preview-loading showLoadFailure：bus 发 toast，cap 不直接碰 DOM。
          dbg("ground-tex-load-fail", { name: file.name });
          bus.emit("toast:show", {
            msg: `${t("preview.groundMatLoadFailed")}: ${file.name}`,
            duration: TOAST_MS.normal,
            type: "error",
          });
        })
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
    this.notify();
  }

  // ── 材质参数 setter/getter（全部经 refreshSurface 单路径落地）──
  getSourceKind(): GroundSourceKind {
    return envState.groundSourceKind;
  }
  setSourceKind(kind: GroundSourceKind): void {
    if (envState.groundSourceKind === kind) return;
    setEnvState({ groundSourceKind: kind }, { source: "manual" });
    this.notify();
  }
  getCanvasStyle(): GroundCanvasStyle {
    return envState.groundCanvasStyle;
  }
  setCanvasStyle(style: GroundCanvasStyle): void {
    if (envState.groundCanvasStyle === style) return;
    setEnvState({ groundCanvasStyle: style }, { source: "manual" });
    this.notify();
  }

  // ── 叠加层 setter（ADR-249 §2.3）──
  // notify 纪律：菜单结构只随**离散 select**（叠加样式）变化；color/slider 的拖动写入
  // 不改变任何 visibleWhen 判定，notify 只会白白重建栈顶子视图（锐评 P6）。
  getOverlayStyle(): GroundOverlayStyle {
    return envState.groundOverlay;
  }
  setOverlayStyle(style: GroundOverlayStyle): void {
    if (envState.groundOverlay === style) return;
    setEnvState({ groundOverlay: style }, { source: "manual" });
    this.notify();
  }
  getOverlayColor(): number {
    return envState.groundOverlayColor;
  }
  setOverlayColor(hex: number): void {
    if (envState.groundOverlayColor === hex) return;
    setEnvState({ groundOverlayColor: hex }, { source: "manual" });
  }
  getOverlaySize(): number {
    return envState.groundOverlaySize;
  }
  setOverlaySize(n: number, opts?: WriteOpts): void {
    // 钳制读口与写入口同源（ADR-283）：早退比较必须用钳后值，否则会漏写
    const clamped = clampFieldValue("groundOverlaySize", Math.round(n));
    if (envState.groundOverlaySize === clamped) return;
    setEnvState({ groundOverlaySize: clamped }, writeOpts(opts));
  }
  getOverlayOpacity(): number {
    return envState.groundOverlayOpacity;
  }
  setOverlayOpacity(v: number, opts?: WriteOpts): void {
    // 钳制读口与写入口同源（ADR-283）：早退比较必须用钳后值，否则会漏写
    const clamped = clampFieldValue("groundOverlayOpacity", v);
    if (envState.groundOverlayOpacity === clamped) return;
    setEnvState({ groundOverlayOpacity: clamped }, writeOpts(opts));
  }

  /** 订阅参数变更（材质来源/样式/叠加模式等离散切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }
  setMatGridSize(n: number): void {
    // 取整是数据类型归一（非值域）；合法域 [2,32] 由唯一写入口钳制（ADR-283）
    setEnvState({ groundMatGridSize: Math.round(n) }, { source: "manual" }); // 落地经 ground 回调
  }
  getMatOpacity(): number {
    return envState.groundMatOpacity;
  }
  setMatOpacity(v: number, opts?: WriteOpts): void {
    setEnvState({ groundMatOpacity: v }, writeOpts(opts)); // 值域钳制在唯一写入口（ADR-283）
  }
  getMatScale(): number {
    return envState.groundMatScale;
  }
  setMatScale(v: number, opts?: WriteOpts): void {
    setEnvState({ groundMatScale: v }, writeOpts(opts)); // 值域钳制在唯一写入口（ADR-283）
  }
  getMatRotation(): number {
    return envState.groundMatRotationDeg;
  }
  setMatRotation(deg: number, opts?: WriteOpts): void {
    setEnvState({ groundMatRotationDeg: ((deg % 360) + 360) % 360 }, writeOpts(opts));
  }
  getMatRoughness(): number {
    return envState.groundMatRoughness;
  }
  setMatRoughness(v: number, opts?: WriteOpts): void {
    setEnvState({ groundMatRoughness: v }, writeOpts(opts));
  }
  getMatMetalness(): number {
    return envState.groundMatMetalness;
  }
  setMatMetalness(v: number, opts?: WriteOpts): void {
    setEnvState({ groundMatMetalness: v }, writeOpts(opts));
  }
  getMatColor2(): number {
    return envState.groundMatColor2;
  }
  setMatColor2(hex: number): void {
    setEnvState({ groundMatColor2: hex }, { source: "manual" });
  }
  /* 菜单 getter */
  getMatColor(): number {
    return envState.groundMatColor;
  }
  setMatColor(hex: number): void {
    setEnvState({ groundMatColor: hex }, { source: "manual" }); // 落地经 ground 回调单路径
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
  setMatDensity(v: number, opts?: WriteOpts): void {
    setEnvState({ groundMatDensity: v }, writeOpts(opts));
  }
  getMatAngle(): number {
    return envState.groundMatAngleDeg;
  }
  setMatAngle(deg: number, opts?: WriteOpts): void {
    setEnvState({ groundMatAngleDeg: ((deg % 360) + 360) % 360 }, writeOpts(opts));
  }
  /** 存档恢复：委托同一 setter + skipMiddleware + RESTORE_SOURCE（还原非手改，不触发
   *  「脱离预设」标记，ADR-254）。委托而非独立方法：clamp/取模 边界单一事实源，
   *  避免与用户 setter 双写漂移。 */
  private setMatDensityRestore(v: number): void {
    this.setMatDensity(v, { ...RESTORE_SOURCE, skipMiddleware: true });
  }
  private setMatAngleRestore(deg: number): void {
    this.setMatAngle(deg, { ...RESTORE_SOURCE, skipMiddleware: true });
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
      groundGridVisible: envState.groundGridVisible,
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
    // 三代存档（扁平无前缀 / 旧单枚举 matSource / ADR-249 图案型 canvasStyle）的归一
    // 逻辑下沉至 ground-migrations.ts——纯函数、node 可测，回归锚见其同名测试；
    // capability 只保留「当前键形 → envState + Three」的恢复职责。
    const raw = restoreState(this.id);
    if (!raw) return;
    const state = normalizeGroundLegacyState(raw);
    // 重入治理（对齐 light 侧 ADR-281 口径）：restoreFields 内部逐字段 setEnvState 会
    // **同步**触发 ground 回调 → 每字段一次 refresh/syncGeometry（含 GridHelper 重建）。
    // 挂起后恢复只写 envState，末尾统一应用一次——二十余字段 = 一次落地。
    suspendEnvCallbacks();
    try {
      restoreFields(state, {
        enabled: {
          boolean: (v) => {
            this.enabled = v;
          },
        },
        groundVisible: {
          // 走 setVisible（内部写 envState，挂起期不派发）；末尾统一落地覆盖。
          boolean: (v) => this.setVisible(v, RESTORE_SOURCE),
        },
        groundGridVisible: {
          // 同 groundVisible；旧存档缺该键 → 保持 schema 默认 true
          boolean: (v) => this.setGridVisible(v, RESTORE_SOURCE),
        },
        groundSourceKind: oneOf(GROUND_SOURCE_KINDS, (v) =>
          setEnvState({ groundSourceKind: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        ),
        // ADR-254：恢复路径全部 skipMiddleware——存档还原是**非用户手改**写入，
        // 配色/形状还原不得触发「手改即 custom」中间件（实测：逐字段恢复会把
        // 用户选的预设恒打成 custom，名实不符）。旧存档缺该字段 → 回退 plain。
        groundMaterialPreset: oneOf([...GROUND_MATERIAL_PRESET_IDS, "custom"] as const, (v) =>
          setEnvState({ groundMaterialPreset: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        ),
        groundCanvasStyle: oneOf(GROUND_CANVAS_STYLES, (v) =>
          setEnvState({ groundCanvasStyle: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        ),
        groundSize: { number: (v) => setEnvState({ groundSize: v }, RESTORE_SOURCE) },
        groundDivisions: {
          number: (v) => setEnvState({ groundDivisions: v }, RESTORE_SOURCE),
        },
        groundColorCenter: {
          number: (v) => setEnvState({ groundColorCenter: v }, RESTORE_SOURCE),
        },
        groundColorGrid: {
          number: (v) => setEnvState({ groundColorGrid: v }, RESTORE_SOURCE),
        },
        groundMatColor: {
          number: (v) =>
            setEnvState({ groundMatColor: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        },
        groundMatColor2: {
          number: (v) =>
            setEnvState({ groundMatColor2: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        },
        groundMatGridSize: {
          number: (v) =>
            setEnvState({ groundMatGridSize: v }, { ...RESTORE_SOURCE, skipMiddleware: true }),
        },
        // [锐评 F-2] 以下站点委托公开 setter（用户手改语义 = manual）——
        // 必须显式传 RESTORE_SOURCE，否则恢复把这批键冻成 manual（暗门）。
        groundMatOpacity: { number: (v) => this.setMatOpacity(v, RESTORE_SOURCE) },
        groundMatScale: { number: (v) => this.setMatScale(v, RESTORE_SOURCE) },
        groundMatRotationDeg: { number: (v) => this.setMatRotation(v, RESTORE_SOURCE) },
        groundMatDensity: { number: (v) => this.setMatDensityRestore(v) },
        groundMatAngleDeg: { number: (v) => this.setMatAngleRestore(v) },
        groundMatRoughness: { number: (v) => this.setMatRoughness(v, RESTORE_SOURCE) },
        groundMatMetalness: { number: (v) => this.setMatMetalness(v, RESTORE_SOURCE) },
        // ADR-249 §2.3 叠加层恢复
        groundOverlay: oneOf(GROUND_OVERLAY_STYLES, (v) =>
          setEnvState({ groundOverlay: v }, RESTORE_SOURCE),
        ),
        groundOverlayColor: {
          number: (v) => setEnvState({ groundOverlayColor: v }, RESTORE_SOURCE),
        },
        groundOverlaySize: { number: (v) => this.setOverlaySize(v, RESTORE_SOURCE) },
        groundOverlayOpacity: { number: (v) => this.setOverlayOpacity(v, RESTORE_SOURCE) },
      });
    } finally {
      resumeEnvCallbacks();
    }
    // 统一落地一次（与 ground 回调体同序）：几何同步吃满四键（loadState 后
    // 无从知晓哪些真变了，重建一次 GridHelper 的代价可忽略）。
    this.syncGeometry(
      new Set<EnvStateKey>([
        "groundSize",
        "groundDivisions",
        "groundColorCenter",
        "groundColorGrid",
      ]),
    );
    this.refreshSurface();
    this.refreshOverlay();
    this.updateGridVisible();
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
