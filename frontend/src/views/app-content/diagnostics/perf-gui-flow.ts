// ===== 诊断页：性能面板 — gui-flow（6 阶段状态 ✅/❌ + 耗时）=====
// 数据来源：Go CLI gui-flow 结构化输出（ADR-200 D2），直接读 data.stages，禁止正则反解析。

import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
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

// 代际守卫（ADR-230）
const perfGuiGuard = createLoadGuard();

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

// 结构化载荷（ADR-200 D2：gui-flow 首批结构化命令，字段与 Go guiFlowStructured 逐字对齐）
interface GuiFlowStructured {
  stages: GuiFlowStage[];
  total_ms: number;
  failed: boolean;
  /** deprecated（ADR-200 D5）：迁移期保留，供复制原文与守卫兼容 */
  output?: string;
  filesRoot?: string;
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
    ? `<div class="diag-stat diag-stat-error">${UI_ICONS.error} ${t("diagnostics.perfGuiFailed")}</div>`
    : "";
  return (
    sectionHeader("🩺", t("diagnostics.perfGuiResult"), rawOutput) +
    `<div class="perf-gui" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${rows}</div>` +
    totalLine +
    failLine
  );
}

export async function runGuiFlow(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfGuiGuard.next();
  const out = getOutBox(root, "diag-perf-gui-out");
  if (!out) return;
  if (guiFlowWebModeCheck()) return;
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
      typeof data.total_ms === "number" ? data.total_ms : null,
      !!data.failed,
      data.output ?? "",
      esc,
    );
  } catch (e) {
    if (perfGuiGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
