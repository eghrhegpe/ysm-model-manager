// ===== 诊断页：仓库体检（runHealthAudit） =====
// ADR-040 按职责切文件：体检 / 去重（dedup.ts）/ 冲突扫描（conflicts.ts）并列。
// 数据源：Go 端 RepoHealthAuditAll（go/repoaudit 全仓库审计，GUI/CLI 同源消双轨）——
// 前端不再自算健康分，只做展示。

import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { type HealthReport, parseHealthReport } from "@/utils/health-report.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { EscFn } from "./logs.ts";

// 重入守卫：体检扫描大量 await（Walk 全目录 + SHA256），快速连点并发覆盖 innerHTML。
// 【范式豁免】本模块无跨调用配置状态（不像 dedup.ts 的 keepPolicy/priorityPath 需跨调用保持），
// 纯并发守卫故保留模块级 busy；try/finally 兜底复位（见 :51）。改造会话工厂 ROI 低，不立项。
let _healthBusy = false;

/**
 * 仓库体检：调 Go 端 RepoHealthAudit（当前类型单仓库审计）并渲染结果——
 * 动态感知当前资源类型（repo-rtype，等价树视图 vm._filesRoot 的类型来源），
 * 切蓝图扫蓝图、精准建议；不用全仓（RepoHealthAuditAll 合并报告泛泛且全扫耗时）。
 * @param list 结果容器（#diag-health-list）
 * @param esc HTML 转义函数
 */
