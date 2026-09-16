// ===== surface-pixels/anti-repeat.test.ts — 去重复解法验证（node 可测，零 three）=====
import { describe, expect, it } from "vitest";
import { generateGrassPixels } from "./grass.ts";
import { generateMarblePixels } from "./marble.ts";
import type { SurfacePixelInput } from "./types.ts";
import {
  derandomize,
  derandomizeDual,
  makeDecorrelatedVariant,
  maxSeamDiscontinuity,
  maxWrapSeamDiscontinuity,
  repetitionScore,
  textureRepeatForDerepeat,
  tilePlain,
} from "./anti-repeat.ts";

const S = 64; // 源 tile 边长
const N = 4; // tilesPerAxis → 输出 256²，16 子块

function grassTile(density: number): Uint8Array {
  const input: SurfacePixelInput = {
    color: [76, 122, 58],
    color2: [47, 85, 36],
    gridSize: 8,
    density,
    angleRad: 0,
  };
  return generateGrassPixels(input, S);
}

function marbleTile(): Uint8Array {
  const input: SurfacePixelInput = {
    color: [232, 229, 223],
    color2: [143, 138, 128],
    gridSize: 6,
    density: 1.5,
    angleRad: 0,
  };
  return generateMarblePixels(input, S);
}

function allAlpha255(px: Uint8Array): boolean {
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
  return true;
}

// 输入的固有缝（来自 4D 环面噪声在固定分辨率下的亚像素边界残差；S=512 实际可忽略）。
// anti-repeat 的契约是「不引入新缝」，故以它为基准。
const INPUT_SEAM = maxSeamDiscontinuity(tilePlain(grassTile(1.5), S, N), N * S, S);

describe("anti-repeat：基线（完全重复）", () => {
  it("平铺大图的重复评分应≈0（相邻子块逐像素相同）", () => {
    const base = tilePlain(grassTile(1.5), S, N);
    expect(repetitionScore(base, N * S, N)).toBeLessThan(1e-6);
    expect(allAlpha255(base)).toBe(true);
  });
});

