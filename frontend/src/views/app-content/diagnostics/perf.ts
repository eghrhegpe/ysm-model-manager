// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-common.ts      ：共享工具层（sectionHeader / 守卫 / 错误辅助 / 复制委托）
//   - perf-single-bench.ts：single-bench（结构化载荷消费 + 柱状图 + 趋势图 + 矩阵分发）
//   - perf-matrix-render.ts：目标集渲染（--target rtype/all/repo 三种目标集载荷同形 + 体量口径回显）
//   - perf-gui-flow.ts    ：gui-flow（6 阶段结构化消费，实测/估算分离）
//   - perf-scan-bench.ts  ：scan-bench（Go/Rust 扫描引擎对照，未采集不填 0ms）
//   - perf-log.ts         ：perf-log（优化历史卡片）
//   - perf-trace.ts       ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件仅 ~45 行。

import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers } from "./perf-common.ts";
import { runConcurrentBench } from "./perf-concurrent.ts";
import { runGuiFlow } from "./perf-gui-flow.ts";
import { runPerfLog } from "./perf-log.ts";
import { populatePerfTargetOptions } from "./perf-matrix-render.ts";
import { runScanBench } from "./perf-scan-bench.ts";
import { runSingleBench, syncPerfBaselineControls } from "./perf-single-bench.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

/** 初始化性能面板（single-bench / 引擎对照 / gui-flow / 并发 / perf-log / 加载剖析） */
export function initPerfPanel(root: ShadowRoot, esc: EscFn): void {
  bindPerfCopyHandlers(root);
  root.getElementById("diag-perf-run")?.addEventListener("click", () => runSingleBench(root, esc));
  // 目标集选择器选项来自 Go/registry（前端不写死类型表）；注册表不可用时静默回落静态首项旧行为
  // 填充后同步基准控件可用性（选项变化不影响当前值，但仍以填充后的值为准）
  void populatePerfTargetOptions(root, "diag-perf-rtype", true).then(() =>
    syncPerfBaselineControls(root),
  );
  // 并发 tab 复用同一套填充（includeModel=false：该 tab 没有单模型路径输入框）
  void populatePerfTargetOptions(root, "diag-perf-conc-target", false);
  // 基准三件套只在单模型目标集可用（ADR-262 D8）：Go 对 target≠model 的基准参数是**明确拒绝**的
  root
    .getElementById("diag-perf-rtype")
    ?.addEventListener("change", () => syncPerfBaselineControls(root));
  syncPerfBaselineControls(root);
  root.getElementById("diag-perf-gui")?.addEventListener("click", () => runGuiFlow(root, esc));
  // 并发基准（ADR-262 D5）：加速比只有 Go 量得到，前端只提交参数 + 渲染结构化载荷
  root
    .getElementById("diag-perf-conc-run")
    ?.addEventListener("click", () => void runConcurrentBench(root, esc));
  // 扫描引擎对照（ADR-262 D3）：Go/Rust 对照的实测归属归 Go，前端只提交迭代次数 + 渲染载荷
  root
    .getElementById("diag-perf-scan-bench")
    ?.addEventListener("click", () => void runScanBench(root, esc));
  root.getElementById("diag-perf-log")?.addEventListener("click", () => runPerfLog(root, esc));
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}

/** 供测试与外部装配复用的目标集选择器填充（facade 对外出口） */
export { populatePerfTargetOptions };