export async function runHealthAudit(list: HTMLElement, esc: EscFn): Promise<void> {
  if (_healthBusy) return;
  _healthBusy = true;
  try {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">⏳ ' +
      t("diagnostics.healthScanning") +
      "</div>";

    const { RepoHealthAudit, GetRepoRoot } = await backendGetApp();
    const filesRoot = await GetRepoRoot(currentRepoType());
    const report = parseHealthReport(await RepoHealthAudit(filesRoot));
    if (!report) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' +
        UI_ICONS.error +
        " " +
        esc(t("diagnostics.healthParseFailed")) +
        "</div>";
      return;
    }

    list.innerHTML = renderHealthReport(report, esc);
  } catch (e) {
    // Go error 通道（路径校验等业务错误）或调用失败：统一展示
    const msg = friendlyError(e, t("diagnostics.healthFailed"));
    list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} ${esc(msg)}</div>`;
  } finally {
    _healthBusy = false;
  }
}

/** 渲染体检报告（分数环 + 完整性/缓存/资源/去重 + 警告），全部走 esc() 防注入 */
export function renderHealthReport(r: HealthReport, esc: EscFn): string {
  const score = Math.max(0, Math.min(100, r.score));
  const color = score >= 80 ? "var(--free)" : score >= 60 ? "var(--tag-amber)" : "var(--paid)";
  const label =
    score >= 80
      ? t("diagnostics.healthGood")
      : score >= 60
        ? t("diagnostics.healthOk")
        : t("diagnostics.healthBad");

  const warnings = (r.warnings ?? [])
    .map((w) => `<div class="stat-row diag-warn">${UI_ICONS.warning} ${esc(w)}</div>`)
    .join("");

  return (
    '<div class="health-head" style="display:flex;align-items:center;gap:14px;padding:6px 12px">' +
    '<div class="health-ring" style="width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:conic-gradient(' +
    color +
    " " +
    score +
    "%, var(--bd) 0);" +
    '"><div class="health-ring-inner" style="width:52px;height:52px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column">' +
    '<span style="font-size:18px;font-weight:700;color:var(--txt)">' +
    score +
    '</span><span style="font-size:var(--fs-xs);color:var(--muted)">/100</span></div></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:600;color:var(--txt)">' +
    label +
    "</div>" +
    '<div style="font-size:var(--fs-sm);color:var(--muted);word-break:break-all">' +
    esc(r.directory) +
    "</div>" +
    "</div></div>" +
    '<div class="stat-row" style="justify-content:space-around;padding:8px 12px;border-top:1px solid var(--bd)">' +
    "<span>" +
    UI_ICONS.clipboard +
    " " +
    t("diagnostics.healthComplete") +
    " <b>" +
    formatPct(r.completeness.percentage, esc) +
    "</b></span>" +
    "<span>" +
    UI_ICONS.save +
    " " +
    t("diagnostics.healthCache") +
    " <b>" +
    esc(r.cache.cache_files) +
    "</b></span>" +
    "<span>" +
    UI_ICONS.delete +
    " " +
    t("diagnostics.healthDedup") +
    " <b>" +
    esc(r.dedup.groups) +
    "</b></span>" +
    "<span>" +
    UI_ICONS.package +
    " " +
    t("diagnostics.healthFiles") +
    " <b>" +
    esc(r.resources.total_files) +
    "</b></span>" +
    "</div>" +
    '<div class="stat-row" style="flex-direction:column;align-items:stretch;gap:2px;padding:8px 12px;border-top:1px solid var(--bd);font-size:var(--fs-sm);color:var(--muted)">' +
    "<div>" +
    UI_ICONS.success +
    " " +
    t("diagnostics.healthValid") +
    ": " +
    esc(r.completeness.valid) +
    " · ❌ " +
    t("diagnostics.healthInvalid") +
    ": " +
    esc(r.completeness.invalid) +
    "</div>" +
    "<div>" +
    UI_ICONS.save +
    " " +
    t("diagnostics.healthCacheSize") +
    ": " +
    esc(formatSize(r.cache.cache_size)) +
    cacheHitRateSuffix(r.cache, esc) +
    "</div>" +
    "<div>" +
    UI_ICONS.delete +
    " " +
    t("diagnostics.healthReclaim") +
    ": " +
    esc(formatSize(r.dedup.reclaim_bytes)) +
    "</div>" +
    "</div>" +
    (warnings
      ? `<div style="padding:6px 12px;border-top:1px solid var(--bd)">${warnings}</div>`
      : "") +
    '<div class="stat-row diag-stat diag-stat-muted" style="padding:6px 12px">' +
    UI_ICONS.settings +
    " " +
    t("diagnostics.healthSource") +
    "</div>"
  );
}

/** 缓存命中率后缀（Go 端真命中率：本仓库纹理内容哈希逐张查缓存的结果）。
 *
 * 历史：此处曾展示过一次又删除——旧口径是「全局缓存文件数 / 本仓库纹理数」，
 * 分子分母不同源，比例必然 >100% 被 Go 侧截断成假绿 100%。现 Go 已重写为
 * 逐纹理哈希统计（与 `cache-verify` 命令同口径），分子分母同为「本仓库纹理」，
 * 故恢复展示。三个诚实性细节：
 *  - 采样时加「≈」：仓库纹理超上限时 Go 侧只统计前 N 张，不是全量结论；
 *  - 显示「命中/总数」：光看百分比无法判断样本多小；
 *  - 探测失败可见：哈希/缓存探测故障 ≠ 未缓存，静默吞掉会让磁盘故障显示成
 *    「贴图没缓存」，用户据此白重编码一遍。全探测失败时（hits+misses==0
 *    且 cache_scan_errors>0）同样须保留失败数——故障不能伪装成「没纹理」。
 */
function cacheHitRateSuffix(cache: HealthReport["cache"], esc_: EscFn): string {
  const hits = cache.hits ?? 0;
  const misses = cache.misses ?? 0;
  const total = hits + misses;
  if (total === 0) {
    // 无纹理（分母 0）→ 0/0 无意义；但全探测失败时须保留失败数可见
    const scanErrs = cache.cache_scan_errors ?? 0;
    if (scanErrs > 0) {
      return esc_(
        ` · ${t("diagnostics.healthHitRateUnavailable")} ${t("diagnostics.healthCacheScanErrors")} ${scanErrs}`,
      );
    }
    return "";
  }

  const approx = cache.cache_sampled ? "≈" : "";
  let s = ` · ${t("diagnostics.healthHitRate")} ${approx}${Math.round(cache.hit_rate ?? 0)}%（${hits}/${total}）`;
  if ((cache.cache_scan_errors ?? 0) > 0) {
    s += ` · ${t("diagnostics.healthCacheScanErrors")} ${cache.cache_scan_errors}`;
  }
  return esc_(s);
}

/** 百分比展示（带小数收敛） */
function formatPct(pct: number, esc: EscFn): string {
  return esc(Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "100.0%");
}

/** 字节大小人性化——委托至 formatBytes（单一事实来源，消灭多处实现口径漂移） */
export const formatSize = formatBytes;
