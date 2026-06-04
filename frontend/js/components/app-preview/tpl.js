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
  <div class="dp-log-list" id="dp-log-list">
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
