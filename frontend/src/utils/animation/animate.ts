// ===== 里程表滚动进位动画（类型化版 — ADR-014 P2）=====
// 数字像老式汽车里程表：个位先转→十位→百位
// 用法: animateNumber(el, targetValue, duration, onFinish)

/** 元素 → 在途动画取消函数（同一元素重复调用时先取消旧动画，防陈旧定时器覆盖新值） */
const activeAnims = new WeakMap<HTMLElement, () => void>();

/**
 * 里程表滚动进位动画
 * @param el 目标元素（textContent 中的数字将被替换）
 * @param to 目标数值
 * @param duration 总时长 ms（默认 700）
 * @param onFinish 完成落定回调——自然结束或短路分支（值已就位、无需动画）时触发；
 *  **被取消（显式或新轮隐式接管）不触发**，因取消即「值未落定、终值归接管方」。
 *  消费方借此把「动画终点的收尾写」收敛为完成事件，取代调用方另配同速 setTimeout 接力。
 * @returns 取消函数（组件卸载/新动画接管时调用）
 */
export function animateNumber(
  el: HTMLElement,
  to: number,
  duration = 700,
  onFinish?: () => void,
): () => void {
  if (!el) return () => {};
  // 新调用先取消同元素上一轮在途动画——否则旧 timers 会继续按旧帧写入
  // textContent 覆盖新动画结果（消费者 updateStat 有外部取消，但本工具是
  // 最后一层防线，任何未取消的重复调用都会造成陈旧写回）
  const prevCancel = activeAnims.get(el);
  if (prevCancel) {
    activeAnims.delete(el);
    prevCancel();
  }

  const text = el.textContent || "";
  const match = text.match(/([0-9]+)/);
  if (!match) {
    // 无法动画化 = 无在途帧需要等待：已就位语义，落定回调照常触发（消费方终值写不丢失）
    onFinish?.();
    return () => {};
  }
  const from = parseInt(match[1], 10);
  if (from === to) {
    onFinish?.();
    return () => {};
  }

  const numStr = String(to);
  const fromStr = String(from).padStart(numStr.length, "0");
  const len = numStr.length;

  const frames: number[] = [];
  for (let p = len - 1; p >= 0; p--) {
    let val = "";
    for (let i = 0; i < len; i++) {
      // i < p 位保持旧值,≥ p 位进位到目标值(低位先转→高位)
      if (i < p) val += fromStr[i];
      else val += numStr[i];
    }
    frames.push(parseInt(val, 10));
  }
  const unique = frames.filter((v, i) => v !== (i > 0 ? frames[i - 1] : from));

  if (unique.length <= 1) {
    el.textContent = text.replace(/[0-9]+/, String(to));
    onFinish?.();
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

  const finish = (): void => {
    // 动画自然结束/被取消：清理模块级登记（值引用相等才删，防误删新一轮登记）
    if (activeAnims.get(el) === cancel) activeAnims.delete(el);
  };

  const cancel = (): void => {
    cancelled = true;
    timers.forEach(clearTimeout);
    finish();
  };

  const play = (): void => {
    if (cancelled) return;
    el.textContent = (el.textContent || "").replace(/[0-9]+/, String(unique[idx]));
    idx++;
    if (idx < unique.length) {
      schedule(play, stepDuration);
    } else {
      // 自然结束：末帧已落目标值 → 完成事件（cancel 分支不经此处，取消不回调）
      finish();
      onFinish?.();
    }
  };

  activeAnims.set(el, cancel);
  play();

  return cancel;
}
