// ===== 复制并如实回执（诊断页所有复制入口的唯一出口）=====
//
// 立因（2026-09-18 诊断页重复实现审计 C5，见 docs/plans/diagnostics-dedup-audit.md）：
// 本页曾绕开既有单点 `utils/dom/clipboard.ts|copyText` 自写 textarea 降级——那份实现返回 void，
// 失败不可见，于是调用方**无条件**弹「已复制」：剪贴板被拒且 execCommand 也失败时，界面在撒谎。
// 全仓既有范式早已写在 `features/pack-ops/instance-ops.ts:73-80` 的注释里：
// copyText 永不 reject（全败时返回 { ok: false }），**必须消费布尔结果**，否则失败仍会误弹成功 toast。
//
// 为何单独成叶模块：日志面板（init.ts）与性能面板（perf-common.ts）都要用它，而 perf-common 是
// 性能面板的共享层，让日志模块 import 属跨域依赖（同 web-gate.ts 的取舍）。裸目录聚口同样不给。
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { copyText } from "@/utils/dom/clipboard.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

/**
 * 复制文本并如实回执：成功说成功，失败说失败（失败文案自带替代动作），绝不谎报。
 *
 * @param text 要复制的文本
 * @param okKey 成功文案的 i18n 键——各入口措辞本就不同（整份日志带隐私提示、单行日志不带、
 *              性能原始输出另说），故键名由调用方给，而不是在单点里猜一个通用词
 * @returns 是否真的写入了剪贴板（`copyText` 的布尔结果，调用方可继续消费）
 */
export async function copyWithToast(text: string, okKey: LocaleKey): Promise<boolean> {
  const result = await copyText(text);
  bus.emit("toast:show", {
    msg: result.ok ? `✅ ${t(okKey)}` : `❌ ${t("diagnostics.copyFail")}`,
    // 失败消息要留够阅读时间（用户得知道要手动框选），成功可以更快收走
    duration: result.ok ? TOAST_MS.success : TOAST_MS.normal,
    ...(result.ok ? {} : { type: "error" as const }),
  });
  return result.ok;
}
