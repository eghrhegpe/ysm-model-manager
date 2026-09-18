// ===== 诊断页：性能面板 — concurrent-bench（串行 vs 并行的加速比 + 判决）=====
// 数据来源：Go CLI `concurrent-bench --format json` 的结构化载荷（ADR-262 D1/D5）。
//
// 职责红线（本文件的核心约束）：
//  - **加速比与判决都读 Go 交出的值**。前端不重算 serial/parallel、不重判阈值——
//    重算就等于把阈值维护成两份，两边漂移时「看到的报告」与「载荷」会互相矛盾。
//  - **不给文案做正则反解析**：文本模式是给人看的流式输出，结构化模式才是契约。
//  - 载荷里的 `hints` 是 Go 侧中文散文（未 i18n），**不在界面渲染**（英文/日文界面会出现
//    未翻译中文）；它与 single-bench 的 hints 同口径：结构化保留供 CLI/AI 消费。

import { t } from "@/core/i18n/t.ts";
import type { CLIArgs } from "@/services/cli-bridge.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import {
  errorHTML,
  getOutBox,
  sectionHeader,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
} from "./perf-common.ts";
import {
  PERF_TARGET_REPO,
  type PerfOrder,
  parsePerfTargetValue,
  perfTargetEchoHTML,
  readPerfOrder,
} from "./perf-matrix-render.ts";
import { webGate } from "./web-gate.ts";

// 代际守卫（ADR-230）：快速连点「运行」时旧响应不得覆盖新结果
const perfConcGuard = createLoadGuard();

/** 加速比判决 token（Go 单点 concurrentSpeedVerdict 的取值域） */
type ConcVerdict = "excellent" | "good" | "fair" | "none";

const CONC_VERDICTS: readonly ConcVerdict[] = ["excellent", "good", "fair", "none"];

/** 判决 token → 图标/配色/i18n 键。**阈值一律不回前端**（只映射 Go 给的 token） */
type ConcVerdictKey =
  | "diagnostics.perfConcurrentVerdictExcellent"
  | "diagnostics.perfConcurrentVerdictGood"
  | "diagnostics.perfConcurrentVerdictFair"
  | "diagnostics.perfConcurrentVerdictNone";

const CONC_VERDICT_STYLE: Record<ConcVerdict, { icon: string; cls: string; key: ConcVerdictKey }> =
  {
    excellent: {
      icon: UI_ICONS.success,
      cls: "perf-conc-good",
      key: "diagnostics.perfConcurrentVerdictExcellent",
    },
    good: {
      icon: UI_ICONS.success,
      cls: "perf-conc-good",
      key: "diagnostics.perfConcurrentVerdictGood",
    },
    fair: {
      icon: UI_ICONS.warning,
      cls: "perf-conc-warn",
      key: "diagnostics.perfConcurrentVerdictFair",
    },
    none: {
      icon: UI_ICONS.error,
      cls: "perf-conc-bad",
      key: "diagnostics.perfConcurrentVerdictNone",
    },
  };

/** 参与模型的身份块（Go perfIdentity：relPath 跨机器可比，rtype 由 registry 单点判定） */
interface ConcIdentity {
  relPath?: string;
  rtype?: string;
  rtype_label?: string;
}

interface ConcPhase {
  total_ms?: number;
  per_model_ms?: number;
}

interface ConcWorker {
  workers?: number;
  total_ms?: number;
  speedup?: number;
  verdict?: string;
}

interface ConcFileRead {
  file_count?: number;
  serial_ms?: number;
  parallel_ms?: number;
  speedup?: number;
}

/** concurrent-bench 结构化载荷（字段与 Go concurrentBenchJSON 逐字对齐） */
interface ConcPayload {
  workers?: number;
  max_models?: number;
  /** 目标集 selector（ADR-262 D3 修订）：model/rtype/all/repo——与 single-bench 同名同义 */
  target?: string;
  /** 排序键：path（路径升序）/ size（体量降序） */
  order?: string;
  /** 体量口径 token（**仅 order=size 时出现**）：dir_total = 目录式按目录内容合计、其余按文件大小 */
  size_source?: string;
  /**
   * target=rtype 时回显的**请求类型 id**（与 single-bench 的 `spec.rtype` 对称，Go 顶层字段）。
   *
   * 注意与请求侧的 `ConcParams.rtype` 不是一个方向：这里读的是 Go 交回的事实，界面不许从
   * `models[0].rtype` 反推（空集推不出来，且类型判定的事实源只有 Go / resource_types.json）。
   */
  rtype?: string;
  model_count?: number;
  models?: ConcIdentity[];
  serial?: ConcPhase;
  parallel?: ConcWorker[];
  file_read?: ConcFileRead;
  /** Go 侧中文建议（未 i18n，不渲染，仅供 AI/CLI） */
  hints?: string[];
  /** ADR-200 D5 sidecar：桥注入的原始文本（复制原文用） */
  output?: string;
  filesRoot?: string;
}

