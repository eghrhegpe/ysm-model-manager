// ===== 基岩版模型 2D 线条图渲染（类型化版 — ADR-014 P2 大件收尾）=====
import { dbg } from "../debug/debug.ts";
import type { BoneTransform } from "../animation/animation.ts";

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

/** 骨骼屏幕热区（鼠标拾取） */
interface HitZone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
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

  // 调试：检查是否有 cube rotation
  const cubesWithRotation: Array<{
    bone: string;
    origin: number[];
    size: number[];
    rotation: number[];
    y: number;
  }> = [];
  for (const bone of model.bones) {
    for (const c of bone.cubes || []) {
      if (
        c.rotation &&
        (c.rotation[0] !== 0 || c.rotation[1] !== 0 || c.rotation[2] !== 0)
      ) {
        // 只记录 Y 坐标较高的 cube（可能是头发）
        if (c.origin[1] > 20) {
          // Y > 20 的通常是头部/头发
          cubesWithRotation.push({
            bone: bone.name,
            origin: c.origin,
            size: c.size,
            rotation: c.rotation,
            y: c.origin[1],
          });
        }
      }
    }
  }
  if (cubesWithRotation.length > 0) {
    // 按 Y 坐标排序，只显示最高的 10 个（最可能是头发）
    cubesWithRotation.sort((a, b) => b.y - a.y);
    dbg("model2d", "头部带 rotation 的 cube (前10个):", cubesWithRotation.slice(0, 10));

    // 额外调试：检查第一个 cube 是否有 pivot
    const firstCube = cubesWithRotation[0];
    const bone = model.bones?.find((b) => b.name === firstCube.bone);
    const cube = bone?.cubes?.find(
      (c) =>
        c.origin[0] === firstCube.origin[0] &&
        c.origin[1] === firstCube.origin[1] &&
        c.origin[2] === firstCube.origin[2],
    );
    dbg("model2d", "第一个 cube 的 pivot:", cube?.pivot || "无显式 pivot，使用默认中心点");
  }

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
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
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
  const onMove = (e: MouseEvent): void => {
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
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  // 清理旧监听（防止重复绑定）
  canvas._hoverCleanup?.();
  canvas._hoverCleanup = (): void => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
  };
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
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
      // P2 修复：热区必须应用 cube 级 c.rotation（与 drawView 静态分支 :410-470 同口径），
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
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];

      if (hasAnim) {
        // ---- 动画骨骼：使用 Canvas 变换使旋转可见 ----
        // cube 中心
        let cx = x + sx / 2;
        let cy = y + sy / 2;
        let cz = z + sz / 2;

        // 位置偏移
        if (btx?.position) {
          cx += btx.position[0] || 0;
          cy += btx.position[1] || 0;
          cz += btx.position[2] || 0;
        }

        // Z 旋转（绕 pivot，屏幕平面内最可见）
        const rzRad = ((btx?.rotation?.[2] || 0) * Math.PI) / 180;
        if (rzRad !== 0) {
          const cRz = Math.cos(rzRad);
          const sRz = Math.sin(rzRad);
          const dxx = cx - pivot[0];
          const dyy = cy - pivot[1];
          cx = pivot[0] + dxx * cRz - dyy * sRz;
          cy = pivot[1] + dxx * sRz + dyy * cRz;
        }

        // X 旋转（Y 方向压缩）
        const rxRad = ((btx?.rotation?.[0] || 0) * Math.PI) / 180;
        const cosRx = Math.cos(rxRad);
        if (rxRad !== 0) {
          const dyy = cy - pivot[1];
          cy = pivot[1] + dyy * cosRx;
        }

        // 全局 Y 旋转投影
        const scrX = cx * cosA - cz * sinA;
        const scrY = cy;
        const screenX = ox + scrX * scale;
        const screenY = oy - scrY * scale;

        // 投影后的宽高（不含 Z 旋转，因为 Z 旋转由 canvas.rotate 负责）
        const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
        const ph = sy * Math.abs(cosRx);
        const drawW = pw * scale;
        const drawH = ph * scale;
        if (drawW < 1 || drawH < 1) continue;

        ctx.save();
        ctx.translate(screenX, screenY);
        // 屏幕 Y 轴翻转，取反
        ctx.rotate(-rzRad);

        ctx.fillStyle = isHighlight
          ? "rgba(255,180,50,0.25)"
          : "rgba(124,131,255,0.45)";
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
        ctx.strokeStyle = isHighlight
          ? "rgba(255,220,100,1)"
          : "rgba(205,214,244,0.85)";
        ctx.lineWidth = isHighlight ? 1.5 : 1;
        ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      } else {
        // ---- 静态骨骼：应用 cube rotation ----
        const cubeRot = c.rotation || [0, 0, 0];
        const hasRotation =
          cubeRot[0] !== 0 || cubeRot[1] !== 0 || cubeRot[2] !== 0;

        if (hasRotation) {
          // 有 rotation，使用简化方法：先计算旋转后的中心点，然后用 Canvas rotate 绘制
          const pivot2 = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];

          // 获取旋转角度
          const rxRad = (cubeRot[0] * Math.PI) / 180;
          const rzRad = (cubeRot[2] * Math.PI) / 180;
          const cosRx = Math.cos(rxRad);
          const cRz = Math.cos(rzRad);
          const sRz = Math.sin(rzRad);

          // cube 原始中心点
          let cx = x + sx / 2;
          let cy = y + sy / 2;
          let cz = z + sz / 2;

          // 应用 X 轴旋转（只影响 Y 坐标）
          if (rxRad !== 0) {
            const dyy = cy - pivot2[1];
            cy = pivot2[1] + dyy * cosRx;
          }

          // 应用 Z 轴旋转（影响 X 和 Y）
          if (rzRad !== 0) {
            const dxx = cx - pivot2[0];
            const dyy = cy - pivot2[1];
            cx = pivot2[0] + dxx * cRz - dyy * sRz;
            cy = pivot2[1] + dxx * sRz + dyy * cRz;
          }

          // 全局 Y 轴旋转投影
          const scrX = cx * cosA - cz * sinA;
          const scrY = cy;
          const screenX = ox + scrX * scale;
          const screenY = oy - scrY * scale;

          // 计算尺寸（考虑 X 轴旋转对高度的影响）
          const drawW = sx * scale;
          const drawH = sy * Math.abs(cosRx) * scale;
          if (drawW < 1 || drawH < 1) continue;

          ctx.save();
          ctx.translate(screenX, screenY);
          // 屏幕 Y 轴翻转，取负
          ctx.rotate(-rzRad);

          ctx.fillStyle = isHighlight
            ? "rgba(255,180,50,0.25)"
            : "rgba(124,131,255,0.45)";
          ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
          ctx.strokeStyle = isHighlight
            ? "rgba(255,220,100,1)"
            : "rgba(205,214,244,0.85)";
          ctx.lineWidth = isHighlight ? 1.5 : 1;
          ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        } else {
          // 无 rotation，使用原有快速路径
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

          ctx.fillStyle = isHighlight
            ? "rgba(255,180,50,0.25)"
            : "rgba(124,131,255,0.45)";
          ctx.fillRect(drawX, drawY, drawW, drawH);
          ctx.strokeStyle = isHighlight
            ? "rgba(255,220,100,1)"
            : "rgba(205,214,244,0.85)";
          ctx.lineWidth = isHighlight ? 1.5 : 1;
          ctx.strokeRect(drawX, drawY, drawW, drawH);
          ctx.strokeRect(drawX, drawY, drawW, drawH);
        }
      }
    }
  }

  // 骨骼名标注（跟随动画变换）
  if (showLabels !== false) {
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
        const [x, y, z] = c.origin;
        const [sx, sy, sz] = c.size;
        const pivot = c.pivot || [x + sx / 2, y + sy / 2, z + sz / 2];
        // 8 个角
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
              const rxx = cx * cosA - cz * sinA;
              const rzz = cx * sinA + cz * cosA;
              const px2 = rxx;
              const py2 = isFront ? cy : rzz;
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
}

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
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
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
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
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
