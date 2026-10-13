// ===== 分批并发批处理原语（2026-10-13 收口 app-tree 五处 BATCH=8 手抄）=====
// 模式：批内 Promise.allSettled 并发、批间串行、逐项 ok/fail 不短路、失败按下标归因。
// 语义与 app-tree 五处原实现逐字对齐（events.toggleFolderBatch /
// bus-handlers.runBatchRename·dirRecycle·runBatchToggle / index._deleteSelected），
// 差异只在调用方的任务构造与结果收集——本函数收口结构，业务留在调用点。
//
// 为何放 utils/async：纯函数（无 DOM / 无 Wails / 无上层依赖），与 load-guard 同域。

/** 单项执行结果（成功值 + 原任务下标） */
export interface BatchFulfilled<T> {
  /** 原任务列表下标（非批内下标——跨批归因不漂移） */
  index: number;
  value: T;
}

/** 单项失败结果（原任务下标 + 拒绝原因） */
export interface BatchRejected {
  index: number;
  reason: unknown;
}

/** 批处理结果：成功/失败分桶，均按原任务顺序 */
export interface BatchAllSettledResult<T> {
  fulfilled: BatchFulfilled<T>[];
  rejected: BatchRejected[];
}

/** 缺省批大小：与 app-tree 五处原 BATCH=8 一致 */
export const BATCH_ALL_SETTLED_DEFAULT_SIZE = 8;

/**
 * 分批并发执行异步任务：批内 allSettled（单项失败不短路）、批间严格串行。
 *
 * @param tasks 异步任务工厂列表（调用时才执行，未执行的失败任务无副作用）
 * @param batchSize 每批并发上限；缺省 8，非法值（非有限正数）回落缺省
 * @returns 成功/失败分桶（`index` = 原任务列表下标），结果按任务顺序
 */
export async function batchAllSettled<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  batchSize: number = BATCH_ALL_SETTLED_DEFAULT_SIZE,
): Promise<BatchAllSettledResult<T>> {
  const size =
    typeof batchSize === "number" && Number.isFinite(batchSize) && batchSize > 0
      ? batchSize
      : BATCH_ALL_SETTLED_DEFAULT_SIZE;
  const fulfilled: BatchFulfilled<T>[] = [];
  const rejected: BatchRejected[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    const batch = tasks.slice(i, i + size);
    const results = await Promise.allSettled(batch.map((fn) => fn()));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") fulfilled.push({ index: i + j, value: r.value });
      else rejected.push({ index: i + j, reason: r.reason });
    }
  }
  return { fulfilled, rejected };
}
