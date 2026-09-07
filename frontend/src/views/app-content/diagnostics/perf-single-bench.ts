// ===== 诊断页：性能面板 — single-bench（7 阶段耗时柱状图）=====
// 数据来源：Go CLI single-bench 命令文本输出，正则解析后渲染柱状图 + 趋势图。

import { t } from "@/core/i18n/t.ts";
import type { CLIArgs } from "@/services/cli-bridge.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import type { EscFn } from "./logs.ts";
import {
  getOutBox,
  makeGenGuard,
  respHasOutput,
  sectionHeader,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
} from "./perf-common.ts";
import { renderPerfTrendSection, savePerfRecord } from "./perf-trend.ts";

// 代际守卫：single-bench 命令可并发/快速连点，旧响应后到会覆盖新响应
let perfSingleSeq = 0;

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
  const model =
    (root.getElementById("diag-perf-model") as HTMLInputElement | null)?.value.trim() ?? "";
  const iterRaw = (root.getElementById("diag-perf-iter") as HTMLInputElement | null)?.value ?? "3";
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

/** single-bench 汇总行标签（契约 = go/cli/concurrent.go printSingleModelStages 输出，
 *  perf.test.ts 夹具锁定；本仓 CLI 文案不做 i18n，Go 侧改名需同步此处） */
const BENCH_TOTAL_LABEL = "总计";

function singleBenchParseStages(
  output: string,
): { stages: SingleBenchStage[]; total: number } | null {
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
    if (name === BENCH_TOTAL_LABEL) continue;
    const ms = parseFloat(m[2]);
    const status = m[3] ?? "";
    stages.push({ name, ms, status });
    if (ms > maxMs) maxMs = ms;
  }
  const totalRes = lines.find((l) => totalRe.test(l));
  const total = totalRes
    ? // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      parseFloat(totalRes.match(totalRe)![1])
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
  const { stale } = makeGenGuard({
    get current() {
      return perfSingleSeq;
    },
    set current(v) {
      perfSingleSeq = v;
    },
  });
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
