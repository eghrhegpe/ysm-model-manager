// ===== 诊断页：性能面板入口（facade）=====
// 职责：事件接线 + 对外 API re-export，业务逻辑已拆至：
//   - perf-common.ts      ：共享工具层（sectionHeader / 守卫 / 错误辅助 / 复制委托）
//   - perf-single-bench.ts：single-bench（结构化载荷消费 + 柱状图 + 趋势图 + 矩阵分发）
//   - perf-matrix-render.ts：目标集渲染（--target rtype/all/repo 三种目标集载荷同形 + 体量口径回显）
//   - perf-scan-bench.ts  ：scan-bench（Go/Rust 扫描引擎对照，未采集不填 0ms）
//   - perf-trace.ts       ：加载剖析（load-trace store 消费）
// ADR-040 拆分后每文件 ≤400 行红线；本文件为薄接线层。

import { bus, type ModelSelectPayload } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { getLastModelPath } from "@/core/model-path-store.ts";
import { toast } from "@/utils/dom/toast.ts";
import type { EscFn } from "./logs.ts";
import { bindPerfCopyHandlers } from "./perf-common.ts";
import { runConcurrentBench } from "./perf-concurrent.ts";
import {
  PERF_TARGET_REPO,
  parsePerfTargetValue,
  populatePerfTargetOptions,
} from "./perf-matrix-render.ts";
import { runScanBench } from "./perf-scan-bench.ts";
import { runSingleBench, syncPerfBaselineControls } from "./perf-single-bench.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

const _perfModelSync = new Map<ShadowRoot, () => void>();

/**
 * 基准模式的 i18n 接线单点（ADR-278 §2.6）：模式 → 文案键的**唯一事实源**。
 * 维护约定：新增模式只改下面三张表 + 补一个 `perfModeName*`，**禁止**再为某模式开平行
 * 后缀键（如 perfScopeHintXxx）——那会把「加一个模式 = 改 N 处」的债重新养回来。
 */
const PERF_MODE_NAMES: Record<string, LocaleKey> = {
  single: "diagnostics.perfModeNameSingle",
  conc: "diagnostics.perfModeNameConc",
  scan: "diagnostics.perfModeNameScan",
};

/** 控件 id → **不读它**的模式集（真相源 = 各命令模块的 read*：perf-single-bench / perf-concurrent）。
 * 未登记 = 所有模式都读；登记了则在列出的模式下置 disabled——
 * 「可见但被忽略」与「同控件跨模式改义」是 §2.6 要清的同一笔账的两面。
 * ⚠️ ADR-278 §2.7：引擎对照已退出模式轴（独立 tab），故本表不再有 scan 列。 */
export const PERF_UNREAD_MODES: Record<string, readonly string[]> = {
  "diag-perf-model": ["conc"],
  "diag-perf-order": [], // 公共区常驻：两种模式都读排序（ADR-278 §2.7 前是 ["scan"]）
  "diag-perf-max": ["conc"],
  "diag-perf-baseline-save": ["conc"],
  "diag-perf-baseline-compare": ["conc"],
  "diag-perf-baseline-th": ["conc"],
  "diag-perf-conc-workers": ["single"],
  "diag-perf-conc-max": ["single"],
};

/** 控件 id → **不读它**的目标集集（第二维，与 PERF_UNREAD_MODES 对称）。
 *  真相源 = `perf-single-bench.ts|singleBenchReadMode`：`target==="model"` 时提前 return，
 *  只读 model / iterations / 基准三件套，`order` 与 `maxModels` 根本不进载荷。
 *  为什么必须成表而不是散在 apply 里：五修穷尽护栏判据是「行归属 ∨ 不读表」，而 max / order
 *  整行可见（行归属 single）却仍不被读——护栏把「可见」误当「被读」。登记成表后护栏可校验，
 *  且这是**默认路径**（新手进 tab 即 single+model），漏判代价最高。 */
