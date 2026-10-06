// @vitest-environment node
// ===== surface-pixels/sand — 沙子生成器不变量（零 three / 零 DOM）=====
// 锁：① 双色线性插值有界（t 已 clamp 到 [0,1] ⇒ 输出恒落在两端色之间）；
// ② alpha 恒 255；③ 可复现；④ density<0.25 / gridSize<1 的下限保护是**等价类**
// （断言「输出逐字节相同」而非「看起来合理」）；⑤ color===color2 退化恒色。
import { describe, it, expect } from "vitest";
import { generateSandPixels } from "./sand.ts";
import type { SurfacePixelInput } from "./types.ts";

const IN = (over: Partial<SurfacePixelInput> = {}): SurfacePixelInput => ({
  color: [210, 180, 130],
  color2: [150, 120, 80],
  gridSize: 8,
  density: 1,
  angleRad: 0,
  ...over,
});

// 采样尺寸 32（与 ground-surface-spec.test.ts 同口径）：`baseFreq` 是「每贴图周期数」，
// 尺寸必须显著大于频率才分辨得出颗粒——16px / freq16 = 一像素一周期，欠采样退化成平色
// （本测初版即踩此坑：不是生成器 bug，是测试尺寸小于奈奎斯特）。
const SIZE = 32;

/** 逐像素四通道展开（避免测试里散落 `*4` 下标魔法） */
function pixels(px: Uint8Array): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < px.length; i += 4) out.push([px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!]);
  return out;
}

describe("generateSandPixels", () => {
  it("尺寸契约 + alpha 恒 255", () => {
    const px = generateSandPixels(IN(), SIZE);
    expect(px.length).toBe(SIZE * SIZE * 4);
    for (const [, , , a] of pixels(px)) expect(a).toBe(255);
  });

  it("双色插值有界：每通道落在两端色之间（round 给 ±1 容差）", () => {
    const inp = IN();
    const lo = (i: number) => Math.min(inp.color[i]!, inp.color2[i]!) - 1;
    const hi = (i: number) => Math.max(inp.color[i]!, inp.color2[i]!) + 1;
    for (const [r, g, b] of pixels(generateSandPixels(inp, SIZE))) {
      expect(r).toBeGreaterThanOrEqual(lo(0));
      expect(r).toBeLessThanOrEqual(hi(0));
      expect(g).toBeGreaterThanOrEqual(lo(1));
      expect(g).toBeLessThanOrEqual(hi(1));
      expect(b).toBeGreaterThanOrEqual(lo(2));
      expect(b).toBeLessThanOrEqual(hi(2));
    }
  });

  it("color === color2 → 退化恒色（噪声不再改变任何像素）", () => {
    const c: [number, number, number] = [77, 88, 99];
    for (const [r, g, b] of pixels(generateSandPixels(IN({ color: c, color2: c }), SIZE))) {
      expect([r, g, b]).toEqual(c);
    }
  });

  it("确实产生颗粒（非平色）", () => {
    const distinct = new Set(
      pixels(generateSandPixels(IN(), SIZE)).map((p) => `${p[0]},${p[1]},${p[2]}`),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("同输入可复现（纯函数，无随机源）", () => {
    expect(Array.from(generateSandPixels(IN(), SIZE))).toEqual(
      Array.from(generateSandPixels(IN(), SIZE)),
    );
  });

  it("density 下限保护：<=0.25 与 0.25 输出逐字节相同", () => {
    expect(Array.from(generateSandPixels(IN({ density: 0 }), SIZE))).toEqual(
      Array.from(generateSandPixels(IN({ density: 0.25 }), SIZE)),
    );
  });

  it("gridSize 下限保护：<1 与 1 输出逐字节相同", () => {
    expect(Array.from(generateSandPixels(IN({ gridSize: 0 }), SIZE))).toEqual(
      Array.from(generateSandPixels(IN({ gridSize: 1 }), SIZE)),
    );
  });

  it("angleRad 参与环面相位：角度改变会改变输出", () => {
    expect(Array.from(generateSandPixels(IN({ angleRad: 0 }), SIZE))).not.toEqual(
      Array.from(generateSandPixels(IN({ angleRad: 1.1 }), SIZE)),
    );
  });
});
