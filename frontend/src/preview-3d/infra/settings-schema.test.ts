// ===== settings-schema 单一源契约（ADR-303）=====
// 本测试守三件事：
//   ① 规格数据自洽（默认值落在值域内、步进为正、键不重复）——「默认值必在区间内」
//      靠断言而非注释约定；
//   ② 存储读取层与规格同源（loadTdCamSpeed / loadTdRotMode / getMaxPixelRatio 的
//      clamp 边界与回退默认 = schema 声明值，越界一律回退默认而非静默截断）；
//   ③ 存储键只有一处声明（读取层 / 派生导出不得出现第二份字面量副本）。
// 两个 UI 面的规格一致性由各自域内测试守着（⚙ 面板 → panels/camera-schema.test.ts；
// 主设置页 → views/app-content/tpl.test.ts），三处断言**都引用 schema**，
// 于是「改规格漏改某面」必红（ADR-303 §2）。
import { beforeEach, describe, expect, it } from "vitest";
import { loadTdCamSpeed, loadTdRotMode } from "./keymap.ts";
import { getMaxPixelRatio, MAX_PIXEL_RATIO_KEY } from "./render-budget.ts";
import { TD_CAM_SPEED, TD_KEYMAP_KEY, TD_PIXEL_RATIO, TD_ROT_MODE } from "./settings-schema.ts";

const SPECS = [TD_CAM_SPEED, TD_PIXEL_RATIO] as const;

describe("settings-schema 数据自洽（ADR-303）", () => {
  it("数值规格：min < max、step > 0、默认值落在值域内", () => {
    for (const s of SPECS) {
      expect(s.min, `${s.key} min<max`).toBeLessThan(s.max);
      expect(s.step, `${s.key} step>0`).toBeGreaterThan(0);
      expect(s.default, `${s.key} 默认值必须落在 [min, max] 内`).toBeGreaterThanOrEqual(s.min);
      expect(s.default, `${s.key} 默认值必须落在 [min, max] 内`).toBeLessThanOrEqual(s.max);
    }
  });

  it("存储键全局唯一（防两偏好共用一键互相覆盖）", () => {
    const keys = [TD_KEYMAP_KEY, ...SPECS.map((s) => s.key), TD_ROT_MODE.key];
    expect(new Set(keys).size, `存储键重复：${keys.join(", ")}`).toBe(keys.length);
  });

  it("旋转模式：默认值在枚举内、orbit/free 具名成员与 values 一致", () => {
    expect(TD_ROT_MODE.values).toContain(TD_ROT_MODE.default);
    expect(TD_ROT_MODE.orbit).toBe("orbit");
    expect(TD_ROT_MODE.free).toBe("free");
    expect([...TD_ROT_MODE.values].sort()).toEqual([TD_ROT_MODE.orbit, TD_ROT_MODE.free].sort());
  });
});

describe("存储读取层与规格同源（ADR-303）", () => {
  beforeEach(() => localStorage.clear());

  it("loadTdCamSpeed：缺省 = 规格默认；边界内原样返回", () => {
    expect(loadTdCamSpeed()).toBe(TD_CAM_SPEED.default);
    localStorage.setItem(TD_CAM_SPEED.key, String(TD_CAM_SPEED.min));
    expect(loadTdCamSpeed()).toBe(TD_CAM_SPEED.min);
    localStorage.setItem(TD_CAM_SPEED.key, String(TD_CAM_SPEED.max));
    expect(loadTdCamSpeed()).toBe(TD_CAM_SPEED.max);
  });

  it("loadTdCamSpeed：越界 / 非法一律回退默认（不静默截断）", () => {
    for (const bad of [String(TD_CAM_SPEED.min - 1), String(TD_CAM_SPEED.max + 1), "abc", ""]) {
      localStorage.setItem(TD_CAM_SPEED.key, bad);
      expect(loadTdCamSpeed(), `非法值 ${JSON.stringify(bad)} 应回退默认`).toBe(TD_CAM_SPEED.default);
    }
  });

  it("loadTdRotMode：缺省 = 规格默认（orbit→true）；free 落盘 → false", () => {
    expect(TD_ROT_MODE.default).toBe(TD_ROT_MODE.orbit);
    expect(loadTdRotMode()).toBe(true);
    localStorage.setItem(TD_ROT_MODE.key, TD_ROT_MODE.free);
    expect(loadTdRotMode()).toBe(false);
    localStorage.setItem(TD_ROT_MODE.key, TD_ROT_MODE.orbit);
    expect(loadTdRotMode()).toBe(true);
  });

  it("getMaxPixelRatio：缺省 = 规格默认；越界 clamp 到规格值域", () => {
    expect(getMaxPixelRatio()).toBe(TD_PIXEL_RATIO.default);
    localStorage.setItem(TD_PIXEL_RATIO.key, String(TD_PIXEL_RATIO.max + 10));
    expect(getMaxPixelRatio()).toBe(TD_PIXEL_RATIO.max);
    localStorage.setItem(TD_PIXEL_RATIO.key, String(TD_PIXEL_RATIO.min / 2));
    expect(getMaxPixelRatio()).toBe(TD_PIXEL_RATIO.min);
  });

  it("渲染预算的键导出派生自 schema（非第二份字面量）", () => {
    expect(MAX_PIXEL_RATIO_KEY).toBe(TD_PIXEL_RATIO.key);
  });
});
