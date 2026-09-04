// utils/core/async.ts — 纯异步工具与生命周期守卫，仅依赖轻量 ./log。
// 下沉自 MikuMikuAR @/core/utils 去桶化（ADR-191）。
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

/**
 * 创建惰性动态 import 加载器（带并发守卫 + 失败重试）。
 * 首次调用执行 loader() 并缓存结果，并发调用共享同一 Promise，
 * 失败后自动清锁使下次调用可重试。
 */
export function makeLazyLoader<T>(loader: () => Promise<T>): () => Promise<T> {
  let _cached: T | null = null;
  let _loading: Promise<T> | null = null;
  let _resolved = false;
  return async () => {
    if (_resolved) {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      return _cached!;
    }
    if (!_loading) {
      _loading = loader().then(
        (mod) => {
          _cached = mod;
          _resolved = true;
          _loading = null;
          return mod;
        },
        (err) => {
          _loading = null;
          throw err;
        },
      );
    }
    return _loading;
  };
}

// ======== Lifecycle Guards ========

/**
 * 并发加载守卫——防止同一 key 的异步操作重复触发。
 * 覆盖两种模式：
 * - Set 模式：`tryEnter('modelId')` / `leave('modelId')`，多 key 并发去重
 * - Boolean 模式：`tryEnter()` / `leave()` 无参，单实例锁定
 */
export class LoadingGuard {
  private _loading = new Set<string>();

  /** 尝试进入加载状态。返回 true 表示获准进入，false 表示已有同 key 操作进行中。 */
  tryEnter(key: string = "__default__"): boolean {
    if (this._loading.has(key)) {
      return false;
    }
    this._loading.add(key);
    return true;
  }

  /** 退出加载状态，释放 key 占用。 */
  leave(key: string = "__default__"): void {
    this._loading.delete(key);
  }

  /** 查询指定 key 是否正在加载中。 */
  isLoading(key: string = "__default__"): boolean {
    return this._loading.has(key);
  }

  /** 清除所有加载状态（异常恢复用）。 */
  clear(): void {
    this._loading.clear();
  }
}

/**
 * 防抖定时器——封装 setTimeout 的 schedule/cancel 样板。
 * 重复调用 schedule 会取消前一个定时器，仅最后一个生效。
 */
export class DebouncedTimer {
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /** 调度延迟执行。若已有待执行定时器，先取消再重设。 */
  schedule(fn: () => void, ms: number): void {
    this.cancel();
    this._timer = setTimeout(() => {
      this._timer = null;
      fn();
    }, ms);
  }

  /** 取消待执行的定时器。 */
  cancel(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** 是否有待执行的定时器。 */
  get isPending(): boolean {
    return this._timer !== null;
  }

  /** 释放资源（等同 cancel）。 */
  dispose(): void {
    this.cancel();
  }
}

/**
 * 可复用的 AbortController 封装——abort 后自动重置，使对象可重复使用。
 * 避免每次 abort 后都要手动 `new AbortController()` 的样板。
 */
export class Abortable {
  private _controller: AbortController = new AbortController();

  /** 获取当前 controller（一般用 signal 即可）。 */
  get controller(): AbortController {
    return this._controller;
  }

  /** 获取当前 signal，传给 fetch / API 调用。 */
  get signal(): AbortSignal {
    return this._controller.signal;
  }

  /** 中止当前 signal，然后自动重置为新 controller，使对象可复用。 */
  abort(): void {
    this._controller.abort();
    this._controller = new AbortController();
  }

  /** 释放资源（abort 后不重置，因为对象不再使用）。 */
  dispose(): void {
    this._controller.abort();
  }
}
