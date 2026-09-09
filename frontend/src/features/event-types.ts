// ===== Wails 事件 payload 类型定义 =====
// 为 features 模块消费的 Wails Events.On 提供类型化 payload，
// 消除 `as [string, number, unknown]` 类型断言。
// 形状 = 具名元组（对齐 Go Emit 多参打包的线上格式，code_review 04250e9a9：
// 对象形状与 parseEventPayload<T extends unknown[]> 的元组契约相悖且零消费）。
import { dbg } from "@/utils/debug/debug.ts";

/** queue:status 事件 payload：[status, total, extra] */
export type QueueStatusPayload = [status: string, total: number, extra: unknown];

/** queue:file-start 事件 payload：[name, total, remaining] */
export type QueueFileStartPayload = [name: string, total: number, remaining: number];

/** queue:file-done 事件 payload：[name, status, errMsg] */
export type QueueFileDonePayload = [name: string, status: string, errMsg: string];

/** download:progress 事件 payload：[dl, total] */
export type DownloadProgressPayload = [dl: number, total: number];

/**
 * Wails 事件 payload 守卫 + 类型 narrowing。
 * 验证 payload 为非空数组后，返回类型化元组。
 * @param e Wails 事件对象
 * @param tag 事件标签（畸形 payload 调试日志用）
 * @returns 类型化 payload 或 null（畸形时，附 dbg 日志——原 eventArr 守卫的
 *          可观测性：协议漂移/字段裁剪可查，不静默丢弃）
 */
export function parseEventPayload<T extends unknown[]>(
  e: { data: unknown },
  tag?: string,
): T | null {
  if (!Array.isArray(e?.data) || e.data.length === 0) {
    dbg(`event:${tag ?? "?"} 畸形 payload,跳过`, e);
    return null;
  }
  return e.data as T;
}
