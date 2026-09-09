// ===== 主线程长任务观测 =====
// 用 PerformanceObserver 监听主线程 longtask（>50ms 同步阻塞），
// 回调格式化为「耗时 @ 函数名」经 report 塞进环形日志面板——
// 排查卡顿不再依赖 DevTools trace（AGENTS.md：查日志/排查卡顿往环形日志面板塞日志）。
//
// 降级契约：不支持 PerformanceObserver（旧环境/测试）时 no-op，不抛错。
//
// 通用化：report 由调用方注入，MMD/YSM/VRM 等任意 adapter 均可复用。

/** longtask 最小报告结构（duration 单位 ms） */
export interface LongTaskInfo {
  /** 阻塞耗时（ms） */
  durationMs: number;
  /** 归因函数名（无 attribution 时兜底 "unknown"） */
  fnName: string;
  /** entry 原始 startTime（相对 performance.timeOrigin） */
  startTime: number;
}

/** 阈值：低于不报告（longtask 规范本身 ≥50ms，此处可再收紧/放宽） */
const DEFAULT_THRESHOLD_MS = 50;

/** 启动主线程长任务观测，返回 stop 函数（disconnect + 清回调）。 */
export function startMainThreadWatch(
  report: (info: LongTaskInfo) => void,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): () => void {
  // 不支持 → 降级 no-op
  if (typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  let stopped = false;
  const observer = new PerformanceObserver((list) => {
    if (stopped) return;
    for (const entry of list.getEntries()) {
      if (entry.duration < thresholdMs) continue;
      const longTask = entry as PerformanceEntry & {
        attribution?: Array<{ name?: string; containerType?: string }>;
      };
      // attribution 归因到具体函数（第一个有名字的）；无则兜底
      const fnName = longTask.attribution?.find((a) => a?.name)?.name ?? "unknown";
      report({
        durationMs: entry.duration,
        fnName,
        startTime: entry.startTime,
      });
    }
  });
  observer.observe({ type: "longtask", buffered: false });

  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
  };
}

/**
 * 便捷格式化：LongTaskInfo → 环形日志消息串。
 * 例：`主线程长任务 400ms @ onImageLoad（t+8.2s）`
 */
export function formatLongTask(info: LongTaskInfo): string {
  const t = (info.startTime / 1000).toFixed(1);
  return `主线程长任务 ${Math.round(info.durationMs)}ms @ ${info.fnName}（t+${t}s）`;
}