type ConcParams = CLIArgs & {
  workers: number;
  /** 目标集 selector（model/rtype/all/repo）：与 single-bench 同一套三旋钮，跨命令同名同义 */
  target: string;
  order: PerfOrder;
  "max-models": number;
  /** target=rtype 时的类型 id（错配的载荷参数 Go 直接报错，故只在那个 selector 下带） */
  rtype?: string;
  format: "json";
};

function concVerdict(v: string | undefined): ConcVerdict {
  // 未知 token 按最保守的「无提升」呈现——宁可显示保守结论，也不假装是优秀（诚实红线）
  return CONC_VERDICTS.includes(v as ConcVerdict) ? (v as ConcVerdict) : "none";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 载荷守卫：显式校验形状（桥数据禁 `as` 断言穿透）。
 * 与 single-bench 同口径：**不要求 status === "success"**——Go 在错误分支同样先 SetResult
 * （规律六），把有效载荷丢掉会让用户看不到已经测出来的数字。
 */
export function concParsePayload(resp: { status?: string; data?: unknown }): ConcPayload | null {
  if (resp.status !== "success" && resp.status !== "error") return null;
  const data = resp.data as ConcPayload | undefined;
  if (!data || typeof data !== "object") return null;
  // 串行段是结果主体；并行档位为空 = 没测到任何东西，不渲染假表
  if (!data.serial || typeof data.serial !== "object") return null;
  if (!isFiniteNumber(data.serial.total_ms)) return null;
  if (!Array.isArray(data.parallel) || data.parallel.length === 0) return null;
  if (!data.parallel.every((p) => p && typeof p === "object" && isFiniteNumber(p.workers))) {
    return null;
  }
  return data;
}

/** 参数行：workers / 上限 / 实测模型数（三个口径都来自 Go，前端不数） */
function concParamsHTML(payload: ConcPayload, esc: EscFn): string {
  const parts: string[] = [];
  if (isFiniteNumber(payload.workers)) {
    parts.push(t("diagnostics.perfConcurrentWorkersN", { n: String(payload.workers) }));
  }
  if (isFiniteNumber(payload.model_count)) {
    parts.push(t("diagnostics.perfConcurrentModelCount", { n: String(payload.model_count) }));
  }
  if (parts.length === 0) return "";
  return `<div class="perf-conc-params">${esc(parts.join(" · "))}</div>`;
}

function concFileReadHTML(fr: ConcFileRead, esc: EscFn): string {
  // 块缺失即「没测」（Go 侧 omitempty 的诚实性），此处不补 0 占位
  if (!isFiniteNumber(fr.file_count) || !isFiniteNumber(fr.serial_ms)) return "";
  const speedup = isFiniteNumber(fr.speedup)
    ? `<span class="perf-conc-speedup">${esc(t("diagnostics.perfConcurrentSpeedup", { speedup: fr.speedup.toFixed(2) }))}</span>`
    : "";
  return `<div class="perf-conc-filerow">
<span class="perf-conc-label">${UI_ICONS.file} ${esc(t("diagnostics.perfConcurrentFileRead"))}</span>
<span class="perf-conc-detail">${esc(
    t("diagnostics.perfConcurrentFileDetail", {
      count: String(fr.file_count),
      serial: fr.serial_ms.toFixed(2),
      parallel: isFiniteNumber(fr.parallel_ms) ? fr.parallel_ms.toFixed(2) : "-",
    }),
  )}</span>${speedup}
</div>`;
}

function concRender(payload: ConcPayload, banner: string, esc: EscFn): string {
  // 目标集回显（ADR-262 D3 修订）：并发载荷是**扁平**的（无 spec 对象），三旋钮与 max_models 同层
  const echo = perfTargetEchoHTML(
    {
      target: payload.target,
      order: payload.order,
      size_source: payload.size_source,
      max_models: payload.max_models,
      // rtype 由 Go 顶层回显（与 single-bench 的 spec.rtype 对称）：模板里那个 `models[0].rtype`
      // 兜底已撤——拿入选样本反推目标类型是臆断（空集时推不出来），类型判定的事实源只有 Go。
      rtype: payload.rtype,
    },
    esc,
  );
  const serial = payload.serial ?? {};
  const perModel = isFiniteNumber(serial.per_model_ms)
    ? `<span class="perf-conc-detail">${esc(
        t("diagnostics.perfConcurrentPerModel", { ms: serial.per_model_ms.toFixed(2) }),
      )}</span>`
    : "";

  const rows = (payload.parallel ?? [])
    .map((p) => {
      const v = concVerdict(p.verdict);
      const style = CONC_VERDICT_STYLE[v];
      const speedup = isFiniteNumber(p.speedup)
        ? t("diagnostics.perfConcurrentSpeedup", { speedup: p.speedup.toFixed(2) })
        : "-";
      return `<div class="perf-conc-row">
<span class="perf-conc-label">${esc(t("diagnostics.perfConcurrentRow", { workers: String(p.workers ?? "?") }))}</span>
<span class="perf-conc-ms">${isFiniteNumber(p.total_ms) ? `${p.total_ms.toFixed(2)}ms` : "-"}</span>
<span class="perf-conc-speedup">${esc(speedup)}</span>
<span class="perf-conc-verdict ${style.cls}" title="${esc(t("diagnostics.perfConcurrentJudgeHint"))}">${style.icon} ${esc(t(style.key))}</span>
</div>`;
    })
    .join("");

  return (
    sectionHeader(
      UI_ICONS.performance,
      t("diagnostics.perfConcurrentResult"),
      payload.output ?? "",
    ) +
    banner +
    echo +
    `<div class="perf-conc" style="padding:8px 2px;user-select:text;-webkit-user-select:text">` +
    concParamsHTML(payload, esc) +
    `<div class="perf-conc-row perf-conc-serial">
<span class="perf-conc-label">${esc(t("diagnostics.perfConcurrentSerial"))}</span>
<span class="perf-conc-ms">${isFiniteNumber(serial.total_ms) ? `${serial.total_ms.toFixed(2)}ms` : "-"}</span>${perModel}
</div>` +
    rows +
    concFileReadHTML(payload.file_read ?? {}, esc) +
    `</div>`
  );
}

/**
 * 读并发度 + 目标集三旋钮（target / order / 取样上限）。
 * 目标集控件与 single-bench **同一套填充与判定函数**（populatePerfTargetOptions /
 * parsePerfTargetValue）——跨命令同名同义，界面不另立第二套。
 * 默认 target=repo（与 Go 的 concurrent-bench 默认一致：全库扁平取前 N 个可分析模型）。
 */
function concReadParams(root: ShadowRoot): ConcParams | null {
  const workersEl = root.getElementById("diag-perf-conc-workers") as HTMLInputElement | null;
  const maxEl = root.getElementById("diag-perf-conc-max") as HTMLInputElement | null;
  const workers = Number.parseInt(workersEl?.value ?? "", 10);
  const maxModels = Number.parseInt(maxEl?.value ?? "", 10);
  // 非法输入不提交给 Go（Go 侧还会再校验一次，但报错前就拦掉更省事）
  if (!Number.isFinite(workers) || workers < 1 || workers > 256) return null;
  if (!Number.isFinite(maxModels) || maxModels < 1) return null;
  const targetEl = root.getElementById("diag-perf-conc-target") as HTMLSelectElement | null;
  // 控件缺席（旧 DOM / 测试夹具）按 Go 默认 repo 处理
  const choice = parsePerfTargetValue(targetEl ? targetEl.value.trim() : PERF_TARGET_REPO);
  // 本 tab 没有单模型路径输入框：target=model 必然缺载荷参数，本地拦掉而不是换 Go 一句报错
  if (choice.target === "model") return null;
  const base = {
    target: choice.target,
    order: readPerfOrder(root, "diag-perf-conc-order"),
    "max-models": maxModels,
    workers,
    format: "json" as const,
  };
  return choice.target === "rtype" ? { ...base, rtype: choice.rtype } : base;
}

export async function runConcurrentBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfConcGuard.next();
  const out = getOutBox(root, "diag-perf-conc-out");
  if (!out) return;
  const params = concReadParams(root);
  if (!params) {
    setErrorMsg(out, t("diagnostics.perfConcurrentParamInvalid"), esc);
    return;
  }
  if (webGate("diagnostics.webNoPerf")) return;
  setBusy(out);
  try {
    const resp = await executeCLI("concurrent-bench", params);
    if (perfConcGuard.stale(gen)) return;
    const payload = concParsePayload(resp);
    if (!payload) {
      // 参数错/未找到模型等：Go 在 SetResult 之前就返回了，此时没有载荷可渲染，如实报错
      if (resp.status === "success") {
        setErrorMsg(out, t("diagnostics.perfConcurrentEmpty"), esc);
      } else {
        setErrorResp(out, resp, esc);
      }
      return;
    }
    const banner =
      resp.status === "error"
        ? errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc)
        : "";
    out.innerHTML = concRender(payload, banner, esc);
  } catch (e) {
    if (perfConcGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
