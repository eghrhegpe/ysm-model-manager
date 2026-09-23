// ===== postproc-cost-probe 纯函数段测试 =====
// 只测零 WebGL 依赖的部分（median / percentile / estimateComposerRtBytes / summarizeArm /
// buildNote）。采样主体需真实 WebGL + 活跃会话，属「按需手动跑」类
// （同 scripts/_attic/translucency-probe.ts），不进 CI——但纯计算段必须锁死，
// 否则报告里的 MB 数与判读口径没人复核。

import { describe, expect, it } from "vitest";
import {
  buildNote,
  estimateComposerRtBytes,
  median,
  percentile,
  summarizeArm,
} from "./postproc-cost-probe.ts";

describe("median", () => {
  it("空数组回落 0（不产 NaN，防报告里出现 NaN%）", () => {
    expect(median([])).toBe(0);
  });

  it("奇数个取正中", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("偶数个取中间两数均值", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("输入不被排序副作用污染（调用方还要用原数组算 p95）", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("percentile", () => {
  it("空数组回落 0", () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it("单元素恒为该元素（任意分位）", () => {
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([7], 0.5)).toBe(7);
  });

  it("p95 落在高位且不超过最大值（最近秩，不插值造伪精度）", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    const p95 = percentile(xs, 0.95);
    expect(p95).toBe(95);
    expect(p95).toBeLessThanOrEqual(Math.max(...xs));
  });
});

describe("estimateComposerRtBytes", () => {
  it("samples=0（浏览器未授予 antialias）按 1 倍计，不为 0", () => {
    // 0 会让「常驻显存」显示成 0MB，等于替 ADR-250 遮羞
    expect(estimateComposerRtBytes({ bufferW: 100, bufferH: 100, samples: 0 })).toBe(
      100 * 100 * 8 * 1,
    );
  });

  it("默认 HalfFloat RGBA = 8 字节/像素", () => {
    expect(estimateComposerRtBytes({ bufferW: 10, bufferH: 10, samples: 1 })).toBe(800);
  });

  it("MSAA 采样数按倍数计入（上界估算）", () => {
    expect(estimateComposerRtBytes({ bufferW: 10, bufferH: 10, samples: 4 })).toBe(
      10 * 10 * 8 * 4,
    );
  });

  it("1080p DPR1 + MSAA4：单缓冲约 63.3MB（数量级锚点，便于人工复核）", () => {
    const bytes = estimateComposerRtBytes({ bufferW: 1920, bufferH: 1080, samples: 4 });
    expect(bytes).toBe(1920 * 1080 * 8 * 4);
    expect(bytes / 1048576).toBeCloseTo(63.28, 1);
  });

  it("1080p DPR2 + MSAA4：单缓冲约 253MB——常驻税的主证据", () => {
    const bytes = estimateComposerRtBytes({ bufferW: 3840, bufferH: 2160, samples: 4 });
    expect(bytes / 1048576).toBeCloseTo(253.1, 0);
  });
});

describe("summarizeArm", () => {
  it("GPU 样本缺失时中位/p95 为 null（不用 CPU 值顶替）", () => {
    const s = summarizeArm("composer", [1, 2, 3], []);
    expect(s.gpuMedianMs).toBeNull();
    expect(s.gpuP95Ms).toBeNull();
    expect(s.submitMedianMs).toBe(2);
  });

  it("GPU 样本齐备时分别统计（两路样本数各自独立）", () => {
    const s = summarizeArm("direct", [1, 2, 3, 4], [10, 20, 30]);
    expect(s.n).toBe(4);
    expect(s.gpuMedianMs).toBe(20);
    expect(s.gpuP95Ms).toBe(30);
  });

  it("arm 字段透传（报告按臂取值，别串行）", () => {
    expect(summarizeArm("direct", [], []).arm).toBe("direct");
    expect(summarizeArm("composer", [], []).arm).toBe("composer");
  });
});

describe("buildNote（判读口径）", () => {
  const base = {
    taxMeaningful: true,
    composerArmFrames: 60,
    gpuTimingAvailable: true,
    extraGpuMsPerFrame: 1.05,
    extraPct: 53.7,
    rtBytesBoth: 37_009_920,
  } as unknown as Parameters<typeof buildNote>[0];

  it("开启态：明说 A−B 是全部成本，非常驻税", () => {
    const note = buildNote({ ...base, taxMeaningful: false });
    expect(note).toContain("非常驻税");
  });

  // [ADR-299] 惰性常驻后关闭态两臂同路径：差值必然趋零。若仍按旧口径报「常驻每帧多耗
  // X ms」，会把噪声（甚至负值）读成代价——这条守卫锁死「不谎报」。
  it("[ADR-299] 关闭态 composer 零参与 → 自证常驻税归零，不报代价", () => {
    const note = buildNote({ ...base, composerArmFrames: 0, extraGpuMsPerFrame: -0.02 });
    expect(note).toContain("惰性常驻生效");
    expect(note).not.toContain("常驻每帧多耗");
  });

  it("无 GPU timer：只给 CPU 值时明确禁止据其判决", () => {
    const note = buildNote({ ...base, gpuTimingAvailable: false });
    expect(note).toContain("勿据 submitMs 判决");
  });
});
