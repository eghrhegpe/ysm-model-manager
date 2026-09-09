// ===== 监听器集合工厂（域内订阅共享原语 — ADR-216 提级）=====
// 两套「subscribe + notify」手搓 Set（download-queue-store 状态快照订阅、
// preview-3d scene-capability 无参变更通知）收敛为本原语单一事实源。
//
// 与 bus（跨模块事件流）的语义边界：bus emit 对 handler 包 try/catch（异常吞掉
// console.error）、事件名进全局 BusEvents 类型表；本原语是模块本地通道——notify
// 直接逐调、异常向订阅方传播，是「单一写入纪律」（如 ADR-187 D3）的保护载体。
//
// 两种形态：
// - 无参变更通知（T = void，缺省）：subscribe(fn) + notify() —— 原 3D ground/water/scene 样板
// - 状态快照订阅（T = 载荷类型，如 DownloadState）：subscribe(fn: (s: T) => void) +
//   notify(payload) —— 订阅回调收到「通知时刻」的载荷，由调用方保证传递当前状态

/** 监听器集合句柄 */
export interface ListenerSet<T = void> {
  /** 登记监听器，返回取消订阅函数 */
  subscribe(fn: (payload: T) => void): () => void;
  /**
   * 同步逐个触发全部监听器。
   * T = void（缺省）时参数为 void，可无参调用；带载荷形态必须传入通知时刻的载荷。
   */
  notify(payload: T): void;
}

/**
 * 创建监听器集合（Set 去重：同一函数重复 subscribe 只登记一次，unsub 即删）。
 * 零状态闭包，destroy 语义由调用方保留 unsub 函数自清。
 */
export function createListenerSet<T = void>(): ListenerSet<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    notify(payload) {
      for (const fn of listeners) fn(payload);
    },
  };
}
