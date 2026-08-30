// ===== 诊断页：性能面板 — 加载剖析（load-trace store 消费层）=====
// 数据来源：各 3D adapter（MMD / VRM / FBX / YSM / Litematic）调用 recordLoadTrace() 写入全局内存 store；
// 本文件消费 store 渲染甘特图 + 资产清单 + 纹理详情。
// 与 perf-cli.ts 职责隔离：CLI 文本流 ≠ 运行时 trace store，不混在同一文件。

import { t } from "../../../core/i18n/t.ts";
import { getLoadTraces } from "../../../features/preview-3d/load-trace.ts";
import type { EscFn } from "./logs.ts";
import { sectionHeader } from "./perf-cli.ts";

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

/** 渲染加载剖析区段（取最近一条 trace 渲染甘特图 + 资产清单） */
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
  // 取最近一条（最新的加载）
  const latest = traces[traces.length - 1];
  const totalMs = latest.stages.reduce((s, st) => s + st.ms, 0);
  const maxMs = Math.max(...latest.stages.map(s => s.ms), 1);

  // 甘特图 SVG（横向条状）
  const W = 560, padR = 10;
  const plotW = W - 72 - padR;
  const rowH = 18;
  const padL = 72;
  let ganttSvg = `<svg width="${W}" height="${latest.stages.length * rowH + 8}" viewBox="0 0 ${W} ${latest.stages.length * rowH + 8}" style="display:block;width:100%;height:auto">`;
  latest.stages.forEach((st, i) => {
    const y = i * rowH + 4;
    const x = padL;
    const w = Math.max(2, (st.ms / maxMs) * plotW);
    const color = st.ms > 500 ? "#e91e63" : st.ms > 200 ? "#ff9800" : "#4caf50";
    ganttSvg += `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 4}" fill="${color}" rx="2" opacity="0.85"><title>${esc(st.name)}: ${st.ms}ms</title></rect>`;
    ganttSvg += `<text x="${x - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(st.name)}</text>`;
    ganttSvg += `<text x="${x + w + 4}" y="${y + rowH / 2 + 4}" font-size="10" fill="var(--txt)">${st.ms}ms</text>`;
  });
  ganttSvg += `</svg>`;

  // 资产清单
  const a = latest.assets || {};
  const assetRows = [
    a.bones ? `<span class="perf-asset-item">🦴 ${t("diagnostics.metric.assetsBones")}: ${a.bones}</span>` : "",
    a.cubes ? `<span class="perf-asset-item">🧊 ${t("diagnostics.assetsCubes")}: ${a.cubes}</span>` : "",
    a.materials ? `<span class="perf-asset-item">🎨 ${t("diagnostics.assetsMats")}: ${a.materials}</span>` : "",
    a.textures ? `<span class="perf-asset-item">🖼 ${t("diagnostics.assetsTex")}: ${a.textures}</span>` : "",
    a.morphs ? `<span class="perf-asset-item">😀 ${t("diagnostics.assetsMorphs")}: ${a.morphs}</span>` : "",
    a.animations ? `<span class="perf-asset-item">🎬 ${t("diagnostics.assetsAnims")}: ${a.animations}</span>` : "",
    a.pmxWorker !== undefined ? `<span class="perf-asset-item ${a.pmxWorker ? "perf-badge-ok" : "perf-badge-warn"}">${a.pmxWorker ? "⚡" : "🔄"} ${t("diagnostics.assetsPmxWorker")}: ${a.pmxWorker ? "ON" : "OFF"}</span>` : "",
    a.ktx2Hits !== undefined ? `<span class="perf-asset-item">${t("diagnostics.assetsKtx2")}: ${a.ktx2Hits}/${a.ktx2Total ?? a.ktx2Hits}</span>` : "",
    latest.gpuMb ? `<span class="perf-asset-item">💾 ${t("diagnostics.assetsGpu")}: ~${latest.gpuMb}MB</span>` : "",
  ].filter(Boolean).join("");

  // 纹理详情列表
  let texDetailHtml = "";
  if (latest.textureDetails?.length) {
    const rows = latest.textureDetails.slice(0, 10).map(t => {
      const badge = t.cached ? `<span class="perf-ktx2-badge">KTX2</span>` : "";
      return `<div class="perf-tex-row">${badge}<span class="perf-tex-name">${esc(t.path)}</span><span class="perf-tex-size">${esc(t.size ?? "")}</span></div>`;
    }).join("");
    const more = latest.textureDetails.length > 10 ? `<div class="perf-tex-more">${t("diagnostics.loadTraceMore", { n: latest.textureDetails.length - 10 })}</div>` : "";
    texDetailHtml = `<div class="perf-tex-section">${t("diagnostics.loadTraceTexDetail")}:<br>${rows}${more}</div>`;
  }

  const fmtTs = new Date(latest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  container.innerHTML =
    sectionHeader("🔍", t("diagnostics.loadTraceTitle")) +
    `<div class="perf-trace-meta" style="padding:6px 2px;font-size:var(--fs-xs);color:var(--muted)">${esc(latest.path)} · ${fmtTs} · ${latest.format.toUpperCase()}</div>` +
    `<div class="perf-gantt-wrap" style="padding:8px 2px">${ganttSvg}</div>` +
    `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${formatTime(totalMs)}</div>` +
    `<div class="perf-asset-grid">${assetRows}</div>` +
    texDetailHtml +
    `<div class="perf-trace-hint">${t("diagnostics.loadTraceHint")}</div>`;
}
