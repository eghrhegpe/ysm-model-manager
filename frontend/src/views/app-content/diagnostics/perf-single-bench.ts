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
  getOutBox,
  sectionHeader,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
} from "./perf-common.ts";
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
  /** 人类可读原文（复制/AI 直读用） */
  output?: string;
}

type SingleBenchParams = CLIArgs & {
  model: string;
  iterations: number;
  /** 结构化载荷开关；Go 侧 text/json 双模式共用同一采集路径 */
  format: "json";
};

function singleBenchGetParams(root: ShadowRoot): SingleBenchParams {
  const model =
    (root.getElementById("diag-perf-model") as HTMLInputElement | null)?.value.trim() ?? "";
  const iterRaw = (root.getElementById("diag-perf-iter") as HTMLInputElement | null)?.value ?? "3";
  const iterations = Math.max(1, parseInt(iterRaw, 10) || 3);
  return { model, iterations, format: "json" };
}

function singleBenchValidateAndRender(
  root: ShadowRoot,
  out: HTMLElement,
  esc: EscFn,
): SingleBenchParams | null {
  const params = singleBenchGetParams(root);
  if (!params.model) {
    setErrorMsg(out, t("diagnostics.perfModelRequired"), esc);
    return null;
  }
  return params;
}

/**
 * 结构化载荷守卫：形状不对即返回 null，由调用方走错误分支。
 * 不做 `as` 断言穿透——桥另一侧是不可信字符串，形状必须显式校验（同 cli-bridge 协议边界口径）。
 */
function singleBenchParsePayload(resp: CLIResp): SingleBenchPayload | null {
  if (resp.status !== "success") return null;
  const data = resp.data as Partial<SingleBenchPayload> | undefined;
  if (!data || !Array.isArray(data.stages) || typeof data.total_ms !== "number") return null;
  if (typeof data.per_iteration_ms !== "number") return null;
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

function singleBenchRenderBars(payload: SingleBenchPayload, esc: EscFn): string {
  const stages = payload.stages;
  let maxMs = 0;
  for (const s of stages) if (s.ms > maxMs) maxMs = s.ms;
  const bars = stages
    .map((s) => {
      const pct = maxMs > 0 ? Math.max(3, Math.round((s.ms / maxMs) * 100)) : 3;
      const meta = singleBenchStageMeta(s.status);
      const noteAttr = s.note ? ` title="${esc(s.note)}"` : "";
      return `<div class="perf-bar-row"${noteAttr}>
<span class="perf-bar-name" title="${esc(s.name)}">${esc(s.name)}</span>
<span class="perf-bar-track"><span class="perf-bar-fill ${meta.cls}" style="width:${pct}%"></span></span>
<span class="perf-bar-val ${meta.cls}">${s.ms.toFixed(2)}ms ${meta.icon}</span>
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
    renderPerfTrendSection(esc)
  );
}

export async function runSingleBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfSingleGuard.next();
  const out = getOutBox(root, "diag-perf-single");
  if (!out) return;
  const params = singleBenchValidateAndRender(root, out, esc);
  if (!params) return;
  setBusy(out);
  try {
    const resp = await executeCLI("single-bench", params);
    if (perfSingleGuard.stale(gen)) return;
    const payload = singleBenchParsePayload(resp);
    if (!payload) {
      // 命令成功但载荷不可用 = 契约漂移（比"执行失败"更值得暴露，故也走失败分支）
      if (resp.status === "success") {
        setErrorMsg(out, t("diagnostics.perfFail"), esc);
      } else {
        setErrorResp(out, resp, esc);
      }
      return;
    }
    out.innerHTML = singleBenchRenderBars(payload, esc);
  } catch (e) {
    if (perfSingleGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
