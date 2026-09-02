// ===== 诊断页：性能面板 — CLI 消费层（single-bench / gui-flow / perf-log）=====
// 数据来源：Go CLI 命令文本输出，通过 executeCLI 白名单调用后解析渲染。
// 纯前端逻辑，零 Go 改动；与 perf-trace.ts（load-trace store 消费层）职责隔离。

import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";
import { t } from "../../../core/i18n/t.ts";
import { executeCLI } from "../../../services/cli-bridge.ts";
import type { CLIArgs } from "../../../services/cli-bridge.ts";
import { isWebPlatform } from "../../../backend/platform-web.ts";
import { bus } from "../../../bus.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { stagger } from "../../../utils/animation/stagger.ts";
import type { EscFn } from "./logs.ts";
import { safeErrorMessage } from "../../../utils/safe-error-msg.ts";

// 代际守卫：single-bench/gui-flow/perf-log 三个命令各自可并发/快速连点，旧响应后到会覆盖
// 新响应（对齐 logs.ts 的 diagLoadSeq 做法）——入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let perfSingleSeq = 0;
let perfGuiSeq = 0;
let perfHistSeq = 0;


/** 运行中占位 */
function busyHTML(): string {
  return `<div class="diag-stat diag-stat-muted">⏳ ${t("diagnostics.perfRunning")}</div>`;
}

/** 失败占位（复用 diag-stat diag-stat-error 样式） */
function errorHTML(msg: string, esc: EscFn): string {
  return `<div class="diag-stat diag-stat-error">❌ ${esc(msg)}</div>`;
}

/** 结果区段头（可选复制按钮：data-perf-copy 供事件委托识别） */
export function sectionHeader(icon: string, label: string, rawText?: string): string {
  const copyBtn =
    rawText !== undefined
      ? `<button type="button" data-perf-copy class="btn-base perf-copy-btn" style="margin-left:auto;padding:2px 8px;font-size:var(--fs-xs);line-height:1.4" title="${t("perf.copyRaw")}">📋 ${t("perf.copy")}</button>`
      : "";
  const wrapper =
    rawText !== undefined
      ? ` data-perf-raw="${encodeURIComponent(rawText)}"`
      : "";
  return `<div class="perf-section" style="margin-top:10px;font-size:var(--fs-sm);font-weight:600;color:var(--txt);display:flex;align-items:center;gap:6px"${wrapper}>
<span>${icon}</span><span>${label}</span>${copyBtn}</div>`;
}

/** 统一复制：优先 navigator.clipboard，降级 textarea + execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 兜底到下方 textarea */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 为三个结果容器注册复制按钮事件委托（只绑一次） */
let perfCopyBound = false;
export function bindPerfCopyHandlers(root: ShadowRoot): void {
  if (perfCopyBound) return;
  perfCopyBound = true;
  for (const id of ["diag-perf-single", "diag-perf-gui-out", "diag-perf-hist"]) {
    const el = root.getElementById(id);
    if (!el) continue;
    el.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.matches?.("[data-perf-copy]")) return;
      const section = target.closest<HTMLElement>("[data-perf-raw]");
      const raw = section?.dataset.perfRaw;
      if (raw === undefined) return;
      const text = decodeURIComponent(raw);
      const ok = await copyText(text);
      bus.emit("toast:show", {
        msg: ok ? "✅ " + t("diagnostics.perfCopied") : "❌ " + t("diagnostics.perfCopyFail"),
        duration: ok ? 2000 : 3000,
        type: ok ? undefined : "error",
      });
    });
  }
}

// ===== B-3 性能趋势图：single-bench 历史存储（safeGet/safeSet，localStorage）+ SVG 折线 =====
// 存储：每次 single-bench 成功后追加一条 {ts, stages:{name:ms}}，FIFO 限长防无限增长；
// 趋势图：原生 SVG polyline，每阶段一条线（时间 → 耗时），看清优化趋势 / 突然变慢。
// 隐私模式（safeSet 静默降级）无持久化不影响功能，只是历史不跨会话。
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

function savePerfRecord(stages: { name: string; ms: number }[]): void {
  const stageMap: Record<string, number> = {};
  for (const s of stages) stageMap[s.name] = s.ms;
  const hist = loadPerfHistory();
  hist.push({ ts: Date.now(), stages: stageMap });
  safeSet(PERF_HISTORY_KEY, JSON.stringify(hist.slice(-MAX_PERF_RECORDS)));
}

