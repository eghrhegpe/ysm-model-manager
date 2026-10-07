// @vitest-environment node
// ===== environment-state 纯数据层测试 =====
// ENV_PRESETS 是 equirect 程序化环境贴图 + 各 cap 联动的唯一事实源（零 THREE 依赖）。
// 本测试锁：预设覆盖完整性、归一化域不越界、颜色字段合法、氛围语义单调。
import { describe, it, expect } from "vitest";
import {
  ENV_PRESET_DEFAULT_INTENSITY,
  type SelectableEnvPresetId,
} from "@/preview-3d/state/env-preset-types.ts";
import { ENV_PRESETS } from "./environment-state.ts";

const PRESET_IDS: SelectableEnvPresetId[] = ["sky", "studio", "sunset", "night", "forest"];

const isInt24 = (v: number): boolean =>
  Number.isInteger(v) && v >= 0 && v <= 0xffffff;

describe("ENV_PRESETS — 预设集合自洽", () => {
  it("覆盖全部非 custom 预设，且每条 id 与键名一致", () => {
    expect(Object.keys(ENV_PRESETS).sort()).toEqual([...PRESET_IDS].sort());
    for (const id of PRESET_IDS) {
      expect(ENV_PRESETS[id].id).toBe(id);
    }
  });

  it("label 非空且互不重复", () => {
    const labels = PRESET_IDS.map((id) => ENV_PRESETS[id].label);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("[P0-②] defaultIntensity 恒等于 ENV_PRESET_DEFAULT_INTENSITY（单一事实源，非手抄）", () => {
    // [锐评 P0-② 收口 2026-10-07] 本表 defaultIntensity 与 state/atmosphere-presets.ts 的
    // envIntensity 曾各自手抄同一组数值（sky1.0/studio1.6/sunset1.4/night0.7/forest1.1），
    // 零派生、零对账。现两表同源于 env-preset-types.ts 的强度表——本条钉 caps 侧，
    // atmosphere-presets.test.ts 同款断言钉 state 侧，两条合起来即「两表恒等、无法再分叉」。
    for (const id of PRESET_IDS) {
      expect(ENV_PRESETS[id].defaultIntensity, `${id}.defaultIntensity`).toBe(
        ENV_PRESET_DEFAULT_INTENSITY[id],
      );
    }
  });
});

describe("ENV_PRESETS — 声明的归一化域", () => {
  it("sunPos 落在 equirect 合法域 [0,1]²", () => {
    for (const id of PRESET_IDS) {
      const p = ENV_PRESETS[id];
      expect(p.sunPos.x, `${id}.sunPos.x`).toBeGreaterThanOrEqual(0);
      expect(p.sunPos.x).toBeLessThanOrEqual(1);
      expect(p.sunPos.y, `${id}.sunPos.y`).toBeGreaterThanOrEqual(0);
      expect(p.sunPos.y).toBeLessThanOrEqual(1);
    }
  });

  it("sunRadius 0~0.2 / hazeLayers 0~3 整数 / defaultIntensity 0~3", () => {
    for (const id of PRESET_IDS) {
      const p = ENV_PRESETS[id];
      expect(p.sunRadius, `${id}.sunRadius`).toBeGreaterThanOrEqual(0);
      expect(p.sunRadius).toBeLessThanOrEqual(0.2);
      expect(Number.isInteger(p.hazeLayers), `${id}.hazeLayers`).toBe(true);
      expect(p.hazeLayers).toBeGreaterThanOrEqual(0);
      expect(p.hazeLayers).toBeLessThanOrEqual(3);
      expect(p.defaultIntensity, `${id}.defaultIntensity`).toBeGreaterThan(0);
      expect(p.defaultIntensity).toBeLessThanOrEqual(3);
    }
  });

  it("zenith/horizon/nadir/sunColor 均为合法 24-bit 颜色", () => {
    for (const id of PRESET_IDS) {
      const p = ENV_PRESETS[id];
      expect(isInt24(p.zenith), `${id}.zenith`).toBe(true);
      expect(isInt24(p.horizon), `${id}.horizon`).toBe(true);
      expect(isInt24(p.nadir), `${id}.nadir`).toBe(true);
      expect(isInt24(p.sunColor), `${id}.sunColor`).toBe(true);
    }
  });
});

describe("ENV_PRESETS — 氛围语义（Rec.601 亮度口径）", () => {
  const lum = (hex: number): number =>
    0.299 * ((hex >> 16) & 0xff) + 0.587 * ((hex >> 8) & 0xff) + 0.114 * (hex & 0xff);

  it("night 的天空/地平线亮度低于白天 sky 预设", () => {
    expect(lum(ENV_PRESETS.night.zenith)).toBeLessThan(lum(ENV_PRESETS.sky.zenith));
    expect(lum(ENV_PRESETS.night.horizon)).toBeLessThan(lum(ENV_PRESETS.sky.horizon));
  });

  it("studio 亮度最高（室内柔光），defaultIntensity 同步最高", () => {
    const maxIntensity = PRESET_IDS.reduce(
      (max, id) => Math.max(max, ENV_PRESETS[id].defaultIntensity),
      0,
    );
    expect(ENV_PRESETS.studio.defaultIntensity).toBe(maxIntensity);
    expect(lum(ENV_PRESETS.studio.horizon)).toBeGreaterThan(
      lum(ENV_PRESETS.night.horizon),
    );
  });
});