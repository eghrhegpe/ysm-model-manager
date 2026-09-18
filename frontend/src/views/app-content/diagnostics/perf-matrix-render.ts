// ===== 诊断页：性能面板 — 类型矩阵渲染（ADR-262 D3）=====
//
// Go 侧 `single-bench --rtype/--all-types --format json` 产出 `{spec, models[]}`：
// 目标集由 Go 扫描 + 聚合（发现权/类型判定各自单点），**前端只渲染**——不挑样本、不判类型、
// 不重算"哪个模型该出现在哪"（治理红线：筛选/聚合归 Go）。
//
// 关键诚实点：`cli_analyzable=false` 的类型在载荷里 `stages` 为空（Go 不采集空模型数据），
// 前端必须显示"未采集"而不是 0ms——否则又变回"拿空数据当实测"。

import { t } from "@/core/i18n/t.ts";
import { loadResourceRegistry } from "@/services/resource-registry.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import { sectionHeader } from "./perf-common.ts";

/** 单类型汇总（字段与 Go `perfTypeSummary` 逐字对齐） */
export interface PerfTypeSummary {
  rtype: string;
  rtype_label?: string;
  cli_analyzable: boolean;
  found: number;
  analyzed: number;
  unsupported: number;
  expected_stages: number;
  stage_mismatch?: boolean;
}

/** 矩阵实验规格（字段与 Go `perfMatrixSpec` 逐字对齐） */
export interface PerfMatrixSpec {
  rtype?: string;
  all_types: boolean;
  max_models: number;
  iterations: number;
  analyzed: number;
  unsupported: number;
  cli_analyzable: boolean;
  /** 前 N 大目标集的 N（缺席 = 非该模式）；与 rtype/all_types/max_models 互不同现 */
  top_largest?: number;
  /** 体量口径 token（仅前 N 大回显）：dir_total = 目录式按目录内容合计、其余按文件大小 */
  size_source?: string;
  types: PerfTypeSummary[];
}

/** 矩阵里的单个模型条目（单模型载荷子集，身份块与 singleBenchJSON 同源） */
export interface PerfMatrixModel {
  model: string;
  identity?: {
    rtype: string;
    rtype_label?: string;
    rtype_source?: string;
    form?: "file" | "dir";
    relPath: string;
  };
  per_iteration_ms?: number;
  total_ms?: number;
  stages?: { name: string; ms: number; status: string }[];
  hints?: string[];
  /**
   * 参与排名的模型占用（仅前 N 大模式）。
   * 不能拿 size_bytes 代替：目录式模型按 identity 口径在那儿恒为 0，用它排序等于没排序。
   */
  footprint_bytes?: number;
}

export interface PerfMatrixPayload {
  spec: PerfMatrixSpec;
  models: PerfMatrixModel[];
  output?: string;
}

/** 类型选择器的「全部类型」哨兵值（与 tpl 的 select 约定，非 registry 类型 id） */
export const PERF_RTYPE_ALL = "__all__";

/** 类型选择器的「全库前 N 大」哨兵（ADR-262 D3 第三种目标集）；同样不是 registry 类型 id */
export const PERF_RTYPE_TOP = "__top__";

/** 体量口径 token → i18n 描述；token 由 Go 单点给出，前端只映射不重算排名 */
const SIZE_SOURCE_KEYS: Record<string, string> = {
  dir_total: "diagnostics.perfSizeSourceDirTotal",
};

function typeLabel(s: PerfTypeSummary, esc: EscFn): string {
  const label = s.rtype_label ? esc(s.rtype_label) : esc(s.rtype);
  return `${label} <span class="perf-matrix-id">${esc(s.rtype)}</span>`;
}

function typeRow(s: PerfTypeSummary, esc: EscFn): string {
  // 未采集原因必须显式：0 与「没测」在视觉上不能混同
  const unsupportedCell =
    s.unsupported > 0
      ? `<span class="perf-matrix-warn">${s.unsupported} · ${t("diagnostics.perfMatrixUnsupported")}</span>`
      : "0";
  const mismatch = s.stage_mismatch
    ? ` <span class="perf-matrix-warn">${UI_ICONS.warning} ${t("diagnostics.perfMatrixStageMismatch")}</span>`
    : "";
  return `<tr>
<td>${typeLabel(s, esc)}</td>
<td>${s.found}</td>
<td>${s.analyzed}</td>
<td>${unsupportedCell}</td>
<td>${s.cli_analyzable ? s.expected_stages : "—"}${mismatch}</td>
</tr>`;
}

