// ===== render-loop 活跃输入会话生命周期测试 =====
// code_review ece0d4a4 #8：P0 修复改「动态 active-input-session」模型后，原 WASD 闭包捕获
// 语义被 render-loop 的 set/unregisterActiveInputSession 取代——晋升/置 null 逻辑零测试，
// coop 多会话下「关掉 active 后存活 session 的 WASD 永久死」回归无护栏。此处纯函数级钉住。
import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveInputSession,
  setActiveInputSession,
  unregisterActiveInputSession,
  resetLoopState,
} from "./render-loop.ts";
import type { TdKeyAction } from "../keymap.ts";

type InputSession = {
  keys: Partial<Record<TdKeyAction, boolean>>;
  camSpeed: number;
  orbitMode: boolean;
};

function makeSession(name: string): InputSession {
  return { keys: { [name]: true } as Partial<Record<TdKeyAction, boolean>>, camSpeed: 1, orbitMode: false };
}

beforeEach(() => {
  resetLoopState();
});

describe("render-loop active-input 会话（code_review ece0d4a4 #2/#3/#9/#8）", () => {
  it("unregister 关掉 active → 晋升最新存活 session（非置 null）", () => {
    const a = makeSession("a");
    const b = makeSession("b");
    setActiveInputSession(a);
    setActiveInputSession(b);
    expect(getActiveInputSession()).toBe(b);
    // 关掉 active 的 b：a 仍存活 → 晋升 a（原实现无条件置 null，存活 session WASD 永久死）
    unregisterActiveInputSession(b);
    expect(getActiveInputSession()).toBe(a);
  });

  it("unregister 非 active 的存活 session → 不动 active", () => {
    const a = makeSession("a");
    const b = makeSession("b");
    setActiveInputSession(a);
    setActiveInputSession(b);
    // 关掉较旧的 a（当前 active 是 b）→ active 不变
    unregisterActiveInputSession(a);
    expect(getActiveInputSession()).toBe(b);
  });

  it("最后一个存活 session 注销 → 置 null（无 session 无输入源）", () => {
    const a = makeSession("a");
    setActiveInputSession(a);
    unregisterActiveInputSession(a);
    expect(getActiveInputSession()).toBeNull();
  });

  it("重复 set 同一引用为 no-op（不重复入列）；同一引用重复 unregister 幂等", () => {
    const a = makeSession("a");
    setActiveInputSession(a);
    setActiveInputSession(a); // 重复注册同一引用 no-op
    unregisterActiveInputSession(a);
    unregisterActiveInputSession(a); // 重复注销幂等不抛
    expect(getActiveInputSession()).toBeNull();
  });
});
