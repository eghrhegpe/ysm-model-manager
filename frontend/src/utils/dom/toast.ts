// ===== 通知原语（toast 系收敛）=====
// 跨层复用原语——消费方：context-menu 族 / pack-ops / sync / settings / app-sidebar 等。
// DOM 反馈原语归 utils/dom（与 toast-ms.ts 同域）；与 feedback.ts（flashBtn 原地闪烁）区分。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "./errors.ts";
import { TOAST_MS, type ToastType } from "./toast-ms.ts";

// ToastType 单一事实源 = toast-ms.ts；toast.ts 不再手写 union，避免语义漂移

/** 显示 toast 通知 */
export function toast(
  msg: string,
  duration: number = TOAST_MS.normal,
  type: ToastType = "success",
): void {
  bus.emit("toast:show", { msg, duration, type });
}

/** 错误 toast（`friendlyError(e)` 模板收敛——instance-ops / settings/init 等 catch 块共用；
 *  ADR-267：type 驱动 error 图标，msg 载荷不再带 `❌` 前缀）。
 *  @param err       错误对象
 *  @param fallback  friendlyError 未匹配时的回退文案（仅错误无中文时生效）
 *  @param prefix    操作名前缀（如 "统计失败"），拼在 friendlyError 前：`${prefix}: ${msg}` */
export function toastError(err: unknown, fallback?: string, prefix?: string): void {
  toast(
    prefix ? `${prefix}: ${friendlyError(err, fallback)}` : friendlyError(err, fallback),
    TOAST_MS.long,
    "error",
  );
}

/** rtype 契约缺失守卫 toast（context-menu / pack-ops / app-sidebar 等多处重复，收口于此） */
export function toastEmptyRtype(): void {
  toast(t("ctx.emptyRtype"), TOAST_MS.normal, "error");
}
