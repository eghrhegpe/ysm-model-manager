// ===== GroundSurfaceSpec：地面材质单一事实源（借鉴 MikuMikuAR ADR-226 精髓）=====
// 「地面材质应该长什么样」描述为纯数据 spec，由 buildGroundSurfaceSpec 唯一生成：
//   - structural：换纹理/换颜色的结构性字段 → 触发重建（specKey 自动序列化，杜绝手拼 key）
//   - appearance：数值性外观字段 → 原地更新（applyGroundSurfaceAppearance 单路径落地）
// 不变量（测试锁死，见 ground-surface-spec.test.ts Suite 3 合约）：
//   1. 外观参数只经 applyGroundSurfaceAppearance 落地，禁止在 capability 里散落 mutate；
//   2. 纹理密度 = meshSize / TILE_WORLD_SIZE / scale，只在 textureRepeat() 一处计算；
//   3. 新增结构字段 = 改接口 + build 里赋值，specKey 自动纳入（无手拼遗漏风险）。
// 本模块保持可独立单测：除 THREE 类型外无渲染依赖；像素生成走 Uint8Array（node 可测，
// 对齐 ground-capability.generateNormalMap 的 DataTexture 口径），不用 DOM canvas。

import type * as THREE from "three";
import {
  generatePlainPixels,
  SURFACE_PIXEL_GENERATORS,
} from "@/preview-3d/caps/surface-pixels/index.ts";
import type {
  SurfaceCanvasStyle,
  SurfacePixelInput,
} from "@/preview-3d/caps/surface-pixels/types.ts";

/* ============ 类型 ============ */

/** 地面表面模式（当前 = 来源 × **材质**；几何图案已迁至叠加层轴——ADR-252）。
 *  与 ADR-249 时期的区别：不再含 grid/checker/stripes/diamond。 */
export type GroundSurfaceMode =
  | "none"
  | "solid"
  | "plain"
  | "marble"
  | "sand"
  | "grass"
  | "texture";

/** ADR-252 之前的扁平 9 值枚举（**仅作迁移输入**，运行时不出现图案值）。 */
export type LegacyGroundMatSource =
  | "none"
  | "solid"
  | "plain"
  | "grid"
  | "checker"
  | "texture"
  | "stripes"
  | "diamond"
  | "marble";

export interface GroundMaterialParams {
  /** 表面模式 */
  matSource: GroundSurfaceMode;
  /** 底色 / 素面色（0xRRGGBB） */
  matColor: number;
  // ADR-252：原 `matLineColor` 已删除——几何图案（唯一读线色者）已迁至叠加层轴，
  // 叠加层用自己的 `groundOverlayColor`。旧存档的该值由迁移搬入 `groundOverlayColor`。
  /** 渐变副色 / 大理石纹线色（0xRRGGBB） */
  matColor2: number;
  /** 噪声材质粒度基准（ADR-252：图案离场后仅噪声材质读它） */
  matGridSize: number;
  /** 表面不透明度 0=全透 1=不透明 */
  matOpacity: number;
  /** 纹理缩放倍率（越大重复越多越细） */
  matScale: number;
  /** 纹理旋转角（度，UI 直读） */
  matRotationDeg: number;
  /** PBR 粗糙度 */
  matRoughness: number;
  /** PBR 金属度 */
  matMetalness: number;
  /** 图案密度（条纹/大理石 有效，控制粗细/频率） */
  matDensity: number;
  /** 图案角度（度，条纹/菱形/大理石 生效；UI 直读 0~360） */
  matAngleDeg: number;
}

export const DEFAULT_GROUND_SURFACE_PARAMS: GroundMaterialParams = {
  matSource: "none",
  matColor: 0x9a8b78,
  matColor2: 0x6b5d4c,
  matGridSize: 8,
  matOpacity: 1,
  matScale: 1,
  matRotationDeg: 0,
  matRoughness: 0.85,
  matMetalness: 0,
  matDensity: 1,
  matAngleDeg: 0,
};

