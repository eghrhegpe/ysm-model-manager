// ===== 诊断页：性能面板 — 性能趋势图（localStorage + SVG 折线）=====
// 存储：每次 single-bench 成功后追加一条 {ts, stages:{name:ms}}，FIFO 限长防无限增长；
// 趋势图：原生 SVG polyline，每阶段一条线（时间 → 耗时），看清优化趋势 / 突然变慢。
// 隐私模式（safeSet 静默降级）无持久化不影响功能，只是历史不跨会话。

import { t } from "@/core/i18n/t.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import { sectionHeader } from "./perf-common.ts";

interface PerfRecord {
  ts: number;
  stages: Record<string, number>;
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

export function savePerfRecord(stages: { name: string; ms: number }[]): void {
  const stageMap: Record<string, number> = {};
  for (const s of stages) stageMap[s.name] = s.ms;
  const hist = loadPerfHistory();
  hist.push({ ts: Date.now(), stages: stageMap });
  safeSet(PERF_HISTORY_KEY, JSON.stringify(hist.slice(-MAX_PERF_RECORDS)));
}

/** 渲染趋势区段（<2 次时提示收集数据；否则渲染 SVG 折线 + 图例） */
export function renderPerfTrendSection(esc: EscFn): string {
  const hist = loadPerfHistory();
  const head = sectionHeader(UI_ICONS.chart, t("diagnostics.perfTrendTitle"));
  if (hist.length < 2) {
    return (
      head +
      `<div class="perf-trend" style="padding:var(--sp-vh-perf)"><div style="color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.perfTrendNoData")}</div></div>`
    );
  }
  const pts = hist.slice(-MAX_TREND_POINTS); // 时间从旧到新
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
    `<div class="perf-trend" style="padding:var(--sp-vh-perf)">
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto">${grid}${polys}</svg>
<div class="perf-legend" style="display:flex;flex-wrap:wrap;padding:var(--sp-1) 2px 0">${legend}</div>
</div>`
  );
}
