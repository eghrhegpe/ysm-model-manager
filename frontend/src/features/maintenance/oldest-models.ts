// ===== 资历最深 + 仓库评分 + 每日推荐（类型化版 — ADR-014 P3 features）=====
// 响应全局类型切换
// 评分/去重/禁用统计：数据源统一为 Go RepoHealthAudit（与诊断页/CLI health-report
// 同源），前端不再自算健康分——消灭「本地正则数 ban + Hash 分组算重复」的双轨口径。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { useCurrentResourceType } from "@/features/repo/repo-rtype.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { parseHealthReport } from "@/utils/health-report.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { maintenanceGetApp } from "./maintenance-deps.ts";

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

/** 状态行（加载中/空/错误）——DOM API 构建，零 HTML 字面量（R8，同 community/data.ts 「非
 * 字符串拼接」范式）。状态碎片粒度小到不构成页面模板，不单独开 tpl 注入口；整页仍走
 * deps.renderPage（views 注入）。textContent 自动转义，无需 esc。 */
function statusRow(opts: { tone: "muted" | "error"; icon?: string; text: string }): HTMLElement {
  const row = document.createElement("div");
  row.style.padding = "12px";
  row.style.color = opts.tone === "error" ? "var(--status-error)" : "var(--muted)";
  row.style.fontSize = "var(--fs-base)";
  if (opts.icon) row.innerHTML = opts.icon;
  row.appendChild(document.createTextNode(opts.icon ? ` ${opts.text}` : opts.text));
  return row;
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
  const { RepoHealthAudit } = await maintenanceGetApp();
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
        ? "var(--status-success)"
        : score >= SCORE_HEALTH_OK
          ? "var(--tag-amber)"
          : "var(--status-error)",
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
  _esc: (s: string) => string, // 保留位与 views 调用点兼容（init-pages 传参形状）；DOM 构建后 textContent 自转义，本函数不再消费
  deps?: OldestDeps,
): Promise<() => void> {
  const renderPage =
    deps?.renderPage ||
    (() => {
      throw new Error("OldestDeps.renderPage 未注入（应由 views 组合根提供，见 tpl-oldest.ts）");
    });
  if (!container) return () => {};
  const guard = createLoadGuard();
  async function render(): Promise<void> {
    const gen = guard.next();
    container.replaceChildren(
      statusRow({ tone: "muted", icon: UI_ICONS.refresh, text: t("oldest.scanning") }),
    );
    try {
      const { ScanModelEntriesWithLabel, GetRepoRoot } = await maintenanceGetApp();
      const filesRoot = await GetRepoRoot(getCurrentType());
      if (guard.stale(gen)) return;
      if (!filesRoot) {
        container.replaceChildren(statusRow({ tone: "error", text: t("oldest.configTypeDir") }));
        return;
      }
      const entries: ModelEntry[] =
        (await ScanModelEntriesWithLabel(
          filesRoot,
          RESOURCE_TYPE_LABELS[getCurrentType()] ?? RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM],
        )) || [];
      if (guard.stale(gen)) return;
      if (!entries?.length) {
        container.replaceChildren(statusRow({ tone: "muted", text: t("oldest.repoEmpty") }));
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
      container.replaceChildren(
        statusRow({
          tone: "error",
          icon: UI_ICONS.error,
          text: `${t("resource.loadFailed")}: ${(err as Error).message || String(err)}`,
        }),
      );
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
