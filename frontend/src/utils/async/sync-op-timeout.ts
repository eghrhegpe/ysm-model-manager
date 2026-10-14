// sync-op-timeout.ts：同步类 binding 的**兜底超时单点**（批D）。
//
// 为什么需要：直调模式下（ADR-340 去总线化）binding 的「不收口」只有一种成因——
// Go 侧同步/安装链在 InstallLock 竞争或慢盘上长时间不返回。Promise 没有取消语义，
// 不收口就等于**按钮与互斥锁永久卡死**（侧栏 `_syncLock` 被占 → 整个同步入口失效；
// 面板 per-path 守卫 → 那一行永久禁用）。故任何同步 binding 的 await 都必须包超时。
//
// 120s 的取值依据：超过大仓库整树硬链接安装的观测上限；超时**不是**取消（原 Promise
// 仍在跑），调用方须按「已超时」如实报告，不得把晚到结果写回 UI（晚到 reject 由
// withTimeout 内部 swallowError 兜底，不会成为 unhandled rejection）。
import { withTimeout } from "@/utils/base/primitives/async.ts";

/** 同步 binding 兜底超时（唯一事实源：侧栏批量链与面板行内链共用一个策略值） */
export const SYNC_OP_TIMEOUT_MS = 120_000;

/**
 * 把同步 binding 包进兜底超时。label 统一写「<动作> <对象>」便于超时文案定位到具体操作
 * （如「拉取 insA」「推送 a.zip」）。
 */
export function withSyncOpTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return withTimeout(p, SYNC_OP_TIMEOUT_MS, label);
}
