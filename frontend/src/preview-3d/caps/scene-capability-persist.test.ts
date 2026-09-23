// ===== scene-capability.ts 持久化入口（restoreState）存档形态闸测试 =====
//
// 背景（2026-09-22 锐评 F-1 三度收口复审发现）：`restoreState` 只 try/catch 包 `JSON.parse`，
// **不校验解析结果的形态**——`JSON.parse("5")` 得 `5`，被原样当作 `Record<string, unknown>`
// 返回给 9 个 cap 的 `loadState`。而各 cap 的 legacy 旧键回填一律写 `!("fogEnabled" in s)`
// 这类 `in` 表达式，`in` 对**非对象**真值抛 TypeError：
//
//   TypeError: Cannot use 'in' operator to search for 'skyEnabled' in 5
//
// 该异常在 `loadState` 内抛出后被 `sceneCapabilityRegistry.loadAll()` 的 per-cap try/catch
// 吞掉并 `continue` → **后续 cap 全部静默跳过恢复**（ringLog 无生产 sink，用户只见黑场景、
// 零提示）。触发条件仅「手改 / 损坏的 localStorage」——正常路径写不出非对象存档。
//
// 故本闸把「存档必须是 JSON 对象」收口在**唯一入口** `restoreState`，一处修、9 个调用点全免疫；
// 非对象真值一律视同**无存档**（返回 null，与 `!raw` / 解析失败同语义），下游既有的
// `if (!state) return` 早退天然接住，无需各 cap 各写一遍 typeof 守卫。
//
// 环境：默认 happy-dom（需真实 localStorage；本文件**不加** `@vitest-environment node`）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { persistState, restoreState } from "./scene-capability.ts";

const CAP = "sky";

/** 直接落盘原始字符串——绕过 persistState 的 JSON.stringify，模拟手改/损坏存档 */
function seedRaw(raw: string): void {
  localStorage.setItem(`ysm-scene-cap-${CAP}`, raw);
}

describe("restoreState — 存档形态闸（非对象真值视同无存档）", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("[回归锁] 非对象真值 number（JSON.parse(\"5\")）→ null，不再把 5 当存档对象返回", () => {
    // 收口前实测：restoreState 返回 5，下游 `"skyEnabled" in (5 as object)` 抛 TypeError。
    seedRaw("5");
    expect(restoreState(CAP)).toBeNull();
  });

  it("[回归锁] 非对象真值 string/boolean → null（同族三型一并闸住）", () => {
    seedRaw('"hello"');
    expect(restoreState(CAP)).toBeNull();
    seedRaw("true");
    expect(restoreState(CAP)).toBeNull();
  });

  it("JSON null 字面量 → null", () => {
    seedRaw("null");
    expect(restoreState(CAP)).toBeNull();
  });

  it("数组 → null（`in` 对数组不抛错但语义上不是存档对象，一并排除）", () => {
    seedRaw("[1,2,3]");
    expect(restoreState(CAP)).toBeNull();
  });

  it("损坏 JSON（既有行为不回归）→ null", () => {
    seedRaw("{不是合法 JSON");
    expect(restoreState(CAP)).toBeNull();
  });

  it("键缺失（无存档）→ null", () => {
    expect(restoreState(CAP)).toBeNull();
  });

  it("合法 JSON 对象 → 原样返回（收口不得误伤正常存档）", () => {
    seedRaw(JSON.stringify({ skyEnabled: false, timeOfDay: 17 }));
    expect(restoreState(CAP)).toEqual({ skyEnabled: false, timeOfDay: 17 });
  });

  it("空对象 → 原样返回 {}（`{}` 是合法存档形态，非 null）", () => {
    seedRaw("{}");
    expect(restoreState(CAP)).toEqual({});
  });

  it("persistState → restoreState 往返自洽（真实写入路径不被形态闸拦截）", () => {
    persistState(CAP, { skyEnabled: true, cloudCoverage: 0.3 });
    expect(restoreState(CAP)).toEqual({ skyEnabled: true, cloudCoverage: 0.3 });
  });
});
