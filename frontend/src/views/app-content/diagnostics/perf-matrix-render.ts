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
}

export interface PerfMatrixPayload {
  spec: PerfMatrixSpec;
  models: PerfMatrixModel[];
  output?: string;
}

/** 类型选择器的「全部类型」哨兵值（与 tpl 的 select 约定，非 registry 类型 id） */
export const PERF_RTYPE_ALL = "__all__";

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
  const stageCount = m.stages?.length ?? 0;
  const detail =
    stageCount > 0
      ? `${(m.per_iteration_ms ?? 0).toFixed(2)}ms · ${stageCount} ${t("diagnostics.perfMatrixColAnalyzed")}`
      : t("diagnostics.perfMatrixUnsupported");
  const detailCls =
    stageCount > 0 ? "perf-matrix-model-detail" : "perf-matrix-model-detail perf-matrix-warn";
  return `<div class="perf-matrix-model">
<span class="perf-matrix-model-name">${name}${formTag}</span>
<span class="${detailCls}">${esc(detail)}</span>
</div>`;
}

/** 渲染类型矩阵（表格 + 逐模型明细）。空结果走显式空态，不画空表。 */
export function renderPerfMatrix(payload: PerfMatrixPayload, esc: EscFn): string {
  const rawOutput = payload.output ?? JSON.stringify(payload, null, 2);
  const head = sectionHeader(UI_ICONS.performance, t("diagnostics.perfMatrixResult"), rawOutput);
  if (!payload.models.length) {
    return `${head}<div class="diag-stat diag-stat-muted">${UI_ICONS.search} ${t("diagnostics.perfMatrixEmpty")}</div>`;
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
  return `${head}${table}<div class="perf-matrix-models">${models}</div>`;
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

  for (const ty of types) {
    const opt = document.createElement("option");
    opt.value = String(ty.id);
    const icon = typeof ty.icon === "string" ? ty.icon : "";
    opt.textContent = `${icon} ${String(ty.name ?? ty.id)}`.trim();
    select.appendChild(opt);
  }
}
