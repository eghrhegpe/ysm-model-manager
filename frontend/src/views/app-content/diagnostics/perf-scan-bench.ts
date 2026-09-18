// ===== 诊断页：性能面板 — scan-bench（Go / Rust 扫描引擎对照，ADR-262 D3）=====
// 数据来源：Go CLI `scan-bench --format json` 的结构化载荷（ADR-200 D1/D2）。
//
// 诚实红线（Go 侧 scan_bench.go 把「测到」与「没测到」分成了两件事，前端必须原样映到界面）：
//  - `used=false` 的引擎**不得**显示 0.00ms——0ms 会被读成「快到测不出」，与事实正好相反；
//    数值列留空（—），状态列写「未采集 + 原因 token 的人话」。
//  - `entries` 同理：未采集时载荷里的 0 是「没扫」而不是「扫到 0 条」，也不上屏。
//  - `skipped>0` 要如实说明「另有 N 次未计入样本」——静默丢弃等于把缓存命中的那几次当没发生。
//  - `parity.comparable=false` → 只说「无法比对」，**不画 ✅/❌**：单侧数据比的是空气。
//  - 分位数（median_ms / p95_ms）与样本（runs_ms）一律用 Go 交出的值：前端不自算分位数、
//    不重排样本（重算 = 同一口径维护两份，漂移时界面与载荷会自相矛盾）。
//
// 与 single-bench 的关系：同为「跑在仓库根上的基准」，但量的是两个不同对象（一次解析 vs 整库扫描），
// 故结果分容器渲染（各自整块 innerHTML 替换，共用容器会互相冲掉结果）。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import type { CLIArgs } from "@/services/cli-bridge.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { isNum } from "@/utils/base/pure/guards.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import {
  errorHTML,
  getOutBox,
  renderLoadFailure,
  sectionHeader,
  setBusy,
  setErrorCatch,
} from "./perf-common.ts";
import { singleBenchReadIterations } from "./perf-single-bench.ts";
import { webGate } from "./web-gate.ts";

// 代际守卫（ADR-230）：可连点触发，旧响应后到不得覆盖新结果
const scanBenchGuard = createLoadGuard();

/** 单引擎实测结果（字段与 Go scanBenchEngineJSON 逐字对齐） */
export interface ScanBenchEngine {
  /** go | rust */
  engine: string;
  /** 该引擎是否真的处理过至少一次扫描（false = 未采集，看 reason，别把缺席的数值读成快） */
  used: boolean;
  /** 未参与的原因 token（used=true 时缺席） */
  reason?: string;
  /** 逐次墙钟原始样本（omitempty：未采集时缺席） */
  runs_ms?: number[];
  median_ms?: number;
  p95_ms?: number;
  entries: number;
  /** 因缓存命中 / 归属不可判定而未计入样本的次数 */
  skipped: number;
}

/** 规格回显（字段与 Go scanBenchSpecJSON 逐字对齐） */
export interface ScanBenchSpec {
  files_root: string;
  iterations: number;
  /** 构建期事实（`-tags rust_backend` → "rust"），与运行期归属是两件事 */
  build_backend: string;
}

/** 跨引擎一致性（字段与 Go scanBenchParityJSON 逐字对齐） */
export interface ScanBenchParity {
  /** 两侧都真的跑了才有可比性 */
  comparable: boolean;
  match: boolean;
  only_go?: string[];
  only_rust?: string[];
  field_diff?: string[];
}

/** scan-bench 结构化载荷（附 AttachSidecar 注入的 output/filesRoot，ADR-200 D5） */
export interface ScanBenchPayload {
  spec: ScanBenchSpec;
  engines: ScanBenchEngine[];
  parity: ScanBenchParity;
  output?: string;
  filesRoot?: string;
}

type ScanBenchParams = CLIArgs & {
  /** 每个引擎重复扫描次数（Go 默认 3）；复用面板既有的「迭代次数」控件，不另开输入框 */
  iterations: number;
  format: "json";
};

/**
 * 未参与原因 token → i18n 键。
 * token 取值域是 Go 侧常量（scanBenchReason*），前端只映射人话、不做字符串猜测——
 * 未知 token 落到通用句并把原文带上，绝不把 Go 的中文散文当兜底文案上屏。
 */
export const SCAN_BENCH_REASON_KEYS: Record<string, LocaleKey> = {
  unavailable: "diagnostics.perfScanBenchReasonUnavailable",
  fell_back: "diagnostics.perfScanBenchReasonFellBack",
  cache_hit: "diagnostics.perfScanBenchReasonCacheHit",
  interfered: "diagnostics.perfScanBenchReasonInterfered",
};

