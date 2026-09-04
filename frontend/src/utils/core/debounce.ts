/**
 * 函数防抖：在等待指定时间后才执行函数，如果在等待期间再次调用则重置计时器。
 *
 * @param fn 要防抖的函数
 * @param ms 延迟时间（毫秒）
 * @returns 防抖后的函数，带有 cancel() 方法取消 pending 调用
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): {
  (...args: A): void;
  cancel(): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}