/* ============ 参数 × 模式生效矩阵（ADR-249 §2.4 单一事实源）============ */
// 本矩阵是「菜单控件可见性」与「渲染参数读取」的**共同事实源**：
//     菜单可见 ⇔ paramIsEffective(mode, param) === true
// 禁止菜单与渲染各写一份 if——两处必须共同派生自此处，否则必然回归死控件。
//
// 核实基准（2026-09-16）：generateSurfacePixels 的像素读取分支 +
// applyGroundSurfaceAppearance 的 mat.map 读取。逐格核实记录见
// docs/ADR-249-ground-material-effect-matrix.md。
//
// 注意 matScale / matRotationDeg：二者作用于 mat.map，故凡产出贴图的模式
// （plain 起）均被读取——属「生效但视觉不可见」（纯色贴图重复仍是纯色）。
// 这与 solid（完全不产出贴图、参数无从作用）性质不同，故不并入真死控件。

export const GROUND_SURFACE_MODES = [
  "none",
  "solid",
  "plain",
  "marble",
  "sand",
  "grass",
  "texture",
] as const satisfies readonly GroundSurfaceMode[];

/** ADR-252 之前的 9 值扁平枚举（仅迁移路径消费；与 `LegacyGroundMatSource` 同步）。 */
export const LEGACY_GROUND_MAT_SOURCES = [
  "none",
  "solid",
  "plain",
  "grid",
  "checker",
  "texture",
  "stripes",
  "diamond",
  "marble",
] as const satisfies readonly LegacyGroundMatSource[];

/** 来源轴取值集合（ADR-249 §2.1；loadState 校验 + 菜单来源 select 选项用） */
export const GROUND_SOURCE_KINDS = [
  "none",
  "solid",
  "canvas",
  "texture",
] as const satisfies readonly GroundSourceKind[];

/** 样式轴取值集合（纯材质，仅 sourceKind === "canvas" 有效；ADR-252 起不含几何图案）。 */
export const GROUND_CANVAS_STYLES = [
  "plain",
  "marble",
  "sand",
  "grass",
] as const satisfies readonly GroundCanvasStyle[];

/* ============ 材质预设（ADR-254）：材质名兑现配色 ============ */
// 病根：`canvasStyle` 只控制「纹理形状」（频率/对比度），颜色是正交参数。
// 于是选「草地」得到的是棕色斑块——材质名是**预设**语汇，实现却是**原语**语汇。
// 此处把材质名兑换为「形状 + 配色」完整预设，并附显式状态供菜单展示。

/** 材质预设键（`custom` = 用户已手改脱离预设，非可选项） */
export type GroundMaterialPreset = GroundCanvasStyle | "custom";

/** 菜单可选的预设项（不含 custom） */
export const GROUND_MATERIAL_PRESET_IDS = [
  "plain",
  "marble",
  "sand",
  "grass",
] as const satisfies readonly GroundCanvasStyle[];

export interface GroundMaterialPresetDef {
  /** 菜单标签（中文兜底） */
  label: string;
  /** 形状：写入 groundCanvasStyle */
  canvasStyle: GroundCanvasStyle;
  /** 配色：底色 */
  matColor: number;
  /** 配色：副色（噪声插值另一端） */
  matColor2: number;
  /** 颗粒参数（预设推荐值；用户可再调） */
  matDensity: number;
  matGridSize: number;
  matAngleDeg: number;
}

/**
 * 材质预设表——**配色的唯一事实源**。
 * 邻座（MikuMikuAR）实证：材质名必须自带颜色，否则「选草地」名实不符。
 * 配色取向参考邻座 `GROUND_PRESETS`（其草地为 `[0.3,0.5,0.25]` 绿系）。
 */
