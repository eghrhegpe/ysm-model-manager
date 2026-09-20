// ===== 诊断页：性能面板 — 类型矩阵渲染（ADR-262 D3）=====
//
// Go 侧 `single-bench --target rtype|all|repo --format json` 产出 `{spec, models[]}`：
// 目标集由 Go 扫描 + 聚合（发现权/类型判定各自单点），**前端只渲染**——不挑样本、不判类型、
// 不重算"哪个模型该出现在哪"（治理红线：筛选/聚合归 Go）。
//
// 关键诚实点：`cli_analyzable=false` 的类型在载荷里 `stages` 为空（Go 不采集空模型数据），
// 前端必须显示"未采集"而不是 0ms——否则又变回"拿空数据当实测"。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { resourceTypesById } from "@/utils/resource/schema.ts";
import type { EscFn } from "./logs.ts";
import { type OptionRow, optionRows } from "./option-rows.ts";
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
  /** 目标集 selector（model/rtype/all/repo，与 Go perfTargetSpec.Target 同名同义） */
  target?: string;
  /** 排序键（path/size）；缺席即 Go 默认 path */
  order?: string;
  /** target=rtype 时回显该类型 id；all/repo 为空 */
  rtype?: string;
  /** 体量口径 token（仅 order=size 回显）：dir_total = 目录式按目录内容合计、其余按文件大小 */
  size_source?: string;
  /** 取样上限——**单位 = target 的展开单位**（rtype = 该类型 N 条 / all = 每类各 N 条 / repo = 全库 N 条） */
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

/** 目标集选择器的哨兵值（与 tpl 的 select 约定，非 registry 类型 id） */
export const PERF_TARGET_ALL = "__all__";

/** 「全库扁平」哨兵（ADR-262 D3 修订：取代旧 `__top__`；排序另由 `--order` 承载，不再焊死在选项里） */
export const PERF_TARGET_REPO = "__repo__";

/** 排序键取值（与 Go perfOrderPath / perfOrderSize 同名同义） */
export const PERF_ORDER_PATH = "path";
export const PERF_ORDER_SIZE = "size";
export type PerfOrder = typeof PERF_ORDER_PATH | typeof PERF_ORDER_SIZE;

/** 目标集三旋钮里的 selector 维度：选谁（上限单位随它变，由 Go 解释） */
export type PerfTargetChoice =
  | { target: "model" }
  | { target: "rtype"; rtype: string }
  | { target: "all" }
  | { target: "repo" };

/** 目标集回显所需的最小字段集（single-bench 矩阵与并发基准共用同一条回显，不写第二份） */
export interface PerfTargetEcho {
  // 显式带 `| undefined`：并发基准是**扁平**载荷，回显时按字段逐个透传（exactOptionalPropertyTypes 下
  // `target?: string` 不接受显式的 undefined），这里不在调用侧编造缺省值
  target?: string | undefined;
  order?: string | undefined;
  rtype?: string | undefined;
  size_source?: string | undefined;
  max_models?: number | undefined;
}

/**
 * 选择器值 → 目标集（single-bench 与 concurrent-bench **共用同一套判定**）：
 * 空值 = 单模型（按路径）；两个哨兵 = all / repo；其余即 registry 类型 id → rtype。
 * **恒有结果**（穷尽）：selector 的取值域就这四类，故调用方不需要「无法识别」分支——
 * 真正要拦的是「单模型但没给路径」这类*载荷*缺失，那在各自的 readMode 里判。
 */
export function parsePerfTargetValue(value: string): PerfTargetChoice {
  if (value === PERF_TARGET_ALL) return { target: "all" };
  if (value === PERF_TARGET_REPO) return { target: "repo" };
  if (value === "") return { target: "model" };
  return { target: "rtype", rtype: value };
}

/** 读排序控件；取值域由 Go 冻结（path|size），未知/缺席一律回落 path（= Go 的默认值） */
export function readPerfOrder(root: ShadowRoot, selectId = "diag-perf-order"): PerfOrder {
  const raw = (root.getElementById(selectId) as HTMLSelectElement | null)?.value;
  return raw === PERF_ORDER_SIZE ? PERF_ORDER_SIZE : PERF_ORDER_PATH;
}

/** 体量口径 token → i18n 描述；token 由 Go 单点给出，前端只映射不重算排名 */
const SIZE_SOURCE_KEYS: Record<string, LocaleKey> = {
  dir_total: "diagnostics.perfSizeSourceDirTotal",
};

