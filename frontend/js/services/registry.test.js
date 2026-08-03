// ===== 服务注册表测试（ADR-021 扩展）=====
// register / get / has / unregister / clear 全生命周期。
import { describe, it, expect, beforeEach } from "vitest";
import { register, get, has, unregister, clear } from "./registry.ts";

describe("服务注册表", () => {
  beforeEach(() => {
    clear();
  });

  it("register 后可 get 取回同一实例", () => {
    const impl = { load: () => 42 };
    register("loadInstances", impl);
    expect(get("loadInstances")).toBe(impl);
  });

  it("get 未注册服务抛错（含服务名）", () => {
    expect(() => get("nope")).toThrow(/nope/);
  });

  it("has 反映注册状态", () => {
    expect(has("x")).toBe(false);
    register("x", 1);
    expect(has("x")).toBe(true);
    unregister("x");
    expect(has("x")).toBe(false);
  });

  it("重复注册覆盖旧实例", () => {
    register("svc", "v1");
    register("svc", "v2");
    expect(get("svc")).toBe("v2");
  });

  it("unregister 不存在的服务不抛错", () => {
    expect(() => unregister("nope")).not.toThrow();
  });

  it("clear 清空全部服务", () => {
    register("a", 1);
    register("b", 2);
    clear();
    expect(has("a")).toBe(false);
    expect(has("b")).toBe(false);
  });

  it("register 支持任意值（函数/对象/标量）", () => {
    register("fn", () => "hi");
    register("obj", { k: 1 });
    register("num", 7);
    expect(typeof get("fn")).toBe("function");
    expect(get("obj")).toEqual({ k: 1 });
    expect(get("num")).toBe(7);
  });
});
