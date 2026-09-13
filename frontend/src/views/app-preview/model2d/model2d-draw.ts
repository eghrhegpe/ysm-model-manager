// ===== 基岩版模型 2D 线条图渲染 —— 绘制层（model2d.ts 拆分四件之二）=====
// 含全部 Canvas 绘制函数（mdDv* 辅助 + drawView + drawMiniView）。
// 几何计算（cubeVec / 顶点投影 / 包围盒）下沉至 model2d-geom.ts（纯几何叶）——
// 本层与热区层各自引用叶模块，互不引用，结构上无环。
// 类型经 type-only import 引用主文件（编译期擦除，无运行时循环依赖）。

import type { BoneTransform } from "@/utils/animation/animation.ts";
import type { BedrockModel } from "./model2d.ts";
import { collectBoneBounds, cubeVec } from "./model2d-geom.ts";

/**
 * 主题色回退表（CSS 变量缺失/非 hex 时；取默认主题同源色相）。
 * key 必须与 css/variables.css 的变量名逐字一致。
 */
const FALLBACK_THEME_RGB: Record<string, [number, number, number]> = {
  "--accent": [124, 131, 255], // 强调色（回退取紫，与 cyber 同源色相）
  "--txt": [224, 213, 245], // 正文前景色（回退取 cyber 值，对 --bg 高对比）
  "--bg": [17, 17, 27], // 主题底色（标签/缩略图衬底）
};

/** 单个 cube 投影到屏幕的结果（mdDv 投影函数统一返回）。 */
interface CubeProjection {
  ok: boolean;
  screenX: number;
  screenY: number;
  drawW: number;
  drawH: number;
  rzRad: number;
}

/** 2D 视图投影上下文：视角 + 屏幕原点到像素。同帧内所有 cube 共享一份，避免逐次传参污染。 */
interface View2D {
  cosA: number;
  sinA: number;
  ox: number;
  oy: number;
  scale: number;
}

/** cube 空间几何 + 旋转轴（投影输入，把原先散开的 x/y/z/sx/sy/sz/pivot 聚成一组）。 */
interface Cube2D {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  pivot: number[];
}

/**
 * 解析当前主题 CSS 变量为 rgba 字符串（canvas 2D fillStyle/strokeStyle 不解析 CSS 变量）。
 * 每次调用实时读取（不缓存）：绘制为低频操作（重绘时调用，非每帧），且避免主题切换后脏值。
 * 兼容 #rgb / #rrggbb；未知变量或解析失败回退 FALLBACK_THEME_RGB。
 *
 * 取色口径（2026-09-13 修复）：骨架线一律走主题变量，禁止硬编码浅色——
 * 画布底为「主题 --bg + 12% 黑罩」，六主题中 warm/sakura/mint 为亮色，
 * 原硬编码 rgba(205,214,244,·) 在其上对比度 ≈1.06:1（几乎不可见，只剩色块没有线）。
 * --txt（暗色主题浅、亮色主题深）与 --accent（规范保证对 --bg ≥4.5:1）是唯二安全取色源。
 */
