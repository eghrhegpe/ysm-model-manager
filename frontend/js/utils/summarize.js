// ===== YSM 模型摘要工具函数 =====

/** 清洗 MC 格式代码和换行 */
function cleanTips(text) {
  if (!text) return "";
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/\n/g, "<br>");
}

/** 清洗纯文本 */
function cleanText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/§[0-9a-fk-or]/gi, "").trim();
}

/**
 * 从 YsmSummary 渲染为精简摘要卡片
 */
export function summaryCardHTML(summary) {
  if (!summary) {
    return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="dp-placeholder">
  <div class="big-icon">📄</div>
  <div class="dp-hint">点击左侧仓库文件查看详情</div>
</div>
</div>`;
  }

  const name = cleanText(summary.name || summary.source || "-");
  const tips = cleanTips(summary.tips);
  const licenseType = cleanText(summary.license);
  const authors = summary.authors || [];
  const stats = summary.stats || {};
  const preview = summary.preview || {};

  // 作者行
  let authorHtml = "";
  if (authors.length > 0) {
    const parts = authors.map((a) => {
      const name = cleanText(a.name || "");
      const bili = a.bilibili
        ? `<a href="${esc(a.bilibili)}" target="_blank" style="color:#7c83ff;text-decoration:none" title="${esc(a.bilibili)}">📺</a>`
        : "";
      const role = a.roles ? cleanText(a.roles) : "";
      return `${name}${bili}${role ? `（${esc(role)}）` : ""}`;
    });
    authorHtml = parts.join(" / ");
  }

  // 动画分组（带名称翻译）
  let animGroupHtml = "";
  if (summary.animGroups && summary.animGroups.length > 0) {
    animGroupHtml = summary.animGroups
      .map((g) => {
        const name = cleanText(g.name || g.id || "");
        const count = g.items ? g.items.length : 0;
        return `<div class="md-value" style="line-height:1.6">${esc(name)}（${count}）</div>`;
      })
      .join("");
  }

  return `<div class="content" id="preview-content">
<h3>📄 ${esc(name)}</h3>

${tips ? `<div style="font-size:11px;color:#cdd6f4;margin-bottom:10px;line-height:1.6">${tips}</div>` : ""}

<div class="md-row"><span class="md-label">许可</span><span class="md-value">${esc(licenseType) || "未标注"}</span></div>
${authorHtml ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value">${authorHtml}</span></div>` : ""}

<div class="md-divider"></div>

<div class="md-row"><span class="md-label">📦 资源</span><span class="md-value">贴图 ${stats.textures || 0} · 模型 ${stats.models || 0} · 动画 ${stats.animations || 0}</span></div>

${preview.heightScale || preview.widthScale ? `<div class="md-row"><span class="md-label">📐 缩放</span><span class="md-value">${(preview.heightScale || 1).toFixed(2)} × ${(preview.widthScale || 1).toFixed(2)}</span></div>` : ""}

${animGroupHtml ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🎬 动画组</span><span class="md-value">${animGroupHtml}</span></div>` : ""}

${summary.links?.home ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🔗 链接</span><span class="md-value"><a href="${esc(summary.links.home)}" target="_blank" style="color:#7c83ff;text-decoration:none">主页</a>${summary.links.donate ? ` · <a href="${esc(summary.links.donate)}" target="_blank" style="color:#7c83ff;text-decoration:none">赞助</a>` : ""}</span></div>` : ""}
</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
