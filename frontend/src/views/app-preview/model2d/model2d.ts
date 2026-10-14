// ===== 基岩版模型 2D 线条图渲染（类型化版 — ADR-014 P2 大件收尾）=====
// model2d.ts 拆分四件之四：主入口 + 结构类型。
// 纯几何 → model2d-geom.ts（cubeVec + collectBoneBounds + BoneBounds/BoundsOpts）
// 绘制层 → model2d-draw.ts（mdDv* + drawView + drawMiniView）
// 热区计算 → model2d-hit-zones.ts（calcBoneHitZones + HitZone）

import type { BoneTransform } from "@/utils/animation/animation.ts";
import { drawMiniView, drawView } from "./model2d-draw.ts";
import { cubeVec } from "./model2d-geom.ts";
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

/** 点 [x,z] 绕 Y 轴旋转（前视图 2D 投影用），返回 {x, z}。 */
function rotAroundY(x: number, z: number, cosA: number, sinA: number): { x: number; z: number } {
  return { x: x * cosA - z * sinA, z: x * sinA + z * cosA };
}

interface BoundsAcc {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 单 cube 4 个水平角绕 Y 旋转后的 X 极值。 */
function cubeXRange(c: BedrockCube, cosA: number, sinA: number): { minX: number; maxX: number } {
  const [ox, , oz] = cubeVec(c.origin);
  const [sx, , sz] = cubeVec(c.size);
  const corners: Array<[number, number]> = [
    [ox, oz],
    [ox + sx, oz],
    [ox, oz + sz],
    [ox + sx, oz + sz],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [cx, cz] of corners) {
    const r = rotAroundY(cx, cz, cosA, sinA);
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
  }
  return { minX, maxX };
}

/** 单 cube 的 Y 极值（前视图不旋转 Y，直接取 origin/size）。 */
function cubeYRange(c: BedrockCube): { minY: number; maxY: number } {
  const [, oy] = cubeVec(c.origin);
  const [, sy] = cubeVec(c.size);
  return { minY: oy, maxY: oy + sy };
}

/** 把单个 cube 的极值并入累加器（原地更新）。 */
function growBounds(
  acc: BoundsAcc,
  xr: { minX: number; maxX: number },
  yr: { minY: number; maxY: number },
): void {
  if (xr.minX < acc.minX) acc.minX = xr.minX;
  if (xr.maxX > acc.maxX) acc.maxX = xr.maxX;
  if (yr.minY < acc.minY) acc.minY = yr.minY;
  if (yr.maxY > acc.maxY) acc.maxY = yr.maxY;
}

/** 计算旋转后的 bounding box：8 角取旋转后 X 极值 + 原始 Y 极值。 */
function computeBounds(model: BedrockModel, cosA: number, sinA: number): BoundsAcc {
  const acc: BoundsAcc = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const bone of model.bones || []) {
    for (const c of bone.cubes || []) {
      growBounds(acc, cubeXRange(c, cosA, sinA), cubeYRange(c));
    }
  }
  return acc;
}

/** 命中判定：屏幕点落在哪个骨骼热区（onMove 拾取用）。 */
function hitZoneAt(
  hitZones: ReturnType<typeof calcBoneHitZones>,
  mx: number,
  my: number,
): ReturnType<typeof calcBoneHitZones>[number] | undefined {
  return hitZones.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
}

/** 全量重绘：clear + 主视图 + 小视图（初始与 hover 高亮共用同一路径）。 */
function redrawModel2D(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  model: BedrockModel,
  scale: number,
  cx: number,
  cy: number,
  textureImg: HTMLImageElement | null,
  highlight: string | null,
  showLabels: boolean,
  cosA: number,
  sinA: number,
  boneTransforms: Parameters<typeof drawView>[10],
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawView(
    ctx,
    model,
    scale,
    cx,
    cy,
    textureImg,
    highlight,
    showLabels,
    cosA,
    sinA,
    boneTransforms,
  );
  drawMiniView(ctx, model, scale, textureImg, cosA, sinA);
}

/**
 * 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转）
 * @param canvas 目标 canvas
 * @param model AnalyzeBedrockModel 返回的 BedrockModel
 * @param textureImg 纹理图（可选）
 * @param opts 选项
 * @returns 清理函数（abort 内部 AbortController，移除悬停监听）
 */
export function renderModel2D(
  canvas: HTMLCanvasElement,
  model: BedrockModel,
  textureImg: HTMLImageElement | null,
  opts: Model2DOptions = {},
): () => void {
  if (!canvas || !model?.bones?.length) return () => {};
  // ADR-047：2D hover 用 pointer 事件 + 禁触屏手势默认，桌面零回归
  if (canvas.style) canvas.style.touchAction = "none";

  const showLabels = opts?.showLabels !== false;
  const zoom = opts?.zoom || 1;
  const angle = ((opts?.rotation || 0) * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const boneTransforms = opts?.boneTransforms || null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const { minX, maxX, minY, maxY } = computeBounds(model, cosA, sinA);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const baseScale = Math.min((W - 20) / rangeX, (H - 20) / rangeY, 4);
  const scale = baseScale * zoom;
  const cx = W / 2 - (minX + rangeX / 2) * scale;
  const cy = H / 2 + (minY + rangeY / 2) * scale;

  // 计算骨骼屏幕坐标热区，供鼠标拾取
  const boneHitZones = calcBoneHitZones(model, scale, cx, cy, true, cosA, sinA, boneTransforms);

  const redraw = (highlight: string | null): void =>
    redrawModel2D(
      ctx,
      canvas,
      model,
      scale,
      cx,
      cy,
      textureImg,
      highlight,
      showLabels,
      cosA,
      sinA,
      boneTransforms,
    );
  redraw(null);

  // ---- 鼠标交互高亮 ----
  let _highlightBone: string | null = null;
  const onMove = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = hitZoneAt(boneHitZones, mx, my);
    if (hit?.name !== _highlightBone) {
      _highlightBone = hit?.name || null;
      redraw(_highlightBone);
    }
  };
  const onLeave = (): void => {
    if (_highlightBone) {
      _highlightBone = null;
      redraw(null);
    }
  };
  const ac = new AbortController();
  canvas.addEventListener("pointermove", onMove, { signal: ac.signal });
  canvas.addEventListener("pointerleave", onLeave, { signal: ac.signal });
  return (): void => {
    ac.abort();
  };
}
