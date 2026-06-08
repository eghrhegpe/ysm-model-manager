// ===== 基岩版模型 2D 线条图渲染 =====

/**
 * 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转）
 * @param {HTMLCanvasElement} canvas
 * @param {object} model - AnalyzeBedrockModel 返回的 BedrockModel
 * @param {HTMLImageElement} [textureImg] - 纹理图
 * @param {object} [opts] - 选项
 * @param {boolean} [opts.showLabels=true] - 是否显示骨骼名称
 * @param {number} [opts.zoom=1] - 缩放倍率
 * @param {number} [opts.rotation=0] - 绕 Y 轴旋转角度（度）
 */
export function renderModel2D(canvas, model, textureImg, opts) {
  if (!canvas || !model?.bones?.length) return;
  const showLabels = opts?.showLabels !== false;
  const zoom = opts?.zoom || 1;
  const angle = ((opts?.rotation || 0) * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // 旋转点 [x,y,z] 绕 Y 轴，返回 {x, z}
  const rot = (x, z) => ({
    x: x * cosA - z * sinA,
    z: x * sinA + z * cosA,
  });

  // 计算旋转后的 bounding box
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const bone of model.bones) {
    for (const c of bone.cubes || []) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
      // 8 个角中取旋转后 X 最左/最右、Y 最上/最下
      const corners = [
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
  const boneHitZones = calcBoneHitZones(model, scale, cx, cy, true, cosA, sinA);

  // 绘制
  drawView(ctx, model, scale, cx, cy, textureImg, null, showLabels, cosA, sinA);
  drawMiniView(ctx, model, scale, textureImg, cosA, sinA);

  // ---- 鼠标交互高亮 ----
  let _highlightBone = null;
  const onMove = (e) => {
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
      );
      drawMiniView(ctx, model, scale, textureImg, cosA, sinA);
    }
  };
  const onLeave = () => {
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
      );
      drawMiniView(ctx, model, scale, textureImg, cosA, sinA);
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

function calcBoneHitZones(model, scale, ox, oy, isFront, cosA, sinA) {
  const zones = [];
  for (const bone of model.bones) {
    const cs = bone.cubes || [];
    if (!cs.length) continue;
    let mnX = Infinity,
      mxX = -Infinity,
      mnY = Infinity,
      mxY = -Infinity;
    for (const c of cs) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      const rx = x * cosA - z * sinA;
      const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
      const px = rx;
      const py = isFront ? y : z;
      if (px < mnX) mnX = px;
      if (px + pw > mxX) mxX = px + pw;
      if (py < mnY) mnY = py;
      if (py + sy > mxY) mxY = py + sy;
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
  ctx,
  model,
  scale,
  ox,
  oy,
  textureImg,
  highlightBone,
  showLabels,
  cosA,
  sinA,
) {
  const isFront = true;
  for (const bone of model.bones) {
    const isHighlight = bone.name === highlightBone;
    for (const c of bone.cubes || []) {
      const [x, y, z] = c.origin;
      const [sx, sy, sz] = c.size;
      // 绕 Y 轴旋转
      const rx = x * cosA - z * sinA;
      const rz = x * sinA + z * cosA;
      const px = rx;
      const py = isFront ? y : rz;
      // 旋转后的可视宽度（考虑 depth 投影）
      const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
      const ph = isFront ? sy : sz;
      const drawX = ox + px * scale;
      const drawY = oy - (py + ph) * scale;
      const drawW = pw * scale;
      const drawH = ph * scale;
      if (drawW < 0.5 || drawH < 0.5) continue;

      if (isHighlight) {
        ctx.fillStyle = "rgba(255,180,50,0.25)";
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
      ctx.strokeRect(drawX, drawY, drawW, drawH);
    }
  }

  // 骨骼名标注
  if (showLabels !== false) {
    ctx.save();
    ctx.font = "8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const bone of model.bones) {
      const cs = bone.cubes || [];
      if (!cs.length) continue;
      let mnX = Infinity,
        mxX = -Infinity,
        mnY = Infinity,
        mxY = -Infinity;
      for (const c of cs) {
        const [x, y, z] = c.origin;
        const [sx, sy, sz] = c.size;
        const rx = x * cosA - z * sinA;
        const pw = Math.abs(sx * cosA) + Math.abs(sz * sinA);
        const px = rx,
          py = isFront ? y : z;
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
      ctx.fillStyle =
        bone.name === highlightBone ? "#ffd460" : "rgba(205,214,244,0.9)";
      ctx.fillText(txt, cx2, cy2);
    }
    ctx.restore();
  }
}

function drawMiniView(ctx, model, scale, textureImg, cosA, sinA) {
  if (!cosA) cosA = 1;
  if (!sinA) sinA = 0;
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
