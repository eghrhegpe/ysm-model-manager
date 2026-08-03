// ===== preview HTML 模板 =====
import { esc } from "../../utils/dom.ts";

/** 模型统计元数据（modelDetailHTML 入参） */
export interface ModelDetailMeta {
  name?: string;
  author?: string;
  version?: string;
  bones?: number;
  textures?: number;
  animations?: number;
  vertices?: number;
  faces?: number;
  hasError?: boolean;
  errorMsg?: string;
}

/** 模型详情面板（仓库页面） */
export function modelDetailHTML(meta: ModelDetailMeta | null): string {
  if (!meta) {
    return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="dp-placeholder">
  <div class="big-icon"></div>
  <div class="dp-hint">点击左侧仓库文件查看详情</div>
  <div class="dp-hints">
    <span>💎 YSM 模型</span>
    <span> MMD 皮肤</span>
    <span>🥽 VRC 头像</span>
    <span>🎨 资源包</span>
  </div>
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

/** 模型统计卡片（statsCardHTML 入参的几何视图） */
export interface StatsCardModel {
  boneCount: number;
  cubeCount: number;
  texWidth?: number;
  texHeight?: number;
  textures?: unknown[];
}

/** 模型统计卡片 */
export function statsCardHTML(
  model: StatsCardModel,
  modelPath: string,
  decodedBy: string,
): string {
  const isYsm = /\.ysm$/i.test(modelPath);
  const isJson = /\.json$/i.test(modelPath);
  const fmt = isYsm
    ? ".ysm"
    : isJson
      ? ".json (解压目录)"
      : modelPath.endsWith(".zip")
        ? ".zip"
        : ".7z";
  const badge = decodedBy ? `<span class="ysm-badge">${decodedBy}</span>` : "";
  // 多纹理概要（仅当存在额外纹理时）
  let texMapHtml = "";
  const texCount = model.textures?.length || 0;
  const extraCount = texCount > 0 ? texCount - 1 : 0;
  if (extraCount > 0) {
    texMapHtml = `<div class="ysm-card-row" style="font-size:9px;color:var(--muted);padding:1px 0">📎 含 ${extraCount} 张额外纹理（共 ${texCount} 张）</div>`;
  }
  return `
<div class="ysm-card-title">📊 模型概览${badge}</div>
<div class="ysm-card-section ysm-section-blue">
  <div class="ysm-card-section-label">🔗 模型结构</div>
  <div class="ysm-card-row">
    <span class="ysm-stat-label"> 骨骼 (Bones)</span><span class="ysm-card-val">${model.boneCount}</span> 根<br>
    <span class="ysm-stat-label"> 立方体 (Cubes)</span><span class="ysm-card-val">${model.cubeCount}</span> 个
  </div>
</div>
<div class="ysm-card-section ysm-section-green">
  <div class="ysm-card-section-label">🖼️ 纹理尺寸</div>
  <div class="ysm-card-row">
     <span class="ysm-card-val">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> px
  </div>
  ${texMapHtml}
</div>
<div class="ysm-card-section ysm-section-orange">
  <div class="ysm-card-section-label">💾 文件信息</div>
  <div class="ysm-card-row">${fmt}</div>
</div>`;
}