/** 渲染趋势区段（<2 次时提示收集数据；否则渲染 SVG 折线 + 图例） */
function renderPerfTrendSection(esc: EscFn): string {
  const hist = loadPerfHistory();
  const head = sectionHeader("📈", t("diagnostics.perfTrendTitle"));
  if (hist.length < 2) {
    return (
      head +
      `<div class="perf-trend" style="padding:8px 2px"><div style="color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.perfTrendNoData")}</div></div>`
    );
  }
  const pts = hist.slice(-MAX_TREND_POINTS); // 时间从旧到新
  const stageNames = Object.keys(pts[pts.length - 1].stages);
  let maxMs = 0;
  for (const p of pts) for (const v of Object.values(p.stages)) if (v > maxMs) maxMs = v;
  if (maxMs <= 0) maxMs = 1;

  const W = 560, H = 150, padL = 30, padR = 10, padT = 10, padB = 20;
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
    `<div class="perf-trend" style="padding:8px 2px">
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto">${grid}${polys}</svg>
<div class="perf-legend" style="display:flex;flex-wrap:wrap;padding:4px 2px 0">${legend}</div>
</div>`
  );
}

// ===== perf-cli 共用收敛辅助：代际守卫/错误渲染/busy占位/CLI 调用守卫 =====

type CLIResp = Awaited<ReturnType<typeof executeCLI>>;

interface GenGuard {
  gen: number;
  stale: () => boolean;
}

function makeGenGuard(seqRef: { current: number }): GenGuard {
  const gen = ++seqRef.current;
  return { gen, stale: () => gen !== seqRef.current };
}

function getOutBox(root: ShadowRoot, id: string): HTMLElement | null {
  return root.getElementById(id);
}

function setBusy(out: HTMLElement): void {
  out.innerHTML = busyHTML();
}

function setErrorMsg(out: HTMLElement, msg: string, esc: EscFn): void {
  out.innerHTML = errorHTML(msg, esc);
}

function setErrorResp(out: HTMLElement, resp: CLIResp, esc: EscFn): void {
  out.innerHTML = errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc);
}

function setErrorCatch(out: HTMLElement, e: unknown, esc: EscFn): void {
  console.error("[diagnostics] perf-cli 失败:", e);
  out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
}

function respHasOutput(resp: CLIResp): resp is CLIResp & { status: "success"; data: { output: string } } {
  return resp.status === "success" && !!resp.data?.output;
}

// ===== single-bench：7 阶段耗时柱状图 =====

interface SingleBenchStage {
  name: string;
  ms: number;
  status: string;
}

type SingleBenchParams = CLIArgs & {
  model: string;
  iterations: number;
};

function singleBenchGetParams(root: ShadowRoot): SingleBenchParams {
  const model = (root.getElementById("diag-perf-model") as HTMLInputElement | null)
    ?.value.trim() ?? "";
  const iterRaw =
    (root.getElementById("diag-perf-iter") as HTMLInputElement | null)?.value ?? "3";
  const iterations = Math.max(1, parseInt(iterRaw, 10) || 3);
  return { model, iterations };
}

function singleBenchValidateAndRender(
  root: ShadowRoot,
  out: HTMLElement,
  esc: EscFn,
): SingleBenchParams | null {
  const params = singleBenchGetParams(root);
  if (!params.model) {
    setErrorMsg(out, t("diagnostics.perfModelRequired"), esc);
    return null;
  }
  return params;
}

function singleBenchParseStages(output: string): { stages: SingleBenchStage[]; total: number } | null {
  const lines = output.split("\n");
  const stageRe = /^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/;
  const totalRe = /⏱️\s*总耗时.*?([\d.]+)ms/;

  const stages: SingleBenchStage[] = [];
  let maxMs = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(stageRe);
    if (!m) continue;
    const name = m[1].trim();
    if (name === "总计") continue;
    const ms = parseFloat(m[2]);
    const status = m[3] ?? "";
    stages.push({ name, ms, status });
    if (ms > maxMs) maxMs = ms;
  }
  const totalRes = lines.find((l) => totalRe.test(l));
  const total = totalRes
    ? parseFloat(totalRes.match(totalRe)![1])
    : stages.reduce((s, x) => s + x.ms, 0);

  return stages.length ? { stages, total } : null;
}

