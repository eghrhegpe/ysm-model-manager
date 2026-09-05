// ===== oldest 页 DOM 模板（ADR-190 D1a 自 features/maintenance/oldest-models.ts 回迁）=====
// DOM HTML 模板归 views：热力图/资历卡片/每日推荐/整页装配；
// 数据获取与评分分档仍归 features（loadOldestModel 经 deps.renderPage 注入本模块）。
import { t } from "../../core/i18n/t.ts";
import type { ModelEntry, RepoStats } from "../../features/maintenance/oldest-models.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { formatBytes } from "../../utils/dom/format.ts";
import { esc } from "../../utils/dom/html.ts";

// ===== 展示常量（渲染侧；评分分档 80/60 留守 features）=====
const MS_PER_DAY = 86400000;
const HEATMAP_BASE_HT = 4;
const HEATMAP_MAX_EXTRA = 44;
const HEATMAP_STRONG = 0.66;
const HEATMAP_MID = 0.33;
const OLDEST_CARD_COUNT = 4;
const DAILY_PICK_COUNT = 3;

function buildMonthHeatmap(entries: ModelEntry[]): number[] {
  const months = new Array(12).fill(0);
  entries.forEach((e) => {
    if (!e.ModTime) return;
    const d = new Date(e.ModTime);
    const m = d.getMonth();
    const now = new Date();
    const yearDiff = now.getFullYear() - d.getFullYear();
    if (yearDiff === 0 || (yearDiff === 1 && d.getMonth() >= now.getMonth())) {
      months[m]++;
    }
  });
  return months;
}

