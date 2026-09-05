// ===== 通知原语（toast 系收敛，ADR-185）=====
// 从 features/context-menu/context-menu-shared.ts 下沉至此的跨层复用原语——
// 消费方：context-menu 族 / pack-ops / sync / settings / app-sidebar 等。
// 置于 core（而非 utils）原因（订正 2026-09-05 增量深评）：初版注释称「放 utils 会造成
// utils→core 反向依赖」已被现网证伪——utils 现有 4 处 import core/i18n（dom/errors.ts、
// dom/directory-picker.ts、format/summarize.ts、resource/short-label.ts）。现按惯例留 core：
// toast 原语与 i18n/page-store 同属内核侧横向能力；若未来治理 utils→core 依赖，
// 本文件与 utils/dom/toast-ms.ts 可一并迁 utils/dom/（另见与 dom/feedback.ts 的撞名问题）。

import type { ToastPayload } from "../bus.ts";
import { bus } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { t } from "./i18n/t.ts";

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
