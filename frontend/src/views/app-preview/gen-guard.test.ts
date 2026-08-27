// GenGuard 单测：统一代际守卫语义（next 捕获 / invalidate 作废 / stale 判定）
import { describe, it, expect } from "vitest";
import { GenGuard } from "./gen-guard.ts";

describe("GenGuard", () => {
  it("next() 推进并返回新代数", () => {
    const g = new GenGuard();
    expect(g.next()).toBe(1);
    expect(g.next()).toBe(2);
  });

  it("stale(gen) 在代数不匹配时为 true", () => {
    const g = new GenGuard();
    const gen = g.next();
    expect(g.stale(gen)).toBe(false);
    g.next();
    expect(g.stale(gen)).toBe(true);
  });

  it("invalidate() 只作废不捕获——在途 gen 全部变 stale", () => {
    const g = new GenGuard();
    const genA = g.next();
    g.invalidate(); // 无 await 也要作废在途的慢请求回写
    expect(g.stale(genA)).toBe(true);
    const genB = g.next();
    expect(g.stale(genB)).toBe(false);
  });

  it("current 反映最新代数，多检查点场景全程可判", () => {
    const g = new GenGuard();
    const gen = g.next();
    // 模拟 await 前后多次检查点
    expect(g.stale(gen)).toBe(false);
    g.next(); // 用户切换
    expect(g.stale(gen)).toBe(true);
    g.invalidate(); // 又一次选择
    expect(g.stale(gen)).toBe(true);
  });

  it("实例间隔离（maid-3d 的 state 隔离形态）", () => {
    const a = new GenGuard();
    const b = new GenGuard();
    const genA = a.next();
    b.next();
    expect(a.stale(genA)).toBe(false);
  });
});
