// ===== 服务注册表测试（ADR-023 Vitest 体系）=====
// register / get / has / unregister / clear 全生命周期。
// 服务名已收窄为 ServiceName 联合（拼错编译期拦截），
// 测试用"合法名但未注册"的状态表达未注册场景。
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

  it("get 合法名但未注册抛错（含服务名）", () => {
    expect(() => get("loadEntries")).toThrow(/loadEntries/);
  });

  it("has 反映注册状态", () => {
    expect(has("loadInstances")).toBe(false);
    register("loadInstances", 1);
    expect(has("loadInstances")).toBe(true);
    unregister("loadInstances");
    expect(has("loadInstances")).toBe(false);
  });

  it("重复注册覆盖旧实例", () => {
    register("loadInstances", "v1");
    register("loadInstances", "v2");
    expect(get("loadInstances")).toBe("v2");
  });

  it("unregister 不存在的服务不抛错", () => {
    expect(() => unregister("loadEntries")).not.toThrow();
  });

  it("clear 清空全部服务", () => {
    register("loadInstances", 1);
    register("loadEntries", 2);
    clear();
    expect(has("loadInstances")).toBe(false);
    expect(has("loadEntries")).toBe(false);
  });

  it("register 支持任意值（函数/对象/标量）", () => {
    register("loadInstances", () => "hi");
    register("loadEntries", { k: 1 });
    expect(typeof get("loadInstances")).toBe("function");
    expect(get("loadEntries")).toEqual({ k: 1 });
  });
});
