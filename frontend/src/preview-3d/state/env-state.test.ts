// ===== env-state 单元测试（守卫优先级）=====
// 锁定 shouldOverwrite 优先级：manual > auto-atmosphere > auto-model；force 绕过；
// 仅真正变化的键才派发。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  envState,
  setEnvState,
  getStateValue,
  setStateValue,
  resetEnvState,
} from "./env-state.ts";
import {
  registerEnvCallback,
  clearEnvCallbacks,
  type EnvCallback,
} from "./env-dispatcher.ts";

const KEY = "fogEnabled"; // boolean，默认 false

describe("env-state 守卫优先级", () => {
  beforeEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });
  afterEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });

  it("auto-model 首次写入生效（prev 缺省=auto-model）", () => {
    setEnvState({ fogEnabled: true }, { source: "auto-model" });
    expect(envState.fogEnabled).toBe(true);
  });

  it("auto-model 连续写覆盖 auto-model", () => {
    setEnvState({ fogEnabled: true }, { source: "auto-model" });
    setEnvState({ fogEnabled: false }, { source: "auto-model" });
    expect(envState.fogEnabled).toBe(false);
  });

  it("auto-atmosphere 覆盖 auto-model，但不覆盖 manual", () => {
    setEnvState({ fogEnabled: true }, { source: "auto-model" });
    setEnvState({ fogEnabled: false }, { source: "auto-atmosphere" });
    expect(envState.fogEnabled).toBe(false); // 覆盖 auto-model 成功

    setEnvState({ fogEnabled: true }, { source: "manual" });
    setEnvState({ fogEnabled: false }, { source: "auto-atmosphere" });
    expect(envState.fogEnabled).toBe(true); // 不覆盖 manual
  });

  it("auto-model 不覆盖 auto-atmosphere 也不覆盖 manual", () => {
    setEnvState({ fogEnabled: true }, { source: "auto-atmosphere" });
    setEnvState({ fogEnabled: false }, { source: "auto-model" });
    expect(envState.fogEnabled).toBe(true); // 不覆盖 auto-atmosphere

    setEnvState({ fogEnabled: false }, { source: "manual" });
    setEnvState({ fogEnabled: true }, { source: "auto-model" });
    expect(envState.fogEnabled).toBe(false); // 不覆盖 manual
  });

  it("manual 始终覆盖任何来源", () => {
    setEnvState({ fogEnabled: true }, { source: "auto-atmosphere" });
    setEnvState({ fogEnabled: false }, { source: "manual" });
    expect(envState.fogEnabled).toBe(false);
    setEnvState({ fogEnabled: true }, { source: "auto-model" });
    setEnvState({ fogEnabled: false }, { source: "manual" });
    expect(envState.fogEnabled).toBe(false);
  });

  it("force=true 绕过守卫强制写入", () => {
    setEnvState({ fogEnabled: true }, { source: "manual" });
    setEnvState({ fogEnabled: false }, { source: "auto-model" }); // 默认不覆盖 manual
    expect(envState.fogEnabled).toBe(true);
    setEnvState({ fogEnabled: false }, { source: "auto-model", force: true });
    expect(envState.fogEnabled).toBe(false); // force 覆盖
  });

  it("被守卫拒绝的写入不触发派发", () => {
    const fired: number[] = [];
    const cb: EnvCallback = () => fired.push(1);
    registerEnvCallback("cap", cb);

    setEnvState({ fogEnabled: true }, { source: "manual" });
    expect(fired).toHaveLength(1);

    // auto-model 无法覆盖 manual → 无变化 → 不派发
    setEnvState({ fogEnabled: false }, { source: "auto-model" });
    expect(fired).toHaveLength(1);
  });

  it("setStateValue 走 manual 来源；getStateValue 读回", () => {
    setStateValue(KEY, true);
    expect(getStateValue(KEY)).toBe(true);
    expect(envState.fogEnabled).toBe(true);
  });
});

// ===== 值域钳制（ADR-283：schema range 在唯一写入口落地）=====
describe("值域钳制（唯一写入口）", () => {
  beforeEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });
  afterEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });

  it("超上限 / 超下限按 schema range 钳制", () => {
    setEnvState({ waterOpacity: 1.5 }, { source: "manual" });
    expect(envState.waterOpacity).toBe(1);
    setEnvState({ waterOpacity: -0.2 }, { source: "manual" });
    expect(envState.waterOpacity).toBe(0);
  });

  it("NaN → range.min，Infinity → range.max（clamp 语义）", () => {
    setEnvState({ waterSize: Number.NaN }, { source: "manual" });
    expect(envState.waterSize).toBe(1);
    setEnvState({ waterPoolWallThickness: Number.POSITIVE_INFINITY }, { source: "manual" });
    expect(envState.waterPoolWallThickness).toBe(2);
  });

  it("未声明 range 的字段原样写入（颜色不被钳）", () => {
    setEnvState({ waterColor: 0xffffff }, { source: "manual" });
    expect(envState.waterColor).toBe(0xffffff);
  });

  it("非 manual 来源同样受钳：预设 / 存档路径无豁免", () => {
    setEnvState({ waterPoolHeight: 99 }, { source: "auto-model" });
    expect(envState.waterPoolHeight).toBe(5);
  });

  it("setStateValue 这条旁路也过钳制", () => {
    setStateValue("waterClarity", 3);
    expect(envState.waterClarity).toBe(1);
  });

  it("钳制后仍正常派发", () => {
    const fired: number[] = [];
    registerEnvCallback("cap", () => fired.push(1));
    setEnvState({ waterOpacity: 9 }, { source: "manual" });
    expect(fired).toHaveLength(1);
    expect(envState.waterOpacity).toBe(1);
  });
});

