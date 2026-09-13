// @vitest-environment node
// ===== web-component-base.ts node 安全垫片测试 =====
// 本文件存在的唯一目的：视图层 class X extends HTMLElement 在 node 测试环境
// 因无 HTMLElement 全局而 import 即炸。垫片在 node 下回退为空类。
import { describe, it, expect } from "vitest";
import { WebComponentBase } from "./web-component-base.ts";

describe("WebComponentBase — node 安全垫片", () => {
  it("node 下 HTMLElement 未定义，垫片回退为空类（而非 HTMLElement）", () => {
    expect(typeof HTMLElement).toBe("undefined");
    // 直接引用 HTMLElement 标识符在 node 下会抛 ReferenceError，须用 typeof 守卫捕获
    const HeDef = typeof HTMLElement !== "undefined" ? HTMLElement : undefined;
    expect(WebComponentBase).not.toBe(HeDef);
  });

  it("垫片可无参构造（import 不炸、不依赖 DOM 全局）", () => {
    let inst: unknown;
    expect(() => {
      inst = new WebComponentBase();
    }).not.toThrow();
    expect(inst).toBeInstanceOf(WebComponentBase);
  });

  it("垫片可被继承（视图 class X extends WebComponentBase 形态）", () => {
    class Foo extends WebComponentBase {}
    expect(() => new Foo()).not.toThrow();
  });
});
