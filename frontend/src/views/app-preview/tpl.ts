// ===== preview HTML 模板 =====
import { esc } from "../../utils/dom/html.ts";
import { t } from "../../core/i18n/t.ts";

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
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="dp-placeholder">
  <div class="big-icon"></div>
  <div class="dp-hint">${t("preview.clickFileHint")}</div>
  <div class="dp-hints">
    <span>💎 ${t("preview.ysmModel")}</span>
    <span> ${t("preview.mmdSkin")}</span>
    <span>🥽 ${t("preview.vrcAvatar")}</span>
    <span>🎨 ${t("preview.resourcePack")}</span>
  </div>
</div>
</div>`;
  }
  if (meta.hasError) {
    const errMsg = meta.errorMsg || t("preview.unknownError");
    return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="err">⚠️ ${errMsg}</div>
</div>`;
  }
  return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="md-row"><span class="md-label">${t("preview.nameLabel")}</span><span class="md-value">${esc(meta.name || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.authorLabel")}</span><span class="md-value">${esc(meta.author || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.versionLabel")}</span><span class="md-value">${esc(meta.version || "-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">🦴 ${t("preview.label.bones")}</span><span class="md-value">${meta.bones || 0}</span></div>
<div class="md-row"><span class="md-label">🖼️ ${t("preview.texturesLabel")}</span><span class="md-value">${meta.textures || 0}</span></div>
<div class="md-row"><span class="md-label">🎬 ${t("preview.animationsLabel")}</span><span class="md-value">${meta.animations || 0}</span></div>
<div class="md-row"><span class="md-label">🔺 ${t("preview.verticesLabel")}</span><span class="md-value">${(meta.vertices || 0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">◻️ ${t("preview.facesLabel")}</span><span class="md-value">${(meta.faces || 0).toLocaleString()}</span></div>
</div>`;
}

/** 模型统计卡片（statsCardHTML 入参的几何视图） */
export interface StatsCardModel {
  boneCount: number;
  cubeCount: number;
  texWidth?: number;
  texHeight?: number;
  textures?: unknown[];
  /** 纹理文件名（去扩展名），与 textures 同序（区分角色纹理/独立模型用） */
  textureNames?: string[];
  /** 纹理分类：player = 角色可切换皮肤；projectile/vehicle/arrow = 独立模型组件专属 */
  textureCategories?: string[];
  /** L0 清单角色（多角色包内切换用）：name + texSlot（对应 textures 下标） */
  subModels?: Array<{ name: string; texSlot?: number }>;
  /** 子模型数量（多角色包）：extraCount = texCount - subCount（而非固定 -1）。
   *  默认1（单模型），多角色包时传 subModels.length */
  subCount?: number;
}

/** 模型统计卡片 */
export function statsCardHTML(
  model: StatsCardModel,
  modelPath: string,
): string {
  const isYsm = /\.ysm$/i.test(modelPath);
  const isJson = /\.json$/i.test(modelPath);
  const fmt = isYsm
    ? ".ysm"
    : isJson
      ? ".json (解压目录)"
      : modelPath.endsWith(".zip")
        ? ".zip"
        : "其他";
  // 解码器徽标已移至 summaryCardHTML 标题行（2026-08-30），此处不再渲染
  // 纹理分类统计（区分角色纹理 vs 独立模型组件纹理，2026-08-28）：
  // 统计卡「含 N 张额外纹理」口径不再把独立模型纹理混进角色纹理
  const cats = model.textureCategories || [];
  const roleTexCount = cats.filter((c) => c === "player").length;
  const compTexCount = cats.filter((c) => c && c !== "player").length;
  const catSummary =
    roleTexCount > 0 || compTexCount > 0
      ? `<div class="pv-card-row" style="font-size:var(--fs-xs);color:var(--muted);padding:1px 0">🎭 ${t("preview.roleTexCount", { role: roleTexCount, comp: compTexCount })}</div>`
      : "";
  // L0 清单角色区块（每角色：纹理标题 + 尺寸）
  const subs = model.subModels || [];
  const subRows =
    subs.length > 0
      ? subs
          .map((s) => {
            const texName = (model.textureNames || [])[s.texSlot ?? 0] || "—";
            return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px">
        <span style="font-weight:600;color:var(--txt)">🎭 ${esc(s.name)}</span>
        <span style="color:var(--muted)">${esc(texName)}</span>
        ${model.texWidth && model.texHeight ? `<span style="color:var(--muted)">${model.texWidth}×${model.texHeight}px</span>` : ""}
      </div>`;
          })
          .join("")
      : "";
  const subBlock =
    subs.length > 0
      ? `<div class="pv-card-section pv-section-blue">
  <div class="pv-card-section-label">🎭 ${t("preview.rolesList", { n: subs.length })}</div>
  ${subRows}
</div>`
      : "";
  // 多纹理概要（仅当存在额外纹理时）
  let texMapHtml = "";
  const texCount = model.textures?.length || 0;
  // extraCount：单模型 = texCount - 1（主纹理 + 额外层）；多角色包 = texCount - subCount（每角色绑定一张，额外层是剩余）
  const subCount = model.subCount || 1;
  const extraCount = texCount > subCount ? texCount - subCount : 0;
  if (extraCount > 0) {
    texMapHtml = `<div class="pv-card-row" style="font-size:var(--fs-xs);color:var(--muted);padding:1px 0">📎 ${t("preview.extraTextures", { extra: extraCount, total: texCount })}</div>`;
  }
  return `
<div class="pv-card-section pv-section-blue">
  <div class="pv-card-section-label">🔗 ${t("preview.modelStructure")}</div>
  <div class="pv-card-row">
    <span class="pv-stat-label">${t("preview.label.skeleton")}</span><span class="pv-card-val">${model.boneCount}</span> ${t("preview.unit")}<br>
    <span class="pv-stat-label">${t("preview.cubesLabel")}</span><span class="pv-card-val">${model.cubeCount}</span> ${t("preview.unit")}
  </div>
</div>
${subBlock}
<div class="pv-card-section pv-section-green">
  <div class="pv-card-section-label">🖼️ ${t("preview.textureSize")}</div>
  <div class="pv-card-row">
     <span class="pv-card-val">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> ${t("preview.px")}
  </div>
  ${catSummary}
  ${texMapHtml}
</div>
<div class="pv-card-section pv-section-orange">
  <div class="pv-card-section-label">💾 ${t("preview.fileInfo")}</div>
  <div class="pv-card-row">${fmt}</div>
</div>`;
}
