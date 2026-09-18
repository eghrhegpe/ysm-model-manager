// ===== 诊断页：性能面板 — single-bench（结构化 JSON → 7 阶段耗时柱状图）=====
// 数据来源：Go CLI single-bench --format json 的结构化载荷（ADR-200 D2），直接读 data.stages。
//
// 2026-09-17 收口（性能可观测性切片 1）：此前用正则解析**中文人类文案**
// （`/⏱️\s*总耗时.*?([\d.]+)ms/` + 硬编码锚点 BENCH_TOTAL_LABEL = "总计"），
// 与同页 gui-flow 的结构化消费范式双轨；而 Go 侧 `--format json`（注释自称 "AI 友好"）
// 早已存在。同时把 total 口径改为「累计 + 单次平均」双显——旧 UI 把 N 次迭代的累计墙钟
// 当成「一次加载总耗时」展示，正是「6ms 谁信」的机制性来源之一。
// 阶段状态（bottleneck/warn/slow/ok）由 Go stageStatus 单一口径给出，前端不再自算阈值。

import { t } from "@/core/i18n/t.ts";
import type { CLIArgs } from "@/services/cli-bridge.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import {
  type CLIResp,
  errorHTML,
  getOutBox,
  sectionHeader,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
} from "./perf-common.ts";
import {
  PERF_RTYPE_ALL,
  PERF_RTYPE_TOP,
  type PerfMatrixPayload,
  renderPerfMatrix,
} from "./perf-matrix-render.ts";
import { renderPerfTrendSection, savePerfRecord } from "./perf-trend.ts";

// 代际守卫（ADR-230）：single-bench 命令可并发/快速连点，旧响应后到会覆盖新响应
const perfSingleGuard = createLoadGuard();

/** 阶段条目（字段与 go/cli/bench_concurrent.go 的 benchStageJSON 逐字对齐） */
interface SingleBenchStage {
  name: string;
  ms: number;
  bytes?: number;
  /** Go stageStatus 口径：bottleneck / warn / slow / ok / failed（failed 优先于耗时分级） */
  status: string;
  bottleneck: boolean;
  note?: string;
  /** 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）；旧版 Go 载荷缺省，按可选处理 */
  runtime?: string;
  /** 样本统计（ADR-262 D2）：n = 该阶段实际出现次数（阶段可因失败缺席某轮），非迭代轮数 */
  stats?: { n: number; median_ms: number; p95_ms: number };
}

/** 身份块（ADR-262 D2）：registry 类型 id + 相对路径限定 —— 报告靠它分辨真实场景类别 */
interface PerfIdentity {
  /** registry 类型 id（ysm / EntityPlayer / resourcepack / …）；容器兜底为 container */
  rtype: string;
  /** 判定来源：location（祖先目录归属）| extension（扩展名消歧）| container（容器兜底） */
  rtype_source: string;
  /** registry 显示名（如「YSM 模型」）；由 Go 给出，前端不建类型映射 */
  rtype_label?: string;
  filesRoot?: string;
  /** 相对仓库根，跨机器可比（测试/AI 断言用这个，不用 absPath） */
  relPath: string;
  absPath: string;
  /** 模型形态：dir（解包目录，入口 <dir>/ysm.json）| file（打包容器/单文件） */
  form?: "file" | "dir";
}

/** Go singleBenchJSON 载荷（附 AttachSidecar 注入的 output/filesRoot，ADR-200 D5） */
interface SingleBenchPayload {
  model: string;
  iterations: number;
  /** N 次迭代累计墙钟 */
  total_ms: number;
  /** 单次平均（累计 / 迭代次数）——「加载一次多久」看这个 */
  per_iteration_ms: number;
  stages: SingleBenchStage[];
  bottleneck: string;
  format: string;
  size_bytes?: number;
  /** 身份块；旧版 Go 载荷缺省（前端按可选处理并回落 format 标签） */
  identity?: PerfIdentity;
  /** 基准对比/保存结果（ADR-262 D8）；旧版 Go 载荷缺省，按可选处理 */
  baseline?: PerfBaselineBlock;
  /** 人类可读原文（复制/AI 直读用） */
  output?: string;
}

