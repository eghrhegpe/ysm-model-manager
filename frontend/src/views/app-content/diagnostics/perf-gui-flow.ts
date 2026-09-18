// ===== 诊断页：性能面板 — gui-flow（6 阶段状态 ✅/❌ + 耗时）=====
// 数据来源：Go CLI gui-flow 结构化输出（ADR-200 D2），直接读 data.stages，禁止正则反解析。

import { t } from "@/core/i18n/t.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import {
  getOutBox,
  sectionHeader,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
} from "./perf-common.ts";
import { webGate } from "./web-gate.ts";

// 代际守卫（ADR-230）
const perfGuiGuard = createLoadGuard();

interface GuiFlowStage {
  status: string;
  name: string;
  ms: number;
  /** measured（实测）| estimated（估算，如 ⑥ 渲染预估）——ADR-262 D2 */
  kind?: "measured" | "estimated";
  desc: string[];
  /** 估算成分（不计入 total_ms） */
  estimated_ms?: number;
  /** 估算假设/公式 */
  note?: string;
  /** 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）；旧版 Go 载荷缺省，按可选处理 */
  runtime?: string;
}

// 结构化载荷（ADR-200 D2：gui-flow 首批结构化命令，字段与 Go guiFlowStructured 逐字对齐）
interface GuiFlowStructured {
  stages: GuiFlowStage[];
  total_ms: number;
  /** 各阶段估算合计（ADR-262 D2）：不计入 total_ms */
  estimated_ms?: number;
  failed: boolean;
  /** deprecated（ADR-200 D5）：迁移期保留，供复制原文与守卫兼容 */
  output?: string;
  filesRoot?: string;
}

/**
 * 汇总块（ADR-262 D2）：实测总耗时 / 估算合计 / 是否有阶段失败。
 * 三者同源同现（同一个载荷的三个汇总口径），成组传递——避免逐项平铺撑爆参数表。
 */
interface GuiFlowSummary {
  /** 实测墙钟总耗时；非 number 时（旧载荷）不渲染该行 */
  total: number | null;
  /** 各阶段估算合计；不计入 total */
  estimated: number | null;
  failed: boolean;
}

function guiFlowRenderStages(
  entries: GuiFlowStage[],
  summary: GuiFlowSummary,
  rawOutput: string,
  esc: EscFn,
): string {
  const rows = entries
    .map((e) => {
      // 多行描述：**先逐行转义再拼 <br>**（同目录 perf-log.ts 的既有正确写法）。
      // 反例：esc(desc.join("<br>")) 会把 <br> 自己也转义成 &lt;br&gt; → 界面直接显示字面量
      // 「<br>」（2026-09-18 由 e2e 真实渲染抓出；单元层的子串断言对此失明）。
      const desc = e.desc.length
        ? `<span class="perf-gui-desc">${e.desc.map((line) => esc(line)).join("<br>")}</span>`
        : "";
      const cls = e.status === "❌" ? "perf-gui-fail" : "";
      // 估算标记（ADR-262 D2）：人眼必须能区分实测与估算，不能只靠描述里一句话
      const isEstimated = e.kind === "estimated" || (e.estimated_ms ?? 0) > 0;
      const estTag = isEstimated
        ? ` <span class="perf-gui-est" title="${esc(e.note ?? t("diagnostics.perfEstimatedHint"))}">${t("diagnostics.perfEstimated")}</span>`
        : "";
      const msText = isEstimated
        ? `${e.ms.toFixed(2)}ms + ${(e.estimated_ms ?? 0).toFixed(2)}ms`
        : `${e.ms.toFixed(2)}ms`;
      return `<div class="perf-gui-stage ${cls}">
<span class="perf-gui-status">${e.status}</span>
<span class="perf-gui-name">${esc(e.name)}</span>${
        e.runtime
          ? `<span class="perf-rt-tag" title="${esc(t("diagnostics.perfStageRuntimeHint"))}">${esc(e.runtime)}</span>`
          : ""
      }
<span class="perf-gui-ms">${msText}${estTag}</span>${desc}
</div>`;
    })
    .join("");
  const totalLine =
    summary.total !== null
      ? `<div class="perf-total">${UI_ICONS.clock} ${t("diagnostics.perfTotal")}: ${summary.total.toFixed(2)}ms</div>`
      : "";
  // 估算单独一行且明确「不计入总耗时」——混在一起就是「数字不可信」的来源
  const estimatedLine =
    summary.estimated !== null && summary.estimated > 0
      ? `<div class="perf-total">${UI_ICONS.performance} ${t("diagnostics.perfEstimatedTotal", { ms: summary.estimated.toFixed(2) })}</div>`
      : "";
  const failLine = summary.failed
    ? `<div class="diag-stat diag-stat-error">${UI_ICONS.error} ${t("diagnostics.perfGuiFailed")}</div>`
    : "";
  return (
    sectionHeader(UI_ICONS.diagnose, t("diagnostics.perfGuiResult"), rawOutput) +
    `<div class="perf-gui" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${rows}</div>` +
    totalLine +
    estimatedLine +
    failLine
  );
}

export async function runGuiFlow(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfGuiGuard.next();
  const out = getOutBox(root, "diag-perf-gui-out");
  if (!out) return;
  if (webGate("diagnostics.webNoPerf")) return;
  setBusy(out);
  try {
    const resp = await executeCLI("gui-flow", { verbose: true });
    if (perfGuiGuard.stale(gen)) return;
    // 结构化消费（ADR-200 D2/D3）：直接读 data.stages，禁止对人类文案做正则反解析。
    // 失败阶段（status=error，如「③ 模型分析」失败）也照常渲染阶段明细——
    // Go 侧 SetResult 先于汇总报错，错误分支同样带回结构化载荷（规律六）。
    const data = resp.data as Partial<GuiFlowStructured> | undefined;
    if (resp.status !== "success" && resp.status !== "error") {
      setErrorResp(out, resp, esc);
      return;
    }
    if (!data?.stages || !Array.isArray(data.stages) || data.stages.length === 0) {
      if (resp.status === "success") {
        setErrorMsg(out, t("diagnostics.perfFail"), esc);
      } else {
        setErrorResp(out, resp, esc);
      }
      return;
    }
    out.innerHTML = guiFlowRenderStages(
      data.stages,
      {
        // 旧载荷缺 total_ms/estimated_ms 时给 null（不渲染该行），不用 0 冒充实测
        total: typeof data.total_ms === "number" ? data.total_ms : null,
        estimated: typeof data.estimated_ms === "number" ? data.estimated_ms : null,
        failed: !!data.failed,
      },
      data.output ?? "",
      esc,
    );
  } catch (e) {
    if (perfGuiGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
