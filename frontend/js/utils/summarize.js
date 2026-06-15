// ===== YSM 模型摘要工具函数 =====
import { parseModelName } from "./display.js";
import { renderFormattedText } from "./mc-format.js";

/** 渲染 MC 格式代码为带颜色的 HTML */
function renderTips(text) {
  if (!text) return "";
  return renderFormattedText(text);
}

/** 清洗纯文本（名称/ID 类字段，去除 § 和控制字符） */
function cleanText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

/**
 * 从 YsmSummary + YSMHeader 渲染为精简摘要卡片
 */
/** 仅基于头部信息渲染的简约卡片（加密/闭源模型） */
function headerOnlyCardHTML(header, basename) {
  // 头部无名称时从文件名回退解析
  const p = basename && !header.name ? parseModelName(basename) : null;
  const name = p ? "" : cleanText(header.name || "-"); // 用 p 时 name 为空，下面走标签模板
  const tips = renderTips(header.tips);
  const licenseType = cleanText(header.license);
  const freeBadge = header.hasFree
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
${tips ? `<div style="font-size:11px;color:var(--txt);margin-bottom:10px;line-height:1.6;padding:6px 10px;background:var(--surf);border-radius:6px;border-left:3px solid var(--accent)">${tips}</div>` : ""}
<div class="md-row"><span class="md-label">许可</span><span class="md-value">${esc(licenseType) || "未标注"}</span></div>
${p?.author ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value"><span class="tag-author">${esc(p.author)}</span></span></div>` : authorHtml ? `<div class="md-row"><span class="md-label">作者</span><span class="md-value">${authorHtml}</span></div>` : ""}
${header.linkHome ? `<div class="md-row"><span class="md-label">主页</span><span class="md-value"><a href="${esc(header.linkHome)}" target="_blank" style="color:var(--accent);text-decoration:none">${esc(header.linkHome.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}</a></span></div>` : ""}
${header.linkUpdate ? `<div class="md-row"><span class="md-label">更新</span><span class="md-value"><a href="${esc(header.linkUpdate)}" target="_blank" style="color:var(--accent);text-decoration:none">查看更新</a></span></div>` : ""}
${header.hash ? `<div class="md-row" style="font-size:9px;color:var(--muted)"><span class="md-label">指纹</span><span class="md-value" style="font-family:monospace;font-size:8px;word-break:break-all">${esc(header.hash)}</span></div>` : ""}
<div class="md-divider"></div>
<div class="md-row" style="color:var(--muted);font-size:10px"><span>🔒 加密模型，资源详情不可用</span></div>
${header.format > 0 || header.crypto > 0 ? `<div style="font-size:8px;color:var(--muted);margin-top:4px;text-align:right">格式 v${header.format} · 加密 v${header.crypto}</div>` : ""}
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
  const tips = renderTips(summary.tips);
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

  // 动画分组（内部标识符只显示计数，有中文名的显示标签）
  let animGroupHtml = "";
  const isInternalId = (n) =>
    /^[a-z_]+$/.test(n) || /^(range|checkbox|radio|slider|toggle)$/i.test(n);
  if (summary.animGroups && summary.animGroups.length > 0) {
    animGroupHtml = summary.animGroups
      .map((g) => {
        const name = cleanText(g.name || g.id || "");
        const items = (g.items || []).filter((it) => !isInternalId(it));
        if (!items.length) return ""; // 全是内部标识符，跳过
        const displayItems = items.slice(0, 8);
        const more = items.length > 8 ? ` +${items.length - 8}` : "";
        const badges =
          displayItems
            .map(
              (it) =>
                `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:9px;background:color-mix(in srgb,var(--accent,#66d9ef) 14%,transparent);color:var(--accent,#66d9ef);margin:2px 3px;font-weight:500;white-space:nowrap">${esc(it)}</span>`,
            )
            .join("") + more;
        return `<div style="margin-bottom:4px"><div style="font-size:10px;font-weight:600;color:var(--txt);margin-bottom:2px">🎬 ${esc(name)}</div><div>${badges}</div></div>`;
      })
      .filter(Boolean)
      .join("");
  }

  // 配置菜单（只显示前5项，纯标识符的不显示）
  let configHtml = "";
  if (summary.configMenus && summary.configMenus.length > 0) {
    configHtml = summary.configMenus
      .map((m) => {
        const name = cleanText(m.name || m.id || "");
        return `<div style="margin-bottom:2px;font-size:9px;color:var(--muted)">⚙️ ${esc(name)}</div>`;
      })
      .join("");
    if (configHtml) {
      configHtml = `<div class="md-divider"></div><div style="font-size:9px;color:var(--muted);margin-bottom:2px">配置项</div>${configHtml}`;
    }
  }

  // 免费/付费标记
  const freeBadge = header?.hasFree
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
${stats.texWidth ? `<div class="md-row"><span class="md-label">🖼️ 纹理尺寸</span><span class="md-value">${stats.texWidth} × ${stats.texHeight} px</span></div>` : ""}

${preview.heightScale || preview.widthScale ? `<div class="md-row"><span class="md-label">📐 缩放</span><span class="md-value">${(preview.heightScale || 1).toFixed(2)} × ${(preview.widthScale || 1).toFixed(2)}</span></div>` : ""}

${animGroupHtml ? `<div class="md-divider"></div>${animGroupHtml}` : ""}
${configHtml ? configHtml : ""}

${summary.links?.home ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🔗 链接</span><span class="md-value"><a href="${esc(summary.links.home)}" target="_blank" style="color:var(--accent);text-decoration:none">主页</a>${summary.links.donate ? ` · <a href="${esc(summary.links.donate)}" target="_blank" style="color:var(--accent);text-decoration:none">赞助</a>` : ""}</span></div>` : ""}
</div>`;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
