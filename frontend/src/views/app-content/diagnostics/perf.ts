// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-common.ts      ：共享工具层（sectionHeader / 守卫 / 错误辅助 / 复制委托）
//   - perf-single-bench.ts：single-bench（结构化载荷消费 + 柱状图 + 趋势图 + 矩阵分发）
//   - perf-matrix-render.ts：类型矩阵渲染（--rtype / --all-types 载荷）
//   - perf-gui-flow.ts    ：gui-flow（6 阶段结构化消费，实测/估算分离）
//   - perf-log.ts         ：perf-log（优化历史卡片）
//   - perf-trace.ts       ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件仅 ~30 行。

import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers } from "./perf-common.ts";
import { runGuiFlow } from "./perf-gui-flow.ts";
import { runPerfLog } from "./perf-log.ts";
import { populatePerfRtypeOptions } from "./perf-matrix-render.ts";
import { runSingleBench } from "./perf-single-bench.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

/** 初始化性能面板（single-bench / gui-flow / perf-log / 加载剖析） */
export function initPerfPanel(root: ShadowRoot, esc: EscFn): void {
  bindPerfCopyHandlers(root);
  root.getElementById("diag-perf-run")?.addEventListener("click", () => runSingleBench(root, esc));
  // 类型选择器选项来自 Go/registry（前端不写死类型表）；注册表不可用时静默回落「单模型」旧行为
  void populatePerfRtypeOptions(root);
  root.getElementById("diag-perf-gui")?.addEventListener("click", () => runGuiFlow(root, esc));
  root.getElementById("diag-perf-log")?.addEventListener("click", () => runPerfLog(root, esc));
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}

/** 供测试与外部装配复用的类型选择器填充（facade 对外出口） */
export { populatePerfRtypeOptions };
