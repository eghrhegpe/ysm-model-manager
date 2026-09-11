// ===== gpu-load 纯判定 + 采样封装测试（2026 锐评刀⑩）=====
// evaluateGpuLoad 为纯函数（无 WebGL 依赖，happy-dom/node 可测）；
// sampleGpuLoad 是薄封装（只读 renderer.info 字段，不触发渲染）。

import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import {
  DEFAULT_GPU_LOAD_LIMITS,
  evaluateGpuLoad,
  sampleGpuLoad,
  type GpuLoadSample,
} from "./gpu-load.ts";

const s = (drawCalls: number, textures: number, programs = 0): GpuLoadSample => ({
  drawCalls,
  textures,
  programs,
});

describe("evaluateGpuLoad 纯判定", () => {
  it("负载低于预算 → ok（reasons 为空）", () => {
    const v = evaluateGpuLoad(s(100, 10));
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("恰好触上限值 → 不超（判定为严格 >）", () => {
    expect(evaluateGpuLoad(s(DEFAULT_GPU_LOAD_LIMITS.drawCalls, DEFAULT_GPU_LOAD_LIMITS.textures)).ok).toBe(
      true,
    );
  });

  it("单项超限 → reasons 附该项实测值（toast 证据展示）", () => {
    const v = evaluateGpuLoad(s(2000, 10));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([`draw calls 2000 > ${DEFAULT_GPU_LOAD_LIMITS.drawCalls}`]);
  });

  it("两项同超 → reasons 两条（draw calls 在前）", () => {
    const v = evaluateGpuLoad(s(5000, 4000));
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(2);
    expect(v.reasons[0]).toContain("draw calls 5000");
    expect(v.reasons[1]).toContain("textures 4000");
  });

  it("limits 单字段覆盖、缺省字段回落默认预算", () => {
    const v = evaluateGpuLoad(s(500, 50), { drawCalls: 400 });
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual(["draw calls 500 > 400"]); // textures 50 ≤ 默认 1024，未超
  });
});

describe("sampleGpuLoad 薄封装", () => {
  it("读 renderer.info 字段（calls 为上一帧值，读值无副作用）", () => {
    const renderer = {
      info: { render: { calls: 42 }, memory: { textures: 7 }, programs: [1, 2, 3] },
    } as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer)).toEqual({ drawCalls: 42, textures: 7, programs: 3 });
  });

  it("info.programs 缺失 → programs=0（老版本 three 兼容）", () => {
    const renderer = {
      info: { render: { calls: 1 }, memory: { textures: 0 }, programs: undefined },
    } as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer).programs).toBe(0);
  });
});
