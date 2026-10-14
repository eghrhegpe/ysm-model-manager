// ===== YSM 模型摘要工具函数（类型化版 — ADR-014 P2）=====

import { t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import { renderFormattedText } from "@/utils/html/mc-format.ts";
import { parseModelName } from "@/utils/model-name/display.ts";

// ── Go 结构体轻量类型（覆盖用到的字段，事实来源 go/ysm + go/types）──

import type { SummaryAnimGroup, SummaryConfigMenu } from "@/utils/format/ysm-anim-config.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

// 保持转口导出，零下游改动
export type { SummaryAnimGroup, SummaryConfigMenu };

export interface SummaryAuthor {
  name?: string;
  bilibili?: string;
  roles?: string;
}

export interface YsmSummary {
  name?: string;
  source?: string;
  tips?: string;
  license?: string;
  authors?: SummaryAuthor[] | null;
  stats?: {
    textures?: number;
    models?: number;
    animations?: number;
    texWidth?: number;
    texHeight?: number;
  };
  preview?: {
    heightScale?: number;
    widthScale?: number;
  };
  animGroups?: SummaryAnimGroup[] | null;
  configMenus?: SummaryConfigMenu[] | null;
  links?: {
    home?: string;
    donate?: string;
  };
}

export interface YSMHeader {
  isYsm?: boolean;
  name?: string;
  tips?: string;
  license?: string;
  hasFree?: boolean;
  isFree?: boolean;
  authorName?: string;
  authorBilibili?: string;
  authorRole?: string;
  linkHome?: string;
  linkUpdate?: string;
  hash?: string;
  format?: number;
  crypto?: number;
}

// ── 渲染工具 ───────────────────────────────────────

/** 渲染 MC 格式代码为带颜色的 HTML */
function renderTips(text?: string): string {
  if (!text) return "";
  return renderFormattedText(text);
}

/** 清洗纯文本（名称/ID 类字段，去除 § 和控制字符） */
function cleanText(text: unknown): string {
  if (typeof text !== "string") return "";
  return (
    text
      .replace(/§[0-9a-fkor]/gi, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: 故意匹配控制字符做清洗
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
  );
}

/** 安全链接：仅放行 http/https，拦截 javascript:/data: 等危险 scheme（导出供统计卡作者链接复用） */
export function safeUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (/^javascript:|^data:/i.test(trimmed)) return "#";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "#";
}

/** 彩底圆角徽标（收敛 free/paid 标题徽标 ×4 + 动画分组 tag ×1 的六属性同构骨架）。
 * 共同骨架：inline-block + btn-padding-tool-lg + radius-xl + fs-xs + color-mix 底色 + 前景同色。
 * 差异项收为参数：color（var 引用，含回退）/ mixPct（底色混合比例）/ extra（尾部 CSS 声明串，
 * free/paid 为 `margin-left:6px;font-weight:600`，tag 为 `margin:2px 3px;font-weight:500;white-space:nowrap`）。
 * ⚠️ 生成串必须与历史字面量**字节等价**——summarize.test.ts「徽章 style 串」回归锁按完整串断言。
 */
function badgeSpanHTML(
  content: string,
  opts: { color: string; mixPct: string; extra: string },
): string {
  return `<span style="display:inline-block;padding:var(--btn-padding-tool-lg);border-radius:var(--radius-xl);font-size:var(--fs-xs);background:color-mix(in srgb,${opts.color} ${opts.mixPct},transparent);color:${opts.color};${opts.extra}">${content}</span>`;
}

/** 免费/付费标题徽标（两处同构三目：headerOnlyCardHTML 与 summaryCardHTML 各抄一份，收口共用）。
 * header 无 hasFree → 空串；isFree → 免费徽标（tag 图标 + format.free），否则付费徽标（lock 图标 + format.paid）。 */
function freeBadgeHTML(header?: YSMHeader | null): string {
  if (!header?.hasFree) return "";
  return header.isFree
    ? badgeSpanHTML(`${UI_ICONS.tag} ${t("format.free")}`, {
        color: "var(--status-success,#1971C2)",
        mixPct: "18%",
        extra: "margin-left:6px;font-weight:600",
      })
    : badgeSpanHTML(`${UI_ICONS.lock} ${t("format.paid")}`, {
        color: "var(--status-error,#c62828)",
        mixPct: "18%",
        extra: "margin-left:6px;font-weight:600",
      });
}

// ── 卡片渲染 ───────────────────────────────────────

/** 键值行：valueHtml 为空则整行不渲染（收敛各卡里成串的 `? <div class="md-row">…</div> : ""` 三目）。 */
function rowHTML(labelKey: Parameters<typeof t>[0], valueHtml: string): string {
  if (!valueHtml) return "";
  return `<div class="md-row"><span class="md-label">${t(labelKey)}</span><span class="md-value">${valueHtml}</span></div>`;
}

/** 外链锚点（同款 style 三属性）。 */
function anchorHTML(url: string, text: string): string {
  return `<a href="${esc(safeUrl(url))}" target="_blank" style="color:var(--accent);text-decoration:none">${text}</a>`;
}

/** 外链展示文本：去 scheme + 去路径，只留 host（linkHome 行专用）。 */
function hostText(url: string): string {
  return esc(url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
}

/** headerOnly 卡片 tips 块（带底色/圆角/左边框，与 summary 卡不同结构）。 */
function tipsHeaderBlockHTML(tips: string): string {
  return tips
    ? `<div style="font-size:var(--fs-sm);color:var(--txt);margin-bottom:10px;line-height:1.6;padding:var(--sp-vh-btn);background:var(--surf);border-radius:var(--radius-md);border-left:3px solid var(--accent)">${tips}</div>`
    : "";
}

/** summary 卡片 tips 块（无底色，仅字号/行高）。 */
function tipsSummaryBlockHTML(tips: string): string {
  return tips
    ? `<div style="font-size:var(--fs-sm);color:var(--txt);margin-bottom:10px;line-height:1.6">${tips}</div>`
    : "";
}

/** header 字段路径的作者行：作者名 + bilibili 外链（含 title 提示）+ 角色。 */
function headerAuthorHTML(header: YSMHeader): string {
  if (!header.authorName) return "";
  const bili = header.authorBilibili
    ? `<a href="${esc(safeUrl(header.authorBilibili))}" target="_blank" style="color:var(--accent);text-decoration:none" title="${esc(header.authorBilibili)}">${UI_ICONS.media}</a>`
    : "";
  const role = header.authorRole ? cleanText(header.authorRole) : "";
  return `${esc(cleanText(header.authorName))}${bili}${role ? `（${esc(role)}）` : ""}`;
}

/** headerOnly 卡元信息区：链接行×2 + 指纹行 + 加密提示 + 版本号行（整段拼接）。 */
function headerOnlyMetaRowsHTML(header: YSMHeader): string {
  const homeRow = header.linkHome
    ? rowHTML("format.homepage", anchorHTML(header.linkHome, hostText(header.linkHome)))
    : "";
  const updateRow = header.linkUpdate
    ? rowHTML("format.update", anchorHTML(header.linkUpdate, t("format.viewUpdate")))
    : "";
  const hashRow = header.hash
    ? `<div class="md-row" style="font-size:var(--fs-xs);color:var(--muted)"><span class="md-label">${t("format.fingerprint")}</span><span class="md-value" style="font-family:monospace;font-size:var(--fs-xs);word-break:break-all">${esc(header.hash)}</span></div>`
    : "";
  const versionLine =
    (header.format ?? 0) > 0 || (header.crypto ?? 0) > 0
      ? `<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:4px;text-align:right">${t("format.versionLine", { format: header.format ?? 0, crypto: header.crypto ?? 0 })}</div>`
      : "";
  return `${homeRow}
${updateRow}
${hashRow}
<div class="md-divider"></div>
<div class="md-row" style="color:var(--muted);font-size:var(--fs-xs)"><span>${UI_ICONS.lock} ${t("format.encryptedNotice")}</span></div>
${versionLine}`;
}

/** 摘要卡空态：未选择模型时的占位块。 */
function emptyStateHTML(): string {
  return `<div class="content" id="preview-content" data-testid="preview-content">
<h3>${UI_ICONS.file} ${t("preview.modelInfo")}</h3>
<div class="dp-placeholder">
  <div class="big-icon">${UI_ICONS.file}</div>
  <div class="dp-hint">${t("preview.clickFileHint")}</div>
</div>
</div>`;
}

/** 内部标识符判定（下划线小写 / 常见控件类型）。 */
function isInternalId(n: string): boolean {
  return /^[a-z_]+$/.test(n) || /^(range|checkbox|radio|slider|toggle)$/i.test(n);
}

/** 动画分组块：只显示有效项（非内部标识符），标题带计数，最多显示前 8 个徽章。 */
function animGroupsHTML(groups?: SummaryAnimGroup[] | null): string {
  if (!groups || groups.length === 0) return "";
  return groups.map(animGroupRowHTML).filter(Boolean).join("");
}

/** 单组行：内部标识符条目全部过滤，空组跳过，>8 条折叠计数。 */
function animGroupRowHTML(g: SummaryAnimGroup): string {
  const name = cleanText(g.name || g.id || "");
  // items 先过 cleanText 再判内部标识符：含 § 码前缀的条目清洗后不再误判为外部标识符；
  // 清洗后为空的条目（纯 § 码/控制字符）直接排除，避免渲染空徽章
  const items = (g.items || []).map((it) => cleanText(it)).filter((it) => it && !isInternalId(it));
  if (!items.length) return "";
  const displayItems = items.slice(0, 8);
  const more = items.length > 8 ? ` +${items.length - 8}` : "";
  const badges =
    displayItems
      .map((it) =>
        badgeSpanHTML(esc(it), {
          color: "var(--accent,#66d9ef)",
          mixPct: "14%",
          extra: "margin:2px 3px;font-weight:500;white-space:nowrap",
        }),
      )
      .join("") + more;
  return `<div style="margin-bottom:4px"><div style="font-size:var(--fs-xs);font-weight:600;color:var(--txt);margin-bottom:2px">${UI_ICONS.video} ${esc(name)}（${items.length}）</div><div>${badges}</div></div>`;
}

/**
 * 配置菜单块：全部渲染（纯标识符经 cleanText 去 § 码后照常显示——P3 注释修正：
 * 原注释「只显示前5项，纯标识符的不显示」与实现不符，测试已锁定纯标识符也渲染）。
 */
function configMenusHTML(menus?: SummaryConfigMenu[] | null): string {
  if (!menus || menus.length === 0) return "";
  const rows = menus
    .map((m) => {
      const name = cleanText(m.name || m.id || "");
      return `<div style="margin-bottom:2px;font-size:var(--fs-xs);color:var(--muted)">${UI_ICONS.settings} ${esc(name)}</div>`;
    })
    .join("");
  if (!rows) return "";
  return `<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:2px">${t("format.configItems")}</div>${rows}`;
}

/** 外链行（首页 + 赞助，`·` 连接）：无首页则整行不渲染。 */
function linksRowHTML(links?: YsmSummary["links"]): string {
  if (!links?.home) return "";
  const donate = links.donate ? ` · ${anchorHTML(links.donate, t("format.donate"))}` : "";
  const value = `${anchorHTML(links.home, t("format.homepage"))}${donate}`;
  return `<div class="md-row"><span class="md-label">${UI_ICONS.link} ${t("format.links")}</span><span class="md-value">${value}</span></div>`;
}

/** 带分隔线的可选块：块为空则整段（含分隔线）不渲染。 */
function withDivider(block: string): string {
  return block ? `<div class="md-divider"></div>${block}` : "";
}

/** 仅基于头部信息渲染的简约卡片（加密/闭源模型） */
function headerOnlyCardHTML(header: YSMHeader, basename?: string): string {
  // 头部无名称时从文件名回退解析
  const p = basename && !header.name ? parseModelName(basename) : null;
  const name = p ? "" : cleanText(header.name || "-"); // 用 p 时 name 为空，下面走标签模板
  const tips = renderTips(header.tips);
  const licenseValue = esc(cleanText(header.license)) || t("format.unlabeled");
  const freeBadge = freeBadgeHTML(header);

  // 文件名解析路径：作者/作品分开成行；字段路径：作者 + bilibili + 角色合并
  // P3 修复：作者与作品分开成行——原 authorHtml 混装 p.work，p.author 为空时
  // 作品被标注为作者（且标题行重复显示作品 tag）
  const parsedAuthor = p?.author ? `<span class="tag-author">${esc(p.author)}</span>` : "";
  const parsedWork = p?.work ? `<span class="tag-work">${esc(p.work)}</span>` : "";
  const fieldAuthor = p ? "" : headerAuthorHTML(header);
  const authorValue = parsedAuthor || fieldAuthor;

  // 标题行：优先用文件名解析的标签，其次 header.name
  const titleHtml = p
    ? `<h3>${parsedAuthor ? `${parsedAuthor} ` : ""}<span style="color:var(--txt)">${esc(p.chara || p.raw.replace(/\.[^.]*$/, ""))}</span>${freeBadge}</h3>`
    : `<h3>${esc(name)}${freeBadge}</h3>`;

  return `<div class="content" id="preview-content" data-testid="preview-content">
${titleHtml}
${parsedWork ? rowHTML("dialog.work", parsedWork) : ""}
${tipsHeaderBlockHTML(tips)}
<div class="md-row"><span class="md-label">${t("format.license")}</span><span class="md-value">${licenseValue}</span></div>
${authorValue ? rowHTML("preview.authorLabel", authorValue) : ""}
${headerOnlyMetaRowsHTML(header)}
</div>`;
}

/**
 * 从 YsmSummary + YSMHeader 渲染为精简摘要卡片
 * @param summary 模型摘要（可为 null/undefined）
 * @param header 模型头部（可为 null/undefined）
 * @param basename 原始文件名（加密模型回退解析用）
 */
export function summaryCardHTML(
  summary: YsmSummary | null | undefined,
  header: YSMHeader | null | undefined,
  basename?: string,
): string {
  if (!summary && !header) return emptyStateHTML();
  // 无 summary 但有 header → 加密/闭源模型，走头部简约卡片
  if (!summary && header?.isYsm) {
    return headerOnlyCardHTML(header, basename);
  }

  const name = cleanText(summary?.name || summary?.source || "-");
  const tips = renderTips(summary?.tips);
  const licenseValue = esc(cleanText(summary?.license)) || t("format.unlabeled");
  // 作者行不再由详情摘要卡渲染（方案 A 去重 2026-08-28）：统计卡（buildStatsCard
  // → skeleton-render.ts）统一承载「头像 + 作者 + 角色」列表，且挂详情卡底部，
  // 摘要卡保留唯一性——作者信息不重复出现。WASM 解码失败（统计卡不渲染）时
  // 骨架 tab 会显示加载失败态，作者缺失属该降级路径的可接受损失。
  const freeBadge = freeBadgeHTML(header);
  const animGroupHtml = animGroupsHTML(summary?.animGroups);
  const configHtml = configMenusHTML(summary?.configMenus);
  const linksHtml = linksRowHTML(summary?.links);

  return `<div class="content" id="preview-content" data-testid="preview-content">
<h3>${esc(name)}${freeBadge}</h3>
${tipsSummaryBlockHTML(tips)}
<div class="md-row"><span class="md-label">${t("format.license")}</span><span class="md-value">${licenseValue}</span></div>
${withDivider(animGroupHtml)}${withDivider(configHtml)}${withDivider(linksHtml)}
</div>`;
}