export const GROUND_MATERIAL_PRESETS: Record<GroundCanvasStyle, GroundMaterialPresetDef> = {
  plain: {
    label: "素面",
    canvasStyle: "plain",
    matColor: 0x9a8b78,
    matColor2: 0x6b5d4c,
    matDensity: 1,
    matGridSize: 8,
    matAngleDeg: 0,
  },
  marble: {
    // 真大理石：浅底 + 中灰纹（非棕色）
    label: "大理石",
    canvasStyle: "marble",
    matColor: 0xe8e5df,
    matColor2: 0x8f8a80,
    matDensity: 1.5,
    matGridSize: 6,
    matAngleDeg: 0,
  },
  sand: {
    // 沙：暖黄底 + 深沙粒（高频低对比）
    label: "沙子",
    canvasStyle: "sand",
    matColor: 0xd8c49a,
    matColor2: 0xa88f5f,
    matDensity: 1,
    matGridSize: 8,
    matAngleDeg: 0,
  },
  grass: {
    // 草：绿底 + 深绿（中频高对比）
    label: "草地",
    canvasStyle: "grass",
    matColor: 0x4c7a3a,
    matColor2: 0x2f5524,
    matDensity: 1.5,
    matGridSize: 8,
    matAngleDeg: 0,
  },
};

/** 叠加层样式（独立于来源轴/样式轴，可叠加在任意底层之上） */
export type GroundOverlayStyle = "none" | "grid" | "checker" | "stripes" | "diamond";

/** 叠加层样式取值集合（ADR-249 §2.3 架构；ADR-251 补齐几何图案集）：
 *  装饰线型家族——透明底、可叠在任意来源上。 */
export const GROUND_OVERLAY_STYLES = [
  "none",
  "grid",
  "checker",
  "stripes",
  "diamond",
] as const satisfies readonly GroundOverlayStyle[];

/** ADR-249 时代曾作为 `groundCanvasStyle` 取值的几何图案（ADR-252 迁移判据）。
 *  这些值现已非法，读到即拆为「canvasStyle=plain + overlay=<同名>」。 */
export const LEGACY_CANVAS_PATTERNS = ["grid", "checker", "stripes", "diamond"] as const;

/** 矩阵行：材质面板的全部可调参数（与 ground-menu.ts 控件一一对应） */
export const GROUND_MAT_PARAMS = [
  "matColor",
  "matColor2",
  "matGridSize",
  "matDensity",
  "matAngleDeg",
  "matOpacity",
  "matScale",
  "matRotationDeg",
  "matRoughness",
  "matMetalness",
] as const;

export type GroundMatParam = (typeof GROUND_MAT_PARAMS)[number];

/** 产出贴图的模式集（generateSurfacePixels 非空返回）——matScale/matRotationDeg 的生效前提。
 *  ADR-252：图案已离场，剩下的全是材质，均产贴图。 */
const MAP_PRODUCING_MODES: readonly GroundSurfaceMode[] = ["plain", "marble", "sand", "grass"];

/** 使用 color2 的模式集（噪声类材质的色变插值：marble/sand/grass） */
const COLOR2_MODES: readonly GroundSurfaceMode[] = ["marble", "sand", "grass"];

/** 噪声材质集（走 2D 旋转坐标系，读 density / angleRad / gridSize 作颗粒参数）
 *  ADR-252：几何图案已迁至叠加层，此处只剩噪声材质。 */
const NOISE_MODES: readonly GroundSurfaceMode[] = ["marble", "sand", "grass"];

/** 使用 gridSize 的模式集（噪声材质：gridSize 作粒度基准）。
 *  ADR-252：不再含 grid/checker（图案已迁至叠加层）。 */
const GRID_SIZE_MODES: readonly GroundSurfaceMode[] = ["marble", "sand", "grass"];

/** 外观参数（与模式无关，凡非 none 均生效；texture 亦生效） */
const APPEARANCE_PARAMS: readonly GroundMatParam[] = ["matOpacity", "matRoughness", "matMetalness"];

/**
 * 判定单个参数在某表面模式下是否生效（矩阵查询）。
 *
 * 菜单 visibleWhen 谓词与渲染读取分支均从此派生（ADR-249 §2.4）。
 */
