// ===== 忙锁原语（布尔互斥 + withLock 自动释放）=====
// ADR-341 归一裁决：全仓「单临界区互斥」唯一形态。历史上六族 busy 并存（抢锁式 /
// 布尔包装式 / 查询式 isBusy·setBusy 三件套 / 手写三段守卫 / per-key 在途集合 /
// 状态机字段），前四族语义同源形态各异，一律收编于此；tryStart 检查+置位单步原子，
// 杜绝「查了再抢」两段式的竞态窗口（recycle-bin 连点双确认框即此疾实证）。
// isBusy() 读面只为 UI 查询（drop hint 显隐之类）而设——业务守卫一律 tryStart，
// 禁止 `if (!isBusy()) { ...; tryStart() }` 的回潮写法。
// 豁免边界（判据「挡的是不是同一个临界区」）：
// - per-key 在途集合（import executor inFlight、sync-manager _singleBusy）挡的是
//   「每个 key 各自一份在途」，异键须并发，强并即误伤；
// - 代际/状态机字段（switch-preview inFlight、dedup state.busy+pendingType）是
//   会话状态机的分体，非独立互斥原语。两者不归本原语，勿机械套用。

/** 忙锁句柄（context-menu 旧私有 makeBusy 同名接口，可无缝替换） */
export interface BusyLock {
  /** 抢锁：空闲则占用并返回 true；已占用返回 false（调用方据返回值走「被跳过」分支） */
  tryStart(): boolean;
  /** 释放锁：仅持有者调用（withLock 的 finally 自动完成；手动场景须自行保证） */
  finish(): void;
  /** 只读查询（UI 展示层专用，如 dnd hint 显隐）；业务守卫请走 tryStart，勿查了再抢 */
  isBusy(): boolean;
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
    isBusy(): boolean {
      return busy;
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
