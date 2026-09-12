// ===== GPU 预算真机标定测试（P4）=====
// 纯逻辑（tracker / suggest / resolve）全可测；runGpuBudgetCalibration 经注入
// 时间源/等待器走假时钟，不真 sleep。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";
import type { GpuLoadSample } from "./gpu-load.ts";
import { DEFAULT_GPU_LOAD_LIMITS } from "./gpu-load.ts";
import {
  CALIBRATION_SAFETY_FACTOR,
  GPU_BUDGET_CALIBRATION_KEY,
  clearGpuBudgetCalibration,
  createCalibrationTracker,
  makeGpuSampler,
  resolveGpuLoadLimits,
  runGpuBudgetCalibration,
  suggestGpuLimits,
} from "./gpu-load-calibrate.ts";

const snap = (o: Partial<GpuLoadSample> = {}): GpuLoadSample => ({
  drawCalls: 0,
  triangles: 0,
  textures: 0,
  programs: 0,
  ...o,
});

beforeEach(() => {
  localStorage.removeItem(GPU_BUDGET_CALIBRATION_KEY);
});

describe("createCalibrationTracker", () => {
  it("记录各维度峰值（取 max 而非末值）", () => {
    const t = createCalibrationTracker();
    t.observe(snap({ drawCalls: 100, triangles: 5000, textures: 10, textureBytes: 1024 }));
    t.observe(snap({ drawCalls: 300, triangles: 1000, textures: 5, textureBytes: 2048 }));
    t.observe(snap({ drawCalls: 200, triangles: 9000, textures: 20, textureBytes: 512 }));
    const { peak, samples } = t.snapshot();
    expect(samples).toBe(3);
    expect(peak).toEqual({ drawCalls: 300, triangles: 9000, textures: 20, textureBytes: 2048 });
  });

  it("textureBytes 缺失按 0 计（不污染其他维度）", () => {
    const t = createCalibrationTracker();
    t.observe(snap({ drawCalls: 50 }));
    expect(t.snapshot().peak.textureBytes).toBe(0);
    expect(t.snapshot().peak.drawCalls).toBe(50);
  });

  it("snapshot 返回副本（外部改动不影响内部状态）", () => {
    const t = createCalibrationTracker();
    t.observe(snap({ drawCalls: 10 }));
    const s1 = t.snapshot();
    s1.peak.drawCalls = 9999;
    expect(t.snapshot().peak.drawCalls).toBe(10);
  });
});

describe("suggestGpuLimits", () => {
  it("峰值 × 安全系数（向上取整）", () => {
    const s = suggestGpuLimits(
      { drawCalls: 100, triangles: 1000, textures: 10, textureBytes: 1000 },
      1.5,
    );
    expect(s).toEqual({
      drawCalls: 150,
      triangles: 1500,
      textures: 15,
      textureBytes: 1500,
    });
  });

  it("小数结果向上取整（不低估预算）", () => {
    const s = suggestGpuLimits(
      { drawCalls: 101, triangles: 0, textures: 0, textureBytes: 0 },
      CALIBRATION_SAFETY_FACTOR,
    );
    expect(s.drawCalls).toBe(Math.ceil(101 * 1.5)); // 152
  });

  it("某维度峰值为 0（未采样到）→ 该维度回落默认，不压成 0 误拦一切", () => {
    const s = suggestGpuLimits({ drawCalls: 800, triangles: 0, textures: 0, textureBytes: 0 });
    expect(s.drawCalls).toBe(1200);
    expect(s.triangles).toBe(DEFAULT_GPU_LOAD_LIMITS.triangles);
    expect(s.textures).toBe(DEFAULT_GPU_LOAD_LIMITS.textures);
    expect(s.textureBytes).toBe(DEFAULT_GPU_LOAD_LIMITS.textureBytes);
  });
});

