// ===== 感知层：眨眼（程序化生命力 L1.5）=====
// 随机间隔触发眨眼 morph，模拟自然眨眼节奏。
// 设计原则：
//   - 时序与格式解耦：controller 只负责"何时眨眼、眨多深"，
//     通过 onBlink(weight) callback 写入具体格式；
//   - 随机间隔（2-6 秒）+ 眨眼持续（~0.15s），避免机械感；
//   - 静默降级：无 callback 或已 dispose 时不操作。
//
// 消费方接入示例（MMD）：
//   const blink = createBlinkController();
//   // in update():
//   if (semanticBones && (!action || action.paused)) {
//     blink.apply(dt, (weight) => { mmd.morphs["まばたき"] = weight; });
//   }
//
// 消费方接入示例（VRM）：
//   const blink = createBlinkController();
//   // in update():
//   blink.apply(dt, (weight) => {
//     vrm.expressionManager.setValue("blink", weight);
//   });

/** 眨眼 callback：被 controller 在眨眼周期内周期性调用，传入当前权重（0→1→0） */
export type BlinkCallback = (weight: number) => void;

interface BlinkState {
  /** 距下次眨眼的剩余时间（秒） */
  nextBlinkIn: number;
  /** 当前眨眼周期的剩余时间（秒），0 = 未眨眼 */
  blinkRemaining: number;
  /** 眨眼速度（帧/秒），决定闭眼→睁眼的时间长度 */
  blinkSpeed: number;
  /** 上次计时起点（performance.now 毫秒） */
  lastTick: number;
}

/** 默认参数 */
const DEFAULT_MIN_INTERVAL_S = 2.0;
const DEFAULT_MAX_INTERVAL_S = 5.0;
const DEFAULT_BLINK_DURATION_S = 0.15; // 一次眨眼持续时间

export interface BlinkOptions {
  /** 两次眨眼的最小间隔（秒） */
  minInterval?: number;
  /** 两次眨眼的最大间隔（秒） */
  maxInterval?: number;
  /** 单次眨眼持续时间（秒） */
  blinkDuration?: number;
}

/**
 * 构建眨眼 controller。
 * 每次 build 调用一次；dispose 后不再触发。
 */
export function createBlinkController(opts: BlinkOptions = {}) {
  const minInterval = opts.minInterval ?? DEFAULT_MIN_INTERVAL_S;
  const maxInterval = opts.maxInterval ?? DEFAULT_MAX_INTERVAL_S;
  const blinkDuration = opts.blinkDuration ?? DEFAULT_BLINK_DURATION_S;

  let state: BlinkState | null = null;
  let disposed = false;

  function scheduleNext(): void {
    if (disposed) return;
    const interval = minInterval + Math.random() * (maxInterval - minInterval);
    state = {
      nextBlinkIn: interval,
      blinkRemaining: 0,
      blinkSpeed: 1 / blinkDuration,
      lastTick: performance.now(),
    };
  }

  /**
   * 每帧调用（在 adapter update 内）。
   * @param dt      帧间隔（秒）
   * @param onBlink 写入 morph weight 的 callback（格式特化）
   */
  function apply(dt: number, onBlink: BlinkCallback): void {
    if (disposed || !onBlink) return;
    if (!state) { scheduleNext(); return; }

    const now = performance.now();
    const elapsed = (now - state.lastTick) / 1000;
    state.lastTick = now;

    if (state.blinkRemaining > 0) {
      // 眨眼周期中：三角波 0→1→0
      state.blinkRemaining -= dt;
      const t = 1 - state.blinkRemaining * state.blinkSpeed; // 0..1
      const weight = Math.sin(t * Math.PI); // 0→1→0
      onBlink(Math.max(0, Math.min(1, weight)));
      if (state.blinkRemaining <= 0) {
        onBlink(0);
        state.blinkRemaining = 0;
        scheduleNext();
      }
    } else {
      // 待机：倒计时到下次眨眼
      state.nextBlinkIn -= dt;
      if (state.nextBlinkIn <= 0) {
        state.nextBlinkIn = 0;
        state.blinkRemaining = blinkDuration;
        onBlink(0); // 眨眼起始：睁眼
      }
    }
  }

  function reset(): void {
    state = null;
  }

  function dispose(): void {
    disposed = true;
    state = null;
  }

  scheduleNext();
  return { apply, reset, dispose };
}
