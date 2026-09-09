// ===== Wails 事件 payload 类型定义 =====
// 为 features 模块消费的 Wails Events.On 提供类型化 payload，
// 消除 `as [string, number, unknown]` 类型断言。

/** queue:status 事件 payload */
export type QueueStatusPayload = {
  status: string;
  total: number;
  extra?: unknown;
};

/** queue:file-start 事件 payload */
export type QueueFileStartPayload = {
  name: string;
  total: number;
  remaining: number;
};

/** queue:file-done 事件 payload */
export type QueueFileDonePayload = {
  name: string;
  status: string;
  errMsg: string;
};

/** download:progress 事件 payload */
export type DownloadProgressPayload = {
  dl: number;
  total: number;
};

/** update:progress 事件 payload（版本更新） */
export type UpdateProgressPayload = {
  done: number;
  total: number;
};

/**
 * Wails 事件 payload 守卫 + 类型 narrowing。
 * 验证 payload 为非空数组后，返回类型化元组。
 * @param e Wails 事件对象
 * @param tag 事件标签（调试用）
 * @returns 类型化 payload 或 null（畸形时）
 */
export function parseEventPayload<T extends unknown[]>(
  e: { data: unknown },
  _tag?: string,
): T | null {
  if (!Array.isArray(e?.data) || e.data.length === 0) {
    return null;
  }
  return e.data as T;
}
