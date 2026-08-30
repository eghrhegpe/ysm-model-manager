// ===== 资历最深 + 仓库评分 + 每日推荐（类型化版 — ADR-014 P3 features）=====
// 响应全局类型切换
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { renderDisplayName } from "../utils/dom/display.ts";
import { formatBytes } from "../utils/dom/format.ts";
import { loadResourceRegistry } from "../utils/resource/registry.ts";
import { getApp } from "../backend/app.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../utils/resource/types.ts";
import { useCurrentResourceType } from "./repo-rtype.ts";
import { createLoadGuard } from "../utils/async/load-guard.ts";

// ===== 业务常量（审核：魔法数值集中化，数值与既有行为完全一致）=====
const MS_PER_DAY = 86400000;
const SCORE_BAN_PENALTY = 40;
const SCORE_DUP_PENALTY = 5;
const SCORE_DUP_PENALTY_CAP = 55;
const SCORE_HEALTH_GOOD = 80;
const SCORE_HEALTH_OK = 50;
const HEATMAP_BASE_HT = 4;
const HEATMAP_MAX_EXTRA = 44;
const HEATMAP_STRONG = 0.66;
const HEATMAP_MID = 0.33;
const OLDEST_CARD_COUNT = 4;
const DAILY_PICK_COUNT = 3;

interface ModelEntry {
  Name: string;
  Size: number;
  Path: string;
  Ext: string;
  Hash: string;
  ModTime: number;
}

interface RepoStats {
  totalSize: number;
  banned: number;
  dupGroups: number;
  dupTotal: number;
  score: number;
  healthColor: string;
  healthLabel: string;
  healthTagClass: string;
}

interface OldestPageOpts {
  stats: RepoStats;
  entriesLen: number;
  curIcon: string;
  oldestHtml: string;
  heatmapHtml: string;
  dailyHtml: string;
  formatBytes: (n: number) => string;
}

function handleContainerClick(e: MouseEvent): void {
  const card = (e.target as Element).closest("[data-path]") as HTMLElement | null;
  if (card) {
    const path = card.dataset.path;
    if (path) bus.emit("model:select", { path });
  }
}

function computeRepoStats(entries: ModelEntry[]): RepoStats {
  let totalSize = 0;
  let banned = 0;
  const hashMap: Record<string, number> = {};
  entries.forEach((e) => {
    totalSize += e.Size ?? 0;
    if (/\.(disabled|ban)$/i.test(e.Name || "")) banned++;
    if (e.Hash) hashMap[e.Hash] = (hashMap[e.Hash] ?? 0) + 1;
  });
  const dupGroups = Object.values(hashMap).filter((c) => c > 1).length;
  const dupTotal = Object.values(hashMap).reduce(
    (s, c) => s + (c > 1 ? c - 1 : 0),
    0,
  );
  let score = 100;
  if (entries.length > 0) {
    const banPenalty = Math.round((banned / entries.length) * SCORE_BAN_PENALTY);
    const dupPenalty = Math.min(dupTotal * SCORE_DUP_PENALTY, SCORE_DUP_PENALTY_CAP);
    score = Math.max(0, 100 - banPenalty - dupPenalty);
  }
  const healthColor =
    score >= SCORE_HEALTH_GOOD
      ? "var(--free)"
      : score >= SCORE_HEALTH_OK
        ? "var(--tag-amber)"
        : "var(--paid)";
  const healthLabel =
    score >= SCORE_HEALTH_GOOD ? t("oldest.health.good") : score >= SCORE_HEALTH_OK ? t("oldest.health.ok") : t("oldest.health.bad");
  const healthTagClass =
    score >= SCORE_HEALTH_GOOD ? "good" : score >= SCORE_HEALTH_OK ? "ok" : "bad";
  return { totalSize, banned, dupGroups, dupTotal, score, healthColor, healthLabel, healthTagClass };
}

