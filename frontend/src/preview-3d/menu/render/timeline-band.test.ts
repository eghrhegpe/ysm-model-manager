// timeline-band.test.ts — 昼夜色带纯计算（[锐评 S1-3] 破「硬编码 5 色」）
//
// 病：色带原为**写死的 5 个色标**（黑→蓝→浅蓝→橙→深蓝→黑），与真实太阳位置无关。
// 同一控件里，太阳圆点随 timeOfDay 走 `computeHourToSun` 实时联动，底下的色带却是常量
// ——「一半实时一半假」比全假更误导（用户改云量/浑浊度，色带纹丝不动）。
//
// 药：色带**整体由太阳高度角派生**（与 shader/太阳标记同一事实源 `computeHourToSun`）——
// 不再自写大气散射（ADR-073 红线），只把「光照相位」如实画出来；并显式标 6/12/18 刻度
// （日出/正午/日落 = 控件自身坐标系的锚点，从同一函数派生，永不漂移）。
import { describe, it, expect } from "vitest";
import { computeHourToSun } from "@/preview-3d/caps/sky-sun.ts";
import { bandStops, BAND_TICKS, bandColorAt } from "./timeline-band.ts";

describe("bandStops — 色带由太阳高度角派生（非硬编码 5 色）", () => {
  it("逐时刻调 computeHourToSun 取相位；同一小时两次调用结果恒等（纯函数）", () => {
    const a = bandStops();
    const b = bandStops();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5); // 原实现 5 个写死色标，现按小时采样
  });

  it("色标 t 严格递增且覆盖 [0,1] 两端（canvas linearGradient 的硬要求）", () => {
    const stops = bandStops();
    expect(stops[0]!.t).toBe(0);
    expect(stops[stops.length - 1]!.t).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.t, `第 ${i} 个色标 t 须严格大于前一个`).toBeGreaterThan(stops[i - 1]!.t);
    }
  });

  it("正午（12h）比子夜（0h）显著更亮——相位如实反映，不是常量", () => {
    const lum = (css: string): number => {
      const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(css);
      expect(m, `颜色须为 rgb() 形式，实得 ${css}`).not.toBeNull();
      return 0.299 * Number(m![1]) + 0.587 * Number(m![2]) + 0.114 * Number(m![3]);
    };
    expect(lum(bandColorAt(12))).toBeGreaterThan(lum(bandColorAt(0)) + 60);
  });

  it("日出/日落（6h / 18h）落在暖色相位：红分量 > 蓝分量（地平线橙，与太阳标记同源）", () => {
    const parts = (css: string): number[] =>
      css.match(/\d+/g)!.map(Number);
    for (const h of [6, 18]) {
      const [r, , b] = parts(bandColorAt(h));
      expect(r, `${h}h 应偏暖（红 > 蓝），实得 ${bandColorAt(h)}`).toBeGreaterThan(b!);
    }
  });

  it("夜间（0h / 23h）整体压暗：亮度低于白天峰值的一半", () => {
    const lum = (css: string): number => {
      const [r, g, b] = css.match(/\d+/g)!.map(Number);
      return 0.299 * r! + 0.587 * g! + 0.114 * b!;
    };
    const dayPeak = lum(bandColorAt(12));
    for (const h of [0, 23]) {
      expect(lum(bandColorAt(h)), `${h}h 应为夜相位`).toBeLessThan(dayPeak * 0.5);
    }
  });

  it("与 computeHourToSun 同源可核：24h 处颜色回到 0h（取模闭环，无 24 点跳变）", () => {
    expect(bandColorAt(24)).toBe(bandColorAt(0));
  });
});

describe("BAND_TICKS — 6/12/18 刻度锚点", () => {
  it("三个锚点正好是 6/12/18 时，t = 小时/24", () => {
    expect(BAND_TICKS.map((k) => k.hour)).toEqual([6, 12, 18]);
    for (const k of BAND_TICKS) expect(k.t).toBeCloseTo(k.hour / 24, 10);
  });

  it("锚点与 computeHourToSun 的语义一致：6h/18h 在地平线（elevation≈0），12h 在最高点", () => {
    const el = (h: number): number => computeHourToSun(h).elevation;
    for (const h of [6, 18]) expect(Math.abs(el(h))).toBeLessThan(1e-9);
    expect(el(12)).toBeGreaterThan(el(6));
    expect(el(12)).toBeGreaterThan(el(18));
  });
});
