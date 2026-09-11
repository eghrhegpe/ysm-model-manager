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
