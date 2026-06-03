// ===== preview HTML 模板 =====

export function statsHTML() {
  return `<div class="tabs">
<span class="tab active" data-tab="stat">📊 统计</span>
<span class="tab" data-tab="log">📋 日志</span>
</div>
<div class="content" id="tab-stat">
<h3>📊 模型统计</h3>
<div class="stat-row"><span class="label">📦 仓库模型</span><span class="value" id="sv-repo">-</span></div>
<div class="stat-row"><span class="label">📂 整合包</span><span class="value" id="sv-ver">-</span></div>
<div class="stat-row"><span class="label accent">✅ 完全同步</span><span class="value accent" id="sv-ok">-</span></div>
<hr class="divider">
<div class="stat-row"><span class="label">⬇️ 待下载</span><span class="value" id="sv-miss">-</span></div>
<div class="stat-row"><span class="label">📤 待上传</span><span class="value" id="sv-extra">-</span></div>
<hr class="divider">
<div class="btn-group">
<button class="btn accent" id="btn-install-missing">📥 下载缺失</button>
<button class="btn warn" id="btn-upload-extra">📤 上传待上传</button>
<button class="btn" id="btn-refresh-stat">🔄 刷新</button>
</div>
</div>
<div class="content" id="tab-log" style="display:none">
<h3>📋 操作日志</h3>
<div id="log-list"><div class="stat-row"><span class="label">暂无日志</span></div></div>
<div class="btn-group" style="margin-top:8px">
<button class="btn" id="btn-clear-logs">🗑️ 清空日志</button>
</div>
</div>`;
}

/** 模型详情面板（仓库页面） */
export function modelDetailHTML(meta) {
  if (!meta || meta.hasError) {
    const errMsg = meta ? meta.errorMsg : "未知错误";
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
