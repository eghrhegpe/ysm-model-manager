// ===== 忙锁原语（布尔互斥 + withLock 自动释放）=====
// 收敛同构样板：sync.ts 手写 {busy:boolean} flag 与 context-menu 私有 makeBusy——
// tryStart 抢锁语义 + withLock 的 finally 自动 finish，杜绝「忘了释放永久锁死」从
// 纪律问题变成不可能。命中分支（返回 null）由调用方走 toast / done(skipped) 等语义。
// 注意边界：dnd 的查询式 busy（isBusy/setBusy 状态对，供 UI 高亮层读）与
// import/executor 的 per-key _inFlight（细粒度并发控制）属不同语义，不归本原语。

/** 忙锁句柄（context-menu 旧私有 makeBusy 同名接口，可无缝替换） */
export interface BusyLock {
  /** 抢锁：空闲则占用并返回 true；已占用返回 false（调用方据返回值走「被跳过」分支） */
  tryStart(): boolean;
  /** 释放锁：仅持有者调用（withLock 的 finally 自动完成；手动场景须自行保证） */
  finish(): void;
}

/** 忙锁工厂：初始空闲，每组件实例/每 verb 各建一把，互不耦合 */
export function createBusyLock(): BusyLock {
  let busy = false;
  return {
    tryStart(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    finish(): void {
      busy = false;
    },
  };
}

/**
 * 组合子：抢锁执行 fn，结束后自动 finish（含 fn 抛错路径）。
 * @returns fn 的结果；锁被占用（未执行）时返回 null。
 * 调用方约定：fn 不得返回 null（否则与「被跳过」无法区分）。
 */
export async function withLock<T>(lock: BusyLock, fn: () => Promise<T>): Promise<T | null> {
  if (!lock.tryStart()) return null;
  try {
    return await fn();
  } finally {
    lock.finish();
  }
}
