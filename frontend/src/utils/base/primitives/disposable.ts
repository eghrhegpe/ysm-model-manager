// utils/base/disposable.ts — Disposable 模式（事件监听清理）。
// 从 MikuMikuAR 的 dom.ts 抽出通用部分；不携带任何项目专属 DOM 引用。

/** 可释放资源的统一契约。 */
export interface Disposable {
  dispose(): void;
}

/**
 * 添加事件监听器并返回 Disposable，便于在 dispose 链路中统一释放。
 * 与手动 addEventListener/removeEventListener 相比，确保配对不遗漏。
 */
export function addDisposableListener<T extends Event = Event>(
  el: EventTarget,
  event: string,
  handler: (ev: T) => void,
  options?: AddEventListenerOptions,
): Disposable {
  // 捕获 add 时的 capture 标志：removeEventListener 只关心 capture，
  // 若直接保存 options 对象引用，调用方在 add 后修改 options.capture
  // 会导致 dispose 时按错误 capture 移除、监听器泄漏。
  const capture = options?.capture ?? false;
  el.addEventListener(event, handler as EventListener, options);
  return {
    dispose(): void {
      el.removeEventListener(event, handler as EventListener, capture);
    },
  };
}