/** 单阶段对比明细（字段与 go/cli/bench_baseline.go 的 perfBaselineStageDiff 逐字对齐） */
interface PerfBaselineStageDiff {
  name: string;
  /** 基准侧耗时；无基准（verdict=new）时为 0 */
  base_ms: number;
  now_ms: number;
  /** 相对变化百分比；noise/new 时为 0（Go 不编造无意义的百分比） */
  delta_pct: number;
  /** regressed | slower | ok | faster | noise | new（）——判据全在 Go，前端只映射 emoji/配色 */
  verdict: string;
}

/** 一次基准对比的判决（字段与 go/cli/bench_baseline.go 的 perfBaselineDiff 逐字对齐） */
interface PerfBaselineDiff {
  /** 基准文件路径（显式路径或标准基准槽） */
  path: string;
  threshold_pct: number;
  /** 噪声下限（ms）：低于它的抖动不判退化——两层保护里的绝对量标准 */
  noise_floor_ms: number;
  /** ok | regressed（整体判决） */
  verdict: string;
  /** 退化超阈值的阶段数（Verdict=regressed 的唯一判据） */
  degraded: number;
  stages: PerfBaselineStageDiff[];
}

/** 载荷里的基准块：保存去向 / 对比判决 / 不可用原因，三者各自独立 */
interface PerfBaselineBlock {
  /** 本次写入的基准文件；缺席 = 未保存 */
  saved_to?: string;
  /** 本次对比判决；缺席 = 未对比（含**没比成**：此时看 error） */
  diff?: PerfBaselineDiff;
  /** 基准不可用的结构化原因 token（D-7）：missing / unreadable / invalid / slot_unavailable */
  error?: string;
  /** 中文细节（含本机绝对路径与 CLI 口令）：**只进 title**，不上屏（本地化界面不该出现未翻译中文） */
  detail?: string;
}

/** 基准参数（仅单模型模式有意义）：路径策略归 Go，前端只传基准槽哨兵 */
type BaselineSlot = "default";

/** 单模型基准参数（键名与 Go ParamSpec 逐字对齐） */
type SingleBenchParams = CLIArgs & {
  model: string;
  iterations: number;
  /** 结构化载荷开关；Go 侧 text/json 双模式共用同一采集路径 */
  format: "json";
  /** 对比基准（值 = 基准槽哨兵，实际文件路径由 Go 解析） */
  baseline?: BaselineSlot;
  /** 记录基准（值 = 基准槽哨兵） */
  "save-baseline"?: BaselineSlot;
  /** 退化阈值百分比；仅在对比时传（Go 侧矩阵模式明确拒绝基准参数） */
  threshold?: number;
};

/** 基准入口三件套（勾选状态）；矩阵模式下控件被禁用，这三个值不参与参数 */
interface BenchBaselineOpts {
  save: boolean;
  compare: boolean;
  threshold: number;
}

/** 运行模式：单模型（按路径）/ 单类型矩阵 / 全类型矩阵 / 全库前 N 大（ADR-262 D3 三种目标集） */
type BenchMode =
  | { kind: "model"; model: string; iterations: number; baseline: BenchBaselineOpts }
  | { kind: "rtype"; rtype: string; maxModels: number; iterations: number }
  | { kind: "all"; maxModels: number; iterations: number }
  | { kind: "top"; topLargest: number; iterations: number };

function singleBenchReadIterations(root: ShadowRoot): number {
  const raw = (root.getElementById("diag-perf-iter") as HTMLInputElement | null)?.value ?? "3";
  return Math.max(1, parseInt(raw, 10) || 3);
}

function singleBenchReadMaxModels(root: ShadowRoot): number {
  const raw = (root.getElementById("diag-perf-max") as HTMLInputElement | null)?.value ?? "5";
  return Math.max(1, parseInt(raw, 10) || 5);
}

/**
 * 读取基准勾选状态（ADR-262 D8）。控件缺席时按「未启用」处理（旧版 DOM/测试夹具宽容）。
 * 阈值下限 1%——0 或负数会把任何抖动都判成退化（Go 侧虽然只判 `ratio > threshold`，
 * 前端仍应在入口拦住手输的 0，避免「一跑就红」的假失败）。
 */
