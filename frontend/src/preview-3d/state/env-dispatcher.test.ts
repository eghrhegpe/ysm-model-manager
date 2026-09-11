// ===== env-dispatcher 单元测试 =====
// 锁定：回调注册/注销、派发语义、单回调异常不中断其余、计数/清空。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerEnvCallback,
  dispatchEnvChange,
  getEnvCallbackCount,
  clearEnvCallbacks,
  type EnvCallback,
} from "./env-dispatcher.ts";
import type { EnvState } from "./env-state-schema.ts";

const fakeState = {} as EnvState;

describe("env-dispatcher", () => {
  beforeEach(() => clearEnvCallbacks());
  afterEach(() => clearEnvCallbacks());

  it("registerEnvCallback 注册后计数 +1，并可在派发时收到 (changed, state)", () => {
    const received: Array<{ changed: Set<string>; state: EnvState }> = [];
    const cb: EnvCallback = (changed, state) => received.push({ changed, state });
    const unsub = registerEnvCallback("capA", cb);
    expect(getEnvCallbackCount()).toBe(1);

    const changed = new Set(["fogEnabled"]);
    dispatchEnvChange(changed, fakeState);

    expect(received).toHaveLength(1);
    expect(received[0]!.changed).toBe(changed);
    expect(received[0]!.state).toBe(fakeState);
    unsub();
  });

  it("返回的取消订阅函数可移除该回调", () => {
    const cb: EnvCallback = () => {};
    const unsub = registerEnvCallback("capA", cb);
    expect(getEnvCallbackCount()).toBe(1);
    unsub();
    expect(getEnvCallbackCount()).toBe(0);

    const spy = vi.fn();
    dispatchEnvChange(new Set(["x"]), fakeState);
    expect(spy).not.toHaveBeenCalled();
  });

  it("多次注册按 cap 键覆盖（同键只保留一个）", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerEnvCallback("capA", a);
    registerEnvCallback("capA", b); // 同键覆盖
    expect(getEnvCallbackCount()).toBe(1);
    dispatchEnvChange(new Set(["x"]), fakeState);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("多个回调全部收到派发", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerEnvCallback("capA", a);
    registerEnvCallback("capB", b);
    dispatchEnvChange(new Set(["x"]), fakeState);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("单回调抛错被吞掉且不影响其余回调，并走 console.warn 兜底", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom: EnvCallback = () => {
      throw new Error("boom");
    };
    const ok = vi.fn();
    registerEnvCallback("capBoom", boom);
    registerEnvCallback("capOk", ok);
    expect(() => dispatchEnvChange(new Set(["x"]), fakeState)).not.toThrow();
    expect(ok).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clearEnvCallbacks 清空全部注册", () => {
    registerEnvCallback("capA", () => {});
    registerEnvCallback("capB", () => {});
    expect(getEnvCallbackCount()).toBe(2);
    clearEnvCallbacks();
    expect(getEnvCallbackCount()).toBe(0);
  });
});
