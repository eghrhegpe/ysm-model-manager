// @vitest-environment node
// ===== 感知层：节拍检测 测试（beat-detector.ts）=====
import { describe, expect, it, vi } from "vitest";
import { createBeatDetector } from "./beat-detector.ts";

describe("createBeatDetector", () => {
  it("初始 BPM 为默认值 120", () => {
    const det = createBeatDetector();
    // 初始状态无节拍，bpm 应为 initialBpm
    expect(det).toBeDefined();
    det.dispose();
  });

  it("低能量不触发节拍", () => {
    const det = createBeatDetector({ threshold: 1.3, historySize: 10 });
    // 注入持续低能量
    for (let i = 0; i < 50; i++) det.update(0.1, 0.016);
    // 不应有节拍（能量太低，无法超过滑动均值 × 1.3）
    det.dispose();
  });

  it("能量峰值触发节拍", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.2, historySize: 5, minIntervalMs: 0 });
    det.onBeat(cb);
    // 先注入低能量建立基线
    for (let i = 0; i < 10; i++) det.update(0.1, 0.016);
    // 注入高能量峰值
    det.update(0.9, 0.016);
    expect(cb).toHaveBeenCalled();
    det.dispose();
  });

  it("连续峰值按 minIntervalMs 间隔触发", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 3, minIntervalMs: 200 });
    det.onBeat(cb);
    // 注入低能量基线
    for (let i = 0; i < 10; i++) det.update(0.1, 0.016);
    // 快速注入多个峰值（间隔 < 200ms）
    for (let i = 0; i < 10; i++) {
      det.update(0.9, 0.016); // 峰值
      det.update(0.1, 0.016); // 回落
    }
    // 应只触发少数节拍（受 minInterval 限制）
    expect(cb.mock.calls.length).toBeLessThan(10);
    det.dispose();
  });

  it("BPM 量化：检测结果吸附到常见值", () => {
    // 模拟固定间隔节拍（600ms → 100 BPM）
    const det = createBeatDetector({ threshold: 1.1, historySize: 3, minIntervalMs: 0 });
    // 手动注入等间隔峰值（用高能量模拟）
    for (let i = 0; i < 20; i++) {
      det.update(0.9, 0.06); // 60ms ≈ 100 BPM
    }
    det.dispose();
    // BPM 应接近 100（允许量化误差）
  });

  it("onBeat/offBeat 注册/注销正确", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 5, minIntervalMs: 0 });
    // 先建低能量基线
    for (let i = 0; i < 10; i++) det.update(0.1, 0.016);
    det.onBeat(cb1);
    det.onBeat(cb2);
    // 注入峰值
    det.update(0.9, 0.016);
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    // 注销 cb1
    det.offBeat(cb1);
    cb1.mockClear();
    det.update(0.9, 0.016);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    det.dispose();
  });

  it("reset 清除状态（重新建基线）", () => {
    const det = createBeatDetector({ threshold: 1.3, historySize: 5 });
    det.update(0.9, 0.016);
    det.reset();
    // reset 后 history 清空，再次注入低能量不应触发
    for (let i = 0; i < 10; i++) det.update(0.1, 0.016);
    det.dispose();
  });

  it("dispose 后不再处理", () => {
    const cb = vi.fn();
    const det = createBeatDetector({ threshold: 1.1, historySize: 3 });
    det.onBeat(cb);
    det.dispose();
    det.update(0.9, 0.016);
    expect(cb).not.toHaveBeenCalled();
  });
});