/**
 * 载荷守卫：形状不对即返回 null，由调用方走错误分支（与 concurrent-bench 同口径，
 * 不做 `as` 断言穿透——桥另一侧是不可信字符串）。
 *
 * 参数用结构最小类型（status + data）而非 CLIResp：测试要能直接喂畸形字面量，
 * 而 CLIResp 的 `command` 等字段对「形状校验」这一断言目标毫无意义。
 *
 * 不要求 `status === "success"`：Go 在错误分支同样先 SetResult（规律六），
 * 把已测出的数字丢掉只会让用户更看不明白。
 */
export function scanBenchParsePayload(resp: {
  status?: string;
  data?: unknown;
}): ScanBenchPayload | null {
  if (resp.status !== "success" && resp.status !== "error") return null;
  const data = resp.data as Partial<ScanBenchPayload> | undefined;
  if (!data || typeof data !== "object") return null;
  // engines 是结果主体：缺席/非数组/元素非对象都不得进入渲染（.map 会抛未捕获异常）
  if (!Array.isArray(data.engines) || data.engines.length === 0) return null;
  for (const e of data.engines) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.engine !== "string" || typeof e.used !== "boolean") return null;
  }
  // parity 是三选一结论（无法比对 / 一致 / 分叉）的承载，缺了它渲染层无法给结论
  if (!data.parity || typeof data.parity !== "object") return null;
  return data as ScanBenchPayload;
}

/** 单引擎行：数值列只在 used=true 时采用载荷里的数；未采集一律 "—" + 原因 */
function engineRowHTML(e: ScanBenchEngine, esc: EscFn): string {
  const measured = e.used === true;
  const runs = Array.isArray(e.runs_ms) ? e.runs_ms.filter(isNum) : [];
  // 原始样本进 title（读者有权看到抖动），正文只放分位数——分位数与样本都是 Go 给的
  const samplesTitle =
    measured && runs.length
      ? ` title="${esc(
          t("diagnostics.perfScanBenchSamplesHint", {
            n: String(runs.length),
            runs: runs.map((ms) => `${ms.toFixed(2)}ms`).join(", "),
          }),
        )}"`
      : "";
  const median = measured && isNum(e.median_ms) ? `${e.median_ms.toFixed(2)}ms` : "—";
  const p95 = measured && isNum(e.p95_ms) ? `${e.p95_ms.toFixed(2)}ms` : "—";
  const entries = measured ? String(e.entries ?? 0) : "—";

  const reasonKey = e.reason ? SCAN_BENCH_REASON_KEYS[e.reason] : undefined;
  const reasonText = e.reason
    ? t(reasonKey ?? "diagnostics.perfScanBenchReasonUnknown", { reason: e.reason })
    : "";
  const status = measured
    ? `<span class="perf-sb-ok">${UI_ICONS.success} ${esc(t("diagnostics.perfScanBenchMeasured"))}</span>`
    : `<span class="perf-sb-skip">${UI_ICONS.blocked} ${esc(t("diagnostics.perfScanBenchNotMeasured"))}</span>${
        reasonText ? ` <span class="perf-sb-reason">${esc(reasonText)}</span>` : ""
      }`;
  // skipped 与 used 无关：未采集的引擎同样可能「跑了几次但一次都没归它」（默认构建就是这样）
  const skipped =
    isNum(e.skipped) && e.skipped > 0
      ? `<div class="perf-sb-skipped">${esc(
          t("diagnostics.perfScanBenchSkipped", { n: String(e.skipped) }),
        )}</div>`
      : "";

  return `<tr data-engine="${esc(e.engine)}">
<td class="perf-sb-engine">${esc(e.engine)}</td>
<td class="perf-sb-ms"${samplesTitle}>${median}</td>
<td class="perf-sb-ms">${p95}</td>
<td class="perf-sb-ms">${entries}</td>
<td class="perf-sb-status">${status}${skipped}</td>
</tr>`;
}

