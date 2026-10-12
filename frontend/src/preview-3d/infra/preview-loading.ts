// ===== 3D 预览 loadingEl 渲染原语（加载态 + 失败态统一收口）=====
// showLoadFailure：mount-preview-core / switch-preview 两处逐字重复的失败
// 展示（innerHTML + toast）。renderLoadingState：litematic/mmd/vrm 三个
// adapter 各自拼接的进度条 HTML（仅 emoji / 进度模式不同）。抽一处收口，
// 改文案 / 改样式只需改这一处。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 加载进度条模式：indeterminate（循环动画）| determinate（固定 id + transition，供外部更新宽度） */
export type LoadingProgressMode = "indeterminate" | "determinate";

/** 3D 预览加载态：loadingEl 渲染图标 + 标签 + 进度条 */
export function renderLoadingState(
  loadingEl: HTMLElement,
  icon: string,
  labelKey: LocaleKey,
  mode: LoadingProgressMode = "indeterminate",
  /** determinate 模式进度条 id（外部用 querySelector 更新宽度） */
  barId = "ysm-progress",
): void {
  const bar =
    mode === "determinate"
      ? `<div id="${barId}" style="height:100%;width:5%;background:var(--accent,#7c83ff);border-radius:var(--radius-xs);transition:width 0.06s linear"></div>`
      : '<div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:var(--radius-xs);animation:preview-prog 1.5s ease-in-out infinite"></div>';
  loadingEl.innerHTML =
    '<div style="font-size:var(--fs-xl)">' +
    icon +
    "</div><div>" +
    t(labelKey) +
    '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:var(--radius-xs);overflow:hidden">' +
    bar +
    "</div>";
}

/** 3D 预览加载失败：loadingEl 渲染失败提示 + 全局 toast 报错 */
export function showLoadFailure(loadingEl: HTMLElement, e: unknown): void {
  // [D1 收口 2026-10-12] 内层文案改走 friendlyError（原 safeErrorMessage 的「轻量无 i18n」
  // 本意是 Worker 安全，此处非 Worker）：AppError.Code 命中 CODE_KEYS 即出译文——D4 刚把
  // 守卫拒绝 AppError 化，en/ja 用户的 INVALID_PATH 从此不再泄漏中文 Reason。
  // 前缀策略：friendlyError 对英文消息自带 fallback 前缀（startsWith 判重则不叠）；
  // 中文透传无前言 → 补 loadFailed 前缀（旧 innerHTML 语义逐字保真）。
  // 同批统一：旧代码 innerHTML 与 toast 两路对中文消息前缀有无不一致（toast 缺），
  // 现两路同串——toast 对中文消息获得前缀是一致性修复而非回归。
  const loadFailed = t("preview.loadFailed");
  const detail = friendlyError(e, loadFailed);
  const msg = detail.startsWith(loadFailed) ? detail : `${loadFailed}: ${detail}`;
  loadingEl.innerHTML = `<div style="font-size:var(--fs-xl)">${UI_ICONS.warning}</div><div>${esc(msg)}</div>`;
  toast(msg, TOAST_MS.long, "error");
}
