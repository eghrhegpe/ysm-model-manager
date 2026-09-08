// @vitest-environment node
// ===== Molang 表达式编译器测试（ADR-100 L4）=====
// 覆盖：算术/anim_time 绑定/q. 别名/未知查询降级/角度制/三元/非法表达式。
// 内嵌 molangjs 源码，无外部依赖，同步可用。
import { describe, it, expect } from "vitest";
import { compileMolang } from "./molang.ts";

describe("compileMolang（内嵌 molangjs）", () => {
  it("纯算术表达式", () => {
    const fn = compileMolang("1 + 2");
    expect(fn).not.toBeNull();
    expect(fn!(0)).toBe(3);
  });

  it("query.anim_time 绑定（随 animTime 变化）", () => {
    const fn = compileMolang("query.anim_time * 10")!;
    expect(fn(0.5)).toBeCloseTo(5, 5);
    expect(fn(1)).toBeCloseTo(10, 5);
  });

  it("q. 短别名与 query. 等价", () => {
    const fn = compileMolang("q.anim_time * 10")!;
    expect(fn(0.25)).toBeCloseTo(2.5, 5);
  });

  it("未知 query（mod 扩展）降级为 0 不抛错", () => {
    const fn = compileMolang("query.mod_expanded_query + 7")!;
    expect(fn!(1)).toBeCloseTo(7, 5);
  });

  it("Bedrock 角度制约定：math.sin(90) = 1（use_radians=false）", () => {
    const fn = compileMolang("math.sin(90)")!;
    expect(fn(0)).toBeCloseTo(1, 5);
  });

  it("三元条件（状态切换常见写法）", () => {
    const fn = compileMolang("query.anim_time > 1 ? 10 : -10")!;
    expect(fn(0.5)).toBe(-10);
    expect(fn(2)).toBe(10);
  });

  it("非法表达式返回 null（调用方走零占位降级）", () => {
    // 空串 → null
    expect(compileMolang("")).toBeNull();
    // molangjs 对 `(((` 不抛错，会解析为部分表达式；此处仅测试可确定的行为
  });

  it("大迭代数 math.die_roll 在合理时间内完成（安全预算 clamp 生效）", () => {
    const fn = compileMolang("math.die_roll(100000000, 0, 1)")!;
    expect(fn).not.toBeNull();
    const start = performance.now();
    const result = fn(0);
    const elapsed = performance.now() - start;
    // 1e8 次迭代被 clamp 到 1e4，应在 100ms 内完成；未 clamp 则 WebView2 主线程卡死
    expect(elapsed).toBeLessThan(100);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1e4);
  });
});
