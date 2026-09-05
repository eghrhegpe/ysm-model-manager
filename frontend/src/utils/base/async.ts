// utils/base/async.ts — 纯异步工具，仅依赖轻量 ./log。
// 下沉自 MikuMikuAR @/core/utils 去桶化（原误记 ADR-191，编号不存在；ADR-189 D5 更正）。
// 注意：本叶不引入任何应用层模块，故可安全复用而无需拖起应用层。

import { logWarn } from "./log.ts";

/**
 * 吞掉 promise 的异常并记录日志（比空 `.catch(() => {})` 可调试）。
 * 不返回值——用于 fire-and-forget 场景。内部调用 logWarn，确保错误不沉默。
 */
export function swallowError<T>(promise: Promise<T>): void {
  promise.catch((err) => logWarn("swallow", "", err));
}

/** 启动一个异步操作但不等待，异常由 swallowError 兜底。 */
export function fireAndForget(fn: () => Promise<void>): void {
  swallowError(fn());
}

/** Promise 包装的延迟。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Promise 包装的等待下一帧。 */
export function waitForFrame(): Promise<void> {
  // 用箭头函数显式忽略 rAF 的 time 参数，避免 resolve (void) 与 FrameRequestCallback (number) 类型冲突
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
