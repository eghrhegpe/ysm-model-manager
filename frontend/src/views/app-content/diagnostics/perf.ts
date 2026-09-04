// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-cli.ts     ：single-bench / gui-flow / perf-log（CLI 文本流消费）
//   - perf-trace.ts   ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件仅 ~30 行。

import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers, runGuiFlow, runPerfLog, runSingleBench } from "./perf-cli.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

/** 初始化性能面板（single-bench / gui-flow / perf-log / 加载剖析） */
export function initPerfPanel(root: ShadowRoot, esc: EscFn): void {
  bindPerfCopyHandlers(root);
  root.getElementById("diag-perf-run")?.addEventListener("click", () => runSingleBench(root, esc));
  root.getElementById("diag-perf-gui")?.addEventListener("click", () => runGuiFlow(root, esc));
  root.getElementById("diag-perf-log")?.addEventListener("click", () => runPerfLog(root, esc));
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}
