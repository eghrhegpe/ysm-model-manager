// ===== 基岩版模型 2D 线条图渲染 —— 热区层（model2d.ts 拆分四件之三）=====
// calcBoneHitZones：2D 正交投影骨骼拾取热区（导出供测试/鼠标拾取）。
// 几何计算（cubeVec / 投影 / 包围盒）全部下沉到 model2d-geom.ts（纯几何叶），
// 本层只负责「包围盒 → 屏幕矩形」的装配——与绘制层同引叶模块，互不引用，无环。

import type { BoneTransform } from "@/utils/animation/animation.ts";
import type { BedrockModel } from "./model2d.ts";
import { collectBoneBounds } from "./model2d-geom.ts";

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
