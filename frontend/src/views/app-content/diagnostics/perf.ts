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
import type { EscFn } from "@/utils/html/html.ts";
import { bindPerfCopyHandlers, readActiveBenchMode } from "./perf-common.ts";
import { concReadIds, runConcurrentBench } from "./perf-concurrent.ts";
import { PERF_TARGET_REPO, populatePerfTargetOptions } from "./perf-matrix-render.ts";
import { runScanBench, scanBenchReadIds } from "./perf-scan-bench.ts";
import { runSingleBench, singleBenchReadIds } from "./perf-single-bench.ts";
import { renderLoadTraceSection } from "./perf-trace.ts";

export { renderLoadTraceSection } from "./perf-trace.ts";

const _perfModelSync = new Map<ShadowRoot, () => void>();
/** root → 模式重放函数（initPerfPanel 装配；applyPerfModeUI 是 bench pill 切换的唯一入口） */
const _perfModeApply = new WeakMap<ShadowRoot, () => void>();

/**
 * 基准模式的 i18n 接线单点（ADR-278 §2.6）：模式 → 文案键的**唯一事实源**。
 * 维护约定：新增模式只改下面三张表 + 补一个 `perfModeName*`，**禁止**再为某模式开平行
 * 后缀键（如 perfScopeHintXxx）——那会把「加一个模式 = 改 N 处」的债重新养回来。
 * （表内只列**读共享控件的模式**——scan 自 ADR-300 §2.1 起是 bench 组第三子 pill，
 *  行可见性上轴、参数面仍不碰共享控件（公共区在 scan 下整行退场，ADR-278 §2.7 内容判据
 *  原样成立），故不入派生面，其 hint 由 tpl 直写 perfScanBenchHint。）
 */
const PERF_MODE_NAMES: Record<string, LocaleKey> = {
  single: "diagnostics.perfModeNameSingle",
  conc: "diagnostics.perfModeNameConc",
};

/**
 * ADR-278-d1：原 PERF_UNREAD_MODES / PERF_UNREAD_TARGETS 两张手工登记表已退役——
 * 「载荷实测读哪些控件」由 read* 的 collector 读路径自答（singleBenchReadIds /
 * concReadIds / scanBenchReadIds），apply 据此派生 disabled。表是真相的镜像、
 * 镜像必漂移；读点即真相。「控件行禁加 class 供字符串反查」的旧纪律亦随对账护栏取代
 * （perf-mode.test 改验 apply 产出 === 读集快照）。
 * 基准三件套的双维门禁（ADR-262 D8：模式∧目标集）由「当前状态的真实读路径」自动坍缩
 * 为单维判定（single+model 才读 baseline → 其余态读集自然不含），BASELINE_CONTROL_IDS /
 * syncPerfBaselineControls 一并退役。
 */
/** 运行按钮 id → 其所属模式（scope hint 随此派生，不另写第二份） */
export const PERF_RUN_BUTTON_MODE_KEYS: Record<string, string> = {
  "diag-perf-run": "single",
  "diag-perf-conc-run": "conc",
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
  // （scan 不再有机制长句分支：§2.7 退轴后它不在 PERF_RUN_BUTTON_MODE_KEYS 派发面内，
  //  其 tab hint 由 tpl 直写 perfScanBenchHint。未知模式只落通用句。）
  return scope;
}