export const PERF_UNREAD_TARGETS: Record<string, readonly string[]> = {
  "diag-perf-max": ["model"],
  "diag-perf-order": ["model"],
};

/** 基准三件套 id（双维门禁：模式 ∧ 目标集）——apply 循环跳过、由 syncPerfBaselineControls 兼并判定 */
export const BASELINE_CONTROL_IDS: readonly string[] = [
  "diag-perf-baseline-save",
  "diag-perf-baseline-compare",
  "diag-perf-baseline-th",
];

/** 运行按钮 id → 其所属模式（scope hint 随此派生，不另写第二份） */
export const PERF_RUN_BUTTON_MODE_KEYS: Record<string, string> = {
  "diag-perf-run": "single",
  "diag-perf-conc-run": "conc",
};

/** 迭代标签的模式后缀：只有语义真变的模式才登记（ADR-278 §2.7：scan 已独立成 tab，
 * 它有自己的 #diag-perf-scan-iter 标签，与 single 的框不再是同一个控件）。 */
export const PERF_ITER_SUFFIX_KEYS: Record<string, LocaleKey | undefined> = {
  single: "diagnostics.perfIterationsSuffixSingle",
};

/**
 * 组装运行按钮的 scope hint：短 scope 句（模板插值 mode 名）+ 该模式的既有机制长句。
 * 未知模式只落通用句，不编造。机制句本体仍归各自命令模块消费（perfConcurrentHint /
 * perfScanBenchHint 的接线扫描护栏见 tests/test_cli_gui_flow_contract.ts §3.8）。
 */
