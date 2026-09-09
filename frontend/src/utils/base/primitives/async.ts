// utils/base/async.ts — 纯异步工具，仅依赖轻量 ./log。
// 本叶不引入任何应用层模块，故可安全复用而无需拖起应用层。

import { logWarn } from "./log.ts";

/**
 * 吞掉 promise 的异常并记录日志（比空 `.catch(() => {})` 可调试）。
 * 不返回值——用于 fire-and-forget 场景。内部调用 logWarn，确保错误不沉默。
 */
export function swallowError<T>(promise: Promise<T>): void {
  promise.catch((err) => logWarn("async", "swallowError 吞掉未处理异常", err));
}
