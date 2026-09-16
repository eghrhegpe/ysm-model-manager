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

/* ============ 类型 ============ */

/** 地面表面模式（扁平枚举：来源 × 画布样式合一，避免双字段耦合守卫） */
export type GroundSurfaceMode =
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
  /** 网格线 / 棋盘副色 / 条纹副色 / 菱形线色（0xRRGGBB） */
  matLineColor: number;
  /** 渐变副色 / 大理石纹线色（0xRRGGBB） */
  matColor2: number;
  /** 整面网格/棋盘格数（每边） */
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
  matLineColor: 0x1c2030,
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
  "grid",
  "checker",
  "texture",
  "stripes",
  "diamond",
  "marble",
] as const satisfies readonly GroundSurfaceMode[];

/** 来源轴取值集合（ADR-249 §2.1；loadState 校验 + 菜单来源 select 选项用） */
export const GROUND_SOURCE_KINDS = [
  "none",
  "solid",
  "canvas",
  "texture",
] as const satisfies readonly GroundSourceKind[];

/** 样式轴取值集合（仅 sourceKind === "canvas" 有效；loadState 校验用） */
export const GROUND_CANVAS_STYLES = [
  "plain",
  "grid",
  "checker",
  "stripes",
  "diamond",
  "marble",
] as const satisfies readonly GroundCanvasStyle[];

/** 叠加层样式（独立于来源轴/样式轴，可叠加在任意底层之上） */
export type GroundOverlayStyle = "none" | "grid" | "checker";

/** 叠加层样式取值集合（ADR-249 §2.3；首期仅落地格线/棋盘，scan/glowEdge 等由后续扩展） */
export const GROUND_OVERLAY_STYLES = [
  "none",
  "grid",
  "checker",
] as const satisfies readonly GroundOverlayStyle[];

