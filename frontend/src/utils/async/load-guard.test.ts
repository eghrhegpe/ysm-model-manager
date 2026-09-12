// ===== load-guard 代数守卫测试（全仓唯一代际守卫出口，ADR-230）=====
// 覆盖：oldest-models / recycle-bin（渲染代数）+ GenGuard 语义集（next 捕获 / invalidate 作废
// / stale 判定 / current 只读捕获 / 实例隔离）——原 app-preview/gen-guard.test.ts 并入。
import { describe, expect, it } from "vitest";
import { createLoadGuard } from "./load-guard.ts";

describe("createLoadGuard", () => {
  it("next() 自增并返回新代数，stale 对当前代数为 false", () => {
    const g = createLoadGuard();
    expect(g.next()).toBe(1);
    expect(g.next()).toBe(2);
    const gen = g.next();
    expect(g.stale(gen)).toBe(false);
  });

  it("新一轮 next() 使旧代数变 stale（慢响应丢弃）", () => {
    const g = createLoadGuard();
    const old = g.next();
    g.next();
    expect(g.stale(old)).toBe(true);
  });

  it("invalidate() 使所有在途代数 stale（cleanup 后迟到写入被丢弃）", () => {
    const g = createLoadGuard();
    const gen = g.next();
    g.invalidate();
    expect(g.stale(gen)).toBe(true);
  });

  it("invalidate 后 next() 的新代数依然有效（组件复用场景）", () => {
    const g = createLoadGuard();
    g.next();
    g.invalidate();
    const gen = g.next();
    expect(g.stale(gen)).toBe(false);
  });

  it("current 只读捕获最新代数（不推进）；多检查点场景全程可判", () => {
    const g = createLoadGuard();
    expect(g.current).toBe(0);
    const gen = g.next();
    expect(g.current).toBe(1);
    g.next(); // 用户切换
    expect(g.stale(gen)).toBe(true);
    g.invalidate(); // 又一次选择
    expect(g.stale(gen)).toBe(true);
    expect(g.current).toBe(3);
  });

  it("实例间隔离（多宿主各自持有独立守卫）", () => {
    const a = createLoadGuard();
    const b = createLoadGuard();
    const genA = a.next();
    b.next();
    expect(a.stale(genA)).toBe(false);
  });
});
