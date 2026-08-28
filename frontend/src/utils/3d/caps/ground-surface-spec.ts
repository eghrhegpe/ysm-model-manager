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
export type GroundSurfaceMode = "none" | "solid" | "plain" | "grid" | "checker" | "texture" | "stripes" | "diamond" | "marble";

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

export function buildGroundSurfaceSpec(p: GroundMaterialParams, textureToken: string): GroundSurfaceSpec {
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

/** structural 子集确定性序列化：新增结构字段后在此补一行即自动纳入重建判别 */
export function surfaceSpecKey(s: GroundSurfaceSpec): string {
  const st = s.structural;
  return JSON.stringify([
    st.mode,
    st.color[0], st.color[1], st.color[2],
    st.lineColor[0], st.lineColor[1], st.lineColor[2],
    st.gridSize,
    st.textureToken,
    st.color2[0], st.color2[1], st.color2[2],
    st.density,
    st.angleRad,
  ]);
}

/** 结构性变化 → 需要重建材质与纹理；否则原地更新即可 */
export function groundSurfaceNeedsRebuild(prev: GroundSurfaceSpec, next: GroundSurfaceSpec): boolean {
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
function smoothStep(t: number): number { return t * t * (3 - 2 * t); }
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smoothStep(xf), v = smoothStep(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function generateSurfacePixels(st: GroundSurfaceStructuralSpec, sizePx: number): Uint8Array {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = st.color;
  const [lr, lg, lb] = st.lineColor;
  const [cr2, cg2, cb2] = st.color2;

  if (st.mode === "solid" || st.mode === "none") {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
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
          const band = Math.floor(((rx + 1) % stripeWidth + stripeWidth) % stripeWidth / (stripeWidth / 2));
          if (band === 0) { pr = r; pg = g; pb = b; } else { pr = lr; pg = lg; pb = lb; }
        } else if (st.mode === "diamond") {
          // 菱形等距线：|rx| + |ry| = k * t；线宽 ~1 像素，周期 t = 2/periodCount
          const pxLineWidth = 0.9 / sizePx * 2; // ~0.9 px 宽
          const d = Math.abs(rx) + Math.abs(ry);
          const t = 2 / Math.max(1, periodCount);
          const localD = ((d % t) + t) % t;
          // 只取「接近 0」的单边界：接近 t 实际是下一个周期的 0（相邻菱形重叠），避免双线
          const onLine = localD < pxLineWidth;
          if (onLine) { pr = lr; pg = lg; pb = lb; } else { pr = r; pg = g; pb = b; }
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
        px[i] = pr; px[i + 1] = pg; px[i + 2] = pb; px[i + 3] = 255;
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
        pr = even ? r : lr; pg = even ? g : lg; pb = even ? b : lb;
      } else {
        // grid：cell 首行/首列像素为线
        const line = fx < 1 || fy < 1;
        pr = line ? lr : r; pg = line ? lg : g; pb = line ? lb : b;
      }
      const i = (y * sizePx + x) * 4;
      px[i] = pr; px[i + 1] = pg; px[i + 2] = pb; px[i + 3] = 255;
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
