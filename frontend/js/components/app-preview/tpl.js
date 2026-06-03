// ===== preview HTML 模板 =====

export function contentHTML() {
  return `<div class="content">
<h3>📊 统计</h3>
<div class="stat-row"><span class="label">仓库模型</span><span class="value" id="s-repo">0</span></div>
<div class="stat-row"><span class="label">整合包数</span><span class="value" id="s-ver">0</span></div>
<div class="stat-row"><span class="label">完全同步</span><span class="value" id="s-ok">0</span></div>
<div class="stat-row"><span class="label">待上传</span><span class="value accent" id="s-pending">0</span></div>
<hr class="divider">
<div class="btn-group">
<button class="btn" id="btn-refresh">🔄 刷新</button>
<button class="btn warn" id="btn-upload">📤 上传待上传</button>
<button class="btn" id="btn-logs">📋 日志</button>
</div>
</div>`;
}
