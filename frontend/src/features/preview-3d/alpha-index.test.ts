import { describe, expect, it } from "vitest";
import {
  AlphaIndex,
  ALPHA_F_HOLE,
  ALPHA_F_TRANSLUCENT,
  ALPHA_F_VISIBLE,
  flagsForAlpha,
} from "./alpha-index.ts";

function rgba(w: number, h: number, alphaAt: (x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = 100;
      data[o + 1] = 100;
      data[o + 2] = 100;
      data[o + 3] = alphaAt(x, y);
    }
  }
  return data;
}

describe("flagsForAlpha", () => {
  it("maps binary and mid alpha to distinct flags", () => {
    expect(flagsForAlpha(255)).toBe(ALPHA_F_VISIBLE);
    expect(flagsForAlpha(0)).toBe(ALPHA_F_HOLE);
    expect(flagsForAlpha(128)).toBe(ALPHA_F_TRANSLUCENT);
    expect(flagsForAlpha(1)).toBe(ALPHA_F_TRANSLUCENT);
    expect(flagsForAlpha(254)).toBe(ALPHA_F_TRANSLUCENT);
  });
});

describe("AlphaIndex", () => {
  it("answers exact single-pixel queries", () => {
    const idx = new AlphaIndex(
      rgba(3, 2, (x) => (x === 0 ? 0 : x === 1 ? 128 : 255)),
      3,
      2,
    );
    expect(idx.query(0, 0, 0, 1)).toBe(ALPHA_F_HOLE);
    expect(idx.query(1, 0, 1, 1)).toBe(ALPHA_F_TRANSLUCENT);
    expect(idx.query(2, 0, 2, 1)).toBe(ALPHA_F_VISIBLE);
  });

  it("aggregates flags across tile boundaries", () => {
    const idx = new AlphaIndex(
      rgba(16, 16, (x, y) => (x === 5 && y === 5 ? 0 : x === 10 && y === 10 ? 128 : 255)),
      16,
      16,
    );
    expect(idx.query(0, 0, 15, 15)).toBe(
      ALPHA_F_VISIBLE | ALPHA_F_HOLE | ALPHA_F_TRANSLUCENT,
    );
    expect(idx.query(4, 4, 6, 6)).toBe(ALPHA_F_VISIBLE | ALPHA_F_HOLE);
    expect(idx.query(9, 9, 11, 11)).toBe(ALPHA_F_VISIBLE | ALPHA_F_TRANSLUCENT);
  });

  it("clamps out-of-range rects without crashing", () => {
    const idx = new AlphaIndex(rgba(8, 8, () => 255), 8, 8);
    expect(idx.query(-5, -5, 999, 999)).toBe(ALPHA_F_VISIBLE);
    expect(idx.query(3, 3, 2, 2)).toBe(0);
    expect(idx.query(0, 0, 4, 4)).toBe(ALPHA_F_VISIBLE);
  });

  it("reports only visible flags for fully opaque textures", () => {
    const idx = new AlphaIndex(rgba(20, 20, () => 255), 20, 20);
    expect(idx.query(0, 0, 19, 19)).toBe(ALPHA_F_VISIBLE);
  });
});
