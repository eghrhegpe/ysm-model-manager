// ===== 通知原语（toast 系收敛，ADR-185 下沉；ADR-189 D3 自 core/ 归位 utils/dom）=====
// 从 features/context-menu/context-menu-shared.ts 下沉的跨层复用原语——
// 消费方：context-menu 族 / pack-ops / sync / settings / app-sidebar 等。
// 归位 utils/dom 理由：DOM 反馈原语与 toast-ms.ts 同域；同时消除与
// utils/dom/feedback.ts（flashBtn 原地闪烁）的撞名。

import type { ToastPayload } from "../../bus.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "./errors.ts";
import { TOAST_MS } from "./toast-ms.ts";
import { t } from "../../core/i18n/t.ts";

type ToastType = NonNullable<ToastPayload["type"]>;

/** 显示 toast 通知 */
export function toast(
  msg: string,
  duration: number = TOAST_MS.normal,
  type: ToastType = "success",
): void {
  bus.emit("toast:show", { msg, duration, type });
}

/** 错误 toast（`❌ ${friendlyError(e)}` 模板收敛——instance-ops / settings/init 等 catch 块共用）。
 *  @param err       错误对象
 *  @param fallback  friendlyError 未匹配时的回退文案（仅错误无中文时生效）
 *  @param prefix    操作名前缀（如 "统计失败"），拼在 friendlyError 前：`❌ ${prefix}: ${msg}` */
export function toastError(err: unknown, fallback?: string, prefix?: string): void {
  toast(
    prefix ? `❌ ${prefix}: ${friendlyError(err, fallback)}` : `❌ ${friendlyError(err, fallback)}`,
    TOAST_MS.long,
    "error",
  );
}

/** rtype 契约缺失守卫 toast（context-menu / pack-ops / app-sidebar 等多处重复，收口于此） */
export function toastEmptyRtype(): void {
  toast(t("ctx.emptyRtype"), TOAST_MS.normal, "error");
}
