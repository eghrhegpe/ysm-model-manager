// ===== 3D 预览 loadingEl 渲染原语（加载态 + 失败态统一收口）=====
// showLoadFailure：mount-preview-core / switch-preview 两处逐字重复的失败
// 展示（innerHTML + toast）。renderLoadingState：litematic/mmd/vrm 三个
// adapter 各自拼接的进度条 HTML（仅 emoji / 进度模式不同）。抽一处收口，
// 改文案 / 改样式只需改这一处。
import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { esc } from "../../utils/dom/html.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";

/** 加载进度条模式：indeterminate（循环动画）| determinate（固定 id + transition，供外部更新宽度） */
export type LoadingProgressMode = "indeterminate" | "determinate";

/** 3D 预览加载态：loadingEl 渲染图标 + 标签 + 进度条 */
export function renderLoadingState(
  loadingEl: HTMLElement,
  icon: string,
  labelKey: string,
  mode: LoadingProgressMode = "indeterminate",
  /** determinate 模式进度条 id（外部用 querySelector 更新宽度） */
  barId = "ysm-progress",
): void {
  const bar =
    mode === "determinate"
      ? `<div id="${barId}" style="height:100%;width:5%;background:var(--accent,#7c83ff);border-radius:2px;transition:width 0.2s"></div>`
      : '<div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:preview-prog 1.5s ease-in-out infinite"></div>';
  loadingEl.innerHTML =
    '<div style="font-size:32px">' + icon + "</div><div>" + t(labelKey) +
    '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">' + bar + "</div>";
}

/** 3D 预览加载失败：loadingEl 渲染失败提示 + 全局 toast 报错 */
export function showLoadFailure(loadingEl: HTMLElement, e: unknown): void {
  loadingEl.innerHTML =
    `<div style="font-size:32px">⚠️</div><div>${t("preview.loadFailed")}: ${esc(safeErrorMessage(e))}</div>`;
  bus.emit("toast:show", {
    msg: "❌ " + friendlyError(e, t("preview.loadFailed")),
    duration: TOAST_MS.long,
    type: "error",
  });
}
