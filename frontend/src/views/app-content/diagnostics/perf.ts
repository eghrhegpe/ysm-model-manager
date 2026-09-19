// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-common.ts      ：共享工具层（sectionHeader / 守卫 / 错误辅助 / 复制委托）
//   - perf-single-bench.ts：single-bench（结构化载荷消费 + 柱状图 + 趋势图 + 矩阵分发）
//   - perf-matrix-render.ts：目标集渲染（--target rtype/all/repo 三种目标集载荷同形 + 体量口径回显）
//   - perf-scan-bench.ts  ：scan-bench（Go/Rust 扫描引擎对照，未采集不填 0ms）
//   - perf-trace.ts       ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件为薄接线层。

import { t } from "@/core/i18n/t.ts";
import { getLastModelPath } from "@/core/model-path-store.ts";
import { toast } from "@/utils/dom/toast.ts";
import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers } from "./perf-common.ts";
import { runConcurrentBench } from "./perf-concurrent.ts";
import { PERF_TARGET_REPO, populatePerfTargetOptions } from "./perf-matrix-render.ts";
import { runScanBench } from "./perf-scan-bench.ts";
import { runSingleBench, syncPerfBaselineControls } from "./perf-single-bench.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

/**
 * 基准模式接线（ADR-278 §2.1 / §2.3）：单模型 / 并发 / 引擎对照三选一，只呈现该模式那一套控件。
 *
 * 显隐走 **class**（`.perf-mode-off`）而非 inline style：查看器降级 `dgInHideDesktopOnly` 用的是
 * inline `display:none`，而 inline 胜过 class —— 故模式接线**不可能**把查看器藏掉的桌面专属按钮又
 * 「显示」回来。两种机制各司其职（ADR-278 §2.4），不是巧合。
 *
 * 并发模式还要禁用目标集里的「单模型」选项：并发基准没有模型路径输入框，选了必然缺载荷参数
 * （`perf-concurrent.ts` 原本只是静默 `return null`）。这里把它变成**可见的不可选**，并把已选中的值
 * 回落到「全库扁平」（与 Go 的 concurrent-bench 默认一致）。
 *
 * **语义诚实层（ADR-278 §2.6）**：三模式共用一套控件，但同一个数字/选项**测的对象不同**——
 * 改义必须当场说出来，否则用户/AI 会把 scan 的「迭代次数」误读成「再测一次模型」：
 *  - #diag-perf-iter 标签随模式改写（single=重复解析 / scan=全库重扫），悬停 hint 说口径；
 *  - 三个运行按钮各自挂本模式「测什么对象」的 scope hint；
 *  - conc 回落不再静默：toast 告知发生了替换。
 * 标签改写只发生在 `[data-perf-mode]` 行内受控的两个 label，不碰「取样上限」（其标签恒定性
 * 由 perf-matrix.test 钉死：单位只进 title，不随模式改义）。
 *
 * 返回值 = 重放函数：`populatePerfTargetOptions` 会重建 `<option>`，重建后单模型选项的 `disabled`
 * 随之丢失，故填充完成后必须重放一次。回落 toast 只在**真正发生替换**时弹（重放时值已是
 * 全库扁平 → 不重复弹）。
 */