function modelRow(m: PerfMatrixModel, esc: EscFn): string {
  const id = m.identity;
  const name = id ? `${esc(id.rtype_label ?? id.rtype)} · ${esc(id.relPath)}` : esc(m.model);
  const formTag = id?.form === "dir" ? ` <span class="perf-matrix-tag">dir</span>` : "";
  // 体量回显（ADR-262 D3）：前 N 大模式要能看出「它凭什么排第一」的数值；
  // 0/缺席渲染空串——其他模式没这个字段，且 0 在 Go 口径里是「未知」不是「零字节」
  const footprint = formatBytes(m.footprint_bytes ?? 0);
  const footprintTag = footprint
    ? ` <span class="perf-matrix-tag" title="${esc(t("diagnostics.perfModelFootprintHint"))}">${esc(footprint)}</span>`
    : "";
  const stageCount = m.stages?.length ?? 0;
  const detail =
    stageCount > 0
      ? `${(m.per_iteration_ms ?? 0).toFixed(2)}ms · ${stageCount} ${t("diagnostics.perfMatrixColAnalyzed")}`
      : t("diagnostics.perfMatrixUnsupported");
  const detailCls =
    stageCount > 0 ? "perf-matrix-model-detail" : "perf-matrix-model-detail perf-matrix-warn";
  return `<div class="perf-matrix-model">
<span class="perf-matrix-model-name">${name}${formTag}${footprintTag}</span>
<span class="${detailCls}">${esc(detail)}</span>
</div>`;
}

/**
 * 前 N 大规格回显（ADR-262 D3）：N 与体量口径都摆到界面上。
 * 排序依据不可见 = 结果不可复核——用户至少要能看出「这个 N 是按什么排的」。
 * 非该模式（无 top_largest）返回空串，零存在感。
 */
function topLargestLine(spec: PerfMatrixSpec, esc: EscFn): string {
  const n = spec.top_largest;
  if (typeof n !== "number" || n <= 0) return "";
  const token = spec.size_source ?? "";
  const key = SIZE_SOURCE_KEYS[token] as Parameters<typeof t>[0] | undefined;
  const desc = key ? t(key) : t("diagnostics.perfSizeSourceUnknown");
  return `<div class="perf-total" title="${esc(t("diagnostics.perfRtypeTopHint"))}">${UI_ICONS.performance} ${esc(
    t("diagnostics.perfTopLargestEcho", { n: String(n), source: token, desc }),
  )}</div>`;
}

/** 渲染类型矩阵（表格 + 逐模型明细）。空结果走显式空态，不画空表。 */
export function renderPerfMatrix(payload: PerfMatrixPayload, esc: EscFn): string {
  const rawOutput = payload.output ?? JSON.stringify(payload, null, 2);
  const head = sectionHeader(UI_ICONS.performance, t("diagnostics.perfMatrixResult"), rawOutput);
  // 口径回显先于空态判断：一条样本都没采到，也要说清「这次是按什么挑的」
  const specEcho = topLargestLine(payload.spec, esc);
  if (!payload.models.length) {
    return `${head}${specEcho}<div class="diag-stat diag-stat-muted">${UI_ICONS.search} ${t("diagnostics.perfMatrixEmpty")}</div>`;
  }
  const rows = payload.spec.types.map((s) => typeRow(s, esc)).join("");
  const table = `<table class="perf-matrix">
<thead><tr>
<th>${t("diagnostics.perfMatrixColType")}</th>
<th>${t("diagnostics.perfMatrixColFound")}</th>
<th>${t("diagnostics.perfMatrixColAnalyzed")}</th>
<th>${t("diagnostics.perfMatrixColUnsupported")}</th>
<th>${t("diagnostics.perfMatrixColStages")}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
  const models = payload.models.map((m) => modelRow(m, esc)).join("");
  return `${head}${specEcho}${table}<div class="perf-matrix-models">${models}</div>`;
}

/**
 * 用资源类型注册表填充类型选择器。
 *
 * 选项数据来自 Go/`resource_types.json`（**类型表的单一事实源**，前端不得写死类型列表）；
 * 注册表不可用时保留首项「单模型」并直接返回 —— 回落旧行为，而不是给用户一个空选择器。
 */
export async function populatePerfRtypeOptions(root: ShadowRoot): Promise<void> {
  const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement | null;
  if (!select) return;
  const reg = await loadResourceRegistry();
  const types = Object.values(reg).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!types.length) return;

  const all = document.createElement("option");
  all.value = PERF_RTYPE_ALL;
  all.textContent = t("diagnostics.perfRtypeAll");
  select.appendChild(all);

  // 全库前 N 大（ADR-262 D3 第三种目标集）：N 复用「每类上限」输入框；
  // Go 侧同样拒绝基准参数，故它与其他矩阵模式一样被 syncPerfBaselineControls 禁用三件套
  const top = document.createElement("option");
  top.value = PERF_RTYPE_TOP;
  top.textContent = t("diagnostics.perfRtypeTop");
  top.title = t("diagnostics.perfRtypeTopHint");
  select.appendChild(top);

  for (const ty of types) {
    const opt = document.createElement("option");
    opt.value = String(ty.id);
    const icon = typeof ty.icon === "string" ? ty.icon : "";
    opt.textContent = `${icon} ${String(ty.name ?? ty.id)}`.trim();
    select.appendChild(opt);
  }
}
