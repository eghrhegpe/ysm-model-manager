// ===== 基岩版模型 2D 线条图渲染 —— 纯几何层（model2d.ts 拆分四件之一）=====
// 零运行时依赖的叶模块：cube 向量归一化 + 单顶点正交投影 + 逐骨骼包围盒收敛。
// 绘制层（model2d-draw）与热区层（model2d-hit-zones）**各自**指向本模块，
// 二者互不引用——循环依赖在结构上不可能成立（check-circular 兜底）。
// 类型经 type-only import 引用主文件（编译期擦除，无运行时循环依赖）。

import type { BoneTransform } from "@/utils/animation/animation.ts";
import type { BedrockCube, BedrockModel } from "./model2d.ts";

// P1 修复（审核）：cube 向量归一化——畸形模型缺 origin/size 或数组长度 <3 时
// 解构 undefined 抛 TypeError，整张 2D 图静默空白（skeleton.ts 兜底）。统一入口
// 回退 [0,0,0]，5 处解构点收敛复用。
export function cubeVec(v: number[] | undefined): [number, number, number] {
  return v && v.length >= 3 ? [v[0], v[1], v[2]] : [0, 0, 0];
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
 * 把单个投影顶点纳入包围盒（比较式，非 Math.min/max）。
 * ⚠️ 比较式是**刻意**的：畸形模型顶点算出 NaN 时 `NaN < mnX` 为假 → 既有极值不被污染；
 * Math.min(Infinity, NaN) 会返回 NaN 把整盒变 NaN（与旧内联 if 口径不符）。
 */
function expandBounds(b: BoneBounds, px: number, py: number): void {
  if (px < b.mnX) b.mnX = px;
  if (px > b.mxX) b.mxX = px;
  if (py < b.mnY) b.mnY = py;
  if (py > b.mxY) b.mxY = py;
}

/** 单 cube 的 8 顶点投影包围盒（顶点投影与旋转口径统一走 projectVertex） */
function cubeBounds(c: BedrockCube, btx: BoneTransform | undefined, opts: BoundsOpts): BoneBounds {
  const [x, y, z] = cubeVec(c.origin);
  const [sx, sy, sz] = cubeVec(c.size);
  const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
  const cubeRot = c.rotation || [0, 0, 0];
  const cubeHasRot = cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;
  const b: BoneBounds = { mnX: Infinity, mxX: -Infinity, mnY: Infinity, mxY: -Infinity };
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
        expandBounds(b, pt.px, pt.py);
      }
    }
  }
  return b;
}

/** 合并两个包围盒（a 为 null = 首个 cube，直接取 b） */
function mergeBounds(a: BoneBounds | null, b: BoneBounds): BoneBounds {
  if (!a) return b;
  return {
    mnX: Math.min(a.mnX, b.mnX),
    mxX: Math.max(a.mxX, b.mxX),
    mnY: Math.min(a.mnY, b.mnY),
    mxY: Math.max(a.mxY, b.mxY),
  };
}

/**
 * 逐骨骼 8 顶点投影包围盒。标签绘制（model2d-draw）与热区拾取（model2d-hit-zones）共用，
 * 单一事实来源，避免「注释声明同口径」的脆弱契约。
 *
 * 削平手法：原实现把「8 顶点 + 4 次极值比较」的三重 for 直接嵌在 for(bone)→for(cube) 内，
 * 比较式被迫按 depth=5 计分（每处 +6）。现按 cube 提取 `cubeBounds`（深度归零），
 * 骨骼级只做一次 merge——遍历序与每 cube 的 8 顶点投影序完全不变。
 */
export function collectBoneBounds(model: BedrockModel, opts: BoundsOpts): Map<string, BoneBounds> {
  const out = new Map<string, BoneBounds>();
  for (const bone of model.bones || []) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    const btx = opts.boneTransforms?.get(bone.name);
    let bounds: BoneBounds | null = null;
    for (const c of cs) bounds = mergeBounds(bounds, cubeBounds(c, btx, opts));
    // cs.length > 0 保证 bounds 非 null（与旧实现恒写入同判）
    if (bounds) out.set(bone.name, bounds);
  }
  return out;
}