describe("macro（低频宏观叠加）", () => {
  it("输出尺寸 = N*S，A 恒 255", () => {
    const out = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N });
    expect(out.length).toBe((N * S) * (N * S) * 4);
    expect(allAlpha255(out)).toBe(true);
  });

  it("重复评分显著大于基线（相邻子块不再相同）", () => {
    const base = tilePlain(grassTile(1.5), S, N);
    const out = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N });
    // 默认强度温和（±25% 亮度），MAD 约 0.017；>0.012 即证明确实打破了完全重复
    expect(repetitionScore(out, N * S, N)).toBeGreaterThan(repetitionScore(base, N * S, N) + 0.012);
  });

  it("strength=0 退化为原平铺（逐像素相等）", () => {
    const plain = tilePlain(grassTile(1.5), S, N);
    const out = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N, macroStrength: 0 });
    expect(Array.from(out)).toEqual(Array.from(plain));
  });

  it("未引入新接缝（缝 ≤ 输入固有缝 + 调制微差）", () => {
    const out = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N });
    // 宏观调制在缝处叠加极小量（factor 连续），容差 +2 仍属「无新缝」
    expect(maxSeamDiscontinuity(out, N * S, S)).toBeLessThanOrEqual(INPUT_SEAM + 2);
    // 回绕边界（RepeatWrapping 真正可见处）：周期化低频场后须≈输入固有残差
    // （旧非周期实现 macro 回绕缝 28 vs 固有 20——审核 3aac32d60 P1 回归）
    expect(maxWrapSeamDiscontinuity(out, N * S)).toBeLessThanOrEqual(INPUT_SEAM + 2);
  });

  it("同种子可复现", () => {
    const a = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N, seed: 7 });
    const b = derandomize(grassTile(1.5), S, { strategy: "macro", tilesPerAxis: N, seed: 7 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("stochastic（随机瓦片）", () => {
  it("输出尺寸 = N*S，A 恒 255", () => {
    const out = derandomize(grassTile(1.5), S, { strategy: "stochastic", tilesPerAxis: N });
    expect(out.length).toBe((N * S) * (N * S) * 4);
    expect(allAlpha255(out)).toBe(true);
  });

  it("重复评分显著大于基线", () => {
    const base = tilePlain(grassTile(1.5), S, N);
    const out = derandomize(grassTile(1.5), S, { strategy: "stochastic", tilesPerAxis: N });
    expect(repetitionScore(out, N * S, N)).toBeGreaterThan(repetitionScore(base, N * S, N) + 0.012);
  });

  it("未引入新接缝（羽化回 base 保无缝）", () => {
    const out = derandomize(grassTile(1.5), S, { strategy: "stochastic", tilesPerAxis: N, blend: 4 });
    expect(maxSeamDiscontinuity(out, N * S, S)).toBeLessThanOrEqual(INPUT_SEAM + 1);
    // 回绕边界同样须受控（羽化已保证 x=0 与 x=out-1 同归 base）
    expect(maxWrapSeamDiscontinuity(out, N * S)).toBeLessThanOrEqual(INPUT_SEAM + 1);
  });

  it("同种子可复现", () => {
    const a = derandomize(grassTile(1.5), S, { strategy: "stochastic", tilesPerAxis: N, seed: 11 });
    const b = derandomize(grassTile(1.5), S, { strategy: "stochastic", tilesPerAxis: N, seed: 11 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("dual（双变体混合）", () => {
  it("两份不同材质变体（草×大理石）→ 输出 N*S，重复评分>基线，保无缝", () => {
    const a = grassTile(1.5);
    const b = marbleTile();
    const base = tilePlain(a, S, N);
    // 输出缝契约：不超出「两份源 tile 各自的固有缝」最大值（不引入新缝）
    const srcSeam = Math.max(
      maxSeamDiscontinuity(tilePlain(a, S, N), N * S, S),
      maxSeamDiscontinuity(tilePlain(b, S, N), N * S, S),
    );
    const out = derandomizeDual(a, b, S, { tilesPerAxis: N });
    expect(out.length).toBe((N * S) * (N * S) * 4);
    expect(allAlpha255(out)).toBe(true);
    expect(repetitionScore(out, N * S, N)).toBeGreaterThan(repetitionScore(base, N * S, N) + 0.02);
    expect(maxSeamDiscontinuity(out, N * S, S)).toBeLessThanOrEqual(srcSeam + 1);
    // 回绕边界：周期化 A/B 混合场后须≈两份源 tile 的回绕残差最大值
    // （旧非周期实现 dual 回绕缝 181 vs 内部 77——审核 3aac32d60 P1 回归）
    const srcWrap = Math.max(
      maxWrapSeamDiscontinuity(tilePlain(a, S, N), N * S),
      maxWrapSeamDiscontinuity(tilePlain(b, S, N), N * S),
    );
    expect(maxWrapSeamDiscontinuity(out, N * S)).toBeLessThanOrEqual(srcWrap + 2);
  });

  it("近似变体（makeDecorrelatedVariant）亦能去重复（弱于真实双种子）", () => {
    const a = grassTile(1.5);
    const b = makeDecorrelatedVariant(a, S, 3);
    const out = derandomizeDual(a, b, S, { tilesPerAxis: N });
    expect(repetitionScore(out, N * S, N)).toBeGreaterThan(0.003);
  });

  it("同种子可复现", () => {
    const a = grassTile(1.5);
    const b = marbleTile();
    const x = derandomizeDual(a, b, S, { tilesPerAxis: N, seed: 5 });
    const y = derandomizeDual(a, b, S, { tilesPerAxis: N, seed: 5 });
    expect(Array.from(x)).toEqual(Array.from(y));
  });
});

describe("部署辅助", () => {
  it("textureRepeatForDerepeat 把基线 repeat 放大 tilesPerAxis 倍（保持每米密度）", () => {
    expect(textureRepeatForDerepeat(20, 4)).toBe(5);
    expect(textureRepeatForDerepeat(20, 1)).toBe(20);
  });
});