/** 矩阵行：材质面板的全部可调参数（与 ground-menu.ts 控件一一对应） */
export const GROUND_MAT_PARAMS = [
  "matColor",
  "matColor2",
  "matLineColor",
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

/** 产出贴图的模式集（generateSurfacePixels 非空返回）——matScale/matRotationDeg 的生效前提 */
const MAP_PRODUCING_MODES: readonly GroundSurfaceMode[] = [
  "plain",
  "grid",
  "checker",
  "stripes",
  "diamond",
  "marble",
];

/** 使用 lineColor 的模式集（generateSurfacePixels 中读 st.lineColor 的分支） */
const LINE_COLOR_MODES: readonly GroundSurfaceMode[] = [
  "grid",
  "checker",
  "stripes",
  "diamond",
  "marble",
];

/** 使用 color2 的模式集（仅 marble 的渐变副色） */
const COLOR2_MODES: readonly GroundSurfaceMode[] = ["marble"];

/** 使用 density / angleRad 的模式集（新三模式的旋转坐标系分支） */
const NEW_PATTERN_MODES: readonly GroundSurfaceMode[] = ["stripes", "diamond", "marble"];

/** 使用 gridSize 的模式集（grid/checker 为「每边格数」，新三模式为「图案周期数」） */
const GRID_SIZE_MODES: readonly GroundSurfaceMode[] = [
  "grid",
  "checker",
  "stripes",
  "diamond",
  "marble",
];

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

  // 其余（非 texture）色彩/图案参数
  switch (param) {
    case "matColor":
      // solid 直出 color；canvas 类（plain/grid/...）填充 color
      return true;
    case "matColor2":
      return COLOR2_MODES.includes(mode);
    case "matLineColor":
      return LINE_COLOR_MODES.includes(mode);
    case "matGridSize":
      return GRID_SIZE_MODES.includes(mode);
    case "matDensity":
    case "matAngleDeg":
      return NEW_PATTERN_MODES.includes(mode);
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

/** 样式轴：程序化画布长什么样（仅 sourceKind === "canvas" 有效） */
export type GroundCanvasStyle = "plain" | "grid" | "checker" | "stripes" | "diamond" | "marble";

/** 旧枚举 → 新两轴的映射结果 */
export interface GroundAxisMapping {
  sourceKind: GroundSourceKind;
  canvasStyle?: GroundCanvasStyle;
}

/**
 * 旧单枚举值 → 新两轴（ADR-249 §2.5 迁移映射）。
 *
 * 映射表（与 ADR-249 §2.1 逐行对应）：
 *   none                     → { sourceKind: "none" }
 *   solid                    → { sourceKind: "solid" }
 *   texture                  → { sourceKind: "texture" }
 *   plain/grid/checker/
 *   stripes/diamond/marble   → { sourceKind: "canvas", canvasStyle: <同名> }
 *
 * 注意：不在此做「texture 无贴图则改写为 plain」的降级——那是历史缺陷
 * （loadState 曾静默改写，致用户存档中的自定义贴图重启后变成纯色地面）。
 * 来源选择归用户，「无贴图」由 UI 提示处理（ADR-249 §2.5 第 2 条）。
 */
export function migrateGroundMatSource(old: GroundSurfaceMode): GroundAxisMapping {
  if (old === "none" || old === "solid" || old === "texture") {
    return { sourceKind: old };
  }
  if (GROUND_CANVAS_STYLES.includes(old as GroundCanvasStyle)) {
    return { sourceKind: "canvas", canvasStyle: old as GroundCanvasStyle };
  }
  // 脏数据兜底：未知值回退 none（不抛错、不静默选中某个真实样式）
  return { sourceKind: "none" };
}

/**
 * 新两轴 → 旧单枚举值（渲染分支与持久化回写用）。
 *
 * 与 migrateGroundMatSource 互逆（往返测试锁死）。canvas 缺样式时回退 plain
 * （画布默认样式，对齐 DEFAULT_GROUND_SURFACE_PARAMS.matSource 的历史语义）。
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
  lineColor: [number, number, number];
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
      lineColor: hexToTriple(p.matLineColor),
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

/** 位置哈希（种子化：不使用 Math.random，保证同参数可复现） */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const a = hash2(xi, yi),
    b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1),
    d = hash2(xi + 1, yi + 1);
  const u = smoothStep(xf),
    v = smoothStep(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function generateSurfacePixels(st: GroundSurfaceStructuralSpec, sizePx: number): Uint8Array {
  // ADR-249 §2.2："none" = 真的关闭地面表面层——不产出任何像素（空数组）。
  // 历史行为：none 曾与 solid/plain 同支返回不透明纯色，导致「菜单隐了控件、
  // 地面却仍盖一层实色」的语义矛盾（用户实测反馈）。none 与 solid 自此彻底分离。
  // 消费方判据：空数组 ⇒ 不创建/不显示表面贴图（GroundCapability.updateSurfaceVisible
  // 已按 groundMatSource !== "none" 门控 surface.visible，二者语义现已自洽）。
  if (st.mode === "none") return new Uint8Array(0);

  // ADR-249："texture" 同样不产程序化像素——表面来自用户上传的贴图（走
  // applyGroundSurfaceStructural 的 tex 非空分支：mat.map = tex + 白乘色）。
  // 历史行为：texture 未短路，落进尾部 grid 分支画出格线像素，而该像素
  // **永不被使用**（材质用用户贴图）——属死计算。矩阵测试捕获。
  if (st.mode === "texture") return new Uint8Array(0);

  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = st.color;
  const [lr, lg, lb] = st.lineColor;
  const [cr2, cg2, cb2] = st.color2;

  // "plain"（素面）与 "solid" 同为**纯色**语义，仅来源不同（plain = 内置生成的纯色贴图，
  // solid = 无贴图、材质直出 color）。刀⑳ 修复：原条件漏了 "plain"，使其落到下方 grid
  // 分支画出格线——而 "plain" 是 schema 默认值、菜单「素面」项，且是「清除贴图」与
  // loadState 的回退目标，故这是用户可见的行为缺陷。
  if (st.mode === "solid" || st.mode === "plain") {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
    return px;
  }

  // stripes / diamond / marble 不需要基于 cell 的逐格循环，统一按像素 2D 旋转坐标系生成
  if (st.mode === "stripes" || st.mode === "diamond" || st.mode === "marble") {
    const cosA = Math.cos(st.angleRad);
    const sinA = Math.sin(st.angleRad);
    // 归一化到 [-1,1] 便于几何计算；density 映射为频率倍率
    const half = sizePx / 2;
    const density = Math.max(0.25, st.density);
    // gridSize 在「新三模式」里作为：条纹周期数（当 angle=0 时画面横向条纹条数 ≈ gridSize * density）
    const periodCount = Math.max(1, st.gridSize) * density;

    for (let y = 0; y < sizePx; y++) {
      const ny = (y - half) / half; // [-1, 1]
      for (let x = 0; x < sizePx; x++) {
        const nx = (x - half) / half; // [-1, 1]
        // 2D 旋转：应用图案角度（st.angleRad 为结构性变化，不与 appearance.rotationRad 重复；
        // 后者在 UV repeat 阶段再施加一次，两者叠加但意义不同）
        const rx = nx * cosA + ny * sinA;
        const ry = -nx * sinA + ny * cosA;

        let pr: number, pg: number, pb: number;
        if (st.mode === "stripes") {
          // 沿 x' 轴方向的周期条纹：每 (2/periodCount) 宽度一个周期，color / lineColor 交替
          const stripeWidth = 2 / Math.max(1, periodCount);
          const band = Math.floor(
            ((((rx + 1) % stripeWidth) + stripeWidth) % stripeWidth) / (stripeWidth / 2),
          );
          if (band === 0) {
            pr = r;
            pg = g;
            pb = b;
          } else {
            pr = lr;
            pg = lg;
            pb = lb;
          }
        } else if (st.mode === "diamond") {
          // 菱形等距线：|rx| + |ry| = k * t；线宽 ~1 像素，周期 t = 2/periodCount
          const pxLineWidth = (0.9 / sizePx) * 2; // ~0.9 px 宽
          const d = Math.abs(rx) + Math.abs(ry);
          const t = 2 / Math.max(1, periodCount);
          const localD = ((d % t) + t) % t;
          // 只取「接近 0」的单边界：接近 t 实际是下一个周期的 0（相邻菱形重叠），避免双线
          const onLine = localD < pxLineWidth;
          if (onLine) {
            pr = lr;
            pg = lg;
            pb = lb;
          } else {
            pr = r;
            pg = g;
            pb = b;
          }
        } else {
          // marble：多层 valueNoise 叠加 + 沿旋转轴的正弦带，在 color 与 color2 间 lerp
          let n = 0;
          n += valueNoise(rx * 3 * density + 10, ry * 3 * density + 10) * 0.5;
          n += valueNoise(rx * 6 * density - 5, ry * 6 * density - 5) * 0.3;
          n += valueNoise(rx * 12 * density + 3, ry * 12 * density + 3) * 0.2;
          // 沿主方向（angleRad 已旋转 rx, ry，取 rx 做正弦即沿图案方向的条纹）
          const band = Math.sin((rx * periodCount + n * 2.4) * Math.PI * 2);
          const t2 = 0.5 + 0.5 * band; // [0,1]
          pr = Math.round(r + t2 * (cr2 - r));
          pg = Math.round(g + t2 * (cg2 - g));
          pb = Math.round(b + t2 * (cb2 - b));
        }

        const i = (y * sizePx + x) * 4;
        px[i] = pr;
        px[i + 1] = pg;
        px[i + 2] = pb;
        px[i + 3] = 255;
      }
    }
    return px;
  }

  const cell = sizePx / Math.max(1, st.gridSize);
  for (let y = 0; y < sizePx; y++) {
    const cy = Math.floor(y / cell);
    const fy = y - cy * cell;
    for (let x = 0; x < sizePx; x++) {
      const cx = Math.floor(x / cell);
      const fx = x - cx * cell;
      let pr: number, pg: number, pb: number;
      if (st.mode === "checker") {
        const even = (cx + cy) % 2 === 0;
        pr = even ? r : lr;
        pg = even ? g : lg;
        pb = even ? b : lb;
      } else {
        // grid：cell 首行/首列像素为线
        const line = fx < 1 || fy < 1;
        pr = line ? lr : r;
        pg = line ? lg : g;
        pb = line ? lb : b;
      }
      const i = (y * sizePx + x) * 4;
      px[i] = pr;
      px[i + 1] = pg;
      px[i + 2] = pb;
      px[i + 3] = 255;
    }
  }
  return px;
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
