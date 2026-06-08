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
    <div class="dp-card green" id="dp-card-synced" style="cursor:pointer">
      <div class="dp-card-num" id="dp-card-synced-num">0</div>
      <div class="dp-card-label">已同步的模型列表</div>
    </div>
    <div class="dp-card red" id="dp-card-missing" style="cursor:pointer">
      <div class="dp-card-num" id="dp-card-missing-num">0</div>
      <div class="dp-card-label">待同步的模型列表</div>
    </div>
    <div class="dp-card orange" id="dp-card-extra" style="cursor:pointer">
      <div class="dp-card-num" id="dp-card-extra-num">0</div>
      <div class="dp-card-label">可加入仓库的模型列表</div>
    </div>
  </div>
  <div class="dp-detail" id="dp-detail-synced" style="display:none;flex:1;overflow-y:auto;margin-bottom:4px"></div>
  <div class="dp-detail" id="dp-detail-missing" style="display:none;flex:1;overflow-y:auto;margin-bottom:4px"></div>
  <div class="dp-detail" id="dp-detail-extra" style="display:none;flex:1;overflow-y:auto;margin-bottom:4px"></div>
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
    <button class="dp-log-fbtn active" data-status="all" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">全部</button>
    <button class="dp-log-fbtn" data-status="success" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">✅ 成功</button>
    <button class="dp-log-fbtn" data-status="failed" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">❌ 失败</button>
    <button class="dp-log-fbtn" data-status="skipped" style="font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">⏭️ 跳过</button>
    <input id="dp-log-search" placeholder="🔍 搜索模型名..." style="flex:1;font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);min-width:0;margin-left:4px">
  </div>
  <div class="dp-log-list" id="dp-log-list" style="overflow-y:auto">
    <div class="stat-row" style="font-size:10px;color:#6c7086">暂无日志</div>
  </div>
  <div class="dp-log-footer" id="dp-log-footer" style="display:none">
    <button class="btn" style="font-size:10px" id="dp-btn-clear-logs">🗑️ 清空</button>
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
  const fmt = isYsm ? ".ysm (加密)" : modelPath.endsWith(".zip") ? ".zip" : ".7z";
  const badge = decodedBy
    ? `<span style="font-size:8px;padding:0 5px;border-radius:3px;background:rgba(124,131,255,0.25);color:var(--txt)">${decodedBy}</span>`
    : "";
  return `
<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:10px;font-weight:600;color:var(--txt)">
  📊 模型概览${badge}
</div>
<div style="border-left:2px solid #7c83ff;padding-left:8px;margin-bottom:5px">
  <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">🔗 模型结构</div>
  <div style="font-size:10px;color:var(--txt);line-height:1.6">
    <span style="display:inline-block;min-width:80px">├─ 骨骼 (Bones)</span><span style="color:var(--accent);font-weight:600">${model.boneCount}</span> 根<br>
    <span style="display:inline-block;min-width:80px">└─ 立方体 (Cubes)</span><span style="color:var(--accent);font-weight:600">${model.cubeCount}</span> 个
  </div>
</div>
<div style="border-left:2px solid #a6e3a1;padding-left:8px;margin-bottom:5px">
  <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">🖼️ 纹理尺寸</div>
  <div style="font-size:10px;color:var(--txt);line-height:1.6">
    └─ <span style="color:var(--accent);font-weight:600">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> px
  </div>
</div>
<div style="border-left:2px solid #f9a826;padding-left:8px">
  <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">💾 文件信息</div>
  <div style="font-size:10px;color:var(--txt);line-height:1.6">
    └─ ${fmt}
  </div>
</div>`;
}