/**
 * 基准模式接线（ADR-278 §2.1 / §2.3 × ADR-300 §2.2）：bench 组三 pill（单模型 / 批量并发 /
 * 引擎对照）三选一，只呈现该模式那一套控件。模式源 = 子 pill 行 `data-active-sub`，
 * 唯一读出口 readActiveBenchMode（原 #diag-perf-mode 下拉已退役）。
 *
 * 显隐走 **class**（`.perf-mode-off`）而非 inline style：bindSubBar 的子面板显隐用的是
 * inline `display`，两种机制作用对象不重叠（bench 组无 data-sub-pane，行门控独此一家）——
 * 互不覆盖，各司其职（ADR-278 §2.4 的口径随模式源迁移原样成立）。
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
  const apply = (): void => {
    const mode = readActiveBenchMode(root);
    root.querySelectorAll<HTMLElement>("[data-perf-mode]").forEach((el) => {
      const modes = (el.dataset.perfMode ?? "").split(/\s+/);
      el.classList.toggle("perf-mode-off", !modes.includes(mode));
    });
    // ===== ADR-278 §2.6 语义诚实层（显示维，ADR-278-d1 明令不动）：同控件跨模式改义，当场说清 =====
    const iterLabel = root.getElementById("diag-perf-iter-label");
    if (iterLabel) {
      iterLabel.textContent = t("diagnostics.perfIterations"); // 跑几次 = 重复跑几轮，不再按模式拼后缀（原 PERF_ITER_SUFFIX_KEYS 随改名退役）
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
    // ===== 控件门禁派生化（ADR-278-d1，取代原 §2.6 三修/六修的两张手工登记表）=====
    // 「载荷实测读哪些控件」不再由 PERF_UNREAD_MODES / PERF_UNREAD_TARGETS / BASELINE_CONTROL_IDS
    // 三份表转述，而是**跑当前状态的真实读路径**（纯读：零 RPC、零写 DOM、幂等）取读集快照。
    // conc 回落必须先于读快照：值改回 repo 后读集自然不含 model——原「单模型选项在 conc 不可选」
    // 由读取路径本身表达，不再是 apply 里的特判。
    const targetEl = root.getElementById("diag-perf-rtype") as HTMLSelectElement | null;
    if (mode === "conc" && targetEl && targetEl.value.trim() === "") {
      targetEl.value = PERF_TARGET_REPO;
      // 静默改用户的选择是欺骗：发生了什么要当场说（重放时值已回落，不重复弹）
      toast(t("diagnostics.perfConcTargetFallback"));
    }
    const readIds =
      mode === "conc"
        ? concReadIds(root)
        : mode === "scan"
          ? scanBenchReadIds(root)
          : singleBenchReadIds(root);
    // 门禁枚举面 = 面板内**所有** `diag-perf-*` 的 input/select（运行按钮/label/结果容器
    // 不进门禁账，与原大刀护栏同口径）。枚举**不依赖 DOM 落位**（不按 [data-perf-mode] 行筛）——
    // 读点即真相，控件挂在行内还是行外都归门禁管：曾按行筛会漏掉不在任何 data-perf-mode 行里的
    // 控件（perf.test 夹具的基准框即如此），那正是本刀要消灭的「门禁与 DOM 布局耦合」。
    // disabled 是**赋值式**：从 true 回 false 也覆盖，读集就是全部真相。
    const controls = new Set<HTMLInputElement | HTMLSelectElement>();
    root
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input[id^="diag-perf-"], select[id^="diag-perf-"]',
      )
      .forEach((el) => {
        controls.add(el);
      });
    for (const el of controls) {
      el.disabled = !readIds.has(el.id);
    }
    // 「为什么禁」要当场说清，不能只留一个灰控件：title 随禁用原因切换
    const maxEl = root.getElementById("diag-perf-max") as HTMLInputElement | null;
    if (maxEl) {
      maxEl.title = maxEl.disabled
        ? t("diagnostics.perfMaxUnreadHint")
        : t("diagnostics.perfMaxModelsHint");
    }
    const modelEl = root.getElementById("diag-perf-model") as HTMLInputElement | null;
    if (modelEl) {
      const modelInputNeeded = readIds.has("diag-perf-model");
      modelEl.title = modelInputNeeded
        ? t("diagnostics.perfModelHintFromTree")
        : t("diagnostics.perfModelUnreadHint");
    }

    const modelOpt = Array.from(targetEl?.options ?? []).find((o) => o.value === "");
    if (modelOpt) modelOpt.disabled = mode !== "single";
  };
  apply();
  return apply;
}

/** bench 模式的外界重放入口（ADR-300 §2.2）：bench 组 bindSubBar 的 onSwitch 是唯一消费者——
 *  pill 点击已写好 data-active-sub，这里读取并重放行门控 / 控件门禁 / 标签改写。未装配即调用 = 无操作。 */
export function applyPerfModeUI(root: ShadowRoot): void {
  _perfModeApply.get(root)?.();
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
      // 模式唯一读出口；夹具/异常态无 pill 行时兜底 single，不因 DOM 缺失而静默不填充
      if (readActiveBenchMode(root) !== "single") return; // 并发 / 引擎对照无模型路径输入框
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
  _perfModeApply.set(root, applyPerfMode); // bench pill 切换经 applyPerfModeUI 重放（ADR-300 §2.2）
  // ADR-278-d1：基准控件可用性不再由 syncPerfBaselineControls 独立判定——apply 每次重放都会
  // 跑当前状态的真实读路径、重算全部控件 disabled（含基准三件套），三处旧调用收敛为 applyPerfMode。
  void populatePerfTargetOptions(root, "diag-perf-rtype", true).then(() => {
    // 填充会重建 <option>，单模型选项的 disabled 随之丢失 → 重放一次模式态（读集也随新 option 值重取）
    applyPerfMode();
  });
  root.getElementById("diag-perf-rtype")?.addEventListener("change", () => {
    applyPerfMode(); // 目标集维度变化：读路径分叉不同，必须重跑读快照（single+model vs 目标集）
  });
  // 并发基准（ADR-262 D5）：加速比只有 Go 量得到，前端只提交参数 + 渲染结构化载荷
  root
    .getElementById("diag-perf-conc-run")
    ?.addEventListener("click", () => void runConcurrentBench(root, esc));
  // 扫描引擎对照（ADR-278 §2.7 内容判据 × ADR-300 §2.1：现为 bench 组第三子 pill，
  // 独立参数面随 data-perf-mode="scan" 显隐）：Go/Rust 对照的实测归属归 Go，
  // 前端只提交迭代次数 + 渲染载荷
  root
    .getElementById("diag-perf-scan-bench")
    ?.addEventListener("click", () => void runScanBench(root, esc));
  // 加载剖析刷新：ADR-300 §2.2 起 record/trace 降级为 **logs 组**第三 pill，id 跟着落户
  // logs（原 diag-perf-refresh-trace 是 tab 还在 bench 那会儿的名字，留在 logs 组是误导）
  root
    .getElementById("diag-trace-refresh")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
}

/** 供测试与外部装配复用的目标集选择器填充（facade 对外出口） */
export { populatePerfTargetOptions };