function singleBenchReadBaseline(root: ShadowRoot): BenchBaselineOpts {
  const save =
    (root.getElementById("diag-perf-baseline-save") as HTMLInputElement | null)?.checked ?? false;
  const compare =
    (root.getElementById("diag-perf-baseline-compare") as HTMLInputElement | null)?.checked ??
    false;
  const raw =
    (root.getElementById("diag-perf-baseline-th") as HTMLInputElement | null)?.value ?? "50";
  return { save, compare, threshold: Math.max(1, parseInt(raw, 10) || 50) };
}

/**
 * 基准控件与矩阵模式互斥（ADR-262 D8）：Go 侧矩阵模式**明确拒绝**基准参数（基准是单模型概念）。
 * 选中类型/全部类型时禁用三件套——「被禁用」比「勾了却没生效」诚实（后者是被吞参数）。
 *
 * 同一入口顺带同步「条数」控件的**标签语义**：`#diag-perf-max` 在矩阵模式下是「每类上限」、
 * 在前 N 大模式下是 N。标签不跟着换，界面就在骗人（控件名与它实际含义不符）。
 */
export function syncPerfBaselineControls(root: ShadowRoot): void {
  const rtype =
    (root.getElementById("diag-perf-rtype") as HTMLSelectElement | null)?.value.trim() ?? "";
  const isMatrix = rtype !== "";
  for (const id of [
    "diag-perf-baseline-save",
    "diag-perf-baseline-compare",
    "diag-perf-baseline-th",
  ]) {
    const el = root.getElementById(id) as HTMLInputElement | null;
    if (el) el.disabled = isMatrix;
  }
  syncPerfCountLabel(root, rtype);
}

/** 条数控件的标签按模式切换：前 N 大 → 「前 N 大」，其余（单模型 / 矩阵）→ 「每类上限」。 */
function syncPerfCountLabel(root: ShadowRoot, rtype: string): void {
  const label = root.getElementById("diag-perf-max-label");
  if (!label) return;
  label.textContent = t(
    rtype === PERF_RTYPE_TOP ? "diagnostics.perfTopLargestCount" : "diagnostics.perfMaxModels",
  );
}

/**
 * 读取运行模式：类型选择器为空 → 单模型（需路径）；`__all__` → 全类型矩阵；`__top__` → 全库前 N 大；其余 → 该类型矩阵。
 * 返回 null 表示参数不合法（调用方渲染提示），不在此处静默取默认值。
 */
function singleBenchReadMode(root: ShadowRoot): BenchMode | null {
  const iterations = singleBenchReadIterations(root);
  const rtype =
    (root.getElementById("diag-perf-rtype") as HTMLSelectElement | null)?.value.trim() ?? "";
  if (rtype === PERF_RTYPE_ALL) {
    return { kind: "all", maxModels: singleBenchReadMaxModels(root), iterations };
  }
  if (rtype === PERF_RTYPE_TOP) {
    // 「每类上限」输入框在此模式下语义是「前 N 大」的 N——复用同一控件，不另开数字输入
    return { kind: "top", topLargest: singleBenchReadMaxModels(root), iterations };
  }
  if (rtype) {
    return { kind: "rtype", rtype, maxModels: singleBenchReadMaxModels(root), iterations };
  }
  const model =
    (root.getElementById("diag-perf-model") as HTMLInputElement | null)?.value.trim() ?? "";
  if (!model) return null;
  return { kind: "model", model, iterations, baseline: singleBenchReadBaseline(root) };
}

/**
 * 矩阵载荷守卫：形状不对即返回 null（同单模型载荷口径，不做 `as` 断言穿透）。
 * 只要 `spec.types` 与 `models` 齐备即可渲染——`models` 允许为空（走显式空态）。
 */
function singleBenchParseMatrix(resp: CLIResp): PerfMatrixPayload | null {
  if (resp.status !== "success") return null;
  const data = resp.data as Partial<PerfMatrixPayload> | undefined;
  if (!data?.spec || !Array.isArray(data.spec.types) || !Array.isArray(data.models)) {
    return null;
  }
  return data as PerfMatrixPayload;
}

