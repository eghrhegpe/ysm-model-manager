// ===== 诊断页：两族状态行外壳单点（诊断页重复实现审计 C13，2026-09-18）=====
//
// 立因：本页状态行有**两族 CSS 并存**，且两族都保留（用户已定，不是待办）：
//   · `diag-msg`（css/content-diag.ts:167）—— padding12 + fs-sm（小字），左对齐；
//   · `diag-stat`（css/content-diag.ts:66）—— padding12 + fs-base，居中。
// 字号与对齐是刻意的视觉区分，**不在本模块的收敛范围**：本模块不统一字号、不统一对齐、
// 不改 class 名、不动 CSS，只消除「同一段外壳被手写二十多遍」——`<div class="…">图标 文案</div>`
// 此前在 conflicts / dedup / dedup-scan / dedup-render / health / logs 各自拼装，
// 于是改一处外壳要横扫十几个文件（漏一处就两族漂移）。现在外壳唯一，两族各留一个语义入口。
//
// 复刻口径（逐字，不是重新设计）：
//   · **图标由调用点给，不由 kind 推**：现状同一 kind 的图标并不唯一——`diag-msg-error` 有
//     `UI_ICONS.error`（扫描/解析失败）、`UI_ICONS.warning`（发现冲突的告警头）与无图标三种；
//     `diag-stat-muted` 有 refresh（体检扫描中）/ search（矩阵空态）/ error（去重配置失败）与
//     无图标四种。硬编一张 kind→图标表 = 替调用点改视觉决策，故这里只把「图标 + 一个空格」
//     这个**连接**写一遍，图标身份仍由调用点声明。
//   · **是否转义由现状决定**：多数站点直接喂 `t(...)`（可信文案，现状不转义）→ 不传 `esc`；
//     现状里做了 `esc(...)` 的站点把 `esc` 传进来，转义仍是同一处，不新增也不减少。
//   · **带额外属性的站点不并入**：本模块不产出属性位（`style="…"` 等），那些站点保持原样。
import type { EscFn } from "./logs.ts";

/** 两族共用的状态语义 —— 映射到 `diag-msg-<kind>` / `diag-stat-<kind>`。 */
export type StatusRowKind = "error" | "success" | "warn" | "muted";

export interface StatusRowOpts {
  /** 前置图标（`UI_ICONS.*` 的 SVG 串）。缺省 = 无图标（与现状中无图标站点逐字一致）。 */
  icon?: string;
}

/**
 * 状态行外壳（私有单点）：class 前缀由两族入口各自给，图标连接与收尾在此只写一遍。
 *
 * @param msg 正文。缺省按**可信 HTML** 直插（现状口径：调用点要么喂 `t()`，要么先自行 `esc()`）
 * @param esc 传入即由本函数转义 `msg`；此时调用点**不要**再套一层 `esc()`（会二次转义）
 */
function statusRowHTML(
  cls: string,
  msg: string,
  esc: EscFn | undefined,
  icon: string | undefined,
): string {
  const body = esc ? esc(msg) : msg;
  const glyph = icon ? `${icon} ` : "";
  return `<div class="${cls}">${glyph}${body}</div>`;
}

/**
 * `diag-msg` 族（padding12 + fs-sm，左对齐）：
 * `<div class="stat-row diag-msg diag-msg-<kind>">图标 文案</div>`
 */
export function msgRowHTML(
  kind: StatusRowKind,
  msg: string,
  esc?: EscFn,
  opts?: StatusRowOpts,
): string {
  return statusRowHTML(`stat-row diag-msg diag-msg-${kind}`, msg, esc, opts?.icon);
}

/**
 * `diag-stat` 族（padding12 + fs-base，居中）：
 * `<div class="stat-row diag-stat diag-stat-<kind>">图标 文案</div>`
 *
 * ⚠️ 只覆盖**带 `stat-row`** 的写法。perf 面板另有 4 处是
 * `<div class="diag-stat diag-stat-<kind>">`（**无 `stat-row`**，见 perf-common.ts / perf-gui-flow.ts /
 * perf-matrix-render.ts）：`stat-row` 自带 `color/padding/justify-content`（css/content-diag.ts:66），
 * 少一个类就是另一种观感（且 perf-common 的 `errorHTML` / `setBusy` 已是 perf 族单点），
 * 不属「逐字相同才可替换」的范围，故那 4 处保持原样。
 */
export function statRowHTML(
  kind: StatusRowKind,
  msg: string,
  esc?: EscFn,
  opts?: StatusRowOpts,
): string {
  return statusRowHTML(`stat-row diag-stat diag-stat-${kind}`, msg, esc, opts?.icon);
}
