// ===== key-router.test.ts — 全局快捷键注册表契约测试（ADR-308 D1）=====
// 契约：registerShortcut 单点 document keydown 分发 + 组合匹配（纯函数）
// + 注册期碰撞响亮告警 + dispose 归还；WASD 键状态/一次性捕获不进本注册表。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetShortcutsForTest,
  comboMatches,
  findCollisions,
  listShortcuts,
  registerShortcut,
  type ShortcutSpec,
} from "./key-router.ts";

function keydown(key: string, init: Omit<KeyboardEventInit, "key"> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...init });
}

function fire(key: string, init: Omit<KeyboardEventInit, "key"> = {}): KeyboardEvent {
  const e = keydown(key, init);
  document.dispatchEvent(e);
  return e;
}

describe("comboMatches（纯函数）", () => {
  it("裸键（Delete/F12/方向键）命中且大小写不敏感", () => {
    expect(comboMatches("Delete", keydown("Delete"))).toBe(true);
    expect(comboMatches("delete", keydown("Delete"))).toBe(true);
    expect(comboMatches("F12", keydown("F12"))).toBe(true);
    expect(comboMatches("F12", keydown("f12"))).toBe(true);
    expect(comboMatches("ArrowDown", keydown("ArrowDown"))).toBe(true);
    expect(comboMatches("ArrowDown", keydown("ArrowUp"))).toBe(false);
    // 裸键 = 无任何修饰键（Ctrl+Delete 不算 "Delete"）
    expect(comboMatches("Delete", keydown("Delete", { ctrlKey: true }))).toBe(false);
  });

  it("修饰键组合：修饰键精确匹配（多按/漏按都失配）", () => {
    expect(comboMatches("Ctrl+F", keydown("f", { ctrlKey: true }))).toBe(true);
    expect(comboMatches("Ctrl+F", keydown("f"))).toBe(false);
    expect(comboMatches("Ctrl+F", keydown("f", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(comboMatches("Ctrl+Shift+I", keydown("i", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(comboMatches("Ctrl+Shift+I", keydown("i", { ctrlKey: true }))).toBe(false);
    expect(comboMatches("Meta+F", keydown("f", { metaKey: true }))).toBe(true);
    expect(comboMatches("Alt+Q", keydown("q", { altKey: true }))).toBe(true);
  });

  it("只写修饰键（无主键）恒失配；未知 token 恒失配", () => {
    expect(comboMatches("Ctrl", keydown("c", { ctrlKey: true }))).toBe(false);
    expect(comboMatches("Ctrl+Shift", keydown("Shift"))).toBe(false);
    expect(comboMatches("Win+F", keydown("f", { metaKey: true }))).toBe(true); // Win=meta 别名
    expect(comboMatches("Foo+F", keydown("f"))).toBe(false);
  });
});

describe("findCollisions（纯函数）", () => {
  const reg: ShortcutSpec[] = [
    { id: "a", combo: "Ctrl+F", handler: () => {} },
    { id: "b", combo: ["Delete", "Del"], handler: () => {} },
    { id: "c", combo: "F12", handler: () => {} },
  ];
  it("共享任一组合即碰撞（与自身 id 不算）", () => {
    // 候选先落变量再传（findCollisions 形参是 Pick 子集，新字面量直接传会触发多余属性检查）
    const c1: ShortcutSpec = { id: "x", combo: "F12", handler: () => {} };
    const c2: ShortcutSpec = { id: "x", combo: "Del", handler: () => {} };
    const c3: ShortcutSpec = { id: "a", combo: "Ctrl+F", handler: () => {} };
    expect(findCollisions(c1, reg)).toEqual(["c"]);
    expect(findCollisions(c2, reg)).toEqual(["b"]);
    expect(findCollisions(c3, reg)).toEqual([]); // 自身
  });
  it("修饰键不同不算碰撞（Ctrl+F vs F）", () => {
    const c4: ShortcutSpec = { id: "x", combo: "F", handler: () => {} };
    expect(findCollisions(c4, reg)).toEqual([]);
  });
});

describe("registerShortcut 分发", () => {
  beforeEach(__resetShortcutsForTest);
  afterEach(__resetShortcutsForTest);

  it("组合命中 + when 放行 → handler 收到事件；失配/拦截 → 不触发", () => {
    const hit = vi.fn();
    const gate = vi.fn();
    registerShortcut({ id: "s", combo: "Ctrl+F", when: gate, handler: hit });
    expect(listShortcuts().map((s) => s.id)).toEqual(["s"]);

    const e1 = fire("f", { ctrlKey: true });
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenLastCalledWith(e1);
    expect(gate).toHaveBeenCalledWith(e1);

    fire("f"); // 无修饰键
    fire("g", { ctrlKey: true });
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it("when 返回 false 即拦截（3D 全屏让路语义）", () => {
    const hit = vi.fn();
    registerShortcut({ id: "s", combo: "Ctrl+F", when: () => false, handler: hit });
    fire("f", { ctrlKey: true });
    expect(hit).not.toHaveBeenCalled();
  });

  it("combo 数组任一命中即触发（Delete/Del 双写）", () => {
    const hit = vi.fn();
    registerShortcut({ id: "s", combo: ["Delete", "Del"], handler: hit });
    fire("Delete");
    fire("Del");
    expect(hit).toHaveBeenCalledTimes(2);
  });

  it("handler 内 preventDefault 可见（事件可取消）", () => {
    const hit = vi.fn((e: KeyboardEvent) => e.preventDefault());
    registerShortcut({ id: "s", combo: "F12", handler: hit });
    const e = fire("F12", { cancelable: true });
    expect(e.defaultPrevented).toBe(true);
  });

  it("按注册顺序触发；不同组合互不干扰", () => {
    const order: string[] = [];
    registerShortcut({ id: "first", combo: "F12", handler: () => order.push("first") });
    registerShortcut({ id: "second", combo: "F12", handler: () => order.push("second") });
    registerShortcut({ id: "other", combo: "Ctrl+Shift+I", handler: () => order.push("other") });
    fire("F12");
    fire("i", { ctrlKey: true, shiftKey: true });
    expect(order).toEqual(["first", "second", "other"]);
  });

  it("注册期同组合碰撞 → 响亮告警（console.warn 一次/注册）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerShortcut({ id: "a", combo: "Ctrl+F", handler: () => {} });
    registerShortcut({ id: "b", combo: "Ctrl+F", handler: () => {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("b");
    warnSpy.mockRestore();
  });
});

describe("dispose 生命周期", () => {
  beforeEach(__resetShortcutsForTest);
  afterEach(__resetShortcutsForTest);

  it("dispose 后不再触发且 listShortcuts 移除；重复 dispose 幂等", () => {
    const hit = vi.fn();
    const off = registerShortcut({ id: "s", combo: "F12", handler: hit });
    off();
    off();
    fire("F12");
    expect(hit).not.toHaveBeenCalled();
    expect(listShortcuts()).toHaveLength(0);
  });

  it("最后一个 shortcut dispose 后 document 监听摘除（防 HMR/重求值叠加注册）", () => {
    const off1 = registerShortcut({ id: "s1", combo: "F12", handler: () => {} });
    const off2 = registerShortcut({ id: "s2", combo: "Ctrl+F", handler: () => {} });
    off1();
    off2();
    fire("F12");
    expect(listShortcuts()).toHaveLength(0);
  });
});

describe("跨用例卫生", () => {
  it("__resetShortcutsForTest 清空注册表（vi.resetModules 后 document 残留监听不再带旧 spec）", () => {
    const hit = vi.fn();
    registerShortcut({ id: "zombie", combo: "F12", handler: hit });
    __resetShortcutsForTest();
    fire("F12");
    expect(hit).not.toHaveBeenCalled();
    expect(listShortcuts()).toHaveLength(0);
  });
});