/**
 * 结构化载荷守卫：形状不对即返回 null，由调用方走错误分支。
 * 不做 `as` 断言穿透——桥另一侧是不可信字符串，形状必须显式校验（同 cli-bridge 协议边界口径）。
 *
 * ⚠️ **不要求 `status === "success"`**（ADR-262 D8，2026-09-18）：基准对比判「退化」时
 * Go 返回 error 状态，但载荷已随 SetResult 交出（规律六）。若在此拦掉，UI 上「退化」只剩
 * 一句错误文案，用户看不到哪个阶段变慢——「永远没有好还是坏的判定」等于没修。
 * 非基准类错误（命令失败/绑定错误）的 data 形状不成立，下面的显式校验自然会拒绝它。
 * 调用方在 status=error 时额外渲染错误横幅，两者叠加（见 runSingleBench）。
 */
function singleBenchParsePayload(resp: CLIResp): SingleBenchPayload | null {
  const data = resp.data as Partial<SingleBenchPayload> | undefined;
  if (!data || !Array.isArray(data.stages) || typeof data.total_ms !== "number") return null;
  if (typeof data.per_iteration_ms !== "number") return null;
  // iterations >= 1：全零空载荷（stages=[] / total_ms=0 / iterations=0）不得被当成实测
  // （诚实红线「空模型数据不得当实测」；identityOnlyPayload 正是这个形状）。
  if (typeof data.iterations !== "number" || data.iterations < 1) return null;
  for (const s of data.stages) {
    if (typeof s?.ms !== "number" || typeof s?.name !== "string") return null;
  }
  // 基准块是**嵌套**结构，形状校验得下探一层：畸形 `diff.stages` 会在渲染期的 .map 抛错，
  // 整块结果被 setErrorCatch 的兜底文案覆盖——数字明明已经拿到了。
  // Go 当前恒给数组，但桥另一侧不可信是本文件的一贯口径（宁可拒绝，不 `as` 穿透）。
  const bl = data.baseline as { saved_to?: unknown; diff?: { stages?: unknown } } | undefined;
  if (bl !== undefined) {
    if (bl === null || typeof bl !== "object") return null;
    if (bl.diff !== undefined && !Array.isArray(bl.diff.stages)) return null;
  }
  return data as SingleBenchPayload;
}

/** Go stageStatus token → 展示（emoji 无语种差异；颜色复用既有 perf-bar-* 类，阈值不在前端重算） */
const STAGE_STATUS_META: Record<string, { icon: string; cls: string }> = {
  bottleneck: { icon: "🔴", cls: "perf-bar-danger" },
  warn: { icon: "🟡", cls: "perf-bar-warn" },
  slow: { icon: "🟢", cls: "" },
  ok: { icon: "✅", cls: "" },
  // failed 由 Go 在「阶段失败」时优先于耗时分级给出（失败常是 0ms，按 ms 分级会误判 ok）
  failed: { icon: "❌", cls: "perf-bar-danger" },
};

function singleBenchStageMeta(status: string): { icon: string; cls: string } {
  return STAGE_STATUS_META[status] ?? { icon: "⚪", cls: "" };
}

/**
 * 基准对比判决 token → 展示（ADR-262 D8）。判据（阈值/两层噪声下限）全在 Go，
 * 前端只做 emoji/配色映射——同 STAGE_STATUS_META 口径，**不得重算阈值**。
 * noise/new 在 Go 侧就不是「判退化」，故标灰、压低视觉权重。
 */
const BASELINE_VERDICT_META: Record<string, { icon: string; cls: string }> = {
  regressed: { icon: "🔴", cls: "perf-bar-danger" },
  slower: { icon: "🟡", cls: "perf-bar-warn" },
  ok: { icon: "✅", cls: "" },
  faster: { icon: "🟢", cls: "" },
  noise: { icon: "⚪", cls: "perf-bl-muted" },
  new: { icon: "🆕", cls: "perf-bl-muted" },
};

/**
 * 渲染基准块（保存去向 + 逐阶段判决）。
 * 未用基准参数时 `bl` 为 undefined → 返回空串（零存在感，不凭空出现空框）。
 * 三个子块各自独立：只保存（saved_to）、只对比（diff）、先比后存（GUI 勾两个），
 * 或**比不成**（error token，D-7：本地化文案由横幅说，块内不重复）。
 */