function buildHeatmapHtml(entries: ModelEntry[]): string {
  const monthCounts = buildMonthHeatmap(entries);
  const maxMonth = Math.max(1, ...monthCounts);
  return (
    '<div style="display:flex;gap:4px;justify-content:center;align-items:end;padding:4px 0;min-height:48px">' +
    monthCounts
      .map((c, i) => {
        const pct = c / maxMonth;
        const ht = HEATMAP_BASE_HT + Math.round(pct * HEATMAP_MAX_EXTRA);
        const color =
          c === 0
            ? "var(--bd)"
            : pct > HEATMAP_STRONG
              ? "var(--free)"
              : pct > HEATMAP_MID
                ? "var(--tag-amber)"
                : "var(--paid)";
        const nowYear = new Date().getFullYear();
        const monthLabel = esc(
          new Date(nowYear, i, 1).toLocaleDateString("zh-CN", {
            month: "short",
          }),
        );
        return (
          '<div class="heatmap-bar-wrap">' +
          '<div class="heatmap-bar" style="height:' +
          ht +
          "px;background:" +
          color +
          '" title="' +
          t("oldest.heatmapTip", { month: monthLabel, count: c }) +
          '"></div>' +
          '<span class="heatmap-bar-label">' +
          monthLabel +
          "</span></div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderOldestCardsHtml(sorted4: ModelEntry[]): string {
  if (!sorted4.length) return "";
  return (
    '<div class="oldest-cards-row">' +
    sorted4
      .map((e) => {
        const ageDays = Math.floor((Date.now() - e.ModTime) / MS_PER_DAY);
        const dateStr = new Date(e.ModTime).toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        return (
          '<div class="model-card-sm" style="width:calc(50% - 3px);box-sizing:border-box" data-path="' +
          esc(e.Path || e.Name || "") +
          '" title="' +
          t("oldest.clickDetail", { name: esc(e.Name || "") }) +
          '">' +
          '<div class="oldest-card-name" title="' +
          esc(e.Name || "") +
          '">' +
          renderDisplayName(e.Name) +
          "</div>" +
          '<div class="oldest-card-meta"><span>📏 ' +
          formatBytes(e.Size) +
          "</span><span>📅 " +
          dateStr +
          "</span><span> " +
          t("oldest.daysAgo", { n: ageDays }) +
          "</span></div></div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderDailyPicksHtml(entries: ModelEntry[]): string {
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const total = Math.min(DAILY_PICK_COUNT, shuffled.length);
  const picks: string[] = [];
  for (let i = 0; i < total; i++) {
    const p = shuffled[i];
    if (!p) continue;
    const sizeStr = formatBytes(p.Size);
    const dateStr = p.ModTime
      ? new Date(p.ModTime).toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";
    picks.push(
      '<div class="pick-card" data-path="' +
        esc(p.Path || p.Name || "") +
        '" title="' +
        t("oldest.clickDetail", { name: esc(p.Name || "") }) +
        '">' +
        '<div class="name" title="' +
        esc(p.Name || "") +
        '">' +
        renderDisplayName(p.Name) +
        "</div>" +
        '<div class="meta"><span> ' +
        sizeStr +
        "</span>" +
        (dateStr ? "<span> " + dateStr + "</span>" : "") +
        "</div></div>",
    );
  }
  if (!picks.length)
    return (
      '<div style="color:var(--muted);font-size:var(--fs-base)">' + t("oldest.noPicks") + "</div>"
    );
  return (
    '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
    picks.join("") +
    "</div>"
  );
}

/** 整页装配（原 features 侧 loadOldestModel 内联组装段原样回迁） */
export function renderOldestPage(entries: ModelEntry[], stats: RepoStats): string {
  const heatmapHtml = buildHeatmapHtml(entries);
  const sorted4 = [...entries]
    .filter((e) => Number.isFinite(e.ModTime) && e.ModTime > 0)
    .sort((a, b) => a.ModTime - b.ModTime)
    .slice(0, OLDEST_CARD_COUNT);
  const oldestHtml = renderOldestCardsHtml(sorted4);
  const dailyHtml = renderDailyPicksHtml(entries);
  const {
    score,
    healthColor,
    healthLabel,
    healthTagClass,
    totalFiles,
    totalSize,
    banned,
    dupGroups,
  } = stats;
  return (
    '<div class="oldest-page">' +
    '<div class="oldest-stats-bar">' +
    '<div class="oldest-health-box">' +
    '<div class="oldest-health-label">📊 ' +
    t("repo.score") +
    "</div>" +
    '<div class="oldest-health-ring" style="background:conic-gradient(' +
    healthColor +
    " " +
    score +
    "%, var(--bd) " +
    score +
    '% 100%)">' +
    '<div class="oldest-health-ring-inner">' +
    '<span class="oldest-health-ring-num">' +
    score +
    "</span></div></div>" +
    '<span class="health-tag ' +
    healthTagClass +
    '" style="font-size:var(--fs-sm)">' +
    healthLabel +
    "</span></div>" +
    '<div class="oldest-stats-divider"></div>' +
    '<div class="oldest-stats-row">' +
    '<span class="oldest-stat-pill">📄 ' +
    totalFiles +
    "</span>" +
    '<span class="oldest-stat-pill">📏 ' +
    formatBytes(totalSize) +
    "</span>" +
    '<span class="oldest-stat-pill">🚫 ' +
    banned +
    "</span>" +
    '<span class="oldest-stat-pill">🔗 ' +
    dupGroups +
    "</span></div></div>" +
    '<div class="oldest-section">' +
    '<div class="oldest-section-title">🏆 ' +
    t("repo.tab.oldest") +
    "</div>" +
    '<div style="display:flex;justify-content:center">' +
    oldestHtml +
    "</div></div>" +
    '<div class="oldest-section">' +
    '<div class="oldest-section-title-sm">📅 ' +
    t("oldest.monthly") +
    "</div>" +
    heatmapHtml +
    "</div>" +
    '<div class="oldest-section" style="text-align:center">' +
    '<div class="oldest-section-title">🎲 ' +
    t("oldest.daily") +
    "</div>" +
    '<div style="display:flex;justify-content:center">' +
    dailyHtml +
    "</div></div></div>"
  );
}
