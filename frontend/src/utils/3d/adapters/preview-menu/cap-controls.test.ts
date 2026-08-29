// preview-menu-cap-controls.test.ts — 能力控件通用渲染器纯函数测试。
// formatCapSliderValue 是纯函数（无 DOM 依赖），node 环境直接测四分支：
//   h（钟点 → HH:MM）/ %（百分比）/ 带单位（拼接）/ 无单位（toFixed2）。
// 该函数由 renderCapSlider 与 renderEnvLevel 摘要行共用——防两端分叉回归。
import { describe, it, expect } from "vitest";
import { formatCapSliderValue, renderCapControls } from "./cap-controls.ts";
import type { PreviewSnapshot } from "../../state/preview-state.ts";
import type { MenuControlDef } from "../../caps/scene-capability.ts";

function makeSlider(unit?: string): MenuControlDef {
  return {
    id: "t",
    kind: "slider",
    labelKey: "t",
    fallback: "t",
    getValue: () => 0,
    setValue: () => {},
    slider: unit ? { min: 0, max: 1, step: 0.01, unit } : { min: 0, max: 1, step: 0.01 },
  };
}

describe("formatCapSliderValue", () => {
  it("unit='h' 输出 HH:MM（小数进位分钟）", () => {
    const c = makeSlider("h");
    expect(formatCapSliderValue(c, 12)).toBe("12:00");
    expect(formatCapSliderValue(c, 9.5)).toBe("09:30");
    expect(formatCapSliderValue(c, 23.75)).toBe("23:45");
    expect(formatCapSliderValue(c, 0)).toBe("00:00");
  });

  it("unit='%' 输出百分比（乘 100 取整）", () => {
    const c = makeSlider("%");
    expect(formatCapSliderValue(c, 0.42)).toBe("42%");
    expect(formatCapSliderValue(c, 0)).toBe("0%");
    expect(formatCapSliderValue(c, 1)).toBe("100%");
  });

  it("其它 unit 直接拼接", () => {
    expect(formatCapSliderValue(makeSlider("m"), 2.5)).toBe("2.5m");
    expect(formatCapSliderValue(makeSlider("px"), 128)).toBe("128px");
  });

  it("无 unit 时 toFixed(2)", () => {
    expect(formatCapSliderValue(makeSlider(), 0.5)).toBe("0.50");
    // 整数值也保持两位小数——与 renderCapSlider 原 fmtVal 行为一致
    expect(formatCapSliderValue(makeSlider(), 1)).toBe("1.00");
  });
});

describe("renderCapControls — visibleWhen B 轨谓词", () => {
  function toggle(id: string, extra: Partial<MenuControlDef> = {}): MenuControlDef {
    return { id, kind: "toggle", labelKey: id, fallback: id, getValue: () => true, setValue: () => {}, ...extra };
  }
  const snap = (mode: "film" | "pool"): PreviewSnapshot =>
    ({ "env.waterMode": mode } as unknown as PreviewSnapshot);

  it("传 snapshot 时按 visibleWhen 隐藏/显示", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      toggle("film-only", { visibleWhen: (s) => s["env.waterMode"] === "film" }),
      toggle("pool-only", { visibleWhen: (s) => s["env.waterMode"] === "pool" }),
    ], snap("film"));
    expect(list.querySelector('[data-testid="cap-film-only"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="cap-pool-only"]')).toBeNull();
    const list2 = document.createElement("div");
    renderCapControls(list2, [
      toggle("film-only", { visibleWhen: (s) => s["env.waterMode"] === "film" }),
      toggle("pool-only", { visibleWhen: (s) => s["env.waterMode"] === "pool" }),
    ], snap("pool"));
    expect(list2.querySelector('[data-testid="cap-film-only"]')).toBeNull();
    expect(list2.querySelector('[data-testid="cap-pool-only"]')).not.toBeNull();
  });

  it("无 snapshot 时 visibleWhen 被忽略（保留 A 轨行为），控件正常渲染", () => {
    const list = document.createElement("div");
    renderCapControls(list, [toggle("x", { visibleWhen: () => false })]);
    expect(list.querySelector('[data-testid="cap-x"]')).not.toBeNull();
  });

  it("A 轨 visible 与 B 轨 visibleWhen 并存时 AND", () => {
    const list = document.createElement("div");
    renderCapControls(list, [toggle("y", { visible: () => true, visibleWhen: (s) => s["env.waterMode"] === "pool" })], snap("film"));
    expect(list.querySelector('[data-testid="cap-y"]')).toBeNull();
  });
});