/** 一致性结论：comparable=false 时**不给** ✅/❌（没同时采集就没有「一致性」可言） */
function parityHTML(p: ScanBenchParity, esc: EscFn): string {
  const label = `<span class="perf-sb-parity-label">${esc(t("diagnostics.perfScanBenchParity"))}</span>`;
  if (p.comparable !== true) {
    return `<div class="perf-sb-parity perf-sb-parity-warn">${UI_ICONS.warning} ${label} ${esc(
      t("diagnostics.perfScanBenchParityNotComparable"),
    )}</div>`;
  }
  if (p.match === true) {
    return `<div class="perf-sb-parity perf-sb-parity-ok">${UI_ICONS.success} ${label} ${esc(
      t("diagnostics.perfScanBenchParityMatch"),
    )}</div>`;
  }
  // 分叉明细：Go 已截断到前 10 条，前端不重排、不补全
  const lists: { key: LocaleKey; items: string[] | undefined }[] = [
    { key: "diagnostics.perfScanBenchOnlyGo", items: p.only_go },
    { key: "diagnostics.perfScanBenchOnlyRust", items: p.only_rust },
    { key: "diagnostics.perfScanBenchFieldDiff", items: p.field_diff },
  ];
  const details = lists
    .filter((l) => Array.isArray(l.items) && l.items.length > 0)
    .map(
      (l) => `<div class="perf-sb-diff">${esc(t(l.key))}: ${esc((l.items ?? []).join(", "))}</div>`,
    )
    .join("");
  return `<div class="perf-sb-parity perf-sb-parity-bad">${UI_ICONS.error} ${label} ${esc(
    t("diagnostics.perfScanBenchParityMismatch"),
  )}</div>${details}`;
}

/**
 * 渲染引擎对照（规格回显 + 引擎表 + 一致性结论）。
 * 空引擎表在守卫层就被拒（没东西可比就该报错，不该画空表）。
 */
export function renderScanBench(payload: ScanBenchPayload, esc: EscFn): string {
  const rawOutput = payload.output ?? JSON.stringify(payload, null, 2);
  const head = sectionHeader(UI_ICONS.performance, t("diagnostics.perfScanBenchTitle"), rawOutput);

  // 规格回显：量的是什么、量了几次、什么构建——仓库根可能很长，只进 title
  const spec = payload.spec ?? ({} as ScanBenchSpec);
  const specLine = `<div class="perf-total" title="${esc(spec.files_root ?? "")}">${UI_ICONS.performance} ${esc(
    t("diagnostics.perfScanBenchSpec", {
      backend: String(spec.build_backend ?? ""),
      n: String(spec.iterations ?? ""),
    }),
  )}</div>`;

  const rows = payload.engines.map((e) => engineRowHTML(e, esc)).join("");
  const table = `<table class="perf-matrix perf-sb-table">
<thead><tr>
<th>${t("diagnostics.perfScanBenchColEngine")}</th>
<th>${t("diagnostics.perfScanBenchColMedian")}</th>
<th>${t("diagnostics.perfScanBenchColP95")}</th>
<th>${t("diagnostics.perfScanBenchColEntries")}</th>
<th>${t("diagnostics.perfScanBenchColStatus")}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;

  return `${head}${specLine}${table}${parityHTML(payload.parity, esc)}`;
}

export async function runScanBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = scanBenchGuard.next();
  const out = getOutBox(root, "diag-perf-scan-bench-out");
  if (!out) return;
  if (webGate("diagnostics.webNoPerf")) return;
  // 迭代次数复用面板既有控件（同一语义：同一基准重复几次），默认值也与 Go 的 3 对齐
  const params: ScanBenchParams = {
    iterations: singleBenchReadIterations(root),
    format: "json",
  };
  setBusy(out);
  try {
    const resp = await executeCLI("scan-bench", params);
    if (scanBenchGuard.stale(gen)) return;
    const payload = scanBenchParsePayload(resp);
    if (!payload) {
      // 命令成功但形状不对 = 契约漂移（比"执行失败"更值得暴露）；命令失败则转述 Go 原话
      renderLoadFailure(out, resp, esc, "diagnostics.perfScanBenchEmpty");
      return;
    }
    const banner =
      resp.status === "error"
        ? errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc)
        : "";
    // 预构建 HTML 变量再赋值（R8 豁免口径，同全仓既有写法）：两块都由安全 builder 产出
    // ——renderScanBench 逐字段 esc、errorHTML 自带转义——这里只做装箱，不引入未转义数据。
    // 若把拼接直接写在赋值右侧，R8（innerHTML XSS，阻断型）会判新增违规：行内豁免正则要的是
    // `esc(`，而本行的 esc 是实参名，匹配不上。⚠️ 该规则扫的是**文本行**（含注释）——注释里
    // 照抄那行写法同样会被判违规，故此处用文字描述而非代码片段。
    const html = renderScanBench(payload, esc) + banner;
    out.innerHTML = html;
  } catch (e) {
    if (scanBenchGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
