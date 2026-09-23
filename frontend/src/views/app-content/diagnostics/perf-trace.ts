// ===== 诊断页：性能面板 — 加载剖析（load-trace store 消费层）=====
// 数据来源：各 3D adapter（MMD / VRM / FBX / YSM / Litematic）调用 recordLoadTrace() 写入全局内存 store；
// 本文件消费 store 渲染甘特图 + 资产清单 + 纹理详情。
// 与 perf-cli.ts 职责隔离：CLI 文本流 ≠ 运行时 trace store，不混在同一文件。
//
// 2026-09 展示层补全（承 ADR-278 的那轮追问）：store 保留 50 条、此前**只渲染最后一条**——
// 存了 49 条没有任何消费者（「定义了没人用」的同类）。现在按「最近 N 条 + 其余计数」如实展示，
// 并把两处**格式间差异**写在脸上而不是省略：
//   ① 阶段粒度不同（YSM/MMD 4 段；VRM ≥2 段；FBX / Litematic 各 1 段合并）——1 段时显式说明；
//   ② GPU 口径只有 MMD 采集（`gpuMb`）——其余格式显式标「未采集」，不用 "-" 或省略糊过去。

import { t } from "@/core/i18n/t.ts";
import { getLoadTraces, type LoadTrace } from "@/preview-3d/infra/load-trace.ts";
import { formatClock } from "@/utils/format/format.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import { sectionHeader } from "./perf-common.ts";

/** 面板一次最多展开几条记录（store 上限 50，其余只报数——避免 50 张甘特图糊满屏）。 */
const TRACE_MAX_SHOWN = 5;

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

/**
 * 单条 trace 的卡片（甘特图 + 资产 + 纹理明细）。
 *
 * 甘特图刻度由调用方传 `sharedMaxMs`：**所有卡片共用同一把尺**，条长才能横向对比；
 * 各自归一化会产生「快记录的小段看起来和慢记录的大段一样长」的错觉。
 */