export function paramIsEffective(mode: GroundSurfaceMode, param: GroundMatParam): boolean {
  // none：表面层关闭，无任何参数生效（ADR-249 §2.2）
  if (mode === "none") return false;

  // 外观参数：任何非 none 模式都生效（含 texture）
  if (APPEARANCE_PARAMS.includes(param)) return true;

  // texture 专属例外（须在早退之前判定，否则被下方 texture 早退吞掉）：
  // 自定义贴图 mat.map = customTex（非 null），applyGroundSurfaceAppearance 对其
  // 应用 repeat/rotation——matScale/matRotationDeg 正是「自定义贴图缩放/旋转」的
  // 设计用途（ADR-249 §2.4 矩阵 texture 列 ✔；acceptLoadedTexture 设 RepeatWrapping
  // 即为此）。矩阵单一事实源约束：渲染消费的参数菜单必须可见，禁死控件。
  if (mode === "texture") {
    return param === "matScale" || param === "matRotationDeg";
  }

  // 其余（非 texture）材质参数
  switch (param) {
    case "matColor":
      // solid 直出 color；canvas 材质（plain/marble/sand/grass）均填充 color
      return true;
    case "matColor2":
      return COLOR2_MODES.includes(mode);
    case "matGridSize":
      return GRID_SIZE_MODES.includes(mode);
    case "matDensity":
    case "matAngleDeg":
      return NOISE_MODES.includes(mode);
    case "matScale":
    case "matRotationDeg":
      // 作用于 mat.map：凡产出贴图的模式均可被读取
      return MAP_PRODUCING_MODES.includes(mode);
    default:
      return false;
  }
}

/** 某模式下生效的参数全集（供测试断言「菜单可见集 == 生效集」） */
export function effectiveParamsOf(mode: GroundSurfaceMode): GroundMatParam[] {
  return GROUND_MAT_PARAMS.filter((p) => paramIsEffective(mode, p));
}

/* ============ 叠加层（ADR-249 §2.3）：独立透明格线层 ============ */
// 叠加层是独立于来源轴/样式轴的第三正交维度：可叠加在任意底层（solid/canvas/texture）
// 之上，以透明底色 + 彩色格线/棋盘图案呈现。首期落地 grid/checker 两种样式。

export interface GroundOverlayParams {
  overlayStyle: GroundOverlayStyle;
  overlayColor: number;
  overlaySize: number;
  overlayOpacity: number;
}

export interface GroundOverlaySpec {
  style: GroundOverlayStyle;
  /** 线色 [r,g,b] 0-255 */
  color: [number, number, number];
  size: number;
  opacity: number;
}

export function buildGroundOverlaySpec(p: GroundOverlayParams): GroundOverlaySpec {
  const hex = p.overlayColor;
  return {
    style: p.overlayStyle,
    color: [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff],
    size: p.overlaySize,
    opacity: p.overlayOpacity,
  };
}

export function overlaySpecKey(spec: GroundOverlaySpec): string {
  return JSON.stringify({ style: spec.style, color: spec.color, size: spec.size });
}

export function overlayNeedsRebuild(
  prev: GroundOverlaySpec | null,
  next: GroundOverlaySpec,
): boolean {
  return prev === null || overlaySpecKey(prev) !== overlaySpecKey(next);
}

/**
 * 生成叠加层像素：透明底色 + 彩色格线/棋盘。
 * - grid：首行首列画线（与 surface grid 一致）
 * - checker：奇偶格交替（线色/透明交替）
 * - style 为 none 时返回空数组（表示「无叠加」）
 */