function singleBenchRenderBars(
  stages: SingleBenchStage[],
  total: number,
  rawOutput: string,
  esc: EscFn,
): string {
  let maxMs = 0;
  for (const s of stages) if (s.ms > maxMs) maxMs = s.ms;
  const bars = stages
    .map((s) => {
      const pct = maxMs > 0 ? Math.max(3, Math.round((s.ms / maxMs) * 100)) : 3;
      const cls = s.ms > 100 ? "perf-bar-danger" : s.ms > 50 ? "perf-bar-warn" : "";
      return `<div class="perf-bar-row">
<span class="perf-bar-name" title="${esc(s.name)}">${esc(s.name)}</span>
<span class="perf-bar-track"><span class="perf-bar-fill ${cls}" style="width:${pct}%"></span></span>
<span class="perf-bar-val ${cls}">${s.ms.toFixed(2)}ms ${esc(s.status)}</span>
</div>`;
    })
    .join("");
  savePerfRecord(stages);
  return (
    sectionHeader("⚡", t("diagnostics.perfSingleResult"), rawOutput) +
    `<div class="perf-bars" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${bars}</div>` +
    `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${total.toFixed(2)}ms</div>` +
    renderPerfTrendSection(esc)
  );
}

export async function runSingleBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const { stale } = makeGenGuard({ get current() { return perfSingleSeq; }, set current(v) { perfSingleSeq = v; } });
  const out = getOutBox(root, "diag-perf-single");
  if (!out) return;
  const params = singleBenchValidateAndRender(root, out, esc);
  if (!params) return;
  setBusy(out);
  try {
    const resp = await executeCLI("single-bench", params);
    if (stale()) return;
    if (!respHasOutput(resp)) {
      setErrorResp(out, resp, esc);
      return;
    }
    const parsed = singleBenchParseStages(resp.data.output);
    if (!parsed) {
      setErrorMsg(out, t("diagnostics.perfFail"), esc);
      return;
    }
    out.innerHTML = singleBenchRenderBars(parsed.stages, parsed.total, resp.data.output, esc);
  } catch (e) {
    if (stale()) return;
    setErrorCatch(out, e, esc);
  }
}

// ===== gui-flow：6 阶段状态（✅/❌ + 耗时） =====

interface GuiFlowStage {
  status: string;
  name: string;
  ms: number;
  desc: string[];
}

