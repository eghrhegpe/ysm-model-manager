// ===== render-loop 活跃输入会话生命周期测试 =====
// code_review ece0d4a4 #8：P0 修复改「动态 active-input-session」模型后，原 WASD 闭包捕获
// 语义被 render-loop 的 set/unregisterActiveInputSession 取代——晋升/置 null 逻辑零测试，
// coop 多会话下「关掉 active 后存活 session 的 WASD 永久死」回归无护栏。此处纯函数级钉住。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getActiveInputSession,
  setActiveInputSession,
  unregisterActiveInputSession,
  registerPerFrame,
  removePerFrame,
  resetLoopState,
} from "./render-loop.ts";
import type { TdKeyAction } from "./keymap.ts";

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

// removePerFrame 按引用相等移除——失配原先完全静默（漏移除看起来像正常 no-op），
// 会让已 dispose 的内容层被 rAF 每帧驱动。此处钉住「失配必须留痕」。
describe("removePerFrame 引用失配留痕（可观测性）", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetLoopState();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("传注册时的同一引用 → 正常移除且不告警", () => {
    const f = (): void => {};
    registerPerFrame(f);
    removePerFrame(f);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("传不同引用（列表非空）→ 告警留痕，不静默漏移除", () => {
    registerPerFrame(() => {});
    removePerFrame(() => {}); // 新函数实例，indexOf 恒 -1
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0]?.join(" ") ?? "");
    expect(msg).toContain("removePerFrame 未命中");
  });

  it("列表已空时 removePerFrame → 合法 no-op，不告警（防重复注销刷屏）", () => {
    removePerFrame(() => {});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("bind 包装后注销原方法（典型失配场景）→ 告警", () => {
    // 真实风险形态：注册 bound 闭包、注销时传原型方法 → 引用不等
    const target = { update: (): void => {} };
    const bound = target.update.bind(target);
    registerPerFrame(bound);
    removePerFrame(target.update);
    expect(warnSpy).toHaveBeenCalled();
  });

  // 回归：节流时间戳初值原为 0，而页面/测试早期时钟落在节流窗内
  // （实测 ~830ms < 5000ms）⇒ `now - 0 > 5000` 为假 ⇒ **首条告警被吞**。
  // 对「注销失配」「首帧卡顿」这类首现即最该可见的信号，静默失败等于没有此告警。
  // 现初值为 null（从未告警过）→ 首条恒放行。
  it("首条失配告警不被节流吞掉（early-clock 回归）", () => {
    // 时钟钉死在节流窗内（原实测 ~830ms）。原实现用 `expect(performance.now()) < 5000` 做前置断言，
    // 依赖进程启动快慢——慢机单独跑已 7.3s、全量跑 14s+ 出窗 ⇒ 必挂，且判别力随机器漂移。
    // removePerFrame 调用时才读 performance.now()（render-host.ts），mockReturnValue 即确定性入窗：
    // 若初值回归 0，830 - 0 < 5000 ⇒ 首条被吞 ⇒ 本用例在任何机器上都失败。
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(830);
    try {
      registerPerFrame(() => {});
      removePerFrame(() => {}); // 首次失配
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
