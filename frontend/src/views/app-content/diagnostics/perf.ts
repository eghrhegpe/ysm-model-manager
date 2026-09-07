// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-common.ts      ：共享工具层（sectionHeader / 守卫 / 错误辅助 / 复制委托）
//   - perf-single-bench.ts：single-bench（CLI 文本流消费 + 柱状图 + 趋势图）
//   - perf-gui-flow.ts    ：gui-flow（6 阶段结构化消费）
//   - perf-log.ts         ：perf-log（优化历史卡片）
//   - perf-trace.ts       ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件仅 ~30 行。

import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers } from "./perf-common.ts";
import { runGuiFlow } from "./perf-gui-flow.ts";
import { runPerfLog } from "./perf-log.ts";
import { runSingleBench } from "./perf-single-bench.ts";
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