function guiFlowWebModeCheck(): boolean {
  if (isWebPlatform()) {
    bus.emit("toast:show", {
      msg: t("diagnostics.webNoPerf"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return true;
  }
  return false;
}

function guiFlowParseEntries(output: string): {
  entries: GuiFlowStage[];
  flowTotal: number | null;
  failed: boolean;
} | null {
  const lines = output.split("\n");
  const stageRe = /^([✅❌])\s*\[\d+\]\s*(.+?)\s*\(([\d.]+)ms\)$/;
  const totalRe = /⏱️\s*总耗时:\s*([\d.]+)ms/;

  const entries: GuiFlowStage[] = [];
  let cur: GuiFlowStage | null = null;
  let flowTotal: number | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const sm = line.match(stageRe);
    if (sm) {
      cur = { status: sm[1], name: sm[2].trim(), ms: parseFloat(sm[3]), desc: [] };
      entries.push(cur);
      continue;
    }
    const tm = line.match(totalRe);
    if (tm) {
      flowTotal = parseFloat(tm[1]);
      continue;
    }
    if (cur && /^\s{3}/.test(line) && line.trim()) cur.desc.push(line.trim());
  }

  if (!entries.length) return null;
  const failed = entries.some((e) => e.status === "❌");
  return { entries, flowTotal, failed };
}

function guiFlowRenderStages(
  entries: GuiFlowStage[],
  flowTotal: number | null,
  failed: boolean,
  rawOutput: string,
  esc: EscFn,
): string {
  const rows = entries
    .map((e) => {
      const desc = e.desc.length
        ? `<span class="perf-gui-desc">${esc(e.desc.join("<br>"))}</span>`
        : "";
      const cls = e.status === "❌" ? "perf-gui-fail" : "";
      return `<div class="perf-gui-stage ${cls}">
<span class="perf-gui-status">${e.status}</span>
<span class="perf-gui-name">${esc(e.name)}</span>
<span class="perf-gui-ms">${e.ms.toFixed(2)}ms</span>${desc}
</div>`;
    })
    .join("");
  const totalLine =
    flowTotal !== null
      ? `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${flowTotal.toFixed(2)}ms</div>`
      : "";
  const failLine = failed
    ? `<div class="diag-stat diag-stat-error">❌ ${t("diagnostics.perfGuiFailed")}</div>`
    : "";
  return (
    sectionHeader("🩺", t("diagnostics.perfGuiResult"), rawOutput) +
    `<div class="perf-gui" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${rows}</div>` +
    totalLine +
    failLine
  );
}

export async function runGuiFlow(root: ShadowRoot, esc: EscFn): Promise<void> {
  const { stale } = makeGenGuard({ get current() { return perfGuiSeq; }, set current(v) { perfGuiSeq = v; } });
  const out = getOutBox(root, "diag-perf-gui-out");
  if (!out) return;
  if (guiFlowWebModeCheck()) return;
  setBusy(out);
  try {
    const resp = await executeCLI("gui-flow", { verbose: true });
    if (stale()) return;
    if (!respHasOutput(resp)) {
      setErrorResp(out, resp, esc);
      return;
    }
    const parsed = guiFlowParseEntries(resp.data.output);
    if (!parsed) {
      setErrorMsg(out, t("diagnostics.perfFail"), esc);
      return;
    }
    out.innerHTML = guiFlowRenderStages(
      parsed.entries,
      parsed.flowTotal,
      parsed.failed,
      resp.data.output,
      esc,
    );
  } catch (e) {
    if (stale()) return;
    setErrorCatch(out, e, esc);
  }
}

// ===== perf-log：优化历史（按时间倒序） =====

interface PerfLogEntry {
  date: string;
  area: string;
  commit: string;
  body: string[];
}

function perfLogParseEntries(output: string): PerfLogEntry[] | null {
  const lines = output.split("\n");
  const headRe = /^─\s*(.+?)\s*─\s*(.+?)\s*─\s*(.+?)\s*$/;
  const entries: PerfLogEntry[] = [];
  let cur: PerfLogEntry | null = null;
  for (const raw of lines) {
    const line = raw;
    const hm = line.match(headRe);
    if (hm) {
      cur = { date: hm[1].trim(), area: hm[2].trim(), commit: hm[3].trim(), body: [] };
      entries.push(cur);
      continue;
    }
    if (
      cur &&
      (line.startsWith("  问题:") || line.startsWith("  做法:") || line.startsWith("  效果:")) &&
      line.trim()
    ) {
      cur.body.push(line.trim());
    }
  }
  return entries.length ? entries : null;
}

function perfLogRenderCards(entries: PerfLogEntry[], rawOutput: string, esc: EscFn): string {
  const cards = entries
    .map((e, i) => {
      const body = e.body.length
        ? `<span class="perf-hist-body">${e.body.map((d) => esc(d)).join("<br>")}</span>`
        : "";
      return `<div class="perf-hist-card" style="animation-delay:${stagger(i)}ms">
<span class="perf-hist-head">🗓️ ${esc(e.date)} · ${esc(e.area)} · <code>${esc(e.commit)}</code></span>${body}
</div>`;
    })
    .join("");
  return (
    sectionHeader("🗒️", t("diagnostics.perfHistResult"), rawOutput) +
    `<div class="perf-hist" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${cards}</div>`
  );
}

export async function runPerfLog(root: ShadowRoot, esc: EscFn): Promise<void> {
  const { stale } = makeGenGuard({ get current() { return perfHistSeq; }, set current(v) { perfHistSeq = v; } });
  const out = getOutBox(root, "diag-perf-hist");
  if (!out) return;
  setBusy(out);
  try {
    const resp = await executeCLI("perf-log", {});
    if (stale()) return;
    if (!respHasOutput(resp)) {
      setErrorResp(out, resp, esc);
      return;
    }
    const parsed = perfLogParseEntries(resp.data.output);
    if (!parsed) {
      setErrorMsg(out, t("diagnostics.perfFail"), esc);
      return;
    }
    out.innerHTML = perfLogRenderCards(parsed, resp.data.output, esc);
  } catch (e) {
    if (stale()) return;
    setErrorCatch(out, e, esc);
  }
}
