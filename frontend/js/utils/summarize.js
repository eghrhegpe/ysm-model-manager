// ===== YSM 模型摘要工具函数 =====
import { parseModelName } from "./display.js";

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
 * 从 YsmSummary + YSMHeader 渲染为精简摘要卡片
 */
/** 仅基于头部信息渲染的简约卡片（加密/闭源模型） */
function headerOnlyCardHTML(header, basename) {
  // 头部无名称时从文件名回退解析
  const p = basename && !header.name ? parseModelName(basename) : null;
  const name = p ? "" : cleanText(header.name || "-"); // 用 p 时 name 为空，下面走标签模板
  const tips = cleanTips(header.tips);
  const licenseType = cleanText(header.license);
  const freeBadge = header.isYsm
    ? header.isFree
      ? '<span style=\"display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--free,#1971C2) 18%,transparent);color:var(--free,#1971C2);margin-left:6px;font-weight:600\">🆓 免费</span>'
      : '<span style=\"display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--paid,#c62828) 18%,transparent);color:var(--paid,#c62828);margin-left:6px;font-weight:600\">🔒 付费</span>'
    : "";
  let authorHtml = "";
  if (p) {
    // 从文件名解析到作者/作品/角色，用 renderDisplayName 渲染标题
    authorHtml = p.author
      ? `<span class="tag-author">${esc(p.author)}</span>`
      : "";
    if (p.work) {
      authorHtml +=
        (authorHtml ? " " : "") +
        `<span class="tag-work">${esc(p.work)}</span>`;
    }
  } else {
    if (header.authorName) {
      const bili = header.authorBilibili
        ? `<a href="${esc(header.authorBilibili)}" target="_blank" style="color:var(--accent);text-decoration:none" title="${esc(header.authorBilibili)}">📺</a>`
        : "";
      const role = header.authorRole ? cleanText(header.authorRole) : "";
      authorHtml = `${cleanText(header.authorName)}${bili}${role ? `（${esc(role)}）` : ""}`;
    }
  }

  // 标题行：优先用文件名解析的标签，其次 header.name
  const titleHtml = p
    ? `<h3>${authorHtml ? authorHtml + " " : ""}<span style="color:var(--txt)">${esc(p.chara || p.raw.replace(/\.[^.]*$/, ""))}</span>${freeBadge}</h3>`
    : `<h3>${esc(name)}${freeBadge}</h3>`;

  return `<div class="content" id="preview-content">
<div class="model-detail-title">📄 模型详情</div>
${titleHtml}
${p?.work ? `<div class="md-row"><span class="md-label">作品</span><span class="md-value"><span class="tag-work">${esc(p.work)}</span></span></div>` : ""}
${tips ? `<div style="font-size:11px;color:var(--txt);margin-bottom:10px;line-height:1.6">${tips}</div>` : ""}
<div class="md-row"><span class="md-label">许可</span><span class="md-value">${esc(licenseType) || "未标注"}</span></div>
${p?.author ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value"><span class="tag-author">${esc(p.author)}</span></span></div>` : authorHtml ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value">${authorHtml}</span></div>` : ""}
<div class="md-divider"></div>
<div class="md-row" style="color:var(--muted);font-size:10px"><span>🔒 加密模型，资源详情不可用</span></div>
${header.linkHome ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🔗 链接</span><span class="md-value"><a href="${esc(header.linkHome)}" target="_blank" style="color:var(--accent);text-decoration:none">主页</a></span></div>` : ""}
</div>`;
}

export function summaryCardHTML(summary, header, basename) {
  if (!summary && !header) {
    return `<div class="content" id="preview-content">
<h3>📄 模型信息</h3>
<div class="dp-placeholder">
  <div class="big-icon">📄</div>
  <div class="dp-hint">点击左侧仓库文件查看详情</div>
</div>
</div>`;
  }
  // 无 summary 但有 header → 加密/闭源模型，走头部简约卡片
  if (!summary && header?.isYsm) {
    return headerOnlyCardHTML(header, basename);
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
        ? `<a href="${esc(a.bilibili)}" target="_blank" style="color:var(--accent);text-decoration:none" title="${esc(a.bilibili)}">📺</a>`
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

  // 免费/付费标记
  const freeBadge = header?.isYsm
    ? header.isFree
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--free,#1971C2) 18%,transparent);color:var(--free,#1971C2);margin-left:6px;font-weight:600">🆓 免费</span>'
      : '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--paid,#c62828) 18%,transparent);color:var(--paid,#c62828);margin-left:6px;font-weight:600">🔒 付费</span>'
    : "";

  return `<div class="content" id="preview-content">
<div class="model-detail-title">📄 模型详情</div>
<h3>${esc(name)}${freeBadge}</h3>

${tips ? `<div style="font-size:11px;color:var(--txt);margin-bottom:10px;line-height:1.6">${tips}</div>` : ""}

<div class="md-row"><span class="md-label">许可</span><span class="md-value">${esc(licenseType) || "未标注"}</span></div>
${authorHtml ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value">${authorHtml}</span></div>` : ""}

<div class="md-divider"></div>

<div class="md-row"><span class="md-label">📦 资源</span><span class="md-value">贴图 ${stats.textures || 0} · 模型 ${stats.models || 0} · 动画 ${stats.animations || 0}</span></div>

${preview.heightScale || preview.widthScale ? `<div class="md-row"><span class="md-label">📐 缩放</span><span class="md-value">${(preview.heightScale || 1).toFixed(2)} × ${(preview.widthScale || 1).toFixed(2)}</span></div>` : ""}

${animGroupHtml ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🎬 动画组</span><span class="md-value">${animGroupHtml}</span></div>` : ""}

${summary.links?.home ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🔗 链接</span><span class="md-value"><a href="${esc(summary.links.home)}" target="_blank" style="color:var(--accent);text-decoration:none">主页</a>${summary.links.donate ? ` · <a href="${esc(summary.links.donate)}" target="_blank" style="color:var(--accent);text-decoration:none">赞助</a>` : ""}</span></div>` : ""}
</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