/** 基准不可用 token → i18n 键（D-7）。未知 token 落到通用句，绝不把 Go 中文散文当兜底文案上屏 */
const BASELINE_ERR_KEYS: Record<string, string> = {
  missing: "diagnostics.perfBaselineErrMissing",
  unreadable: "diagnostics.perfBaselineErrUnreadable",
  invalid: "diagnostics.perfBaselineErrInvalid",
  slot_unavailable: "diagnostics.perfBaselineErrSlotUnavailable",
};

/**
 * 基准不可用时的错误横幅（D-7）。
 * 立因：这些原因此前只以中文散文出现在 `resp.error.message` 里（含本机绝对路径与
 * `--save-baseline` 口令），GUI 原样上屏 → 英文/日文界面出现未翻译中文 + 泄露用户机器路径。
 * 现在：token → 本地化句子；Go 给的中文细节只进 `title`（想看细节的人还能看到，但不占版面）。
 * `saved_to` 同时存在说明「本次已记录、下次即可对比」——同一句里带上，避免指引用户去做刚做完的事。
 */
function baselineBannerHTML(bl: PerfBaselineBlock | undefined, resp: CLIResp, esc: EscFn): string {
  const token = bl?.error;
  if (!token) {
    // 非基准类错误（参数错 / 模型不存在等）仍由 Go 的原话负责，前端不臆造
    return errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc);
  }
  const key = BASELINE_ERR_KEYS[token] as Parameters<typeof t>[0] | undefined;
  const msg = key ? t(key) : t("diagnostics.perfBaselineErrUnknown");
  const savedNote = bl?.saved_to ? ` ${t("diagnostics.perfBaselineErrSavedNote")}` : "";
  // detail 进 title：中文细节（含路径）供追问，正文保持本地化
  const title = bl?.detail ? ` title="${esc(bl.detail)}"` : "";
  return `<div class="diag-stat diag-stat-error"${title}>${UI_ICONS.error} ${esc(msg + savedNote)}</div>`;
}
// singleBenchRenderBaseline 渲染基准块（保存去向 + 逐阶段判决；比不成时只有横幅说话）。
function singleBenchRenderBaseline(bl: PerfBaselineBlock | undefined, esc: EscFn): string {
  if (!bl) return "";
  // 保存去向：注意路径可能很长（用户配置根）→ 正文只说「已记录」，路径进 title
  const saved = bl.saved_to
    ? `<div class="perf-total" title="${esc(bl.saved_to)}">${UI_ICONS.clipboard} ${esc(t("diagnostics.perfBaselineSavedTo"))}</div>`
    : "";
  const diff = bl.diff;
  if (!diff) return saved;

  const regressed = diff.verdict === "regressed";
  const summary = regressed
    ? t("diagnostics.perfBaselineSummaryRegressed", {
        count: String(diff.degraded),
        threshold: String(diff.threshold_pct),
      })
    : t("diagnostics.perfBaselineSummaryOk", { threshold: String(diff.threshold_pct) });
  // title 里带上「跟哪个文件比的」：saved_to 有 title 呈现，判决侧缺失会口径不对称
  // （用户在 GUI 里看不到对比对象，只能用命令行才知道）。
  const judgeHint = `${diff.path}\n${t("diagnostics.perfBaselineJudgeHint", {
    noise: diff.noise_floor_ms.toFixed(1),
  })}`;
  const summaryLine = `<div class="perf-total ${regressed ? "perf-bar-danger" : ""}" title="${esc(
    judgeHint,
  )}">${regressed ? UI_ICONS.warning : UI_ICONS.success} ${esc(summary)}</div>`;

  const rows = diff.stages
    .map((s) => {
      const meta = BASELINE_VERDICT_META[s.verdict] ?? { icon: "⚪", cls: "" };
      // noise/new 的 delta_pct 恒为 0（Go 不编造无意义的百分比）——此时改说原因，不说 0.0%
      const reason =
        s.verdict === "noise"
          ? t("diagnostics.perfBaselineNoiseHint")
          : s.verdict === "new"
            ? t("diagnostics.perfBaselineNewHint")
            : "";
      const deltaText = reason
        ? reason
        : t("diagnostics.perfBaselineDelta", {
            delta: `${s.delta_pct >= 0 ? "+" : ""}${s.delta_pct.toFixed(1)}`,
          });
      return `<div class="perf-bl-row ${meta.cls}">
<span class="perf-bl-name" title="${esc(s.name)}">${esc(s.name)}</span>
<span class="perf-bl-detail">${esc(
        t("diagnostics.perfBaselineBaseToNow", {
          base: s.base_ms.toFixed(2),
          now: s.now_ms.toFixed(2),
        }),
      )}</span>
<span class="perf-bl-delta">${esc(deltaText)}</span>
<span class="perf-bl-mark">${meta.icon}</span>
</div>`;
    })
    .join("");

  return `${saved}${summaryLine}<div class="perf-bl-rows">${rows}</div>`;
}
function singleBenchRenderBars(payload: SingleBenchPayload, esc: EscFn): string {
  const stages = payload.stages;
  let maxMs = 0;
  for (const s of stages) if (s.ms > maxMs) maxMs = s.ms;
  const bars = stages
    .map((s) => {
      const pct = maxMs > 0 ? Math.max(3, Math.round((s.ms / maxMs) * 100)) : 3;
      const meta = singleBenchStageMeta(s.status);
      const noteAttr = s.note ? ` title="${esc(s.note)}"` : "";
      // 运行归属徽标（ADR-262 D2）：没有它就看不出这段跑在 Go 还是 Rust/WASM/Three 上
      const rtTag = s.runtime
        ? `<span class="perf-rt-tag" title="${esc(t("diagnostics.perfStageRuntimeHint"))}">${esc(s.runtime)}</span>`
        : "";
      // 样本统计（ADR-262 D2）：n=1 时 p95 就是那个唯一样本（退化），展示它等于把单样本包装成分布，
      // 故仅在 n>1 时渲染分布；n 始终保留在 title 里供追问「几个样本」。
      const st = s.stats;
      const statsTag =
        st && st.n > 1
          ? `<span class="perf-stats" title="${esc(
              t("diagnostics.perfStageStatsHint", {
                median: st.median_ms.toFixed(2),
                p95: st.p95_ms.toFixed(2),
                n: String(st.n),
              }),
            )}">${esc(t("diagnostics.perfStageStats", { p95: st.p95_ms.toFixed(2), n: String(st.n) }))}</span>`
          : "";
      return `<div class="perf-bar-row"${noteAttr}>
<span class="perf-bar-name" title="${esc(s.name)}">${esc(s.name)}</span>${rtTag}
<span class="perf-bar-track"><span class="perf-bar-fill ${meta.cls}" style="width:${pct}%"></span></span>
<span class="perf-bar-val ${meta.cls}">${s.ms.toFixed(2)}ms ${meta.icon}</span>${statsTag}
</div>`;
    })
    .join("");
  savePerfRecord(stages.map((s) => ({ name: s.name, ms: s.ms })));

  const rawOutput = payload.output ?? JSON.stringify(payload, null, 2);
  // 身份优先（ADR-262 D2）：registry 类型显示名 + 相对路径；format 仅作旧载荷回落
  const id = payload.identity;
  const typeText = id?.rtype_label || id?.rtype || payload.format;
  const labelParts = [t("diagnostics.perfSingleResult")];
  if (typeText) labelParts.push(typeText);
  if (id?.relPath) labelParts.push(id.relPath);
  const label = labelParts.map((s) => esc(s)).join(" · ");
  const totalLine = `<div class="perf-total">${UI_ICONS.clock} ${t("diagnostics.perfTotal")}: ${t(
    "diagnostics.perfTotalDetail",
    {
      avg: payload.per_iteration_ms.toFixed(2),
      n: String(payload.iterations),
      total: payload.total_ms.toFixed(2),
    },
  )}</div>`;
  const bottleneckLine = payload.bottleneck
    ? `<div class="perf-total">${UI_ICONS.warning} ${t("diagnostics.perfBottleneck")}: ${esc(payload.bottleneck)}</div>`
    : "";
  return (
    sectionHeader(UI_ICONS.performance, label, rawOutput) +
    `<div class="perf-bars" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${bars}</div>` +
    totalLine +
    bottleneckLine +
    // 基准判决（ADR-262 D8）：放在瓶颈之后、趋势图之前——「与上次比好还是坏」是结果的一部分
    singleBenchRenderBaseline(payload.baseline, esc) +
    renderPerfTrendSection(esc)
  );
}