function themeRgba(varName: string, alpha: number): string {
  let rgb: [number, number, number] = FALLBACK_THEME_RGB[varName] ?? [255, 255, 255];
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (m) {
      let hex = m[1];
      if (hex.length === 3)
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      rgb = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  } catch {
    /* 非 DOM 环境（如 happy-dom 无样式表）走默认回退 */
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function mdDvDrawRect(
  ctx: CanvasRenderingContext2D,
  isHighlight: boolean,
  drawW: number,
  drawH: number,
  pos:
    | { mode: "centered"; screenX: number; screenY: number; rzRad: number }
    | { mode: "plain"; drawX: number; drawY: number; doubleStroke?: boolean },
): void {
  // 高亮 = 浓 accent 块 + accent 实线粗边；普通 = 半透明 accent 块 + 前景色细线。
  // 不用"金黄高亮"：曾在亮色主题（如 warm --bg #f5f0e1）对比度 ≈1.15:1 而不可见。
  const fill = isHighlight ? themeRgba("--accent", 0.7) : themeRgba("--accent", 0.45);
  const stroke = isHighlight ? themeRgba("--accent", 1) : themeRgba("--txt", 0.8);
  const lw = isHighlight ? 1.5 : 1;

  if (pos.mode === "centered") {
    ctx.save();
    ctx.translate(pos.screenX, pos.screenY);
    ctx.rotate(-pos.rzRad);
    ctx.fillStyle = fill;
    ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  } else {
    ctx.fillStyle = fill;
    ctx.fillRect(pos.drawX, pos.drawY, drawW, drawH);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(pos.drawX, pos.drawY, drawW, drawH);
    if (pos.doubleStroke) {
      ctx.strokeRect(pos.drawX, pos.drawY, drawW, drawH);
    }
  }
}

function mdDvApplyBoneAnim(
  cube: Cube2D,
  btx: BoneTransform | undefined,
  v: View2D,
): CubeProjection {
  const { x, y, z, sx, sy, sz, pivot } = cube;
  const { cosA, sinA, ox, oy, scale } = v;
  let cx = x + sx / 2;
  let cy = y + sy / 2;
  let cz = z + sz / 2;

  if (btx?.position) {
    cx += btx.position[0] || 0;
    cy += btx.position[1] || 0;
    cz += btx.position[2] || 0;
  }

  const rzRad = ((btx?.rotation?.[2] || 0) * Math.PI) / 180;
  if (rzRad !== 0) {
    const cRz = Math.cos(rzRad);
    const sRz = Math.sin(rzRad);
    const dxx = cx - pivot[0];
    const dyy = cy - pivot[1];
    cx = pivot[0] + dxx * cRz - dyy * sRz;
    cy = pivot[1] + dxx * sRz + dyy * cRz;
  }

  const rxRad = ((btx?.rotation?.[0] || 0) * Math.PI) / 180;
  const cosRx = Math.cos(rxRad);
  if (rxRad !== 0) {
    const dyy = cy - pivot[1];
    cy = pivot[1] + dyy * cosRx;
  }

  const scrX = cx * cosA - cz * sinA;
  const scrY = cy;
  const screenX = ox + scrX * scale;
  const screenY = oy - scrY * scale;

  const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
  const ph = sy * Math.abs(cosRx);
  const drawW = pw * scale;
  const drawH = ph * scale;
  const ok = drawW >= 1 && drawH >= 1;
  return { ok, screenX, screenY, drawW, drawH, rzRad };
}

function mdDvApplyCubeRot(cube: Cube2D, cubeRot: number[], v: View2D): CubeProjection {
  const { x, y, z, sx, sy, sz, pivot } = cube;
  const { cosA, sinA, ox, oy, scale } = v;
  const rxRad = (cubeRot[0] * Math.PI) / 180;
  const rzRad = (cubeRot[2] * Math.PI) / 180;
  const cosRx = Math.cos(rxRad);
  const cRz = Math.cos(rzRad);
  const sRz = Math.sin(rzRad);

  let cx = x + sx / 2;
  let cy = y + sy / 2;
  const cz = z + sz / 2;

  if (rxRad !== 0) {
    const dyy = cy - pivot[1];
    cy = pivot[1] + dyy * cosRx;
  }

  if (rzRad !== 0) {
    const dxx = cx - pivot[0];
    const dyy = cy - pivot[1];
    cx = pivot[0] + dxx * cRz - dyy * sRz;
    cy = pivot[1] + dxx * sRz + dyy * cRz;
  }

  const scrX = cx * cosA - cz * sinA;
  const scrY = cy;
  const screenX = ox + scrX * scale;
  const screenY = oy - scrY * scale;

  const drawW = sx * scale;
  const drawH = sy * Math.abs(cosRx) * scale;
  const ok = drawW >= 1 && drawH >= 1;
  return { ok, screenX, screenY, drawW, drawH, rzRad };
}

function mdDvDrawLabels(
  ctx: CanvasRenderingContext2D,
  model: BedrockModel,
  scale: number,
  ox: number,
  oy: number,
  highlightBone: string | null,
  cosA: number,
  sinA: number,
  boneTransforms: Map<string, BoneTransform> | null,
  isFront: boolean,
): void {
  // P1 收敛（审核）：包围盒计算统一走 collectBoneBounds（原内联 mdDvProjectCorner），
  // applyCubeRot=true 使标签位置跟随 cube 级旋转，与绘制形状口径一致。
  const bounds = collectBoneBounds(model, {
    cosA,
    sinA,
    isFront,
    boneTransforms,
    applyCubeRot: true,
  });
  ctx.save();
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const bone of model.bones || []) {
    const b = bounds.get(bone.name);
    if (!b) continue;
    const cx2 = ox + ((b.mnX + b.mxX) / 2) * scale;
    const cy2 = oy - ((b.mnY + b.mxY) / 2) * scale;
    const txt = bone.name;
    // 标签底衬与字色必须同源于主题（--bg 半透明衬 + --txt 字）：
    // 亮色主题下衬底为浅、字为深，暗色主题反转，两侧都可读；固定黑衬 + 固定浅字则亮色主题下突兀且高亮字不可见。
    ctx.fillStyle = themeRgba("--bg", 0.85);
    const tw = ctx.measureText(txt).width;
    ctx.fillRect(cx2 - tw / 2 - 2, cy2 - 5, tw + 4, 10);
    ctx.fillStyle =
      bone.name === highlightBone ? themeRgba("--accent", 1) : themeRgba("--txt", 0.92);
    ctx.fillText(txt, cx2, cy2);
  }
  ctx.restore();
}

/** 主视图绘制：逐 bone/cube 投影 + 可选高亮 + 可选标签 */
function drawView(
  ctx: CanvasRenderingContext2D,
  model: BedrockModel,
  scale: number,
  ox: number,
  oy: number,
  _textureImg: HTMLImageElement | null,
  highlightBone: string | null,
  showLabels: boolean,
  cosA: number,
  sinA: number,
  boneTransforms: Map<string, BoneTransform> | null,
): void {
  const isFront = true;
  const view: View2D = { cosA, sinA, ox, oy, scale };

  for (const bone of model.bones || []) {
    const isHighlight = bone.name === highlightBone;
    const btx = boneTransforms?.get(bone.name);
    const hasAnim = btx?.rotation || btx?.position;

    for (const c of bone.cubes || []) {
      const [x, y, z] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];

      if (hasAnim) {
        const r = mdDvApplyBoneAnim({ x, y, z, sx, sy, sz, pivot }, btx, view);
        if (!r.ok) continue;
        mdDvDrawRect(ctx, isHighlight, r.drawW, r.drawH, {
          mode: "centered",
          screenX: r.screenX,
          screenY: r.screenY,
          rzRad: r.rzRad,
        });
      } else {
        const cubeRot = c.rotation || [0, 0, 0];
        const hasRotation = cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;
        if (hasRotation) {
          const r = mdDvApplyCubeRot({ x, y, z, sx, sy, sz, pivot }, cubeRot, view);
          if (!r.ok) continue;
          mdDvDrawRect(ctx, isHighlight, r.drawW, r.drawH, {
            mode: "centered",
            screenX: r.screenX,
            screenY: r.screenY,
            rzRad: r.rzRad,
          });
        } else {
          const px = x * cosA - z * sinA;
          const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
          const drawX = ox + px * scale;
          // drawView 仅前视图（isFront=true），py=y、ph=sy 为定值；删原 isFront 三元死分支
          const drawY = oy - (y + sy) * scale;
          const drawW = pw * scale;
          const drawH = sy * scale;
          if (drawW < 0.5 || drawH < 0.5) continue;
          mdDvDrawRect(ctx, isHighlight, drawW, drawH, {
            mode: "plain",
            drawX,
            drawY,
            doubleStroke: true,
          });
        }
      }
    }
  }

  if (showLabels !== false) {
    mdDvDrawLabels(ctx, model, scale, ox, oy, highlightBone, cosA, sinA, boneTransforms, isFront);
  }
}