export function generateOverlayPixels(
  style: GroundOverlayStyle,
  sizePx: number,
  color: [number, number, number],
  cells: number,
): Uint8Array {
  if (style === "none") return new Uint8Array(0);
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = color;
  // 格数必须真实参与像素生成（与 surface 侧 `cell = sizePx / gridSize` 同口径）。
  // 回归：初版硬编码 `sizePx / 8` 且不设 map.repeat → 「叠加格数」滑杆可拖、
  // 会触发重建，却产出完全相同的贴图——死控件（ADR-249 要消灭的正是这类）。
  const n = Math.max(1, Math.round(cells));
  const cellSize = sizePx / n;
  const lineWidth = Math.max(1, Math.round(sizePx / 256));
  for (let y = 0; y < sizePx; y++) {
    for (let x = 0; x < sizePx; x++) {
      const idx = (y * sizePx + x) * 4;
      let isLine = false;
      if (style === "grid") {
        isLine = x % cellSize < lineWidth || y % cellSize < lineWidth;
      } else if (style === "checker") {
        isLine = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 1;
      } else if (style === "stripes") {
        // 竖向条带（与 surface stripes 同构，但无角度参数 → 轴对齐）
        isLine = Math.floor(x / cellSize) % 2 === 1;
      } else if (style === "diamond") {
        // 菱形等距线：|u|+|v| = k·t（与 surface diamond 同口径，归一化坐标）
        const ux = (x / sizePx) * 2 - 1;
        const uy = (y / sizePx) * 2 - 1;
        const d = Math.abs(ux) + Math.abs(uy);
        const t = 2 / n;
        const localD = ((d % t) + t) % t;
        isLine = localD < (0.9 / sizePx) * 2;
      }
      if (isLine) {
        px[idx] = r;
        px[idx + 1] = g;
        px[idx + 2] = b;
        px[idx + 3] = 255;
      } else {
        px[idx + 3] = 0; // 透明
      }
    }
  }
  return px;
}

/** 叠加层材质的 appearance 落地（map 由 capability 侧构造后传入；本模块不碰 THREE 运行时） */
export function applyOverlayMaterial(
  mat: THREE.MeshStandardMaterial,
  spec: GroundOverlaySpec,
  tex: THREE.Texture | null,
): void {
  mat.map = tex;
  mat.transparent = true;
  mat.opacity = spec.opacity;
  mat.depthWrite = false;
  mat.needsUpdate = true;
}

/** 叠加层纹理边长（capability 侧构造 DataTexture 用；与 surface 同口径） */
export const OVERLAY_TEX_SIZE = 512;

/* ============ 拆轴：来源轴 × 样式轴（ADR-249 §2.1）============ */
// 旧的单枚举 groundMatSource 压了两条正交轴：
//   来源轴（颜色从哪来）  —— none / solid / canvas / texture
//   样式轴（画布长什么样）—— plain / grid / checker / stripes / diamond / marble
// 「线色是否适用」是样式轴的属性，「有没有贴图」是来源轴的属性；压成一个枚举后，
// 菜单层只能做整组显隐，无法表达「纯色来源下线色不适用」——这是死控件的根源。

/** 来源轴：颜色从哪来（决定渲染管线） */
export type GroundSourceKind = "none" | "solid" | "canvas" | "texture";

/** 样式轴：程序化画布长什么样（**纯材质**；仅 sourceKind === "canvas" 有效）。
 *  ADR-252：几何图案（grid/checker/stripes/diamond）已移至叠加层轴，不在此。 */
export type GroundCanvasStyle = "plain" | "marble" | "sand" | "grass";

/** 旧枚举 → 新三轴的映射结果（ADR-249 拆来源/样式；ADR-252 再拆图案至叠加层）。 */
export interface GroundAxisMapping {
  sourceKind: GroundSourceKind;
  canvasStyle?: GroundCanvasStyle;
  /** 旧值若为几何图案：本字段给出对应的叠加层样式。
   *  消费方还须把旧 `matLineColor` 搬入 `groundOverlayColor`、`matGridSize` 搬入 `groundOverlaySize`。 */
  overlayStyle?: GroundOverlayStyle;
}

/**
 * 旧单枚举值 → 新三轴（ADR-249 §2.5 + ADR-252 §2.3 迁移映射）。
 *
 * 映射表：
 *   none                     → { sourceKind: "none" }
 *   solid                    → { sourceKind: "solid" }
 *   texture                  → { sourceKind: "texture" }
 *   plain                    → { sourceKind: "canvas", canvasStyle: "plain" }
 *   marble                   → { sourceKind: "canvas", canvasStyle: "marble" }
 *   grid/checker/stripes/
 *   diamond                  → { sourceKind: "canvas", canvasStyle: "plain", overlayStyle: <同名> }
 *
 * 注意：不在此做「texture 无贴图则改写为 plain」的降级——那是历史缺陷
 * （loadState 曾静默改写，致用户存档中的自定义贴图重启后变成纯色地面）。
 * 来源选择归用户，「无贴图」由 UI 提示处理（ADR-249 §2.5 第 2 条）。
 */
