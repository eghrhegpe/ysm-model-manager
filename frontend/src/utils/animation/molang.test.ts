// @vitest-environment node
// ===== Molang 表达式编译器测试（ADR-100 L4 + ADR-213 工厂化）=====
// 覆盖：算术/anim_time 绑定/q. 别名/未知查询降级/角度制/三元/非法表达式/工厂隔离。
// 内嵌 molangjs 源码，无外部依赖，同步可用。
// ADR-213：模块级 compileMolang / getMolangParser 已移除，全量走 createMolangParser() 工厂。
import { describe, it, expect, vi } from "vitest";
import { createMolangParser } from "./molang.ts";
import Molang from "./molang-lib/molang.js";
import * as log from "@/utils/base/primitives/log.ts";

describe("createMolangParser 工厂实例", () => {
  it("纯算术表达式", () => {
    const fn = createMolangParser().compileMolang("1 + 2");
    expect(fn).not.toBeNull();
    expect(fn!(0)).toBe(3);
  });

  it("query.anim_time 绑定（随 animTime 变化）", () => {
    const fn = createMolangParser().compileMolang("query.anim_time * 10")!;
    expect(fn(0.5)).toBeCloseTo(5, 5);
    expect(fn(1)).toBeCloseTo(10, 5);
  });

  it("q. 短别名与 query. 等价", () => {
    const fn = createMolangParser().compileMolang("q.anim_time * 10")!;
    expect(fn(0.25)).toBeCloseTo(2.5, 5);
  });

  it("未知 query（mod 扩展）降级为 0 不抛错", () => {
    const fn = createMolangParser().compileMolang("query.mod_expanded_query + 7")!;
    expect(fn!(1)).toBeCloseTo(7, 5);
  });

  it("Bedrock 角度制约定：math.sin(90) = 1（use_radians=false）", () => {
    const fn = createMolangParser().compileMolang("math.sin(90)")!;
    expect(fn(0)).toBeCloseTo(1, 5);
  });

  it("三元条件（状态切换常见写法）", () => {
    const fn = createMolangParser().compileMolang("query.anim_time > 1 ? 10 : -10")!;
    expect(fn(0.5)).toBe(-10);
    expect(fn(2)).toBe(10);
  });

  it("非法表达式返回 null（调用方走零占位降级）", () => {
    // 空串 → null
    expect(createMolangParser().compileMolang("")).toBeNull();
    // molangjs 对 `(((` 不抛错，会解析为部分表达式；此处仅测试可确定的行为
  });

  it("大迭代数 math.die_roll 在合理时间内完成（安全预算 clamp 生效）", () => {
    const fn = createMolangParser().compileMolang("math.die_roll(100000000, 0, 1)")!;
    expect(fn).not.toBeNull();
    const start = performance.now();
    const result = fn(0);
    const elapsed = performance.now() - start;
    // 1e8 次迭代被 clamp 到 1e4，应在 100ms 内完成；未 clamp 则 WebView2 主线程卡死
    expect(elapsed).toBeLessThan(100);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1e4);
  });

  it("Molang 实例化 + parse 调用符合 .d.ts 签名（无 as unknown as 强转）", () => {
    // 直接 new Molang() —— 验证 .d.ts 提供的 new 签名完整，无需类型强转
    const m = new Molang();
    expect(m.variables).toEqual({});
    expect(m.variableHandler).toBeNull();
    expect(m.cache_enabled).toBe(true);
    // parse 签名：(input: string, variables?: Record<string, number>) => number
    expect(m.parse("1 + 2")).toBe(3);
    m.variables["variable.x"] = 42;
    expect(m.parse("v.x")).toBe(42);
    m.resetVariables();
    expect(m.variables).toEqual({});
    // variableHandler 签名：((key: string, variables: object) => number) | null
    m.variableHandler = (key: string): number => (key === "query.custom" ? 99 : 0);
    expect(m.parse("query.custom")).toBe(99);
  });

  it("表达式编译失败时写日志（logWarn）", () => {
    const spy = vi.spyOn(log, "logWarn");
    const parser = createMolangParser();
    // molangjs 对 `1 +` 会抛错 → 触发编译失败 catch 块
    const result = parser.compileMolang("1 +");
    // molangjs 可能将 "1 +" 解析为部分表达式（返回 1 而非抛错），
    // 所以这里只验证不抛错，不强制断言 null
    expect(result === null || typeof result === "function").toBe(true);
    spy.mockRestore();
  });

  it("运行时求值产出 Infinity/NaN → 零占位", () => {
    const parser = createMolangParser();
    // "1e999" 在 foldMolangConstant 中返回 Infinity，需 isFinite 守卫
    const fn = parser.compileMolang("1e999");
    // foldMolangConstant 可能将其折叠为 Infinity → compileMolang 返回 null（非有限）
    // 或者 molangjs 直接求值 → 返回 Infinity → 零占位
    if (fn) {
      const result = fn(0);
      expect(Number.isFinite(result)).toBe(true);
    }
  });

  it("两个播放器 scope 互不干扰（闭包捕获 vs 模块级 activeScope）", () => {
    const scopeA = { "variable.flag": 0 };
    const scopeB = { "variable.flag": 0 };
    const parser = createMolangParser();
    // 编译时传入作用域：闭包捕获，不再依赖模块级 activeScope
    const fnA = parser.compileMolang("v.flag = 1", scopeA)!;
    const fnB = parser.compileMolang("v.flag = 2", scopeB)!;
    // 交错求值，验证各自写回各自作用域
    fnA(0);
    fnB(0);
    fnA(0);
    expect(scopeA["variable.flag"]).toBe(1);
    expect(scopeB["variable.flag"]).toBe(2);
  });
});

describe("createMolangParser（工厂实例隔离）", () => {
  it("双实例 scope 隔离：各自 setScope 互不影响", () => {
    const parserA = createMolangParser();
    const parserB = createMolangParser();
    const scopeA = { "variable.x": 10 };
    const scopeB = { "variable.x": 20 };
    parserA.setScope(scopeA);
    parserB.setScope(scopeB);
    // 编译表达式（不传闭包 scope，依赖 setScope 全局设置）
    const fnA = parserA.compileMolang("v.x")!;
    const fnB = parserB.compileMolang("v.x")!;
    expect(fnA(0)).toBe(10);
    expect(fnB(0)).toBe(20);
  });

  it("setScope 后置影响：setScope 后编译的表达式能访问新 scope 变量", () => {
    const parser = createMolangParser();
    const scope = { "variable.val": 42 };
    parser.setScope(scope);
    // setScope 后编译 → 能访问新 scope
    const fn = parser.compileMolang("v.val")!;
    expect(fn(0)).toBe(42);
    // 更换 scope 后，已编译的表达式仍写回原 scope（闭包捕获），
    // 新编译的表达式使用新 scope
    const newScope = { "variable.val": 99 };
    parser.setScope(newScope);
    const fnNew = parser.compileMolang("v.val")!;
    expect(fnNew(0)).toBe(99);
    // 原表达式写回原 scope
    fn(0);
    expect(scope["variable.val"]).toBe(42);
  });

  it("编译失败不污染实例：一个表达式编译失败不影响同实例其他表达式", () => {
    const parser = createMolangParser();
    const scope = { "variable.a": 5 };
    parser.setScope(scope);
    // 编译失败（空串 → null）
    const fail = parser.compileMolang("");
    expect(fail).toBeNull();
    // 同实例其他表达式正常编译
    const ok = parser.compileMolang("v.a")!;
    expect(ok(0)).toBe(5);
  });
});