function renderTraceRecord(rec: LoadTrace, esc: EscFn, sharedMaxMs: number): string {
  const stages = rec.stages ?? [];
  const totalMs = stages.reduce((s, st) => s + st.ms, 0);

  // 甘特图 SVG（横向条状）
  const W = 560,
    padL = 72,
    padR = 10;
  const plotW = W - padL - padR;
  const rowH = 18;
  let ganttSvg = `<svg width="${W}" height="${stages.length * rowH + 8}" viewBox="0 0 ${W} ${stages.length * rowH + 8}" style="display:block;width:100%;height:auto">`;
  stages.forEach((st, i) => {
    const y = i * rowH + 4;
    const x = padL;
    const w = Math.max(2, (st.ms / sharedMaxMs) * plotW);
    const color = st.ms > 500 ? "#e91e63" : st.ms > 200 ? "#ff9800" : "#4caf50";
    ganttSvg += `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 4}" fill="${color}" rx="2" opacity="0.85"><title>${esc(st.name)}: ${st.ms}ms</title></rect>`;
    ganttSvg += `<text x="${x - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(st.name)}</text>`;
    ganttSvg += `<text x="${x + w + 4}" y="${y + rowH / 2 + 4}" font-size="10" fill="var(--txt)">${st.ms}ms</text>`;
  });
  ganttSvg += `</svg>`;

  // 资产清单
  const a = rec.assets || {};
  const assetRows = [
    a.bones
      ? `<span class="perf-asset-item">${UI_ICONS.bone} ${t("diagnostics.metric.assetsBones")}: ${a.bones}</span>`
      : "",
    a.cubes
      ? `<span class="perf-asset-item">${UI_ICONS.unknown} ${t("diagnostics.assetsCubes")}: ${a.cubes}</span>`
      : "",
    a.materials
      ? `<span class="perf-asset-item">${UI_ICONS.appearance} ${t("diagnostics.assetsMats")}: ${a.materials}</span>`
      : "",
    a.textures
      ? `<span class="perf-asset-item">${UI_ICONS.image} ${t("diagnostics.assetsTex")}: ${a.textures}</span>`
      : "",
    a.morphs
      ? `<span class="perf-asset-item">${UI_ICONS.avatar} ${t("diagnostics.assetsMorphs")}: ${a.morphs}</span>`
      : "",
    a.animations
      ? `<span class="perf-asset-item">${UI_ICONS.video} ${t("diagnostics.assetsAnims")}: ${a.animations}</span>`
      : "",
    a.pmxWorker !== undefined
      ? `<span class="perf-asset-item ${a.pmxWorker ? "perf-badge-ok" : "perf-badge-warn"}">${a.pmxWorker ? UI_ICONS.performance : UI_ICONS.refresh} ${t("diagnostics.assetsPmxWorker")}: ${a.pmxWorker ? "ON" : "OFF"}</span>`
      : "",
    a.ktx2Hits !== undefined
      ? `<span class="perf-asset-item">${t("diagnostics.assetsKtx2")}: ${a.ktx2Hits}/${a.ktx2Total ?? a.ktx2Hits}</span>`
      : "",
    // GPU 口径：只有 MMD adapter 采集（其余格式的 adapter 没有这一项量）——**显式标未采集**，
    // 不省略：省略会让「没测」和「测出来是 0」长得一模一样。
    rec.gpuMb
      ? `<span class="perf-asset-item">${UI_ICONS.save} ${t("diagnostics.assetsGpu")}: ~${rec.gpuMb}MB</span>`
      : `<span class="perf-asset-item perf-badge-warn">${UI_ICONS.save} ${t("diagnostics.assetsGpu")}: ${t("diagnostics.loadTraceGpuUncollected")}</span>`,
  ]
    .filter(Boolean)
    .join("");

  // 纹理详情列表
  let texDetailHtml = "";
  if (rec.textureDetails?.length) {
    const rows = rec.textureDetails
      .slice(0, 10)
      .map((tex) => {
        const badge = tex.cached ? `<span class="perf-ktx2-badge">KTX2</span>` : "";
        return `<div class="perf-tex-row">${badge}<span class="perf-tex-name">${esc(tex.path)}</span><span class="perf-tex-size">${esc(tex.size ?? "")}</span></div>`;
      })
      .join("");
    const more =
      rec.textureDetails.length > 10
        ? `<div class="perf-tex-more">${t("diagnostics.loadTraceMore", { n: rec.textureDetails.length - 10 })}</div>`
        : "";
    texDetailHtml = `<div class="perf-tex-section">${t("diagnostics.loadTraceTexDetail")}:<br>${rows}${more}</div>`;
  }

  // 阶段粒度如实标注：1 段意味着该 adapter 只记了合并耗时（不是「只有一个阶段」）
  const coarse =
    stages.length <= 1
      ? ` <span class="perf-badge-warn">${t("diagnostics.loadTraceCoarseHint")}</span>`
      : "";
  const meta = `${esc(rec.path)} · ${formatClock(rec.ts)} · ${rec.format.toUpperCase()} · ${t("diagnostics.loadTraceStages", { n: stages.length })}`;

  return (
    `<div class="perf-hist-card">` +
    `<div class="perf-trace-meta">${meta}${coarse}</div>` +
    `<div class="perf-gantt-wrap" style="padding:var(--sp-vh-perf)">${ganttSvg}</div>` +
    `<div class="perf-total">${UI_ICONS.clock} ${t("diagnostics.perfTotal")}: ${formatTime(totalMs)}</div>` +
    `<div class="perf-asset-grid">${assetRows}</div>` +
    texDetailHtml +
    `</div>`
  );
}

/** 渲染加载剖析区段（最近 TRACE_MAX_SHOWN 条，新的在前；其余只报数） */
export function renderLoadTraceSection(root: ShadowRoot, esc: EscFn): void {
  const container = root.getElementById("diag-load-trace");
  if (!container) return;
  const traces = getLoadTraces();
  if (!traces.length) {
    container.innerHTML =
      `<div class="perf-no-data">${t("diagnostics.loadTraceNoData")}</div>` +
      `<div class="perf-no-hint">${t("diagnostics.loadTraceHint")}</div>`;
    return;
  }

  // 新的在前（最近的加载 = 用户刚做的事），最多展开 TRACE_MAX_SHOWN 条
  const shown = traces.slice(-TRACE_MAX_SHOWN).reverse();
  const hidden = traces.length - shown.length;
  // 跨记录共享刻度：本批所有阶段的最大值（对比的前提是同一把尺，见 renderTraceRecord）
  const sharedMaxMs = Math.max(...shown.flatMap((r) => (r.stages ?? []).map((s) => s.ms)), 1);

  const blocks = shown.map((rec) => renderTraceRecord(rec, esc, sharedMaxMs)).join("");
  const hiddenHtml =
    hidden > 0
      ? `<div class="perf-tex-more">${t("diagnostics.loadTraceMoreRecords", { n: hidden })}</div>`
      : "";

  container.innerHTML =
    sectionHeader(UI_ICONS.search, t("diagnostics.loadTraceTitle")) +
    `<div class="perf-trace-meta" style="padding:6px 2px 0">${t("diagnostics.loadTraceCount", { n: traces.length, max: 50 })}</div>` +
    blocks +
    hiddenHtml +
    `<div class="perf-trace-hint">${t("diagnostics.loadTraceHint")}</div>`;
}
