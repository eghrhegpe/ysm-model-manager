// @vitest-environment node
// ===== 感知层：节拍检测 测试（beat-detector.ts）=====
// 覆盖：初始 BPM / 低能量不触发 / 峰值触发 / minIntervalMs 间隔限制 /
//       BPM 量化吸附 / onBeat-offBeat / reset / dispose / phase 推进。
// 时间源 mock：节拍间隔判定基于 performance.now()，同步注入峰值无法产生
// 真实毫秒间隔 → 用 vi.spyOn 推进虚拟时钟。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeatDetector } from "./beat-detector.ts";

/** 虚拟时钟：每帧推进固定毫秒数 */
let now = 0;
function tick(ms: number): void {
  now += ms;
}
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  now = 0;
  nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  nowSpy.mockRestore();
});

/** 注入 N 帧能量，每帧推进 dtMs 毫秒 */
function feed(
  det: ReturnType<typeof createBeatDetector>,
  energy: number,
  frames: number,
  dtMs = 16,
): void {
  for (let i = 0; i < frames; i++) {
    det.update(energy);
    tick(dtMs);
  }
}

describe("createBeatDetector", () => {
  it("初始 BPM 为默认值 120（无检测数据时回退 initialBpm）", () => {
    const det = createBeatDetector();
    expect(det.getBpm()).toBe(120);
    det.dispose();
  });

  it("低能量不触发节拍", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.3, historySize: 10, minIntervalMs: 0 });
    det.onBeat(cb);
    feed(det, 0.1, 50);
    expect(cb).not.toHaveBeenCalled();
    det.dispose();
  });

  it("能量峰值触发节拍", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.2, historySize: 5, minIntervalMs: 0 });
    det.onBeat(cb);
    // 先注入低能量建立基线
    feed(det, 0.1, 10);
    // 注入高能量峰值
    det.update(0.9);
    expect(cb).toHaveBeenCalledTimes(1);
    det.dispose();
  });

  it("连续峰值按 minIntervalMs 间隔触发", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 3, minIntervalMs: 200 });
    det.onBeat(cb);
    // 建立低能量基线
    feed(det, 0.1, 10);
    // 每 50ms 注入一个峰值（间隔 < 200ms，应被 minInterval 抑制）
    for (let i = 0; i < 10; i++) {
      feed(det, 0.9, 1, 50); // 峰值后等 50ms
      feed(det, 0.1, 3, 16); // 回落，重建基线
    }
    // 10 个峰值 × 50ms 间隔 ≈ 只应触发头 1-2 个（minInterval 200ms 兜底）
    const fired = cb.mock.calls.length;
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThanOrEqual(3);
    det.dispose();
  });

  it("BPM 量化：等间隔节拍吸附到常见值（600ms 间隔 → 100 BPM）", () => {
    const det = createBeatDetector({ threshold: 1.1, historySize: 3, minIntervalMs: 0 });
    const cb = vi.fn();
    det.onBeat(cb);
    // 基线：低能量
    feed(det, 0.1, 10);
    // 每 600ms 一个峰值（峰值间仅隔 600ms）→ 理论 100 BPM
    for (let i = 0; i < 8; i++) {
      feed(det, 0.9, 1, 600);
      feed(det, 0.1, 1, 0); // 同刻回落，不占间隔
    }
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2); // 至少 2 拍才计算 BPM
    expect(det.getBpm()).toBe(100);
    det.dispose();
  });

  it("量化容差内吸附：±tolerance 内取常见值，超出则保留原始值", () => {
    const mk = (bpm: number) => {
      const det = createBeatDetector({ threshold: 1.1, historySize: 3, minIntervalMs: 0 });
      const cb = vi.fn();
      det.onBeat(cb);
      feed(det, 0.1, 10);
      const intervalMs = 60000 / bpm;
      for (let i = 0; i < 6; i++) {
        feed(det, 0.9, 1, intervalMs);
        feed(det, 0.1, 1, 0);
      }
      return det;
    };
    // 98 BPM → 间隔 612.2ms，距 100 差 1.8 ≤ tolerance 5 → 吸附到 100
    expect(mk(98).getBpm()).toBe(100);
    // 92 BPM → 间隔 652.2ms，距 90 差 2.2 → 吸附到 90
    expect(mk(92).getBpm()).toBe(90);
    // 104 BPM → 距 100 差 4（<5），距 110 差 6（>5）→ 唯一命中 100
    expect(mk(104).getBpm()).toBe(100);
    // 106 BPM → 距 110 差 4（<5），距 100 差 6（>5）→ 唯一命中 110
    expect(mk(106).getBpm()).toBe(110);
    // 111 BPM → 间隔 540.5ms，距 110 差 1 → 110
    expect(mk(111).getBpm()).toBe(110);
  });

  it("onBeat/offBeat 注册/注销正确", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 5, minIntervalMs: 0 });
    // 先建低能量基线
    feed(det, 0.1, 10);
    det.onBeat(cb1);
    det.onBeat(cb2);
    // 注入峰值
    det.update(0.9);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    // 注销 cb1，再注入峰值
    det.offBeat(cb1);
    cb1.mockClear();
    cb2.mockClear();
    feed(det, 0.1, 3);
    det.update(0.9);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
    det.dispose();
  });

  it("reset 清除状态：重置后历史与 BPM 回退 initialBpm，低能量不再触发", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.3, historySize: 5, initialBpm: 80 });
    det.onBeat(cb);
    feed(det, 0.1, 10);
    det.update(0.9);
    det.reset();
    expect(det.getBpm()).toBe(80); // 回退 initialBpm
    // reset 后 history 清空，再次注入低能量不应触发
    feed(det, 0.1, 10);
    expect(cb).not.toHaveBeenCalled();
    det.dispose();
  });

  it("dispose 后不再处理", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 3 });
    det.onBeat(cb);
    det.dispose();
    feed(det, 0.9, 3);
    expect(cb).not.toHaveBeenCalled();
  });

  it("phase 推进：无节拍时随绝对时间从 0 走向 1（BPM 决定周期）", () => {
    const det = createBeatDetector({ initialBpm: 120 }); // 周期 500ms
    det.update(0.1);
    tick(250); // 半个周期
    det.update(0.1);
    expect(det.getPhase()).toBeGreaterThan(0.4);
    expect(det.getPhase()).toBeLessThan(0.6);
    tick(500); // 超过一个周期 → 钳到 1
    det.update(0.1);
    expect(det.getPhase()).toBe(1);
    det.dispose();
  });
});
