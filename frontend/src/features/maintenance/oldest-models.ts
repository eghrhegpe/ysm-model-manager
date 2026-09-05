// ===== 资历最深 + 仓库评分 + 每日推荐（类型化版 — ADR-014 P3 features）=====
// 响应全局类型切换
// 评分/去重/禁用统计：数据源统一为 Go RepoHealthAudit（与诊断页/CLI health-report
// 同源），前端不再自算健康分——消灭「本地正则数 ban + Hash 分组算重复」的双轨口径。

import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { createLoadGuard } from "../../utils/async/load-guard.ts";
import { parseHealthReport } from "../../utils/health-report.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { backendGetApp } from "../backend-deps.ts";
import { useCurrentResourceType } from "../repo/repo-rtype.ts";

// ===== 展示阈值（与诊断页 health.ts 同口径：80/60 分档）=====

const SCORE_HEALTH_GOOD = 80;
const SCORE_HEALTH_OK = 60;

export interface ModelEntry {
  Name: string;
  Size: number;
  Path: string;
  Ext: string;
  ModTime: number;
}

export interface RepoStats {
  totalFiles: number;
  totalSize: number;
  banned: number;
  dupGroups: number;
  score: number;
  healthColor: string;
  healthLabel: string;
  healthTagClass: string;
}

function handleContainerClick(e: MouseEvent): void {
  const card = (e.target as Element).closest("[data-path]") as HTMLElement | null;
  if (card) {
    const path = card.dataset.path;
    if (path) bus.emit("model:select", { path });
  }
}

/** 仓库统计：调 Go RepoHealthAudit（与诊断页/CLI 同源单一口径），
 * 前端只做分档展示，不自算评分。失败（Go error 通道）由 render 的 catch 统一展示。 */
async function fetchRepoStats(filesRoot: string): Promise<RepoStats> {
  const { RepoHealthAudit } = await backendGetApp();
  const report = parseHealthReport(await RepoHealthAudit(filesRoot));
  if (!report) throw new Error(t("diagnostics.healthParseFailed"));
  const score = report.score;
  return {
    totalFiles: report.resources.total_files,
    totalSize: report.resources.total_size,
    banned: report.resources.banned ?? 0,
    dupGroups: report.dedup.groups,
    score,
    healthColor:
      score >= SCORE_HEALTH_GOOD
        ? "var(--free)"
        : score >= SCORE_HEALTH_OK
          ? "var(--tag-amber)"
          : "var(--paid)",
    healthLabel:
      score >= SCORE_HEALTH_GOOD
        ? t("oldest.health.good")
        : score >= SCORE_HEALTH_OK
          ? t("oldest.health.ok")
          : t("oldest.health.bad"),
    healthTagClass: score >= SCORE_HEALTH_GOOD ? "good" : score >= SCORE_HEALTH_OK ? "ok" : "bad",
  };
}

/** 可注入依赖（ADR-190 D1a/D2）：整页 DOM 模板由 views 组合根注入（tpl-oldest.ts） */
export interface OldestDeps {
  renderPage: (entries: ModelEntry[], stats: RepoStats) => string;
}

export async function loadOldestModel(
  container: HTMLElement,
  esc: (s: string) => string,
  deps?: OldestDeps,
): Promise<() => void> {
  const renderPage =
    deps?.renderPage ||
    (() => {
      throw new Error("OldestDeps.renderPage 未注入（应由 views 组合根提供，见 tpl-oldest.ts）");
    });
  if (!container) return () => {};
  const guard = createLoadGuard();
  const S = '<div style="padding:12px;';
  async function render(): Promise<void> {
    const gen = guard.next();
    container.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">⏳ ${t("oldest.scanning")}</div>`;
    try {
      const { ScanModelEntriesWithLabel, GetRepoRoot } = await backendGetApp();
      const filesRoot = await GetRepoRoot(getCurrentType());
      if (guard.stale(gen)) return;
      if (!filesRoot) {
        container.innerHTML = `<div style="padding:12px;color:var(--status-error);font-size:var(--fs-base)">${t("oldest.configTypeDir")}</div>`;
        return;
      }
      const entries: ModelEntry[] =
        (await ScanModelEntriesWithLabel(
          filesRoot,
          RESOURCE_TYPE_LABELS[getCurrentType()] ?? RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM],
        )) || [];
      if (guard.stale(gen)) return;
      if (!entries?.length) {
        container.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">${t("oldest.repoEmpty")}</div>`;
        return;
      }
      const stats = await fetchRepoStats(filesRoot);
      if (guard.stale(gen)) return;
      // ADR-190 D1a：DOM 模板归 views，features 只交数据
      container.innerHTML = renderPage(entries, stats);
      container.removeEventListener("click", handleContainerClick);
      container.addEventListener("click", handleContainerClick);
    } catch (err) {
      if (guard.stale(gen)) return;
      container.innerHTML =
        S +
        'color:var(--status-error);font-size:var(--fs-base)">❌ ' +
        t("resource.loadFailed") +
        ": " +
        esc((err as Error).message || String(err)) +
        "</div>";
    }
  }
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => {
    render();
  });
  await render();
  return () => {
    container.removeEventListener("click", handleContainerClick);
    cleanupRtype();
    guard.invalidate();
  };
}