/**
 * 结果区整块 HTML = 柱状图 + 基准判决 + （必要时）错误横幅。
 * 单表达式出口的两个理由：① 调用点一处收敛，未知状态分支不会再漏渲染判决；
 * ② 避开 R8「innerHTML 拼接非字面量」启发式——两个操作数**都已转义**
 *   （bars 内部逐值 esc，banner 由 errorHTML 转义），拼接不是漏洞。
 */
function singleBenchRenderResult(payload: SingleBenchPayload, banner: string, esc: EscFn): string {
  return singleBenchRenderBars(payload, esc) + banner;
}

export async function runSingleBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfSingleGuard.next();
  const out = getOutBox(root, "diag-perf-single");
  if (!out) return;
  const mode = singleBenchReadMode(root);
  if (!mode) {
    setErrorMsg(out, t("diagnostics.perfModelRequired"), esc);
    return;
  }
  setBusy(out);
  try {
    if (mode.kind === "model") {
      // 基准参数只组装「勾了的」（ADR-262 D8）：路径传哨兵 default，实际文件由 Go 解析
      // （前端不编路径——与「类型判定唯一事实源在 Go」同一条职责红线）。
      const baseArgs: SingleBenchParams = {
        model: mode.model,
        iterations: mode.iterations,
        format: "json",
      };
      if (mode.baseline.compare) {
        baseArgs.baseline = "default";
        baseArgs.threshold = mode.baseline.threshold;
      }
      if (mode.baseline.save) baseArgs["save-baseline"] = "default";
      const resp = await executeCLI("single-bench", baseArgs);
      if (perfSingleGuard.stale(gen)) return;
      const payload = singleBenchParsePayload(resp);
      if (!payload) {
        renderBenchFailure(out, resp, esc);
        return;
      }
      // 载荷 + 错误横幅叠加（规律六）：基准对比判「退化」时 Go 返回 error 状态，
      // 但数字是实测的、判决是结构化的——两者都要给，不能因为状态是 error 就把结果丢掉。
      // 另一类 error（基准文件还没记录过）同样如此：载荷照显，另加一句说明缺什么。
      // 基准不可用时（D-7）横幅说**本地化**的人话：token → i18n，Go 的中文细节只进 title。
      // 非基准类错误仍照原样转述 Go 原话（前端不臆造原因）。
      const banner = resp.status === "error" ? baselineBannerHTML(payload.baseline, resp, esc) : "";
      out.innerHTML = singleBenchRenderResult(payload, banner, esc);
      return;
    }

    // 目标集四选一（ADR-262 D3）：目标集归 Go；前端只提交「选谁 + 几条 + 迭代」。
    // 三种矩阵类模式互斥（Go 对组合直接报错），故参数各自独立、绝不叠加：前 N 大带
    // rtype/all-types 是 Go 明确的互斥参数，带 max-models 则与「N 就是条数」自相矛盾。
    const args =
      mode.kind === "all"
        ? {
            "all-types": true,
            "max-models": mode.maxModels,
            iterations: mode.iterations,
            format: "json",
          }
        : mode.kind === "top"
          ? {
              "top-largest": mode.topLargest,
              iterations: mode.iterations,
              format: "json",
            }
          : {
              rtype: mode.rtype,
              "max-models": mode.maxModels,
              iterations: mode.iterations,
              format: "json",
            };
    const resp = await executeCLI("single-bench", args);
    if (perfSingleGuard.stale(gen)) return;
    const matrix = singleBenchParseMatrix(resp);
    if (!matrix) {
      renderBenchFailure(out, resp, esc);
      return;
    }
    out.innerHTML = renderPerfMatrix(matrix, esc);
  } catch (e) {
    if (perfSingleGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}

/** 载荷不可用时的统一失败渲染：命令成功但形状不对 = 契约漂移，比"执行失败"更值得暴露。 */
function renderBenchFailure(out: HTMLElement, resp: CLIResp, esc: EscFn): void {
  if (resp.status === "success") {
    setErrorMsg(out, t("diagnostics.perfFail"), esc);
    return;
  }
  setErrorResp(out, resp, esc);
}