export function migrateGroundMatSource(
  old: LegacyGroundMatSource | GroundCanvasStyle,
): GroundAxisMapping {
  if (old === "none" || old === "solid" || old === "texture") {
    return { sourceKind: old };
  }
  // ADR-252：旧几何图案 → 材质底座（plain）+ 叠加层进位，视觉等价
  if (old === "grid" || old === "checker" || old === "stripes" || old === "diamond") {
    return { sourceKind: "canvas", canvasStyle: "plain", overlayStyle: old };
  }
  // 材质值（plain/marble/sand/grass）原生对应
  if (old === "plain" || old === "marble" || old === "sand" || old === "grass") {
    return { sourceKind: "canvas", canvasStyle: old };
  }
  // 脏数据兜底：未知值回退 none（不抛错、不静默选中某个真实材质）
  return { sourceKind: "none" };
}

/**
 * 新两轴 → 当前表面模式（渲染分支用）。
 *
 * 注意：ADR-252 后**不再与 `migrateGroundMatSource` 互逆**——旧图案值经迁移会
 * 拆为「plain 底座 + 叠加层」，不再回到单值。canvas 缺材质时回退 plain。
 */
export function groundMatSourceFromAxes(
  sourceKind: GroundSourceKind,
  canvasStyle?: GroundCanvasStyle,
): GroundSurfaceMode {
  switch (sourceKind) {
    case "none":
    case "solid":
    case "texture":
      return sourceKind;
    case "canvas":
      return canvasStyle ?? "plain";
    default:
      return "none";
  }
}

export interface GroundSurfaceStructuralSpec {
  mode: GroundSurfaceMode;
  color: [number, number, number];
  gridSize: number;
  /** 自定义贴图身份标识（文件名:尺寸）；"" = 无。变化触发重建 */
  textureToken: string;
  color2: [number, number, number];
  density: number;
  angleRad: number;
}

export interface GroundSurfaceAppearanceSpec {
  opacity: number;
  textureScale: number;
  rotationRad: number;
  roughness: number;
  metalness: number;
}

export interface GroundSurfaceSpec {
  structural: GroundSurfaceStructuralSpec;
  appearance: GroundSurfaceAppearanceSpec;
}

/* ============ spec 构建（唯一真相源）============ */

function hexToTriple(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function buildGroundSurfaceSpec(
  p: GroundMaterialParams,
  textureToken: string,
): GroundSurfaceSpec {
  return {
    structural: {
      mode: p.matSource,
      color: hexToTriple(p.matColor),
      gridSize: p.matGridSize,
      textureToken,
      color2: hexToTriple(p.matColor2),
      density: p.matDensity,
      angleRad: (p.matAngleDeg * Math.PI) / 180,
    },
    appearance: {
      opacity: p.matOpacity,
      textureScale: p.matScale,
      rotationRad: (p.matRotationDeg * Math.PI) / 180,
      roughness: p.matRoughness,
      metalness: p.matMetalness,
    },
  };
}

/* ============ 自动 key（杀死手拼字符串哨兵）============ */

/** structural 子集确定性序列化：排序键投影重建后 JSON——键序与构造/插入顺序无关
 * （code_review 74cc9ad95 #2/#4：整体 JSON.stringify 依赖键插入序，仅 buildGroundSurfaceSpec
 * 字面量固定序的约定兜底；从持久化 JSON 恢复/程序化构造产生不同键序时，语义相同内容会
 * 误报 groundSurfaceNeedsRebuild → 512×512 表面纹理无谓再生。顶层键排序即够——值均为
 * 原子或定长数组，数组元素序是语义、不受影响）。Suite 1「key 对字段顺序不敏感」锁死契约 */
export function surfaceSpecKey(s: GroundSurfaceSpec): string {
  const st = s.structural as unknown as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(st)
        .sort()
        .map((k) => [k, st[k]]),
    ),
  );
}