describe("resolveGpuLoadLimits", () => {
  it("无标定记录 → 默认预算", () => {
    expect(resolveGpuLoadLimits()).toEqual(DEFAULT_GPU_LOAD_LIMITS);
  });

  it("有标定记录 → 标定值生效", () => {
    localStorage.setItem(
      GPU_BUDGET_CALIBRATION_KEY,
      JSON.stringify({ drawCalls: 500, triangles: 600, textures: 700, textureBytes: 800 }),
    );
    expect(resolveGpuLoadLimits()).toEqual({
      drawCalls: 500,
      triangles: 600,
      textures: 700,
      textureBytes: 800,
    });
  });

  it("损坏 JSON → 回落默认（fail-open，不拦死加载）", () => {
    localStorage.setItem(GPU_BUDGET_CALIBRATION_KEY, "{ not json");
    expect(resolveGpuLoadLimits()).toEqual(DEFAULT_GPU_LOAD_LIMITS);
  });

  it("非法字段（负数/非数值/字符串）→ 逐字段回落默认", () => {
    localStorage.setItem(
      GPU_BUDGET_CALIBRATION_KEY,
      JSON.stringify({ drawCalls: -5, triangles: "abc", textures: 0, textureBytes: 3000 }),
    );
    const r = resolveGpuLoadLimits();
    expect(r.drawCalls).toBe(DEFAULT_GPU_LOAD_LIMITS.drawCalls);
    expect(r.triangles).toBe(DEFAULT_GPU_LOAD_LIMITS.triangles);
    expect(r.textures).toBe(DEFAULT_GPU_LOAD_LIMITS.textures); // 0 非法 → 默认
    expect(r.textureBytes).toBe(3000); // 合法 → 保留
  });

  it("clearGpuBudgetCalibration 清除后回落默认", () => {
    localStorage.setItem(GPU_BUDGET_CALIBRATION_KEY, JSON.stringify({ drawCalls: 500 }));
    clearGpuBudgetCalibration();
    expect(resolveGpuLoadLimits()).toEqual(DEFAULT_GPU_LOAD_LIMITS);
  });
});

describe("runGpuBudgetCalibration（注入假时钟）", () => {
  it("按 durationMs 采样、返回峰值 + 建议值，并落盘", async () => {
    let clock = 0;
    let i = 0;
    const sample = (): GpuLoadSample => {
      i++;
      return snap({
        drawCalls: i * 10,
        triangles: i,
        textures: i,
        textureBytes: i * 100,
      });
    };
    const result = await runGpuBudgetCalibration(sample, 250, {
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
    });
    // 假时钟推进 100/次：t=0 采 → 100 → 200 → 300 退出 = 3 个样本
    expect(result.samples).toBe(3);
    expect(result.peak.drawCalls).toBe(30);
    expect(result.suggested.drawCalls).toBe(45);
    // 落盘 = 真的生效（resolveGpuLoadLimits 读同一 key）
    expect(resolveGpuLoadLimits().drawCalls).toBe(45);
  });

  it("durationMs=0 → 仍采一次（不返回全 0 峰值）", async () => {
    let clock = 0;
    const result = await runGpuBudgetCalibration(() => snap({ drawCalls: 42 }), 0, {
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
    });
    expect(result.samples).toBe(1);
    expect(result.peak.drawCalls).toBe(42);
  });
});

describe("makeGpuSampler", () => {
  it("renderer 就绪 → 读 info + 注入纹理字节", () => {
    const renderer = {
      info: {
        render: { calls: 77, triangles: 888 },
        memory: { textures: 9 },
        programs: [1],
      },
    } as unknown as THREE.WebGLRenderer;
    const sampler = makeGpuSampler(() => renderer, () => 4096);
    expect(sampler()).toEqual({
      drawCalls: 77,
      triangles: 888,
      textures: 9,
      programs: 1,
      textureBytes: 4096,
    });
  });

  it("renderer 未就绪（self 模式 / 会话间隙）→ 全 0 快照，不污染峰值", () => {
    const sampler = makeGpuSampler(() => null, () => 4096);
    expect(sampler()).toEqual({
      drawCalls: 0,
      triangles: 0,
      textures: 0,
      programs: 0,
    });
  });
});

describe("installGpuCalibrationHook", () => {
  it("幂等安装 window 钩子（命名不带 __ 前缀，对齐 debugGetSpec 先例），可标定与重置", async () => {
    const { installGpuCalibrationHook } = await import("./gpu-load-calibrate.ts");
    const w = window as unknown as {
      ysmCalibrateGpuBudget?: (ms?: number) => Promise<unknown>;
      ysmResetGpuBudget?: () => void;
    };
    const spy = vi.fn(() => snap({ drawCalls: 11 }));
    installGpuCalibrationHook(spy);
    const first = w.ysmCalibrateGpuBudget;
    installGpuCalibrationHook(spy); // 二次调用幂等（不覆盖）
    expect(w.ysmCalibrateGpuBudget).toBe(first);
    expect(typeof w.ysmResetGpuBudget).toBe("function");
    expect(w.ysmCalibrateGpuBudget?.(0)).toBeInstanceOf(Promise);
    w.ysmResetGpuBudget?.();
    // 清理：避免污染其他测试文件的 window
    Reflect.deleteProperty(w, "ysmCalibrateGpuBudget");
    Reflect.deleteProperty(w, "ysmResetGpuBudget");
  });
});
