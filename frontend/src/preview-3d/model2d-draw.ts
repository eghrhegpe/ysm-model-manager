// ===== 基岩版模型 2D 线条图渲染 —— 绘制层（model2d.ts 拆分三件之一）=====
// 含 cubeVec 工具 + 全部 Canvas 绘制函数（mdDv* 辅助 + drawView + drawMiniView）。
// 类型经 type-only import 引用主文件（编译期擦除，无运行时循环依赖）。

import type { BoneTransform } from "../utils/animation/animation.ts";
import type { BedrockModel } from "./model2d.ts";

// P1 修复（审核）：cube 向量归一化——畸形模型缺 origin/size 或数组长度 <3 时
// 解构 undefined 抛 TypeError，整张 2D 图静默空白（skeleton.ts 兜底）。统一入口
// 回退 [0,0,0]，5 处解构点收敛复用。
export function cubeVec(v: number[] | undefined): [number, number, number] {
  return v && v.length >= 3 ? [v[0], v[1], v[2]] : [0, 0, 0];
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
  const fill = isHighlight
    ? "rgba(255,180,50,0.25)"
    : "rgba(124,131,255,0.45)";
  const stroke = isHighlight
    ? "rgba(255,220,100,1)"
    : "rgba(205,214,244,0.85)";
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
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  pivot: number[],
  btx: BoneTransform | undefined,
  cosA: number, sinA: number,
  ox: number, oy: number, scale: number,
): { ok: boolean; screenX: number; screenY: number; drawW: number; drawH: number; rzRad: number } {
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

function mdDvApplyCubeRot(
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  pivot: number[],
  cubeRot: number[],
  cosA: number, sinA: number,
  ox: number, oy: number, scale: number,
): { ok: boolean; screenX: number; screenY: number; drawW: number; drawH: number; rzRad: number } {
  const rxRad = (cubeRot[0] * Math.PI) / 180;
  const rzRad = (cubeRot[2] * Math.PI) / 180;
  const cosRx = Math.cos(rxRad);
  const cRz = Math.cos(rzRad);
  const sRz = Math.sin(rzRad);

  let cx = x + sx / 2;
  let cy = y + sy / 2;
  let cz = z + sz / 2;

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

function mdDvProjectCorner(
  cx: number, cy: number, cz: number,
  pivot: number[],
  btx: BoneTransform | undefined,
  cosA: number, sinA: number,
  isFront: boolean,
): { px2: number; py2: number } {
  let _cx = cx;
  let _cy = cy;
  let _cz = cz;
  if (btx) {
    if (btx.position) {
      _cx += btx.position[0] || 0;
      _cy += btx.position[1] || 0;
      _cz += btx.position[2] || 0;
    }
    const rz = ((btx.rotation?.[2] || 0) * Math.PI) / 180;
    if (rz !== 0) {
      const cRz = Math.cos(rz);
      const sRz = Math.sin(rz);
      const dxx = _cx - pivot[0];
      const dyy = _cy - pivot[1];
      _cx = pivot[0] + dxx * cRz - dyy * sRz;
      _cy = pivot[1] + dxx * sRz + dyy * cRz;
    }
    const rx = ((btx.rotation?.[0] || 0) * Math.PI) / 180;
    if (rx !== 0) {
      const dyy = _cy - pivot[1];
      _cy = pivot[1] + dyy * Math.cos(rx);
    }
  }
  const rxx = _cx * cosA - _cz * sinA;
  const rzz = _cx * sinA + _cz * cosA;
  return { px2: rxx, py2: isFront ? _cy : rzz };
}

function mdDvDrawLabels(
  ctx: CanvasRenderingContext2D,
  model: BedrockModel,
  scale: number,
  ox: number, oy: number,
  highlightBone: string | null,
  cosA: number, sinA: number,
  boneTransforms: Map<string, BoneTransform> | null,
  isFront: boolean,
): void {
  ctx.save();
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const bone of model.bones || []) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    const btx = boneTransforms?.get(bone.name);
    let mnX = Infinity;
    let mxX = -Infinity;
    let mnY = Infinity;
    let mxY = -Infinity;
    for (const c of cs) {
      const [x, y, z] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
      for (let dx = 0; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dz = 0; dz <= 1; dz++) {
            const cx = x + dx * sx;
            const cy = y + dy * sy;
            const cz = z + dz * sz;
            const { px2, py2 } = mdDvProjectCorner(cx, cy, cz, pivot, btx, cosA, sinA, isFront);
            if (px2 < mnX) mnX = px2;
            if (px2 > mxX) mxX = px2;
            if (py2 < mnY) mnY = py2;
            if (py2 > mxY) mxY = py2;
          }
        }
      }
    }
    const cx2 = ox + ((mnX + mxX) / 2) * scale;
    const cy2 = oy - ((mnY + mxY) / 2) * scale;
    const txt = bone.name;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const tw = ctx.measureText(txt).width;
    ctx.fillRect(cx2 - tw / 2 - 2, cy2 - 5, tw + 4, 10);
    ctx.fillStyle =
      bone.name === highlightBone ? "#ffd460" : "rgba(205,214,244,0.9)";
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
  textureImg: HTMLImageElement | null,
  highlightBone: string | null,
  showLabels: boolean,
  cosA: number,
  sinA: number,
  boneTransforms: Map<string, BoneTransform> | null,
): void {
  const isFront = true;

  for (const bone of model.bones || []) {
    const isHighlight = bone.name === highlightBone;
    const btx = boneTransforms?.get(bone.name);
    const hasAnim = btx?.rotation || btx?.position;

    for (const c of bone.cubes || []) {
      const [x, y, z] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];

      if (hasAnim) {
        const r = mdDvApplyBoneAnim(x, y, z, sx, sy, sz, pivot, btx, cosA, sinA, ox, oy, scale);
        if (!r.ok) continue;
        mdDvDrawRect(ctx, isHighlight, r.drawW, r.drawH, {
          mode: "centered", screenX: r.screenX, screenY: r.screenY, rzRad: r.rzRad,
        });
      } else {
        const cubeRot = c.rotation || [0, 0, 0];
        const hasRotation = cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;
        if (hasRotation) {
          const pivot2 = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
          const r = mdDvApplyCubeRot(x, y, z, sx, sy, sz, pivot2, cubeRot, cosA, sinA, ox, oy, scale);
          if (!r.ok) continue;
          mdDvDrawRect(ctx, isHighlight, r.drawW, r.drawH, {
            mode: "centered", screenX: r.screenX, screenY: r.screenY, rzRad: r.rzRad,
          });
        } else {
          const rx = x * cosA - z * sinA;
          const rz = x * sinA + z * cosA;
          const px = rx;
          const py = isFront ? y : rz;
          const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
          const ph = isFront ? sy : sz;
          const drawX = ox + px * scale;
          const drawY = oy - (py + ph) * scale;
          const drawW = pw * scale;
          const drawH = ph * scale;
          if (drawW < 0.5 || drawH < 0.5) continue;
          mdDvDrawRect(ctx, isHighlight, drawW, drawH, {
            mode: "plain", drawX, drawY, doubleStroke: true,
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
  scale: number,
  textureImg: HTMLImageElement | null,
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

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const bone of model.bones || []) {
    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
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
      const [x, y, z] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      // 俯视图也用旋转坐标
      const rx = x * cosA - z * sinA;
      const rz = x * sinA + z * cosA;
      const drawX = ox2 + rx * s;
      const drawY = oy2 - (rz + sz) * s;
      ctx.fillStyle = "rgba(124,131,255,0.45)";
      ctx.fillRect(drawX, drawY, sx * s, sz * s);
      ctx.strokeStyle = "rgba(205,214,244,0.7)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(drawX, drawY, sx * s, sz * s);
    }
  }
}

// 导出给 model2d.ts 主入口与测试（calcBoneHitZones 在 model2d-hit-zones.ts）
export { drawView, drawMiniView };
