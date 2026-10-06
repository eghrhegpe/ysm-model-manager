// @vitest-environment node
// ===== env-pixels — luminanceHistogram 纯计算测试 =====
// 16-bin 亮度直方图：数据源 customHdrTex（HalfFloat Uint16）优先，无则走程序化背景，再无可回退全 0。
// 用真实 THREE.DataUtils（toHalfFloat/fromHalfFloat 为纯 JS，test-setup 只 stub 渲染器）构造确定性输入。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { luminanceHistogram } from "./env-pixels.ts";

/** 构造一张 half-float DataTexture 的 image 假体（只喂 luminanceHistogram 需要的字段） */
const hdrImage = (width: number, height: number, rgbValue: number) => {
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(rgbValue);
  return { data, width, height };
};

const hdrTex = (img: unknown) => ({ image: img }) as unknown as THREE.DataTexture;

describe("luminanceHistogram — 无数据源", () => {
  it("无任何贴图 → 返回 16 个全 0 bin", () => {
    const hist = luminanceHistogram(null, null);
    expect(hist.length).toBe(16);
    expect(hist).toEqual(new Array(16).fill(0));
  });
});

describe("luminanceHistogram — customHdrTex 分支（HalfFloat）", () => {
  it("恒定亮度 1.0 → 全部落入同一 Reinhard 映射 bin（与实现同口径推算，防 FP 边界漂移）", () => {
    const hist = luminanceHistogram(hdrTex(hdrImage(64, 64, 1.0)), null);
    const total = hist.reduce((a, b) => a + b, 0);
    expect(total).toBe(64 * 64); // 64×64 → stride=1，全采样
    // 按实现同口径推算期望 bin（含 Rec.601 亮度加权，避免只按单通道值推到相邻 bin）
    const v = THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(1.0));
    const lum = 0.299 * v + 0.587 * v + 0.114 * v;
    const mapped = lum / (1 + lum);
    const expectedBin = Math.min(15, Math.floor(mapped * 16));
    expect(hist[expectedBin]).toBe(64 * 64);
    expect(hist.filter((n, i) => i !== expectedBin && n !== 0)).toEqual([]);
  });

  it("全黑（亮度 0）→ 全部落入 bin 0", () => {
    const hist = luminanceHistogram(hdrTex(hdrImage(32, 32, 0)), null);
    expect(hist[0]).toBe(32 * 32);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(32 * 32);
  });

  it("HDR image 缺 data/尺寸 → 回退到程序化分支并最终返回全 0", () => {
    const hist = luminanceHistogram(hdrTex({}), null);
    expect(hist).toEqual(new Array(16).fill(0));
  });
});