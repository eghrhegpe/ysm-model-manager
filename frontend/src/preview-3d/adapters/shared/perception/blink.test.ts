// @vitest-environment node
// ===== 感知层：眨眼 测试（blink.ts）=====
import { beforeEach, describe, expect, it } from "vitest";
import { createBlinkController, type BlinkCallback } from "./blink.ts";
import { setPerceptionPaused } from "./core.ts"; // #9 全局暂停标志

describe("createBlinkController", () => {
  beforeEach(() => setPerceptionPaused(false)); // 防测试间全局标志串扰
  function collect(cb: BlinkCallback): number[] {
    const traces: number[] = [];
    const wrap: BlinkCallback = (w) => traces.push(w);
    cb === null ? null : wrap; // 只是类型断言，实际用 wrap
    return traces;
  }

  it("初始不触发（等待随机间隔）", () => {
    const traces = collect(() => {});
    const ctrl = createBlinkController({ minInterval: 1, maxInterval: 1, blinkDuration: 0.1 });
    ctrl.apply(0.016, (w) => traces.push(w));
    expect(traces).toHaveLength(0);
    ctrl.dispose();
  });

  it("间隔到期后开始眨眼周期（权重 0→正→0）", () => {
    const traces: number[] = [];
    const ctrl = createBlinkController({ minInterval: 0.5, maxInterval: 0.5, blinkDuration: 0.15 });
    // 推进直到首次触发（不硬编码帧数，容错 timing 漂移）
    while (traces.length === 0) {
      ctrl.apply(0.016, (w) => traces.push(w));
    }
    expect(traces[0]).toBe(0); // 起始权重 0
    // 继续推进，找到第一个正权重
    let foundPositive = false;
    for (let i = 0; i < 20 && traces.length < 15; i++) {
      ctrl.apply(0.016, (w) => traces.push(w));
      const last = traces[traces.length - 1];
      if (last > 0.01) foundPositive = true;
    }
    expect(foundPositive).toBe(true);
    ctrl.dispose();
  });

  it("完整周期内产生非零权重（眨眼波形）", () => {
    const traces: number[] = [];
    const ctrl = createBlinkController({ minInterval: 0.3, maxInterval: 0.3, blinkDuration: 0.1 });
    const totalFrames = Math.ceil((0.3 + 0.1) / 0.016) + 5;
    for (let i = 0; i < totalFrames; i++) {
      ctrl.apply(0.016, (w) => traces.push(w));
    }
    const nonZero = traces.filter((w) => w > 0.01);
    expect(nonZero.length).toBeGreaterThan(0);
    ctrl.dispose();
  });

  it("无 callback 时静默降级（不抛错）", () => {
    const ctrl = createBlinkController({ minInterval: 0.001, maxInterval: 0.001, blinkDuration: 0.01 });
    for (let i = 0; i < 10; i++) ctrl.apply(0.016, null as unknown as BlinkCallback);
    expect(() => ctrl.apply(0.016, null as unknown as BlinkCallback)).not.toThrow();
    ctrl.dispose();
  });

 it("dispose 后不再触发", () => {
    const traces: number[] = [];
    const ctrl = createBlinkController({ minInterval: 0.001, maxInterval: 0.001, blinkDuration: 0.01 });
    ctrl.dispose();
    ctrl.apply(1, (w) => traces.push(w));
    expect(traces).toHaveLength(0);
  });

  it("全局暂停标志下不触发（#9）", () => {
    const traces: number[] = [];
    const ctrl = createBlinkController({ minInterval: 0.001, maxInterval: 0.001, blinkDuration: 0.01 });
    setPerceptionPaused(true);
    for (let i = 0; i < 20; i++) ctrl.apply(0.016, (w) => traces.push(w));
    setPerceptionPaused(false);
    expect(traces).toHaveLength(0);
    ctrl.dispose();
  });

  it("reset 清除状态（下次 apply 重新调度，不立即触发）", () => {
    const traces: number[] = [];
    const ctrl = createBlinkController({ minInterval: 0.5, maxInterval: 0.5, blinkDuration: 0.1 });
    ctrl.reset();
    const before = traces.length;
    ctrl.apply(0.016, (w) => traces.push(w));
    expect(traces.length).toBe(before); // reset 后重新调度，不立即触发
    ctrl.dispose();
  });
});
