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
    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
      if (ox < minX) minX = ox;
      if (ox + sx > maxX) maxX = ox + sx;
      if (oy < minY) minY = oy;
      if (oy + sy > maxY) maxY = oy + sy;
    }
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((W - 20) / rangeX, (H - 20) / rangeY, 4);
  const cx = W / 2 - (minX + rangeX / 2) * scale;
  const cy = H / 2 + (minY + rangeY / 2) * scale;

  // 计算骨骼屏幕坐标热区，供鼠标拾取
  const boneHitZones = calcBoneHitZones(model, scale, cx, cy, true);
  model._boneHitZones = boneHitZones;

  // 绘制（当前无高亮）
  drawView(ctx, model, scale, cx, cy, textureImg, null);
  drawMiniView(ctx, model, scale, textureImg);

  // ---- 鼠标交互高亮 ----
  let _highlightBone = null;
  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = boneHitZones.find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
    if (hit?.name !== _highlightBone) {
      _highlightBone = hit?.name || null;
      ctx.clearRect(0, 0, W, H);
      drawView(ctx, model, scale, cx, cy, textureImg, _highlightBone);
      drawMiniView(ctx, model, scale, textureImg);
    }
  };
  const onLeave = () => {
    if (_highlightBone) {
      _highlightBone = null;
      ctx.clearRect(0, 0, W, H);
      drawView(ctx, model, scale, cx, cy, textureImg, null);
      drawMiniView(ctx, model, scale, textureImg);
    }
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  // 清理旧监听（防止重复绑定）
  canvas._hoverCleanup && canvas._hoverCleanup();
  canvas._hoverCleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
  };
}

function calcBoneHitZones(model, scale, ox, oy, isFront) {
  const zones = [];
  for (const bone of model.bones) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const c of cs) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const px = x;
      const py = isFront ? y : z;
      if (px < mnX) mnX = px;
      if (px + sx > mxX) mxX = px + sx;
      if (py < mnY) mnY = py;
      if (py + sy > mxY) mxY = py + sy;
    }
    zones.push({
      name: bone.name,
      x: ox + mnX * scale,
      y: oy - (mxY) * scale,
      w: (mxX - mnX) * scale,
      h: (mxY - mnY) * scale,
    });
  }
  return zones;
}

function drawView(ctx, model, scale, ox, oy, textureImg, highlightBone) {
  const isFront = true;
  for (const bone of model.bones) {
    const isHighlight = bone.name === highlightBone;
    for (const c of bone.cubes || []) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const px = x;
      const py = isFront ? y : z;
      const pw = sx;
      const ph = isFront ? sy : sz;
      const drawX = ox + px * scale;
      const drawY = oy - (py + ph) * scale;
      const drawW = pw * scale;
      const drawH = ph * scale;
      if (drawW < 0.5 || drawH < 0.5) continue;

      if (isHighlight) {
        // 高亮骨骼：亮橙色填充 + 亮边框
        ctx.fillStyle = "rgba(255,180,50,0.7)";
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.strokeStyle = "rgba(255,220,100,1)";
        ctx.lineWidth = 1.5;
      } else {
        ctx.fillStyle = "rgba(124,131,255,0.45)";
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.strokeStyle = "rgba(205,214,244,0.85)";
        ctx.lineWidth = 1;
      }
      ctx.strokeRect(drawX, drawY, drawW, drawH);
    }
  }

  // 骨骼名标注
  ctx.save();
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const bone of model.bones) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const c of cs) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const px = x, py = isFront ? y : z;
      const pw = sx, ph = isFront ? sy : sz;
      if (px < mnX) mnX = px;
      if (px + pw > mxX) mxX = px + pw;
      if (py < mnY) mnY = py;
      if (py + ph > mxY) mxY = py + ph;
    }
    const cx2 = ox + ((mnX + mxX) / 2) * scale;
    const cy2 = oy - ((mnY + mxY) / 2) * scale;
    const txt = bone.name;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const tw = ctx.measureText(txt).width;
    ctx.fillRect(cx2 - tw / 2 - 2, cy2 - 5, tw + 4, 10);
    ctx.fillStyle = bone.name === highlightBone ? "#ffd460" : "rgba(205,214,244,0.9)";
    ctx.fillText(txt, cx2, cy2);
  }
  ctx.restore();
}

function drawMiniView(ctx, model, scale, textureImg) {
  const size = 60;
  const margin = 8;
  const mx = ctx.canvas.width - size - margin;
  const my = ctx.canvas.height - size - margin;

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const bone of model.bones) {
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

  for (const bone of model.bones) {
    for (const c of bone.cubes || []) {
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
