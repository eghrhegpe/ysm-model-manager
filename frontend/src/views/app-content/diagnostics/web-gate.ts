// ===== web 模式能力门禁（诊断页单点）=====
//
// 立因（2026-09-18 诊断页重复实现审计 C1，见 docs/plans/diagnostics-dedup-audit.md）：
// 「web 模式下提示 + 拦住这次调用」这段 8 行样板在本页被抄了 5 份
//（perf-concurrent / perf-scan-bench 各一，conflicts 两种扫描各一，perf-gui-flow 已随 gui-flow 面板下线），
// 连函数名都各起一个（concWebModeCheck / scanBenchWebModeCheck /
// dgCfWebGate / dgCfSyncWebGate），唯一差异是提示文案键。
//
// 抄 5 份的真实代价不是 40 行代码，而是：**新增一个需要 web 门禁的入口时，照抄哪一份都不能
// 保证行为一致**——提示级别、是否中止、是否弹两次，本该各只有一个答案。web 模式没有 Go 桥，
// 提交必然失败的 CLI 只会把「能力不足」伪装成「命令出错」，这是展示层的不诚实，故门禁要拦。
//
// 为什么不放进 perf-common.ts：本页不止性能面板需要它（conflicts 的两种扫描同样要拦），
// 而 perf-common 是性能面板的共享层，让冲突扫描 import 它是跨域依赖；故单独成叶模块。
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

/**
 * web 模式门禁：命中即弹提示并返回 `true`，调用方据此中止本次调用。
 *
 * 用法：`if (webGate("diagnostics.webNoPerf")) return;`
 *
 * @param key 提示文案的 i18n 键（`LocaleKey`，键名由调用方给——同一段逻辑服务不同入口的文案）
 */
export function webGate(key: LocaleKey): boolean {
  if (isWebPlatform()) {
    bus.emit("toast:show", {
      msg: t(key),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return true;
  }
  return false;
}
