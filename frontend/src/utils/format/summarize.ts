// ===== YSM 模型摘要工具函数（类型化版 — ADR-014 P2）=====
import { parseModelName } from "../dom/display.ts";
import { renderFormattedText } from "./mc-format.ts";
import { esc } from "../dom/html.ts";
import { t } from "../../core/i18n/t.ts";
import type { YsmDecodedFile } from "../../wasm/ysm-parser.ts";

// ── Go 结构体轻量类型（覆盖用到的字段，事实来源 go/ysm + go/types）──

export interface SummaryAuthor {
  name?: string;
  bilibili?: string;
  roles?: string;
}

export interface SummaryAnimGroup {
  name?: string;
  id?: string;
  items?: string[] | null;
}

export interface SummaryConfigMenu {
  name?: string;
  id?: string;
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
  return text
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

/** 安全链接：仅放行 http/https，拦截 javascript:/data: 等危险 scheme（导出供统计卡作者链接复用） */
export function safeUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (/^javascript:|^data:/i.test(trimmed)) return "#";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "#";
}

// ── 卡片渲染 ───────────────────────────────────────

/** 仅基于头部信息渲染的简约卡片（加密/闭源模型） */
function headerOnlyCardHTML(header: YSMHeader, basename?: string): string {
  // 头部无名称时从文件名回退解析
  const p = basename && !header.name ? parseModelName(basename) : null;
  const name = p ? "" : cleanText(header.name || "-"); // 用 p 时 name 为空，下面走标签模板
  const tips = renderTips(header.tips);
  const licenseType = cleanText(header.license);
  const freeBadge = header.hasFree
    ? header.isFree
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--free,#1971C2) 18%,transparent);color:var(--free,#1971C2);margin-left:6px;font-weight:600">🆓 ${t("format.free")}</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--paid,#c62828) 18%,transparent);color:var(--paid,#c62828);margin-left:6px;font-weight:600">🔒 ${t("format.paid")}</span>`
    : "";
  let authorHtml = "";
  let workHtml = "";
  if (p) {
    // 从文件名解析到作者/作品/角色，用 renderDisplayName 渲染标题。
    // P3 修复：作者与作品分开成行——原 authorHtml 混装 p.work，p.author 为空时
    // 作品被标注为作者（且标题行重复显示作品 tag）
    if (p.author) {
      authorHtml = `<span class="tag-author">${esc(p.author)}</span>`;
    }
    if (p.work) {
      workHtml = `<span class="tag-work">${esc(p.work)}</span>`;
    }
  } else {
    if (header.authorName) {
      const bili = header.authorBilibili
        ? `<a href="${esc(safeUrl(header.authorBilibili))}" target="_blank" style="color:var(--accent);text-decoration:none" title="${esc(header.authorBilibili)}">📺</a>`
        : "";
      const role = header.authorRole ? cleanText(header.authorRole) : "";
      authorHtml = `${esc(cleanText(header.authorName))}${bili}${role ? `（${esc(role)}）` : ""}`;
    }
  }

  // 标题行：优先用文件名解析的标签，其次 header.name
  const titleHtml = p
    ? `<h3>${authorHtml ? authorHtml + " " : ""}<span style="color:var(--txt)">${esc(p.chara || p.raw.replace(/\.[^.]*$/, ""))}</span>${freeBadge}</h3>`
    : `<h3>${esc(name)}${freeBadge}</h3>`;

  return `<div class="content" id="preview-content">
${titleHtml}
${workHtml ? `<div class="md-row"><span class="md-label">${t("dialog.work")}</span><span class="md-value">${workHtml}</span></div>` : ""}
${tips ? `<div style="font-size:11px;color:var(--txt);margin-bottom:10px;line-height:1.6;padding:6px 10px;background:var(--surf);border-radius:6px;border-left:3px solid var(--accent)">${tips}</div>` : ""}
<div class="md-row"><span class="md-label">${t("format.license")}</span><span class="md-value">${esc(licenseType) || t("format.unlabeled")}</span></div>
${p?.author ? `<div class="md-row"><span class="md-label">${t("preview.authorLabel")}</span><span class="md-value"><span class="tag-author">${esc(p.author)}</span></span></div>` : authorHtml ? `<div class="md-row"><span class="md-label">${t("preview.authorLabel")}</span><span class="md-value">${authorHtml}</span></div>` : ""}
${header.linkHome ? `<div class="md-row"><span class="md-label">${t("format.homepage")}</span><span class="md-value"><a href="${esc(safeUrl(header.linkHome))}" target="_blank" style="color:var(--accent);text-decoration:none">${esc(header.linkHome.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}</a></span></div>` : ""}
${header.linkUpdate ? `<div class="md-row"><span class="md-label">${t("format.update")}</span><span class="md-value"><a href="${esc(safeUrl(header.linkUpdate))}" target="_blank" style="color:var(--accent);text-decoration:none">${t("format.viewUpdate")}</a></span></div>` : ""}
${header.hash ? `<div class="md-row" style="font-size:9px;color:var(--muted)"><span class="md-label">${t("format.fingerprint")}</span><span class="md-value" style="font-family:monospace;font-size:8px;word-break:break-all">${esc(header.hash)}</span></div>` : ""}
<div class="md-divider"></div>
<div class="md-row" style="color:var(--muted);font-size:10px"><span>🔒 ${t("format.encryptedNotice")}</span></div>
${(header.format ?? 0) > 0 || (header.crypto ?? 0) > 0 ? `<div style="font-size:8px;color:var(--muted);margin-top:4px;text-align:right">${t("format.versionLine", { format: header.format ?? 0, crypto: header.crypto ?? 0 })}</div>` : ""}
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
  if (!summary && !header) {
    return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="dp-placeholder">
  <div class="big-icon">📄</div>
  <div class="dp-hint">${t("preview.clickFileHint")}</div>
</div>
</div>`;
  }
  // 无 summary 但有 header → 加密/闭源模型，走头部简约卡片
  if (!summary && header?.isYsm) {
    return headerOnlyCardHTML(header, basename);
  }

  const name = cleanText(summary?.name || summary?.source || "-");
  const tips = renderTips(summary?.tips);
  const licenseType = cleanText(summary?.license);
  // 作者行不再由详情摘要卡渲染（方案 A 去重 2026-08-28）：统计卡（buildStatsCard
  // → skeleton-render.ts）统一承载「头像 + 作者 + 角色」列表，且挂详情卡底部，
  // 摘要卡保留唯一性——作者信息不重复出现。WASM 解码失败（统计卡不渲染）时
  // 骨架 tab 会显示加载失败态，作者缺失属该降级路径的可接受损失。
  const stats = summary?.stats || {};
  const preview = summary?.preview || {};

  // 动画分组（内部标识符只显示计数，有中文名的显示标签）
  // 2026-08-28：标题带有效项计数（如「其他动画（7）」）——资源行「贴图/模型/动画」已删
  // （贴图/模型与统计卡重叠且 Go 侧只数清单条目不准确），动画计数并入分组标题承载
  let animGroupHtml = "";
  const isInternalId = (n: string): boolean =>
    /^[a-z_]+$/.test(n) || /^(range|checkbox|radio|slider|toggle)$/i.test(n);
  if (summary?.animGroups && summary.animGroups.length > 0) {
    animGroupHtml = summary.animGroups
      .map((g) => {
        const name = cleanText(g.name || g.id || "");
        // items 先过 cleanText 再判内部标识符：含 § 码前缀的条目清洗后不再误判为外部标识符
        // 清洗后为空的条目（纯 § 码/控制字符）直接排除，避免渲染空徽章
        const items = (g.items || [])
          .map((it) => cleanText(it))
          .filter((it) => it && !isInternalId(it));
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
        return `<div style="margin-bottom:4px"><div style="font-size:10px;font-weight:600;color:var(--txt);margin-bottom:2px">🎬 ${esc(name)}（${items.length}）</div><div>${badges}</div></div>`;
      })
      .filter(Boolean)
      .join("");
  }

  // 配置菜单（全部渲染，纯标识符的经 cleanText 去 § 码后照常显示——P3 注释修正：
  // 原注释「只显示前5项，纯标识符的不显示」与实现不符，测试已锁定纯标识符也渲染）
  let configHtml = "";
  if (summary?.configMenus && summary.configMenus.length > 0) {
    configHtml = summary.configMenus
      .map((m) => {
        const name = cleanText(m.name || m.id || "");
        return `<div style="margin-bottom:2px;font-size:9px;color:var(--muted)">⚙️ ${esc(name)}</div>`;
      })
      .join("");
    if (configHtml) {
      configHtml = `<div style="font-size:9px;color:var(--muted);margin-bottom:2px">${t("format.configItems")}</div>${configHtml}`;
    }
  }

  // 免费/付费标记
  const freeBadge = header?.hasFree
    ? header.isFree
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--free,#1971C2) 18%,transparent);color:var(--free,#1971C2);margin-left:6px;font-weight:600">🆓 ${t("format.free")}</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:color-mix(in srgb,var(--paid,#c62828) 18%,transparent);color:var(--paid,#c62828);margin-left:6px;font-weight:600">🔒 ${t("format.paid")}</span>`
    : "";

  return `<div class="content" id="preview-content">
<h3>${esc(name)}${freeBadge}</h3>

${tips ? `<div style="font-size:11px;color:var(--txt);margin-bottom:10px;line-height:1.6">${tips}</div>` : ""}

<div class="md-row"><span class="md-label">${t("format.license")}</span><span class="md-value">${esc(licenseType) || t("format.unlabeled")}</span></div>

${preview.heightScale || preview.widthScale ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">📐 ${t("format.scale")}</span><span class="md-value">${(preview.heightScale ?? 1).toFixed(2)} × ${(preview.widthScale || 1).toFixed(2)}</span></div>` : ""}

