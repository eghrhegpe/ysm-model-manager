// ===== GPU 预算门禁（共享判定 + 提示）测试 =====
// 覆盖：预算内放行 / 超限拦截 + toast / 消费标定后的生效预算 /
// 纹理字节维度经 textureCache 聚合。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";
import { bus } from "@/bus";
import { textureCache } from "@/preview-3d/texture/texture-cache.ts";
import { DEFAULT_GPU_LOAD_LIMITS } from "./gpu-load.ts";
import { GPU_BUDGET_CALIBRATION_KEY } from "./gpu-load-calibrate.ts";
import { guardGpuBudget } from "./gpu-budget.ts";

const renderer = (o: {
  calls?: number;
  triangles?: number;
  textures?: number;
}): THREE.WebGLRenderer =>
  ({
    info: {
      render: { calls: o.calls ?? 0, triangles: o.triangles ?? 0 },
      memory: { textures: o.textures ?? 0 },
      programs: [],
    },
  }) as unknown as THREE.WebGLRenderer;

const MIP_FACTOR = 4 / 3;

/** 往全局 textureCache 塞一张 w×h 的假纹理（字节维度测试用）。
 *  `generateMipmaps` 未设 → 按 three 默认 true → 计 mip 链系数。 */
const seedTexture = (url: string, w: number, h: number): void => {
  textureCache.acquire(url, () => ({ image: { width: w, height: h } }) as unknown as THREE.Texture);
};

beforeEach(() => {
  localStorage.removeItem(GPU_BUDGET_CALIBRATION_KEY);
});

afterEach(() => {
  textureCache.disposeAll(); // 模块级单例，防跨用例串扰
  vi.restoreAllMocks();
});

describe("guardGpuBudget", () => {
  it("负载在预算内 → 放行（true），不发 toast", () => {
    const spy = vi.spyOn(bus, "emit");
    expect(guardGpuBudget(renderer({ calls: 100, triangles: 1000, textures: 10 }), "preview.gpuBudgetAppend")).toBe(
      true,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("draw calls 超限 → 拦截（false）+ toast warn 附实测值", () => {
    const toasts: unknown[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    try {
      expect(
        guardGpuBudget(renderer({ calls: 2000 }), "preview.gpuBudgetAppend"),
      ).toBe(false);
      expect(toasts).toHaveLength(1);
      const p = toasts[0] as { msg: string; type: string };
      expect(p.type).toBe("warn");
      expect(p.msg).toContain("GPU 负载已超预算");
      expect(p.msg).toContain("2000 > 1600");
    } finally {
      off();
    }
  });

  it("三角面超限 → 拦截（draw calls 很低也拦）", () => {
    expect(
      guardGpuBudget(renderer({ calls: 1, triangles: 2_000_000 }), "preview.gpuBudgetLoad"),
    ).toBe(false);
  });

  it("纹理字节超限（经 textureCache 聚合）→ 拦截", () => {
    // 8 张 8K（含 mip 链）≈ 2.7GB > 256MB 默认上限
    // 口径：逐张 Math.round 后累加（实现如此，非整体 round）
    for (let i = 0; i < 8; i++) seedTexture(`/tex${i}.png`, 8192, 8192);
    expect(textureCache.getTotalBytes()).toBe(
      8 * Math.round(8192 * 8192 * 4 * MIP_FACTOR),
    );
    expect(guardGpuBudget(renderer({ calls: 10 }), "preview.gpuBudgetLoad")).toBe(false);
  });

  it("4 张 4K 含 mip 链 → 确定超 256MB 默认上限（补 mip 前的踩线态已消除）", () => {
    for (let i = 0; i < 4; i++) seedTexture(`/k${i}.png`, 4096, 4096);
    expect(textureCache.getTotalBytes()).toBeGreaterThan(256 * 1024 * 1024);
    expect(guardGpuBudget(renderer({ calls: 10 }), "preview.gpuBudgetLoad")).toBe(false);
  });

  it("generateMipmaps=false 的纹理不计 mip 系数", () => {
    textureCache.acquire(
      "/nomip.png",
      () =>
        ({
          image: { width: 1024, height: 1024 },
          generateMipmaps: false,
        }) as unknown as THREE.Texture,
    );
    expect(textureCache.getTotalBytes()).toBe(1024 * 1024 * 4);
  });

  it("纹理数量少但字节小 → 放行（字节维度不误报）", () => {
    seedTexture("/small.png", 16, 16);
    expect(guardGpuBudget(renderer({ calls: 10, textures: 1 }), "preview.gpuBudgetLoad")).toBe(true);
  });

  it("消费标定后的**生效**预算（标定放宽后原超限值放行）", () => {
    // 默认上限 1600 draw calls → 2000 超限
    expect(guardGpuBudget(renderer({ calls: 2000 }), "preview.gpuBudgetAppend")).toBe(false);
    // 标定把线抬到 5000 → 同一负载放行（证明标定真的改变拦截行为）
    localStorage.setItem(
      GPU_BUDGET_CALIBRATION_KEY,
      JSON.stringify({ drawCalls: 5000 }),
    );
    expect(guardGpuBudget(renderer({ calls: 2000 }), "preview.gpuBudgetAppend")).toBe(true);
  });

  it("标定收紧后原放行值被拦（标定双向生效）", () => {
    localStorage.setItem(
      GPU_BUDGET_CALIBRATION_KEY,
      JSON.stringify({ drawCalls: 100 }),
    );
    expect(guardGpuBudget(renderer({ calls: 200 }), "preview.gpuBudgetAppend")).toBe(false);
    expect(guardGpuBudget(renderer({ calls: 50 }), "preview.gpuBudgetAppend")).toBe(true);
  });

  it("恰好在默认上限 → 放行（严格 >）", () => {
    expect(
      guardGpuBudget(
        renderer({
          calls: DEFAULT_GPU_LOAD_LIMITS.drawCalls,
          triangles: DEFAULT_GPU_LOAD_LIMITS.triangles,
          textures: DEFAULT_GPU_LOAD_LIMITS.textures,
        }),
        "preview.gpuBudgetAppend",
      ),
    ).toBe(true);
  });

  it("info 结构缺失 → fail-open 放行（不误拦加载）", () => {
    expect(guardGpuBudget({} as THREE.WebGLRenderer, "preview.gpuBudgetAppend")).toBe(true);
  });
});
