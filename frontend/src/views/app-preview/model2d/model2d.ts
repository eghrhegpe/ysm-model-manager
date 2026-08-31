// ===== 基岩版模型 2D 线条图渲染（类型化版 — ADR-014 P2 大件收尾）=====
// model2d.ts 拆分三件之三：主入口 + 结构类型。
// 绘制层 → model2d-draw.ts（cubeVec + mdDv* + drawView + drawMiniView）
// 热区计算 → model2d-hit-zones.ts（calcBoneHitZones + HitZone）

import type { BoneTransform } from "../../../utils/animation/animation.ts";
import { cubeVec, drawView, drawMiniView } from "./model2d-draw.ts";
import { calcBoneHitZones } from "./model2d-hit-zones.ts";

// re-export：测试与既有消费方从 ./model2d.ts 取 calcBoneHitZones，保持 import 面不变
export { calcBoneHitZones };

// ── 结构接口 ────────────────────────────────────────

/** Bedrock cube（AnalyzeBedrockModel 结构） */
export interface BedrockCube {
  origin: number[];
  size: number[];
  pivot?: number[];
  rotation?: number[];
  uv?: number[];
  faceUV?: string;
}

/** Bedrock bone */
export interface BedrockBone {
  name: string;
  cubes?: BedrockCube[];
}

/** BedrockModel（AnalyzeBedrockModel 返回） */
export interface BedrockModel {
  bones?: BedrockBone[];
}

/** renderModel2D 选项 */
export interface Model2DOptions {
  showLabels?: boolean;
  zoom?: number;
  rotation?: number;
  boneTransforms?: Map<string, BoneTransform>;
}

declare global {
  interface HTMLCanvasElement {
    /** 悬停事件清理函数（renderModel2D 绑定，防止重复监听） */
    _hoverCleanup?: () => void;
  }
}

/**
 * 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转）
 * @param canvas 目标 canvas
 * @param model AnalyzeBedrockModel 返回的 BedrockModel
 * @param textureImg 纹理图（可选）
 * @param opts 选项
 */
export function renderModel2D(
  canvas: HTMLCanvasElement,
  model: BedrockModel,
  textureImg: HTMLImageElement | null,
  opts: Model2DOptions = {},
): void {
  if (!canvas || !model?.bones?.length) return;
  // ADR-047：2D hover 用 pointer 事件 + 禁触屏手势默认，桌面零回归
  if (canvas.style) canvas.style.touchAction = "none";

  const showLabels = opts?.showLabels !== false;
  const zoom = opts?.zoom || 1;
  const angle = ((opts?.rotation || 0) * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const boneTransforms = opts?.boneTransforms || null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 旋转点 [x,y,z] 绕 Y 轴，返回 {x, z}
  const rot = (x: number, z: number): { x: number; z: number } => ({
    x: x * cosA - z * sinA,
    z: x * sinA + z * cosA,
  });

  // 计算旋转后的 bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const bone of model.bones) {
    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = cubeVec(c.origin);
      const [sx, sy, sz] = cubeVec(c.size);
      // 8 个角中取旋转后 X 最左/最右、Y 最上/最下
      const corners: Array<[number, number]> = [
        [ox, oz],
        [ox + sx, oz],
        [ox, oz + sz],
        [ox + sx, oz + sz],
      ];
      for (const [cx, cz] of corners) {
        const r = rot(cx, cz);
        if (r.x < minX) minX = r.x;
        if (r.x > maxX) maxX = r.x;
      }
      if (oy < minY) minY = oy;
      if (oy + sy > maxY) maxY = oy + sy;
    }
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const baseScale = Math.min((W - 20) / rangeX, (H - 20) / rangeY, 4);
  const scale = baseScale * zoom;
  const cx = W / 2 - (minX + rangeX / 2) * scale;
  const cy = H / 2 + (minY + rangeY / 2) * scale;

  // 计算骨骼屏幕坐标热区，供鼠标拾取
  const boneHitZones = calcBoneHitZones(
    model,
    scale,
    cx,
    cy,
    true,
    cosA,
    sinA,
    boneTransforms,
  );

  // 绘制
  drawView(
    ctx,
    model,
    scale,
    cx,
    cy,
    textureImg,
    null,
    showLabels,
    cosA,
    sinA,
    boneTransforms,
  );
  drawMiniView(ctx, model, scale, textureImg, cosA, sinA);

  // ---- 鼠标交互高亮 ----
  let _highlightBone: string | null = null;
  const onMove = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = boneHitZones.find(
      (b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h,
    );
    if (hit?.name !== _highlightBone) {
      _highlightBone = hit?.name || null;
      ctx.clearRect(0, 0, W, H);
      drawView(
        ctx,
        model,
        scale,
        cx,
        cy,
        textureImg,
        _highlightBone,
        showLabels,
        cosA,
        sinA,
        boneTransforms,
      );
      drawMiniView(ctx, model, scale, textureImg, cosA, sinA);
    }
  };
  const onLeave = (): void => {
    if (_highlightBone) {
      _highlightBone = null;
      ctx.clearRect(0, 0, W, H);
      drawView(
        ctx,
        model,
        scale,
        cx,
        cy,
        textureImg,
        null,
        showLabels,
        cosA,
        sinA,
        boneTransforms,
      );
      drawMiniView(ctx, model, scale, textureImg, cosA, sinA);
    }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  // 清理旧监听（防止重复绑定）
  canvas._hoverCleanup?.();
  canvas._hoverCleanup = (): void => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
  };
}