/** 结构性变化 → 需要重建材质与纹理；否则原地更新即可 */
export function groundSurfaceNeedsRebuild(
  prev: GroundSurfaceSpec,
  next: GroundSurfaceSpec,
): boolean {
  return surfaceSpecKey(prev) !== surfaceSpecKey(next);
}

/* ============ 纹理密度不变量（唯一计算点）============ */

/** 每格世界单位基准：50 单位地面默认铺 5×5 次重复 */
export const TILE_WORLD_SIZE = 10;

export function textureRepeat(meshSize: number, scale: number): number {
  return meshSize / TILE_WORLD_SIZE / scale;
}

/* ============ 程序化像素生成（RGBA，node 可测）============ */
// 像素算法已下沉至 caps/surface-pixels/（每材质一个生成器 + 共享 noise 原语）。
// 本函数退化为「取 structural → 查表分发」，spec/key/apply 逻辑不变。
// 设计：surface-pixels/* 零 three 运行时依赖、零 DOM，保留 node 单测能力（对齐原约束）。

export function generateSurfacePixels(st: GroundSurfaceStructuralSpec, sizePx: number): Uint8Array {
  // ADR-249 §2.2："none" = 真的关闭地面表面层——不产出任何像素（空数组）。
  if (st.mode === "none") return new Uint8Array(0);

  // ADR-249："texture" 同样不产程序化像素——表面来自用户上传的贴图。
  if (st.mode === "texture") return new Uint8Array(0);

  // "plain"（素面）与 "solid" 同为**纯色**语义（刀⑳ 修复：漏 plain 会画出格线）。
  // 二者走纯色生成器，不进噪声材质表。
  if (st.mode === "solid" || st.mode === "plain") {
    const input: SurfacePixelInput = {
      color: st.color,
      color2: st.color2,
      gridSize: st.gridSize,
      density: st.density,
      angleRad: st.angleRad,
    };
    return generatePlainPixels(input, sizePx);
  }

  // 剩余为噪声材质（marble / sand / grass），查表分发到 surface-pixels/ 各生成器。
  // 形状建模（大理石域扭曲、草各向异性）集中在各材质文件，本函数不再含像素算法。
  const input: SurfacePixelInput = {
    color: st.color,
    color2: st.color2,
    gridSize: st.gridSize,
    density: st.density,
    angleRad: st.angleRad,
  };
  return SURFACE_PIXEL_GENERATORS[st.mode as SurfaceCanvasStyle](input, sizePx);
}

/* ============ 落地函数（两条路径共用，禁止绕过）============ */

/**
 * 重建路径专用：把 structural 落到新材质上。
 * @param tex 已就绪的纹理（solid/none 传 null，用 color 直出）
 */
export function applyGroundSurfaceStructural(
  mat: THREE.MeshStandardMaterial,
  st: GroundSurfaceStructuralSpec,
  tex: THREE.Texture | null,
): void {
  if (tex) {
    mat.map = tex;
    mat.color.setRGB(1, 1, 1); // 有贴图时颜色白乘，色值已烘进像素
  } else {
    mat.map = null;
    mat.color.setRGB(st.color[0] / 255, st.color[1] / 255, st.color[2] / 255);
  }
  mat.needsUpdate = true;
}

/**
 * 原地/重建通用：appearance 字段统一落地（唯一入口）。
 * @param meshSize 地面世界尺寸（UV 密度不变量依赖；见 textureRepeat）
 */
export function applyGroundSurfaceAppearance(
  mat: THREE.MeshStandardMaterial,
  spec: GroundSurfaceSpec,
  meshSize: number,
): void {
  const a = spec.appearance;
  mat.opacity = a.opacity;
  mat.transparent = a.opacity < 1;
  mat.depthWrite = a.opacity >= 1;
  mat.roughness = a.roughness;
  mat.metalness = a.metalness;
  if (mat.map) {
    mat.map.center.set(0.5, 0.5);
    mat.map.rotation = a.rotationRad;
    const rep = textureRepeat(meshSize, a.textureScale);
    mat.map.repeat.set(rep, rep);
  }
}