// ===== 分组前置过滤（锐评病灶④a：无匹配键时不得白分配）=====
describe("dispatch 分组过滤", () => {
  beforeEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });
  afterEach(() => {
    clearEnvCallbacks();
    resetEnvState();
  });

  it("带 group 的回调只收到本组键", () => {
    const got: Array<Set<string>> = [];
    registerEnvCallback("water-cap", (changed) => got.push(changed as Set<string>), "water");
    setEnvState({ skyCloudCoverage: 0.5 }, { source: "manual" });
    expect(got, "sky 变更不应触达 water 回调").toHaveLength(0);

    setEnvState({ waterOpacity: 0.5 }, { source: "manual" });
    expect(got).toHaveLength(1);
    expect([...got[0]!]).toEqual(["waterOpacity"]);
  });

  it("无匹配键时不构造过滤 Set（热路径：昼夜循环每帧派发 × 全 cap）", () => {
    registerEnvCallback("water-cap", () => {}, "water");
    registerEnvCallback("fog-cap", () => {}, "fog");
    registerEnvCallback("ground-cap", () => {}, "ground");

    // 先热身（首次调用会触发 schema group 键集缓存填充，其内部 Set 不计入本断言）
    setEnvState({ skyCloudCoverage: 0.1 }, { source: "manual" });

    // 拦计：派发一个 sky 键，三个分组回调均无匹配。
    // 唯一允许的分配 = setEnvState 自建的 `changedKeys`（它是派发的**入参**，不可避免，恒 1 个）。
    // 关键不变量：分配数**不随分组 cap 数量增长**（旧实现 1 + N，N=无匹配的 cap 数）。
    const RealSet = globalThis.Set;
    let allocations = 0;
    class CountingSet<T> extends RealSet<T> {
      constructor(iterable?: Iterable<T> | null) {
        super(iterable ?? undefined);
        allocations++;
      }
    }
    (globalThis as { Set: unknown }).Set = CountingSet;
    try {
      setEnvState({ skyCloudCoverage: 0.2 }, { source: "manual" });
    } finally {
      (globalThis as { Set: unknown }).Set = RealSet;
    }
    // 恒 1（changedKeys）；旧实现为 1 + 3（三个分组 cap 各一个空 Set）。
    expect(allocations, "无匹配键时不得为每个 cap 各建一个空 Set").toBe(1);
  });

  it("分组 cap 数量增长不增加分配（不变量：与 N 无关）", () => {
    const RealSet = globalThis.Set;
    const countAllocs = (): number => {
      let n = 0;
      class CountingSet<T> extends RealSet<T> {
        constructor(iterable?: Iterable<T> | null) {
          super(iterable ?? undefined);
          n++;
        }
      }
      (globalThis as { Set: unknown }).Set = CountingSet;
      try {
        setEnvState({ skyCloudCoverage: Math.random() }, { source: "manual" });
      } finally {
        (globalThis as { Set: unknown }).Set = RealSet;
      }
      return n;
    };

    registerEnvCallback("water-cap", () => {}, "water");
    registerEnvCallback("fog-cap", () => {}, "fog");
    const withTwo = countAllocs();
    for (const g of ["ground", "shadow", "light", "reflector", "postprocessing", "environment", "renderMode"]) {
      registerEnvCallback(`cap-${g}`, () => {}, g);
    }
    const withNine = countAllocs();
    expect(withNine, "不匹配时分配数不得随分组 cap 数增长").toBe(withTwo);
  });

  it("有匹配键时仍正确过滤（优化不得改变可观察行为）", () => {
    const water: Array<string> = [];
    const fog: Array<string> = [];
    registerEnvCallback("water-cap", (c) => water.push(...(c as Set<string>)), "water");
    registerEnvCallback("fog-cap", (c) => fog.push(...(c as Set<string>)), "fog");

    setEnvState({ waterOpacity: 0.4, fogEnabled: true }, { source: "manual" });
    expect(water).toEqual(["waterOpacity"]);
    expect(fog).toEqual(["fogEnabled"]);
  });
});
