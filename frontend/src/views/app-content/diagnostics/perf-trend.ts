// ===== 诊断页：性能面板 — 性能趋势图（localStorage + SVG 折线）=====
// 存储：每次 single-bench 成功后追加一条 {ts, stages:{name:ms}}，FIFO 限长防无限增长；
// 趋势图：原生 SVG polyline，每阶段一条线（时间 → 耗时），看清优化趋势 / 突然变慢。
// 隐私模式（safeSet 静默降级）无持久化不影响功能，只是历史不跨会话。

import { t } from "@/core/i18n/t.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import type { EscFn } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { perfTypeDisplayName, sectionHeader } from "./perf-common.ts";

interface PerfRecord {
  ts: number;
  stages: Record<string, number>;
  /**
   * 基线口径键（2026-10-15 锐评 P2 拍板「按类型聚合」）：registry 类型 id（ysm / MMD / …）。
   * 旧记录（本字段缺失）不参与任何类型过滤——不能把它们**猜**进某个类型；
   * 它们仍出现在「无类型上下文」的全库混合视图里（矩阵聚合态的回落）。
   */
  rtype?: string;
}

const PERF_HISTORY_KEY = "perf-history";
const MAX_PERF_RECORDS = 100;
const MAX_TREND_POINTS = 20;
const STAGE_COLORS = ["#4caf50", "#2196f3", "#ff9800", "#e91e63", "#9c27b0", "#00bcd4", "#ff5722"];

function loadPerfHistory(): PerfRecord[] {
  try {
    const raw = safeGet(PERF_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r.ts === "number" && r.stages && typeof r.stages === "object",
    ) as PerfRecord[];
  } catch {
    return [];
  }
}

export function savePerfRecord(stages: { name: string; ms: number }[], rtype?: string): void {
  const stageMap: Record<string, number> = {};
  for (const s of stages) stageMap[s.name] = s.ms;
  const hist = loadPerfHistory();
  // rtype 为 undefined 时**不写该键**：`exactOptionalPropertyTypes` 拒绝 `string | undefined`
  // 赋给可选属性；且旧格式记录本就无此键，这样新旧记录同形，JSON 序列化也一致
  hist.push(
    rtype !== undefined
      ? { ts: Date.now(), stages: stageMap, rtype }
      : { ts: Date.now(), stages: stageMap },
  );
  safeSet(PERF_HISTORY_KEY, JSON.stringify(hist.slice(-MAX_PERF_RECORDS)));
}

/**
 * 渲染趋势区段（基线口径下的折线）。
 *
 * `rtype`（基线口径键，2026-10-15 锐评 P2 拍板「按类型聚合」）：给定即只画该类型的历史，
 * 并在区段头标注当前基线。**口径判据**：不给定（矩阵聚合态 / 旧数据回落）→ 全库混合视图
 * （现状行为）；给定但该类型历史不足 2 条 → **明确提示，不回落全库混合**——把其他类型的
 * 观测混进来等于把「没数据」画成「有数据」，正是本模块反复清的缺席账。
 */
export function renderPerfTrendSection(esc: EscFn, rtype?: string): string {
  const hist = loadPerfHistory();
  const head = sectionHeader(UI_ICONS.chart, t("diagnostics.perfTrendTitle"));
  const base = rtype ? hist.filter((r) => r.rtype === rtype) : hist;
  if (base.length < 2) {
    const msg = rtype
      ? t("diagnostics.perfTrendNoDataForType", { n: String(base.length) })
      : t("diagnostics.perfTrendNoData");
    return (
      head +
      `<div class="perf-trend" style="padding:var(--sp-vh-perf)"><div style="color:var(--muted);font-size:var(--fs-sm)">${msg}</div></div>`
    );
  }
  // 基线标注：写清「这是哪个类型、几条历史、口径是什么」，不让人以为画的是全库
  const baselineLabel = rtype
    ? `<div class="perf-trend-baseline" style="font-size:var(--fs-xs);color:var(--muted);display:flex;align-items:center;gap:4px;padding:var(--sp-vh-btn) 2px 0" title="${esc(
        t("diagnostics.perfTrendBaselineHint"),
      )}">${UI_ICONS.chart} ${esc(
        t("diagnostics.perfTrendBaseline", {
          type: perfTypeDisplayName(rtype),
          n: String(base.length),
        }),
      )}</div>`
    : "";
  const pts = base.slice(-MAX_TREND_POINTS); // 时间从旧到新
  // 折线维度 = **最近一次**基准的阶段链（锐评 2026-10-13 P3-3 成文）：趋势 = 同类事物的连续
  // 观测，换模型链/换引擎后更早记录的阶段混进本图会误导对比；不同链的历史各自留档不并线。
  const stageNames = Object.keys(pts[pts.length - 1].stages);
  let maxMs = 0;
  for (const p of pts) for (const v of Object.values(p.stages)) if (v > maxMs) maxMs = v;
  if (maxMs <= 0) maxMs = 1;

  const W = 560,
    H = 150,
    padL = 30,
    padR = 10,
    padT = 10,
    padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = pts.length;
  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (ms: number) => padT + plotH - (ms / maxMs) * plotH;

  // y 轴网格 + 刻度（0% / 50% / 100%）
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const gy = padT + plotH - frac * plotH;
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--bd)" stroke-width="1"/>`;
    grid += `<text x="${padL - 4}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(maxMs * frac)}</text>`;
  }

  const polys = stageNames
    .map((name, si) => {
      const ptsStr = pts
        .map((p, i) => `${x(i).toFixed(1)},${y(p.stages[name] ?? 0).toFixed(1)}`)
        .join(" ");
      return `<polyline points="${ptsStr}" fill="none" stroke="${STAGE_COLORS[si % STAGE_COLORS.length]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><title>${esc(name)}</title></polyline>`;
    })
    .join("");

  const legend = stageNames
    .map(
      (name, si) =>
        `<span class="perf-legend-item" style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 0 0;font-size:var(--fs-xs);color:var(--muted)">
<span style="width:12px;height:3px;background:${STAGE_COLORS[si % STAGE_COLORS.length]}"></span>${esc(name)}</span>`,
    )
    .join("");

  return (
    head +
    baselineLabel +
    `<div class="perf-trend" style="padding:var(--sp-vh-perf)">
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto">${grid}${polys}</svg>
<div class="perf-legend" style="display:flex;flex-wrap:wrap;padding:var(--sp-1) 2px 0">${legend}</div>
</div>`
  );
}
