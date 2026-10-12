// ===== 跨域状态行外壳单点（ADR-332 D1：从 views/app-content/diagnostics/status-row.ts 提炼）=====
//
// 立因（2026-09-18 诊断页审计 C13）：诊断页状态行有**两族 CSS 并存**，此前「<div class="…">图标 文案</div>」
// 在 conflicts / dedup / dedup-scan / dedup-render / health / logs 各处手写二十多遍——改一处外壳要横扫
// 十几个文件（漏一处就两族漂移）。收成单点后外壳唯一，两族各留一个语义入口。
//
// 2026-10-13（ADR-332 D1 拍板）：该外壳被证实不止诊断页需要——features 侧 recycle-bin /
// oldest-models 也各手写等价的行内样式将就行（recycle 还因漏覆盖 .stat-row 的
// justify-content:space-between，导致图标/文案被推到两端）。为避免「又一处将就」，把纯
// builder 提炼为 neutral utils 层（features→utils 合法，不触发分层红线 R4；utils 含 HTML
// 字面量不触发 R8），diagnostics 侧改为 re-export 兼容层（12+ 处调用点零改动、视觉不变）。
//
// 复刻口径（逐字，不是重新设计）：
//   · **图标由调用点给，不由 kind 推**：同一 kind 的图标并不唯一（见源 status-row.ts 注释）。
//   · **是否转义由调用点决定**：传 `esc` 即转义（单点，不二次转义），否则按可信 HTML 直插。
//   · **CSS 由诊断页既有的 content-diag 类族承载**（stat-row / diag-msg / diag-stat），本模块
//     只产 class 串；这些规则已被 app-content 的 ShadowRoot adopt，recycle / oldest 同宿主、复用可达。
export type EscFn = (s: unknown) => string;

/** 两族共用的状态语义 —— 映射到 `diag-msg-<kind>` / `diag-stat-<kind>`。 */
export type StatusRowKind = "error" | "success" | "warn" | "muted";

export interface StatusRowOpts {
  /** 前置图标（UI_ICONS.* 的 SVG 串）。缺省 = 无图标（与现状中无图标站点逐字一致）。 */
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
 */
export function statRowHTML(
  kind: StatusRowKind,
  msg: string,
  esc?: EscFn,
  opts?: StatusRowOpts,
): string {
  return statusRowHTML(`stat-row diag-stat diag-stat-${kind}`, msg, esc, opts?.icon);
}

/**
 * 扫描中占位行 + 取消按钮（ADR-314 长任务取消通道，health / dedup-scan 共用外壳）。
 *
 * 「扫描中」是取消按钮唯一合法形态：任务尚未产出结果，取消 = 纯丢弃、无破坏性；
 * 结果行不提供取消（结果已出，删除/执行各有其确认流）。按钮只产外壳，点击行为由调用方绑定。
 */
export function scanRowWithCancelHTML(
  msg: string,
  esc: EscFn | undefined,
  opts: { icon?: string; cancelLabel: string },
): string {
  const glyph = opts.icon ? `${opts.icon} ` : "";
  const body = esc ? esc(msg) : msg;
  const label = esc ? esc(opts.cancelLabel) : opts.cancelLabel;
  return (
    `<div class="stat-row diag-stat diag-stat-muted">${glyph}${body}` +
    `<button id="diag-scan-cancel" type="button" class="diag-cancel-btn">${label}</button></div>`
  );
}