/** 小地图：俯视图投影全部 cube 包围盒 */
function drawMiniView(
  ctx: CanvasRenderingContext2D,
  model: BedrockModel,
  _scale: number,
  _textureImg: HTMLImageElement | null,
  cosA: number,
  sinA: number,
): void {
  // P2 修复：`!cosA` 会吞掉合法 0（90° 视图角时 cos=0 被强制替换为 1，制造非法旋转对
  // 导致小地图失真）——改为仅对 undefined/NaN 兜底
  if (cosA === undefined || Number.isNaN(cosA)) cosA = 1;
  if (sinA === undefined || Number.isNaN(sinA)) sinA = 0;
  const size = 60;
  const margin = 8;
  const mx = ctx.canvas.width - size - margin;
  const my = ctx.canvas.height - size - margin;

  ctx.fillStyle = themeRgba("--bg", 0.35);
  ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const bone of model.bones || []) {
    for (const c of bone.cubes || []) {
      const [ox, oz] = cubeVec(c.origin);
      const [sx, sz] = cubeVec(c.size);
      if (ox < minX) minX = ox;
      if (ox + sx > maxX) maxX = ox + sx;
      if (oz < minZ) minZ = oz;
      if (oz + sz > maxZ) maxZ = oz + sz;
    }
  }
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const s = Math.min(size / rangeX, size / rangeZ, 2);
  const ox2 = mx + size / 2 - (minX + rangeX / 2) * s;
  const oy2 = my + size / 2 + (minZ + rangeZ / 2) * s;

  for (const bone of model.bones || []) {
    for (const c of bone.cubes || []) {
      const [x, z] = cubeVec(c.origin);
      const [sx, sz] = cubeVec(c.size);
      // 俯视图也用旋转坐标
      const rx = x * cosA - z * sinA;
      const rz = x * sinA + z * cosA;
      const drawX = ox2 + rx * s;
      const drawY = oy2 - (rz + sz) * s;
      ctx.fillStyle = themeRgba("--accent", 0.45);
      ctx.fillRect(drawX, drawY, sx * s, sz * s);
      ctx.strokeStyle = themeRgba("--txt", 0.7);
      ctx.lineWidth = 0.5;
      ctx.strokeRect(drawX, drawY, sx * s, sz * s);
    }
  }
}

// 导出给 model2d.ts 主入口与测试（calcBoneHitZones 在 model2d-hit-zones.ts）
export { drawMiniView, drawView };