/** selector / 排序键 → i18n 键（回显用）；未登记取值**原样回显 token**，不拿默认文案顶替 */
const TARGET_NAME_KEYS: Record<string, LocaleKey> = {
  model: "diagnostics.perfTargetModel",
  all: "diagnostics.perfTargetAll",
  repo: "diagnostics.perfTargetRepo",
};
const ORDER_KEYS: Record<string, LocaleKey> = {
  path: "diagnostics.perfOrderPath",
  size: "diagnostics.perfOrderSize",
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
 * 目标集回显（ADR-262 D3 修订）：把「选谁 / 按什么排 / 取几条」三件事摆到界面上。
 * **排序依据不可见 = 结果不可复核**：order=size 时连体量口径 token 的人话一起给，
 * 用户至少要能看出「这批样本是按什么挑的」。载荷无 target（旧形状）返回空串，零存在感。
 */
export function perfTargetEchoHTML(spec: PerfTargetEcho | undefined, esc: EscFn): string {
  const target = spec?.target ?? "";
  if (!target) return "";
  const nameKey = TARGET_NAME_KEYS[target];
  const targetName =
    target === "rtype"
      ? // 并发载荷没有顶层 rtype（只有 models[].rtype 身份块），由调用方补齐；补不到就原样回显 selector
        // token——空标题（「目标集  类型」）看起来像界面坏了，比原始 token 更糟
        t("diagnostics.perfTargetNameRtype", { rtype: spec?.rtype || "rtype" })
      : nameKey
        ? t(nameKey)
        : target;
  const order = spec?.order ?? PERF_ORDER_PATH;
  const orderKey = ORDER_KEYS[order];
  const parts = [
    t("diagnostics.perfTargetSetEcho", {
      target: targetName,
      order: orderKey ? t(orderKey) : order,
      n: String(spec?.max_models ?? 0),
    }),
  ];
  // 体量口径只在 order=size 时出现（Go 只在这时给 size_source）；未知 token 落通用句而非空话
  if (order === PERF_ORDER_SIZE) {
    const token = spec?.size_source ?? "";
    const key = SIZE_SOURCE_KEYS[token];
    parts.push(
      t("diagnostics.perfSizeSourceSuffix", {
        source: token,
        desc: key ? t(key) : t("diagnostics.perfSizeSourceUnknown"),
      }),
    );
  }
  return `<div class="perf-total" title="${esc(t("diagnostics.perfMaxModelsHint"))}">${UI_ICONS.performance} ${esc(
    parts.join(" · "),
  )}</div>`;
}

/** 渲染类型矩阵（表格 + 逐模型明细）。空结果走显式空态，不画空表。 */
export function renderPerfMatrix(payload: PerfMatrixPayload, esc: EscFn): string {
  const rawOutput = payload.output ?? JSON.stringify(payload, null, 2);
  const head = sectionHeader(UI_ICONS.performance, t("diagnostics.perfMatrixResult"), rawOutput);
  // 口径回显先于空态判断：一条样本都没采到，也要说清「这次是按什么挑的」
  const specEcho = perfTargetEchoHTML(payload.spec, esc);
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
 * 用资源类型注册表填充**目标集选择器**（single-bench 与 concurrent-bench 共用同一套，不写第二份）。
 *
 * 选项数据来自 Go/`resource_types.json`（**类型表的单一事实源**，前端不得写死类型列表）。
 * `includeModel=false` 省略「单模型（按路径）」哨兵——并发 tab 没有路径输入框，
 * 给出一个必然缺载荷参数的选项等于给用户挖坑。
 *
 * 注册表不可用时**不动 DOM**：保留 tpl 里的静态首项（单模型 / 全库扁平）回落旧行为，
 * 而不是给用户一个空选择器（把「加载失败」伪装成「没有类型」）。
 */
export async function populatePerfTargetOptions(
  root: ShadowRoot,
  selectId = "diag-perf-rtype",
  includeModel = true,
): Promise<void> {
  const select = root.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;
  const reg = resourceTypesById;
  // benchmark 目标集只列 CLI 可分析类型（cliAnalyzable 声明在 resource_types.json，Go/前端同源）：
  // 判定归 Go（ADR-262 D3），前端只消费不重算——渲染出「选了必报 unsupported」的选项，
  // 是诚实语义的反面（ADR-278 §2.6：能改却不被读是欺骗）。哨兵不受此过滤：「全部类型」
  // 由 Go 侧对不可分析条目顺延（firstWithGeometry），语义上仍成立。
  const types = Object.values(reg)
    .filter((t) => t.cliAnalyzable)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!types.length) return;

  // 重填不得重置用户已选好的目标集：先记住当前值，重建后再回填
  const keep = select.value;
  const rows: OptionRow[] = [];
  if (includeModel) rows.push({ value: "", label: t("diagnostics.perfTargetModel") });
  // 「全部类型」哨兵不受可分析过滤：Go 侧 --target all 扫**全类型**（不可分析条目顺延），
  // 故它覆盖的类型集大于上面列出的选项——title 说清这层差，否则用户读成「列出的这些的全部」
  rows.push({
    value: PERF_TARGET_ALL,
    label: t("diagnostics.perfTargetAll"),
    title: t("diagnostics.perfTargetAllHint"),
  });
  // 全库扁平（ADR-262 D3 修订的第三种目标集）：上限单位 = 全库 N 条，排序另由排序控件决定
  rows.push({
    value: PERF_TARGET_REPO,
    label: t("diagnostics.perfTargetRepo"),
    title: t("diagnostics.perfTargetRepoHint"),
  });
  for (const ty of types) {
    const icon = typeof ty.icon === "string" ? ty.icon : "";
    // 顺序 = 注册表按 id 字典序（localeCompare），逐字保持现状；label 带图标与 name 兜底 id
    rows.push({ value: String(ty.id), label: `${icon} ${String(ty.name ?? ty.id)}`.trim() });
  }
  select.innerHTML = optionRows(rows, esc);
  select.value = keep;
  // 原选中值不在新选项里（首次填充）→ 回到各自默认：单模型 / 全库扁平（与 Go 默认值一致）
  if (select.value !== keep) select.value = includeModel ? "" : PERF_TARGET_REPO;
}