export function perfScopeHint(mode: string): string {
  const nameKey = PERF_MODE_NAMES[mode];
  const scope = t("diagnostics.perfScopeHint", { mode: nameKey ? t(nameKey) : mode });
  if (mode === "conc") return `${scope} · ${t("diagnostics.perfConcurrentHint")}`;
  if (mode === "scan") return `${scope} · ${t("diagnostics.perfScanBenchHint")}`;
  return scope;
}

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
      const suffixKey = PERF_ITER_SUFFIX_KEYS[mode];
      iterLabel.textContent = t("diagnostics.perfIterations") + (suffixKey ? t(suffixKey) : ""); // 未知模式回落中性「迭代次数」，不编造后缀
      iterLabel.title = t("diagnostics.perfIterationsHint");
    }
    // 并发下目标集只剩「挑样本范围」语义（单模型选项已禁），标签同步改口
    const targetLabel = root.getElementById("diag-perf-target-label");
    if (targetLabel)
      targetLabel.textContent =
        mode === "conc" ? t("diagnostics.perfTargetSampleRange") : t("diagnostics.perfTarget");
    // 每个运行按钮说清自己测的对象（防把引擎对照误读为「换个方式再测这个模型」）：
    // hint = perfScopeHint 单点组装（短 scope 句 + 既有机制句），接线表见 PERF_RUN_BUTTON_MODE_KEYS。
    for (const [id, modeKey] of Object.entries(PERF_RUN_BUTTON_MODE_KEYS)) {
      const el = root.getElementById(id);
      if (el) el.title = perfScopeHint(modeKey);
    }
    // 载荷不读的控件当场禁用（ADR-278 §2.6 反向半边）：整行隐藏的碰不到，三模式共用行里
    // 「能改却不被读」（如 scan 下的排序）才是欺骗——按 PERF_UNREAD_MODES 单点表置灰。
    // 基准三件套是双维门禁（ADR-262 D8：只在单模型目标集可用），而本函数只知模式维——
    // 委托 syncPerfBaselineControls 兼并两维判定，不在这里另写一份「baseline ∉ 表 → 直接启用」
    // （那会把四修刚拆的同一颗雷从 apply 路径重新埋回来）；其余控件按表置灰。
    for (const [id, unread] of Object.entries(PERF_UNREAD_MODES)) {
      if (BASELINE_CONTROL_IDS.includes(id)) continue;
      const el = root.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.disabled = unread.includes(mode);
    }
    // ===== 目标集维（ADR-278 §2.6 六修）：模式维之外的第二维不读面 =====
    // single 模式默认目标集 = 单模型，此时 singleBenchReadMode 提前 return 根本不读 max / order；
    // 两控件整行可见（行归属 single，模式维护栏判它合格）却不被读 = 默认路径上的欺骗。
    // 与 PERF_UNREAD_MODES 对称成表：真相源仍是 perf-single-bench 的 read*，表只是登记面。
    const targetKey =
      mode === "single" ? (parsePerfTargetValue(targetEl?.value ?? "")?.target ?? "") : "";
    for (const [id, unreadTargets] of Object.entries(PERF_UNREAD_TARGETS)) {
      const el = root.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) continue;
      // 两维**并集**：模式维已在上面的循环置过灰（如 scan 下的 order），这里只叠加、不覆盖
      if (unreadTargets.includes(targetKey)) el.disabled = true;
    }
    // 「为什么禁」要当场说清，不能只留一个灰控件：title 随禁用原因切换
    const maxEl = root.getElementById("diag-perf-max") as HTMLInputElement | null;
    if (maxEl) {
      maxEl.title = maxEl.disabled
        ? t("diagnostics.perfMaxUnreadHint")
        : t("diagnostics.perfMaxModelsHint");
    }
    syncPerfBaselineControls(root);

    const modelOpt = Array.from(targetEl?.options ?? []).find((o) => o.value === "");
    if (modelOpt) modelOpt.disabled = mode !== "single";
    if (mode === "conc" && targetEl && targetEl.value.trim() === "") {
      targetEl.value = PERF_TARGET_REPO;
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
  // 进阶 P2（ADR-221 延伸）：订阅全局「模型选中」总线，进入 bench tab 后再去资源树点模型也实时带入——
  // 比初始化只预填一次更进一步，彻底免手敲路径。仅在 single 模式且输入框为空时带入（不覆盖用户已输入值）；
  // 重复 init 同一 root 按 map 去重，不叠加监听。
  if (modelInput && !_perfModelSync.has(root)) {
    const unsub = bus.on("model:select", (p) => {
      const sel = p as ModelSelectPayload;
      if (sel.isDir) return; // 目录不是可测单模型文件，跳过
      const modeEl = root.getElementById("diag-perf-mode") as HTMLSelectElement | null;
      // 缺省（夹具/异常态无 mode select）按 single 处理，不因 DOM 缺失而静默不填充
      if ((modeEl?.value ?? "single") !== "single") return; // 并发 / 引擎对照无模型路径输入框
      const inp = root.getElementById("diag-perf-model") as HTMLInputElement | null;
      if (inp && !inp.value.trim()) inp.value = sel.path;
    });
    _perfModelSync.set(root, unsub);
  }
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
  root.getElementById("diag-perf-rtype")?.addEventListener("change", () => {
    syncPerfBaselineControls(root);
    applyPerfMode(); // 目标集维度变化需重放：单模型目标下禁用 max / order
  });
  syncPerfBaselineControls(root);
  // 并发基准（ADR-262 D5）：加速比只有 Go 量得到，前端只提交参数 + 渲染结构化载荷
  root
    .getElementById("diag-perf-conc-run")
    ?.addEventListener("click", () => void runConcurrentBench(root, esc));
  // 扫描引擎对照（ADR-278 §2.7：已退出模式轴，在独立 scan tab 内挂线）：
  // Go/Rust 对照的实测归属归 Go，前端只提交迭代次数 + 渲染载荷
  root
    .getElementById("diag-perf-scan-bench")
    ?.addEventListener("click", () => void runScanBench(root, esc));
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}

/** 供测试与外部装配复用的目标集选择器填充（facade 对外出口） */
export { populatePerfTargetOptions };
