// ===== 基岩版模型 2D 线条图渲染 —— 热区计算（model2d.ts 拆分三件之二）=====
// calcBoneHitZones：2D 正交投影骨骼拾取热区（导出供测试/鼠标拾取）。

import type { BoneTransform } from "../../utils/animation/animation.ts";
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
  const zones: HitZone[] = [];
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
      // P2 修复：热区必须应用 cube 级 c.rotation（与 drawView 静态分支同口径），
      // 否则静态旋转 cube 的拾取命中域是「未旋转包围盒」，与绘制形状不一致
      const cubeRot = c.rotation || [0, 0, 0];
      const cubeHasRot = cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;
      for (let dx = 0; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dz = 0; dz <= 1; dz++) {
            let cx = x + dx * sx;
            let cy = y + dy * sy;
            let cz = z + dz * sz;
            if (btx) {
              if (btx.position) {
                cx += btx.position[0] || 0;
                cy += btx.position[1] || 0;
                cz += btx.position[2] || 0;
              }
              const rz = ((btx.rotation?.[2] || 0) * Math.PI) / 180;
              if (rz !== 0) {
                const cRz = Math.cos(rz);
                const sRz = Math.sin(rz);
                const dxx = cx - pivot[0];
                const dyy = cy - pivot[1];
                cx = pivot[0] + dxx * cRz - dyy * sRz;
                cy = pivot[1] + dxx * sRz + dyy * cRz;
              }
              const rx = ((btx.rotation?.[0] || 0) * Math.PI) / 180;
              if (rx !== 0) {
                const dyy = cy - pivot[1];
                cy = pivot[1] + dyy * Math.cos(rx);
              }
            }
            // cube 级旋转：与 drawView 静态分支一致——先 X 轴（Y 压缩）再 Z 轴（绕 pivot）。
            // P3 修复（code_review）：仅限无动画变换的骨骼（!btx）——
            // drawView 的动画分支（hasAnim）只应用 bone 级旋转、不读 c.rotation，
            // 无条件应用会让动画骨骼的热区与绘制形状不一致
            if (!btx && cubeHasRot) {
              const rxRad = (cubeRot[0] * Math.PI) / 180;
              const rzRad = (cubeRot[2] * Math.PI) / 180;
              if (rxRad !== 0) {
                const dyy = cy - pivot[1];
                cy = pivot[1] + dyy * Math.cos(rxRad);
              }
              if (rzRad !== 0) {
                const cRz = Math.cos(rzRad);
                const sRz = Math.sin(rzRad);
                const dxx = cx - pivot[0];
                const dyy = cy - pivot[1];
                cx = pivot[0] + dxx * cRz - dyy * sRz;
                cy = pivot[1] + dxx * sRz + dyy * cRz;
              }
            }
            const rxx = cx * cosA - cz * sinA;
            const rz2 = cx * sinA + cz * cosA;
            const px2 = rxx;
            const py2 = isFront ? cy : rz2;
            if (px2 < mnX) mnX = px2;
            if (px2 > mxX) mxX = px2;
            if (py2 < mnY) mnY = py2;
            if (py2 > mxY) mxY = py2;
          }
        }
      }
    }
    zones.push({
      name: bone.name,
      x: ox + mnX * scale,
      y: oy - mxY * scale,
      w: (mxX - mnX) * scale,
      h: (mxY - mnY) * scale,
    });
  }
  return zones;
}
