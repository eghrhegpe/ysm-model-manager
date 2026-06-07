// ===== 基岩版模型 2D 线条图渲染 =====

/**
 * 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图）
 * @param {HTMLCanvasElement} canvas
 * @param {object} model - AnalyzeBedrockModel 返回的 BedrockModel
 * @param {HTMLImageElement} [textureImg] - 纹理图
 */
export function renderModel2D(canvas, model, textureImg) {
  if (!canvas || !model?.bones?.length) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 计算所有 cube 的 bounding box，居中缩放
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const bone of model.bones) {
    for (const c of bone.cubes) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
      // 前视图：X 水平，Y 垂直（忽略 Z）
      if (ox < minX) minX = ox;
      if (ox + sx > maxX) maxX = ox + sx;
      if (oy < minY) minY = oy;
      if (oy + sy > maxY) maxY = oy + sy;
      // 俯视图：X 水平，Z 垂直
    }
  }

  // 防止除零
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((W - 20) / rangeX, (H - 20) / rangeY, 4);
  const cx = W / 2 - (minX + rangeX / 2) * scale;
  const cy = H / 2 + (minY + rangeY / 2) * scale;

  // 前视图（X→右, Y→上, 忽略 Z）
  drawView(ctx, model, "front", scale, cx, cy, textureImg);

  // 俯视图小窗（右下角）
  drawMiniView(ctx, model, "top", scale, textureImg);
}

function drawView(ctx, model, view, scale, ox, oy, textureImg) {
  const isFront = view === "front";
  for (const bone of model.bones) {
    for (const c of bone.cubes) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      // 投影坐标
      const px = isFront ? x : x; // X
      const py = isFront ? y : z; // Y（前视图=Y，俯视图=Z）
      const pw = sx; // 宽
      const ph = isFront ? sy : sz; // 高
      const drawX = ox + px * scale;
      const drawY = oy - (py + ph) * scale;
      const drawW = pw * scale;
      const drawH = ph * scale;
      if (drawW < 0.5 || drawH < 0.5) continue;

      // 填充半透明方块
      ctx.fillStyle = "rgba(124,131,255,0.45)";
      ctx.fillRect(drawX, drawY, drawW, drawH);
      // 白色边框
      ctx.strokeStyle = "rgba(205,214,244,0.85)";
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, drawW, drawH);
    }
  }
}

function drawMiniView(ctx, model, view, scale, textureImg) {
  const size = 60;
  const margin = 8;
  const mx = ctx.canvas.width - size - margin;
  const my = ctx.canvas.height - size - margin;

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);

  // 俯视图小窗
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const bone of model.bones) {
    for (const c of bone.cubes) {
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

  for (const bone of model.bones) {
    for (const c of bone.cubes) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const drawX = ox2 + x * s;
      const drawY = oy2 - (z + sz) * s;
      ctx.fillStyle = "rgba(124,131,255,0.45)";
      ctx.fillRect(drawX, drawY, sx * s, sz * s);
      ctx.strokeStyle = "rgba(205,214,244,0.7)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(drawX, drawY, sx * s, sz * s);
    }
  }
}
