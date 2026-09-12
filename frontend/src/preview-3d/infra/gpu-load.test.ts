// ===== gpu-load 纯判定 + 采样封装测试（2026 锐评刀⑩ + P1 维度补强）=====
// evaluateGpuLoad 为纯函数（无 WebGL 依赖，happy-dom/node 可测）；
// sampleGpuLoad 是薄封装（只读 renderer.info 字段，不触发渲染）。
//
// P1 补强维度：triangles（几何负载）+ textureBytes（显存字节）——
// 原实现只看 draw calls + 纹理数，判不出「50 万面 MMD」与「5 千面方块」的差别。

import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import {
  DEFAULT_GPU_LOAD_LIMITS,
  evaluateGpuLoad,
  sampleGpuLoad,
  type GpuLoadSample,
} from "./gpu-load.ts";

const s = (
  drawCalls: number,
  textures: number,
  programs = 0,
  triangles = 0,
  textureBytes?: number,
): GpuLoadSample => ({
  drawCalls,
  triangles,
  textures,
  programs,
  textureBytes,
});

describe("evaluateGpuLoad 纯判定", () => {
  it("负载低于预算 → ok（reasons 为空）", () => {
    const v = evaluateGpuLoad(s(100, 10));
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("恰好触上限值 → 不超（判定为严格 >）", () => {
    expect(
      evaluateGpuLoad(
        s(
          DEFAULT_GPU_LOAD_LIMITS.drawCalls,
          DEFAULT_GPU_LOAD_LIMITS.textures,
          0,
          DEFAULT_GPU_LOAD_LIMITS.triangles,
          DEFAULT_GPU_LOAD_LIMITS.textureBytes,
        ),
      ).ok,
    ).toBe(true);
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

// ---------------------------------------------------------------------------
// P1 补强：triangles 维度（几何负载——draw calls 判不出的差异）
// ---------------------------------------------------------------------------

describe("evaluateGpuLoad triangles 维度（P1 补强）", () => {
  it("三角面超限 → reasons 附实测值（即使 draw calls 很低）", () => {
    const v = evaluateGpuLoad(s(1, 1, 0, 2_000_000));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([`triangles 2000000 > ${DEFAULT_GPU_LOAD_LIMITS.triangles}`]);
  });

  it("三角面恰好等于上限 → 不超（严格 >）", () => {
    const v = evaluateGpuLoad(s(1, 1, 0, DEFAULT_GPU_LOAD_LIMITS.triangles));
    expect(v.ok).toBe(true);
  });

  it("draw calls 相同但三角面天差地别 → 后者被拦（原实现判不出的场景）", () => {
    const lowPoly = s(1, 1, 0, 5_000); // 5 千面方块模型
    const highPoly = s(1, 1, 0, 500_000 * 3); // 150 万面 MMD 堆叠
    expect(evaluateGpuLoad(lowPoly).ok).toBe(true);
    expect(evaluateGpuLoad(highPoly).ok).toBe(false);
  });

  it("limits.triangles 可覆盖", () => {
    const v = evaluateGpuLoad(s(1, 1, 0, 900_000), { triangles: 400_000 });
    expect(v.reasons).toEqual(["triangles 900000 > 400000"]);
  });
});

// ---------------------------------------------------------------------------
// P1 补强：textureBytes 维度（显存字节——纹理数判不出的差异）
// ---------------------------------------------------------------------------

describe("evaluateGpuLoad textureBytes 维度（P1 补强）", () => {
  it("未提供 textureBytes → 该项不判定（不误报）", () => {
    const v = evaluateGpuLoad(s(1, 1)); // textureBytes undefined
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("提供且超限 → reasons 带 MB 可读值", () => {
    const v = evaluateGpuLoad(s(1, 1, 0, 0, 512 * 1024 * 1024));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual(["texture bytes 512MB > 256MB"]);
  });

  it("提供且未超 → 不报", () => {
    const v = evaluateGpuLoad(s(1, 1, 0, 0, 128 * 1024 * 1024));
    expect(v.ok).toBe(true);
  });

  it("纹理数相同但字节天差地别 → 后者被拦（原实现判不出的场景）", () => {
    // 注：4 张 4K（4×4096²×4 = 256MB）恰好等于默认上限，严格 > 不触发；
    // 这里用 8K 拉开差距，同时说明 256MB 预算对 4K 纹理堆叠是紧的。
    const small = s(1, 4, 0, 0, 4 * 16 * 16 * 4); // 4 张 16×16 ≈ 4KB
    const huge = s(1, 4, 0, 0, 4 * 8192 * 8192 * 4); // 4 张 8K ≈ 1GB
    expect(evaluateGpuLoad(small).ok).toBe(true);
    expect(evaluateGpuLoad(huge).ok).toBe(false);
  });

  it("四维同超 → reasons 四条，顺序为 draw calls / triangles / textures / texture bytes", () => {
    const v = evaluateGpuLoad(s(5000, 4000, 0, 2_000_000, 512 * 1024 * 1024));
    expect(v.reasons).toHaveLength(4);
    expect(v.reasons[0]).toContain("draw calls");
    expect(v.reasons[1]).toContain("triangles");
    expect(v.reasons[2]).toContain("textures");
    expect(v.reasons[3]).toContain("texture bytes");
  });
});

describe("sampleGpuLoad 薄封装", () => {
  it("读 renderer.info 字段（calls/triangles 为上一帧值，读值无副作用）", () => {
    const renderer = {
      info: {
        render: { calls: 42, triangles: 1234 },
        memory: { textures: 7 },
        programs: [1, 2, 3],
      },
    } as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer)).toEqual({
      drawCalls: 42,
      triangles: 1234,
      textures: 7,
      programs: 3,
    });
  });

  it("info.programs 缺失 → programs=0（老版本 three 兼容）", () => {
    const renderer = {
      info: { render: { calls: 1, triangles: 0 }, memory: { textures: 0 }, programs: undefined },
    } as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer).programs).toBe(0);
  });

  it("可选 textureBytes 透传进快照（供预算判定）", () => {
    const renderer = {
      info: { render: { calls: 1, triangles: 0 }, memory: { textures: 0 }, programs: [] },
    } as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer, 64 * 1024 * 1024).textureBytes).toBe(64 * 1024 * 1024);
    expect(sampleGpuLoad(renderer).textureBytes).toBeUndefined();
  });

  // fail-open 语义守卫：WebGPU 后端 / 老版本 three / 测试 mock 的 info 结构未必齐全，
  // 缺字段读 0（宁放行勿误拦）——预算门是「病态堆叠早拦」护栏，不是加载的必要前提。
  it("info 缺失 → 全部读 0（fail-open，不误拦加载）", () => {
    const renderer = {} as unknown as THREE.WebGLRenderer;
    expect(sampleGpuLoad(renderer)).toEqual({
      drawCalls: 0,
      triangles: 0,
      textures: 0,
      programs: 0,
      textureBytes: undefined,
    });
    expect(evaluateGpuLoad(sampleGpuLoad(renderer)).ok).toBe(true);
  });

  it("info.render / info.memory 子字段缺失 → 读 0（部分结构缺失同样 fail-open）", () => {
    const renderer = { info: { programs: [1] } } as unknown as THREE.WebGLRenderer;
    const snap = sampleGpuLoad(renderer);
    expect(snap.drawCalls).toBe(0);
    expect(snap.triangles).toBe(0);
    expect(snap.textures).toBe(0);
    expect(snap.programs).toBe(1);
    expect(evaluateGpuLoad(snap).ok).toBe(true);
  });
});