${animGroupHtml ? `<div class="md-divider"></div>${animGroupHtml}` : ""}
${configHtml ? `<div class="md-divider"></div>${configHtml}` : ""}

${summary?.links?.home ? `<div class="md-divider"></div><div class="md-row"><span class="md-label">🔗 ${t("format.links")}</span><span class="md-value"><a href="${esc(safeUrl(summary.links.home))}" target="_blank" style="color:var(--accent);text-decoration:none">${t("format.homepage")}</a>${summary.links.donate ? ` · <a href="${esc(safeUrl(summary.links.donate))}" target="_blank" style="color:var(--accent);text-decoration:none">${t("format.donate")}</a>` : ""}</span></div>` : ""}
</div>`;
}

// ── 解码统计（收敛自 web-spike/spike-logic.ts，ADR-049 Phase 0）──
// 从 WASM 解码产物统计骨骼/立方体/纹理数，供网页预览页展示。

/** 解码统计结果（原 spike 侧 YsmSummary，改名避免与上方元数据接口撞名） */
export interface DecodedStats {
  bones: number;
  cubes: number;
  texCount: number;
}

const utf8 = new TextDecoder();

/**
 * 递归找第一个数组（骨骼列表通常嵌在 model/bones 等层级）。
 * 命中 bone 相关 key 即返回该数组长度；否则下探第一个对象元素。
 */
export function findBones(node: unknown, depth = 0): number {
  if (depth > 6 || typeof node !== "object" || node === null) return 0;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      if (/bone|bone_name|boneNames/i.test(k)) return v.length;
      if (v.length && typeof v[0] === "object") {
        const n = findBones(v[0], depth + 1);
        if (n > 0) return n;
      }
    } else if (typeof v === "object") {
      const n = findBones(v, depth + 1);
      if (n > 0) return n;
    }
  }
  return 0;
}

/** 解析 main.json 提取骨骼/几何摘要（只做统计，不渲染） */
export function summarizeDecoded(files: YsmDecodedFile[]): DecodedStats {
  let bones = 0;
  let cubes = 0;
  let texCount = 0;

  for (const f of files) {
    const path = f.path.toLowerCase();
    if (path.endsWith(".json") && /main|model/.test(path)) {
      try {
        const obj = JSON.parse(utf8.decode(f.data));
        bones = findBones(obj, 0);
        const cubesArr = JSON.stringify(obj).match(/"cubes"\s*:\s*\[/g);
        cubes = cubesArr?.length ?? 0;
      } catch {
        // 非模型清单 json（animation 等），跳过
      }
    } else if (/textures?\//.test(path) || /\.png$/.test(path)) {
      texCount++;
    }
  }
  return { bones, cubes, texCount };
}
