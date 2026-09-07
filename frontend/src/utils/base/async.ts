// utils/base/async.ts — 纯异步工具，仅依赖轻量 ./log。
// 下沉自 MikuMikuAR @/core/utils 去桶化（原误记 ADR-191，编号不存在；ADR-189 D5 更正）。
// 注意：本叶不引入任何应用层模块，故可安全复用而无需拖起应用层。
// P1 修复（锐评 2026-09）：fireAndForget/delay/waitForFrame 全仓零消费者，删除死代码。

import { logWarn } from "./log.ts";

/**
 * 吞掉 promise 的异常并记录日志（比空 `.catch(() => {})` 可调试）。
 * 不返回值——用于 fire-and-forget 场景。内部调用 logWarn，确保错误不沉默。
 */
export function swallowError<T>(promise: Promise<T>): void {
  promise.catch((err) => logWarn("swallow", "", err));
}
