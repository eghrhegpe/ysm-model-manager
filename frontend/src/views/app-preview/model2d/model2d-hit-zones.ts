// ===== 基岩版模型 2D 线条图渲染 —— 热区计算（model2d.ts 拆分三件之二）=====
// calcBoneHitZones：2D 正交投影骨骼拾取热区（导出供测试/鼠标拾取）。
// P1 收敛（审核）：逐顶点包围盒计算统一走 collectBoneBounds，
// 与 mdDvDrawLabels 共用，消除与 drawView 标签层的重复 + 旋转口径分叉。

import type { BoneTransform } from "@/utils/animation/animation.ts";
import type { BedrockModel } from "./model2d.ts";
import { cubeVec } from "./model2d-draw.ts";

/** 骨骼屏幕热区（鼠标拾取） */
export interface HitZone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 骨骼在投影空间的包围盒（未乘 scale/offset） */
export interface BoneBounds {
  mnX: number;
  mxX: number;
  mnY: number;
  mxY: number;
}

export interface BoundsOpts {
  cosA: number;
  sinA: number;
  isFront: boolean;
  boneTransforms: Map<string, BoneTransform> | null;
  /** 非动画骨骼是否应用 cube 级旋转；标签层与热区层应保持一致（修标签未跟随旋转的口径缺口） */
  applyCubeRot: boolean;
}

/**
 * 投影单顶点到 2D 正交空间。btx 动画变换与 cube 级旋转在此统一实现，
 * 与 drawView 的 mdDvApplyBoneAnim/mdDvApplyCubeRot 数学对称（前者算 cube 中心矩形，
 * 此处算 8 顶点包围盒——语义不同，故不共用，但旋转口径必须一致）。
 */
function projectVertex(
  cx: number,
  cy: number,
  cz: number,
  pivot: number[],
  btx: BoneTransform | undefined,
  cubeRot: number[],
  cubeHasRot: boolean,
  applyCubeRot: boolean,
  cosA: number,
  sinA: number,
  isFront: boolean,
): { px: number; py: number } {
  if (btx) {
    if (btx.position) {
      cx += btx.position[0] || 0;
      cy += btx.position[1] || 0;
      cz += btx.position[2] || 0;
    }
    const rzRad = ((btx.rotation?.[2] || 0) * Math.PI) / 180;
    if (rzRad !== 0) {
      const cRz = Math.cos(rzRad);
      const sRz = Math.sin(rzRad);
      const dxx = cx - pivot[0];
      const dyy = cy - pivot[1];
      cx = pivot[0] + dxx * cRz - dyy * sRz;
      cy = pivot[1] + dxx * sRz + dyy * cRz;
    }
    const rxRad = ((btx.rotation?.[0] || 0) * Math.PI) / 180;
    if (rxRad !== 0) {
      cy = pivot[1] + (cy - pivot[1]) * Math.cos(rxRad);
    }
  } else if (applyCubeRot && cubeHasRot) {
    const rxRad = (cubeRot[0] * Math.PI) / 180;
    if (rxRad !== 0) {
      cy = pivot[1] + (cy - pivot[1]) * Math.cos(rxRad);
    }
    const rzRad = (cubeRot[2] * Math.PI) / 180;
    if (rzRad !== 0) {
      const cRz = Math.cos(rzRad);
      const sRz = Math.sin(rzRad);
      const dxx = cx - pivot[0];
      const dyy = cy - pivot[1];
      cx = pivot[0] + dxx * cRz - dyy * sRz;
      cy = pivot[1] + dxx * sRz + dyy * cRz;
    }
  }
  const px = cx * cosA - cz * sinA;
  const py = isFront ? cy : cx * sinA + cz * cosA;
  return { px, py };
}

/**
 * 逐骨骼 8 顶点投影包围盒。标签绘制与热区拾取共用，
 * 单一事实来源，避免「注释声明同口径」的脆弱契约。
 */
export function collectBoneBounds(model: BedrockModel, opts: BoundsOpts): Map<string, BoneBounds> {
  const out = new Map<string, BoneBounds>();
  for (const bone of model.bones || []) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    const btx = opts.boneTransforms?.get(bone.name);
    let mnX = Infinity;
    let mxX = -Infinity;
    let mnY = Infinity;
    let mxY = -Infinity;
    for (const c of cs) {
      const [x, y, z] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
      const cubeRot = c.rotation || [0, 0, 0];
      const cubeHasRot = cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;
      for (let dx = 0; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dz = 0; dz <= 1; dz++) {
            const pt = projectVertex(
              x + dx * sx,
              y + dy * sy,
              z + dz * sz,
              pivot,
              btx,
              cubeRot,
              cubeHasRot,
              opts.applyCubeRot,
              opts.cosA,
              opts.sinA,
              opts.isFront,
            );
            if (pt.px < mnX) mnX = pt.px;
            if (pt.px > mxX) mxX = pt.px;
            if (pt.py < mnY) mnY = pt.py;
            if (pt.py > mxY) mxY = pt.py;
          }
        }
      }
    }
    out.set(bone.name, { mnX, mxX, mnY, mxY });
  }
  return out;
}

/** 计算骨骼在屏幕上的命中热区（2D 正交投影，供鼠标拾取；导出供测试） */
export function calcBoneHitZones(
  model: BedrockModel,
  scale: number,
  ox: number,
  oy: number,
  isFront: boolean,
  cosA: number,
  sinA: number,
  boneTransforms: Map<string, BoneTransform> | null,
): HitZone[] {
  const bounds = collectBoneBounds(model, {
    cosA,
    sinA,
    isFront,
    boneTransforms,
    applyCubeRot: true,
  });
  const zones: HitZone[] = [];
  for (const bone of model.bones || []) {
    const b = bounds.get(bone.name);
    if (!b) continue;
    zones.push({
      name: bone.name,
      x: ox + b.mnX * scale,
      y: oy - b.mxY * scale,
      w: (b.mxX - b.mnX) * scale,
      h: (b.mxY - b.mnY) * scale,
    });
  }
  return zones;
}
