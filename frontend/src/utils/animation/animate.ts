// ===== 里程表滚动进位动画（类型化版 — ADR-014 P2）=====
// 数字像老式汽车里程表：个位先转→十位→百位
// 用法: animateNumber(el, targetValue, duration)

/**
 * 里程表滚动进位动画
 * @param el 目标元素（textContent 中的数字将被替换）
 * @param to 目标数值
 * @param duration 总时长 ms（默认 700）
 * @returns 取消函数（组件卸载时调用）
 */
export function animateNumber(el: HTMLElement, to: number, duration = 700): () => void {
  if (!el) return () => {};
  const text = el.textContent || "";
  const match = text.match(/([0-9]+)/);
  if (!match) return () => {};
  const from = parseInt(match[1], 10);
  if (from === to) return () => {};

  const numStr = String(to);
  const fromStr = String(from).padStart(numStr.length, "0");
  const len = numStr.length;

  const frames: number[] = [];
  for (let p = len - 1; p >= 0; p--) {
    let val = "";
    for (let i = 0; i < len; i++) {
      if (i < p) val += fromStr[i];
      else if (i === p) val += numStr[i];
      else val += numStr[i];
    }
    frames.push(parseInt(val, 10));
  }
  const unique = frames.filter((v, i) => v !== (i > 0 ? frames[i - 1] : from));

  if (unique.length <= 1) {
    el.textContent = text.replace(/[0-9]+/, String(to));
    return () => {};
  }

  const stepDuration = duration / unique.length;
  let idx = 0;
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const schedule = (fn: () => void, delay: number): void => {
    if (cancelled) return;
    const t = setTimeout(fn, delay);
    timers.push(t);
  };

  const play = (): void => {
    if (cancelled) return;
    el.textContent = (el.textContent || "").replace(/[0-9]+/, String(unique[idx]));
    idx++;
    if (idx < unique.length) {
      schedule(play, stepDuration);
    }
  };
  play();

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
