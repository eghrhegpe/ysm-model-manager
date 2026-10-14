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

/** withTimeout 超时专用的错误类型（调用方据 name/instanceof 与业务错误分流） */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} 超时（${ms}ms）`);
    this.name = "TimeoutError";
  }
}

/**
 * 超时兜底竞速：ms 内 settle 原样透传，否则 reject TimeoutError。
 * ⚠️ 不取消原 Promise（JS 无取消语义）——超时后晚到的 reject 经 swallowError 兜底，
 * 不会变 unhandled rejection；晚到的 resolve 无人消费（调用方按已超时处理，勿再写回结果）。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = "task"): Promise<T> {
  swallowError(p);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
