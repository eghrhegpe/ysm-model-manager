// ===== preview HTML 模板 =====

/** 整合包详情面板（stat mode） */
export function statsHTML() {
  return `<div class="content" id="detail-panel">
<div class="dp-placeholder" id="dp-placeholder">
  <div class="big-icon">👈</div>
  <div class="dp-hint">点击左侧整合包查看详情</div>
</div>
<div class="dp-body" id="dp-body" style="display:none">
  <div class="dp-header-row">
    <span class="dp-name" id="dp-name">📦 -</span>
    <span class="dp-status" id="dp-status"></span>
  </div>
  <div class="dp-cards" id="dp-cards">
    <div class="dp-card green" id="dp-card-synced">
      <div class="dp-card-num" id="dp-card-synced-num">0</div>
      <div class="dp-card-label">已同步的模型列表</div>
    </div>
    <div class="dp-card red" id="dp-card-missing">
      <div class="dp-card-num" id="dp-card-missing-num">0</div>
      <div class="dp-card-label">待同步的模型列表</div>
    </div>
    <div class="dp-card orange" id="dp-card-extra">
      <div class="dp-card-num" id="dp-card-extra-num">0</div>
      <div class="dp-card-label">可加入仓库的模型列表</div>
    </div>
  </div>
  <div class="dp-detail dp-detail-hidden" id="dp-detail-synced"></div>
  <div class="dp-detail dp-detail-hidden" id="dp-detail-missing"></div>
  <div class="dp-detail dp-detail-hidden" id="dp-detail-extra"></div>
  <hr class="divider">
  <div class="dp-global-actions">
    <div class="dp-section-title">⚙️ 全局管理</div>
    <button class="btn accent" id="dp-btn-import-all">⬇️ 导入仓库模型</button>
    <button class="btn warn" id="dp-btn-upload-all">📤 上传新模型</button>
    <button class="btn" id="dp-btn-sync-all">🔄 同步状态</button>
  </div>
  <hr class="divider">
  <div class="dp-section-title">📋 操作日志 <button class="dp-log-toggle" id="dp-log-toggle">展开 ▸</button></div>
  <div class="dp-log-filter" id="dp-log-filter" style="display:none;gap:4px;padding:2px 0">
    <button class="dp-log-fbtn active" data-status="all">全部</button>
    <button class="dp-log-fbtn" data-status="success">✅ 成功</button>
    <button class="dp-log-fbtn" data-status="failed">❌ 失败</button>
    <button class="dp-log-fbtn" data-status="skipped">⏭️ 跳过</button>
    <input class="dp-log-search" id="dp-log-search" placeholder="🔍 搜索模型名...">
  </div>
  <div class="dp-log-list" id="dp-log-list">
    <div class="stat-row dp-log-empty">暂无日志</div>
  </div>
  <div class="dp-log-footer" id="dp-log-footer" style="display:none">
    <button class="btn" id="dp-btn-clear-logs">🗑️ 清空</button>
  </div>
</div>
</div>`;
}

/** 模型详情面板（仓库页面） */
export function modelDetailHTML(meta) {
  if (!meta) {
    return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="dp-placeholder">
  <div class="big-icon">📄</div>
  <div class="dp-hint">点击左侧仓库文件查看详情</div>
</div>
</div>`;
  }
  if (meta.hasError) {
    const errMsg = meta.errorMsg || "未知错误";
    return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="err">⚠️ ${errMsg}</div>
</div>`;
  }
  return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="md-row"><span class="md-label">名称</span><span class="md-value">${esc(meta.name || "-")}</span></div>
<div class="md-row"><span class="md-label">作者</span><span class="md-value">${esc(meta.author || "-")}</span></div>
<div class="md-row"><span class="md-label">版本</span><span class="md-value">${esc(meta.version || "-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">🦴 骨骼</span><span class="md-value">${meta.bones || 0}</span></div>
<div class="md-row"><span class="md-label">🖼️ 贴图</span><span class="md-value">${meta.textures || 0}</span></div>
<div class="md-row"><span class="md-label">🎬 动画</span><span class="md-value">${meta.animations || 0}</span></div>
<div class="md-row"><span class="md-label">🔺 顶点</span><span class="md-value">${(meta.vertices || 0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">◻️ 面</span><span class="md-value">${(meta.faces || 0).toLocaleString()}</span></div>
</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 模型统计卡片 */
export function statsCardHTML(model, modelPath, decodedBy) {
  const isYsm = /\.ysm$/i.test(modelPath);
  const fmt = isYsm
    ? ".ysm (加密)"
    : modelPath.endsWith(".zip")
      ? ".zip"
      : ".7z";
  const badge = decodedBy ? `<span class="ysm-badge">${decodedBy}</span>` : "";
  // 纹理映射日志（只展示有意义的信息）
  let texMapHtml = "";
  const tml = model._texMappingLog;
  if (tml && tml.length > 1) {
    texMapHtml = tml
      .map((m) => {
        const sizeStr = m.finalSize && m.finalSize !== "—" ? m.finalSize : "";
        const texName = m.texKey !== "—" ? m.texKey : `纹理${m.texIdx}`;
        return `<div class="ysm-card-row" style="font-size:9px;padding:1px 0" title="几何体文件 ${m.file} → 使用纹理 ${texName}${sizeStr ? "，" + sizeStr + "px" : ""}">├─ ${m.file} → ${texName}</div>`;
      })
      .join("");
    texMapHtml = `<div class="ysm-card-section-label" style="margin-top:6px">📎 纹理分配 <span style="font-weight:400;font-size:9px;color:var(--muted)">— 每个几何体对应使用的纹理</span></div>${texMapHtml}`;
  }
  return `
<div class="ysm-card-title">📊 模型概览${badge}</div>
<div class="ysm-card-section ysm-section-blue">
  <div class="ysm-card-section-label">🔗 模型结构</div>
  <div class="ysm-card-row">
    <span class="ysm-stat-label">├─ 骨骼 (Bones)</span><span class="ysm-card-val">${model.boneCount}</span> 根<br>
    <span class="ysm-stat-label">└─ 立方体 (Cubes)</span><span class="ysm-card-val">${model.cubeCount}</span> 个
  </div>
</div>
<div class="ysm-card-section ysm-section-green">
  <div class="ysm-card-section-label">🖼️ 纹理尺寸</div>
  <div class="ysm-card-row">
    └─ <span class="ysm-card-val">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> px
  </div>
  ${texMapHtml}
</div>
<div class="ysm-card-section ysm-section-orange">
  <div class="ysm-card-section-label">💾 文件信息</div>
  <div class="ysm-card-row">└─ ${fmt}</div>
</div>`;
}
