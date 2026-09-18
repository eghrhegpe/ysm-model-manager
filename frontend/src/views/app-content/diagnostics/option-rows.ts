// ===== 诊断页：<option> 行构造单点（诊断页待确认 1，2026-09-18）=====
//
// 立因：conflicts 的 `#sync-rtype` 与 perf 目标集下拉各自有一段「id→label → <option>」构造，
// 前者手写 `.map(...)` 拼串，后者在 `populatePerfTargetOptions` 里 DOM 手拼。
// 审计结论（docs/plans/diagnostics-dedup-audit.md 待确认 1）它们**不是数据归属分叉**——
// 两源最终都派生自 `resource_types.json`（本仓类型唯一事实源），前端不自行判定类型；
// 只是**展示层派生分叉**（顺序声明序 vs 字典序、能力有 tooltip/异步重填 vs 无）。
// 故本模块只收掉「手写 <option>」这份重复，**顺序与选中逻辑由调用方决定后传入**——
// 本函数不（也不能）替调用方判断顺序/来源，以便两源各自顺序零视觉变化。
//
// 为何独立成叶（同 status-row.ts / web-gate.ts 的取舍）：conflicts 与 perf-matrix-render
// 是两个子域，谁都不应向对方借内部共享层；此构造又跨两子域，故单独成一叶模块。

export interface OptionRow {
  /** option 的 value（资源类型 id 等） */
  value: string;
  /** option 的展示文案 */
  label: string;
  /** 命中即给该行加 ` selected`（由调用方保持者声明选中状态） */
  selected?: boolean;
  /** 可选 tooltip；缺省不产出 title 位（与源 A 现状逐字一致） */
  title?: string;
}

/**
 * 把选项行拼成单个 `<option>` 串后 join。值 / 标签 / title 均经 `esc` 转义
 *（title 会落入属性位，esc 已转义 `"`/`'`，属性安全）。
 * `esc` 取 `(s: string) => string` 而非全页 `EscFn`（unknown→string）：
 * 这里只喂字符串，`EscFn` 与 `utils/html/html.ts|esc` 两者皆可传入。
 */
export function optionRows(rows: ReadonlyArray<OptionRow>, esc: (s: string) => string): string {
  return rows
    .map((r) => {
      const sel = r.selected ? " selected" : "";
      const title = r.title ? ` title="${esc(r.title)}"` : "";
      return `<option value="${esc(r.value)}"${sel}${title}>${esc(r.label)}</option>`;
    })
    .join("");
}