function buildHeatmapHtml(entries: ModelEntry[], esc: (s: string) => string): string {
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

function renderOldestCardsHtml(
  sorted4: ModelEntry[],
  esc: (s: string) => string,
  renderDisplayName: (s: string) => string,
  formatBytes: (n: number) => string,
): string {
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

function renderDailyPicksHtml(
  entries: ModelEntry[],
  esc: (s: string) => string,
  renderDisplayName: (s: string) => string,
  formatBytes: (n: number) => string,
): string {
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
    return '<div style="color:var(--muted);font-size:var(--fs-base)">' + t("oldest.noPicks") + '</div>';
  return (
    '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
    picks.join("") +
    "</div>"
  );
}

function buildOldestPageHtml(opts: OldestPageOpts): string {
  const { stats, entriesLen, curIcon, oldestHtml, heatmapHtml, dailyHtml, formatBytes } = opts;
  const { score, healthColor, healthLabel, healthTagClass, totalSize, banned, dupGroups } = stats;
  return (
    '<div class="oldest-page">' +
    '<div class="oldest-stats-bar">' +
    '<div class="oldest-health-box">' +
    '<div class="oldest-health-label">📊 ' + t("repo.score") + '</div>' +
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
    '<span class="oldest-stat-pill">' +
    curIcon +
    " " +
    entriesLen +
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
    '<div class="oldest-section-title">🏆 ' + t("repo.tab.oldest") + '</div>' +
    '<div style="display:flex;justify-content:center">' +
    oldestHtml +
    "</div></div>" +
    '<div class="oldest-section">' +
    '<div class="oldest-section-title-sm">📅 ' + t("oldest.monthly") + '</div>' +
    heatmapHtml +
    "</div>" +
    '<div class="oldest-section" style="text-align:center">' +
    '<div class="oldest-section-title">🎲 ' + t("oldest.daily") + '</div>' +
    '<div style="display:flex;justify-content:center">' +
    dailyHtml +
    "</div></div></div>"
  );
}

export async function loadOldestModel(container: HTMLElement, esc: (s: string) => string): Promise<() => void> {
  if (!container) return () => {};
  const guard = createLoadGuard();
  const S = '<div style="padding:12px;';
  async function render(): Promise<void> {
    const gen = guard.next();
    container.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">⏳ ${t("oldest.scanning")}</div>`;
    try {
      const { ScanModelEntriesWithLabel, GetRepoRoot } = await getApp();
      const filesRoot = await GetRepoRoot(getCurrentType());
      if (guard.stale(gen)) return;
      if (!filesRoot) { container.innerHTML = `<div style="padding:12px;color:var(--status-error);font-size:var(--fs-base)">${t("oldest.configTypeDir")}</div>`; return; }
      const entries: ModelEntry[] = (await ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[getCurrentType()] ?? RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
      if (guard.stale(gen)) return;
      if (!entries || !entries.length) { container.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">${t("oldest.repoEmpty")}</div>`; return; }
      const stats = computeRepoStats(entries);
      const heatmapHtml = buildHeatmapHtml(entries, esc);
      const sorted4 = [...entries].filter((e) => Number.isFinite(e.ModTime) && e.ModTime > 0).sort((a, b) => a.ModTime - b.ModTime).slice(0, OLDEST_CARD_COUNT);
      const oldestHtml = renderOldestCardsHtml(sorted4, esc, renderDisplayName, formatBytes);
      const dailyHtml = renderDailyPicksHtml(entries, esc, renderDisplayName, formatBytes);
      const reg = await loadResourceRegistry();
      if (guard.stale(gen)) return;
      const curIcon = (reg[getCurrentType()] && reg[getCurrentType()].icon) || "📦";
      container.innerHTML = buildOldestPageHtml({ stats, entriesLen: entries.length, curIcon, oldestHtml, heatmapHtml, dailyHtml, formatBytes });
      container.removeEventListener("click", handleContainerClick);
      container.addEventListener("click", handleContainerClick);
    } catch (err) {
      if (guard.stale(gen)) return;
      container.innerHTML = S + 'color:var(--status-error);font-size:var(--fs-base)">❌ ' + t("resource.loadFailed") + ": " + esc((err as Error).message || String(err)) + "</div>";
    }
  }
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => { render(); });
  await render();
  return () => { container.removeEventListener("click", handleContainerClick); cleanupRtype(); guard.invalidate(); };
}

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