function initPerfMode(root: ShadowRoot): () => void {
  const modeEl = root.getElementById("diag-perf-mode") as HTMLSelectElement | null;
  const apply = (): void => {
    if (!modeEl) return;
    const mode = modeEl.value || "single";
    root.querySelectorAll<HTMLElement>("[data-perf-mode]").forEach((el) => {
      const modes = (el.dataset.perfMode ?? "").split(/\s+/);
      el.classList.toggle("perf-mode-off", !modes.includes(mode));
    });
    const targetEl = root.getElementById("diag-perf-rtype") as HTMLSelectElement | null;
    // ===== ADR-278 §2.6 语义诚实层：同控件跨模式改义，当场说清 =====
    const iterLabel = root.getElementById("diag-perf-iter-label");
    if (iterLabel) {
      iterLabel.textContent =
        mode === "scan"
          ? t("diagnostics.perfIterationsScan")
          : t("diagnostics.perfIterationsSingle");
      iterLabel.title = t("diagnostics.perfIterationsHint");
    }
    // 并发下目标集只剩「挑样本范围」语义（单模型选项已禁），标签同步改口
    const targetLabel = root.getElementById("diag-perf-target-label");
    if (targetLabel)
      targetLabel.textContent =
        mode === "conc" ? t("diagnostics.perfTargetSampleRange") : t("diagnostics.perfTarget");
    // 每个运行按钮说清自己测的对象（防把引擎对照误读为「换个方式再测这个模型」）。
    // conc/scan 的机制长句 hint 原写死在模板 title，现收进同一事实源：短 scope 句 + 既有机制句拼接。
    const scopeHints: Record<string, string> = {
      "diag-perf-run": t("diagnostics.perfScopeHintSingle"),
      "diag-perf-conc-run": `${t("diagnostics.perfScopeHintConc")} · ${t("diagnostics.perfConcurrentHint")}`,
      // 接线断言护栏：tests/test_cli_gui_flow_contract.ts 的 perfScanBenchHint 引用点只扫
      // perf-scan-bench.ts + tpl.ts；hint 收进本单点后留此注释防其误报「加键没接线」。
      "diag-perf-scan-bench": `${t("diagnostics.perfScopeHintScan")} · ${t("diagnostics.perfScanBenchHint")}`, // diagnostics.perfScanBenchHint
    };
    for (const [id, hint] of Object.entries(scopeHints)) {
      const el = root.getElementById(id);
      if (el) el.title = hint;
    }

    const modelOpt = Array.from(targetEl?.options ?? []).find((o) => o.value === "");
    if (modelOpt) modelOpt.disabled = mode !== "single";
    if (mode === "conc" && targetEl && targetEl.value.trim() === "") {
      targetEl.value = PERF_TARGET_REPO;
      syncPerfBaselineControls(root);
      // 静默改用户的选择是欺骗：发生了什么要当场说（重放时值已回落，不重复弹）
      toast(t("diagnostics.perfConcTargetFallback"));
    }
  };
  modeEl?.addEventListener("change", apply);
  apply();
  return apply;
}

/** 初始化性能面板（基准三模式 / 加载剖析） */
export function initPerfPanel(root: ShadowRoot, esc: EscFn): void {
  bindPerfCopyHandlers(root);
  // 预填「最近选中模型」（ADR-221 model-path-store）：消除小白手输绝对路径的劝退门槛——
  // 树里点过的模型直接进输入框，一键 Run。仅在框为空时填，不覆盖用户已输入/已回填的值；
  // 无选中（null）不动。路径为树 data-fullpath 的磁盘绝对路径，正是 Go single-bench 期望的 --model 口径。
  const modelInput = root.getElementById("diag-perf-model") as HTMLInputElement | null;
  const lastModel = getLastModelPath();
  if (modelInput && !modelInput.value.trim() && lastModel) modelInput.value = lastModel;
  root.getElementById("diag-perf-run")?.addEventListener("click", () => runSingleBench(root, esc));
  // 目标集选择器选项来自 Go/registry（前端不写死类型表）；注册表不可用时静默回落静态首项旧行为
  // 填充后同步基准控件可用性（选项变化不影响当前值，但仍以填充后的值为准）
  // 目标集 / 排序 single 与 conc **共用同一份**（ADR-278 §2.2，落实 ADR-262「跨命令同名同义，
  // 不写第二份」）：故只有这一次填充（includeModel=true —— 单模型选项只在单模型模式可选，
  // 由 initPerfMode 在切到并发 / 引擎对照时禁用）。
  const applyPerfMode = initPerfMode(root);
  void populatePerfTargetOptions(root, "diag-perf-rtype", true).then(() => {
    syncPerfBaselineControls(root);
    // 填充会重建 <option>，单模型选项的 disabled 随之丢失 → 重放一次模式态
    applyPerfMode();
  });
  // 基准三件套只在单模型目标集可用（ADR-262 D8）：Go 对 target≠model 的基准参数是**明确拒绝**的
  root
    .getElementById("diag-perf-rtype")
    ?.addEventListener("change", () => syncPerfBaselineControls(root));
  syncPerfBaselineControls(root);
  // 并发基准（ADR-262 D5）：加速比只有 Go 量得到，前端只提交参数 + 渲染结构化载荷
  root
    .getElementById("diag-perf-conc-run")
    ?.addEventListener("click", () => void runConcurrentBench(root, esc));
  // 扫描引擎对照（ADR-262 D3）：Go/Rust 对照的实测归属归 Go，前端只提交迭代次数 + 渲染载荷
  root
    .getElementById("diag-perf-scan-bench")
    ?.addEventListener("click", () => void runScanBench(root, esc));
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}

/** 供测试与外部装配复用的目标集选择器填充（facade 对外出口） */
export { populatePerfTargetOptions };
