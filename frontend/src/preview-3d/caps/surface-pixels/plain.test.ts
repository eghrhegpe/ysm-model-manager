// @vitest-environment node
// ===== surface-pixels/plain — 纯色 + 微噪点生成器不变量（零 three / 零 DOM）=====
// 锁：① amp<=0 严格平色；② alpha 恒 255；③ amp>0 有界扰动（|Δ|≤amp）且可复现；
// ④ clamp 双向生效——高亮底色不得 255 溢出回绕成小值（文件头点名的 bug 类）。
import { describe, it, expect } from "vitest";
import { generatePlainPixels } from "./plain.ts";
import type { SurfacePixelInput } from "./types.ts";

const IN = (over: Partial<SurfacePixelInput> = {}): SurfacePixelInput => ({
  color: [128, 96, 64],
  color2: [128, 96, 64],
  gridSize: 8,
  density: 1,
  angleRad: 0,
  ...over,
});

// 采样尺寸 32（仓库 surface 生成器测试的既用口径）：微噪点频率是「每贴图周期数」，
// 尺寸过小会欠采样——噪声理应对尺寸不敏感，但断言「有扰动」需足够采样点。
const SIZE = 32;

/** 逐像素四通道展开（避免测试里散落 `*4` 下标魔法） */
function pixels(px: Uint8Array): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < px.length; i += 4) out.push([px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!]);
  return out;
}

describe("generatePlainPixels", () => {
  it("尺寸契约：长度 = sizePx²×4", () => {
    expect(generatePlainPixels(IN(), SIZE).length).toBe(SIZE * SIZE * 4);
  });

  it("amp 关（字段缺省 / 0 / 负数）→ 严格平色 + alpha 255", () => {
    // `exactOptionalPropertyTypes: true` 下不可传 `{microNoise: undefined}`（undefined 不是
    // number）——「缺省」必须是字段真的不存在，故 IN() 不带该键（而非带 undefined 值）。
    const cases: Array<[string, SurfacePixelInput]> = [
      ["字段缺省", IN()],
      ["0", IN({ microNoise: 0 })],
      ["负数", IN({ microNoise: -5 })],
    ];
    for (const [label, inp] of cases) {
      const px = generatePlainPixels(inp, SIZE);
      for (const [r, g, b, a] of pixels(px)) {
        expect([r, g, b, a], `amp=${label} 应严格平色`).toEqual([128, 96, 64, 255]);
      }
    }
  });

  it("amp>0 → 确实产生扰动（非平色），且每通道 |Δ| ≤ amp（中间色，无 clamp 干扰）", () => {
    const amp = 8;
    const px = pixels(generatePlainPixels(IN({ microNoise: amp }), SIZE));
    expect(new Set(px.map((p) => `${p[0]},${p[1]},${p[2]}`)).size).toBeGreaterThan(1);
    for (const [r, g, b, a] of px) {
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(amp);
      expect(Math.abs(g - 96)).toBeLessThanOrEqual(amp);
      expect(Math.abs(b - 64)).toBeLessThanOrEqual(amp);
      expect(a).toBe(255);
    }
  });

  it("同输入可复现（纯函数，无随机源）", () => {
    const a = generatePlainPixels(IN({ microNoise: 12 }), SIZE);
    const b = generatePlainPixels(IN({ microNoise: 12 }), SIZE);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("高亮底色 + 大 amp：clamp 上界生效，绝不回绕成小值", () => {
    const amp = 40;
    for (const [r, g, b] of pixels(
      generatePlainPixels(IN({ color: [255, 255, 255], microNoise: amp }), SIZE),
    )) {
      expect(r).toBeGreaterThanOrEqual(255 - amp);
      expect(g).toBeGreaterThanOrEqual(255 - amp);
      expect(b).toBeGreaterThanOrEqual(255 - amp);
    }
  });

  it("暗底色 + 大 amp：clamp 下界生效，绝不回绕成大值", () => {
    const amp = 40;
    for (const [r, g, b] of pixels(
      generatePlainPixels(IN({ color: [0, 0, 0], microNoise: amp }), SIZE),
    )) {
      expect(r).toBeLessThanOrEqual(amp);
      expect(g).toBeLessThanOrEqual(amp);
      expect(b).toBeLessThanOrEqual(amp);
    }
  });
});
