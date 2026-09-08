// @vitest-environment happy-dom
// 纯逻辑注册表 + DOM 断连自动清扫测试。
// 原 node 环境无法观测 isConnected，切到 happy-dom。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    setControlRegistry,
    registerControl,
    getControl,
    unregisterControl,
    iterateControls,
    clearControls,
    getControlCount,
    registerControlWithElement,
} from "./control-registry.ts";

// 每个用例前后重置全局状态，防串测试。
beforeEach(() => setControlRegistry(null));
afterEach(() => {
    clearControls();
    setControlRegistry(null);
});

describe("setControlRegistry", () => {
    it("未接入外部系统时 registerControl 仅写入内部表，不抛错", () => {
        const fn = vi.fn();
        registerControl("a", fn);
        expect(getControlCount()).toBe(1);
    });

    it("接入外部系统后 register 同时转发 fn 给外部", () => {
        const ext = vi.fn();
        setControlRegistry(ext);
        const fn = vi.fn();
        registerControl("x", fn);
        expect(ext).toHaveBeenCalledWith(fn);
    });

    it("传入 null 取消外部接入", () => {
        const ext = vi.fn();
        setControlRegistry(ext);
        setControlRegistry(null);

        registerControl("y", vi.fn());
        expect(ext).not.toHaveBeenCalled();
    });
});

describe("registerControl", () => {
    it("注册控件后能按 id 取出", () => {
        const fn = () => {};
        registerControl("alpha", fn);
        expect(getControl("alpha")).toBe(fn);
    });

    it("重复注册同一 id → 幂等覆盖旧 fn，数量不变", () => {
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        registerControl("dup", fn1);
        expect(getControl("dup")).toBe(fn1);

        registerControl("dup", fn2);
        expect(getControl("dup")).toBe(fn2);
        expect(getControlCount()).toBe(1);
    });

    it("不同 id 独立注册，互不干扰", () => {
        const fA = () => {}, fB = () => {};
        registerControl("A", fA);
        registerControl("B", fB);
        expect(getControl("A")).toBe(fA);
        expect(getControl("B")).toBe(fB);
        expect(getControlCount()).toBe(2);
    });
});

describe("getControl", () => {
    it("获取不存在的 id 返回 undefined", () => {
        expect(getControl("no-such-id")).toBeUndefined();
    });

    it("空表时获取任何 id 均返回 undefined", () => {
        expect(getControl("anything")).toBeUndefined();
    });
});

describe("unregisterControl", () => {
    it("移除已注册控件 → 返回 true，后续 get 为 undefined", () => {
        registerControl("remove-me", () => {});
        expect(unregisterControl("remove-me")).toBe(true);
        expect(getControl("remove-me")).toBeUndefined();
        expect(getControlCount()).toBe(0);
    });

    it("重复 unregister 同一 id → 返回 false，不抛错", () => {
        registerControl("once", () => {});
        expect(unregisterControl("once")).toBe(true);
        expect(unregisterControl("once")).toBe(false);
    });

    it("unregister 不存在的 id → 返回 false", () => {
        expect(unregisterControl("ghost")).toBe(false);
    });

    it("unregister 不影响其他已注册控件", () => {
        registerControl("keep", () => {});
        registerControl("drop", () => {});
        unregisterControl("drop");
        expect(getControl("keep")).toBeDefined();
        expect(getControlCount()).toBe(1);
    });
});

describe("iterateControls", () => {
    it("遍历所有已注册控件，entries 顺序与 Map 一致", () => {
        const fn1 = () => {}, fn2 = () => {}, fn3 = () => {};
        registerControl("b", fn2);
        registerControl("a", fn1);
        registerControl("c", fn3);

        const entries = [...iterateControls()];
        expect(entries).toEqual([
            ["b", fn2],
            ["a", fn1],
            ["c", fn3],
        ]);
    });

    it("空表时迭代器无条目", () => {
        expect([...iterateControls()]).toEqual([]);
    });

    it("迭代过程中外部 unregister 不影响当前迭代快照", () => {
        registerControl("one", () => {});
        registerControl("two", () => {});

        const iterator = iterateControls();
        const first = iterator.next();
        expect(first.done).toBe(false);

        // 迭代中途移除全部
        clearControls();

        // 原迭代器仍返回剩余条目
        const second = iterator.next();
        expect(second.done).toBe(false);
        expect(second.value).toEqual(["two", expect.any(Function)]);
        expect(iterator.next().done).toBe(true);
    });
});

describe("clearControls", () => {
    it("清空所有已注册控件", () => {
        registerControl("x", () => {});
        registerControl("y", () => {});
        clearControls();
        expect(getControlCount()).toBe(0);
        expect([...iterateControls()]).toEqual([]);
    });

    it("清空后重新注册正常", () => {
        registerControl("a", () => {});
        clearControls();
        const fn = () => {};
        registerControl("a", fn);
        expect(getControl("a")).toBe(fn);
        expect(getControlCount()).toBe(1);
    });

    it("清空不取消外部系统接入", () => {
        const ext = vi.fn();
        setControlRegistry(ext);
        registerControl("a", vi.fn());
        ext.mockClear();

        clearControls();
        registerControl("b", vi.fn());
        expect(ext).toHaveBeenCalled();
    });
});

describe("getControlCount", () => {
    it("初始为 0", () => {
        expect(getControlCount()).toBe(0);
    });

    it("注册/移除/清空的数量变化正确", () => {
        expect(getControlCount()).toBe(0);
        registerControl("1", () => {});
        registerControl("2", () => {});
        expect(getControlCount()).toBe(2);
        unregisterControl("1");
        expect(getControlCount()).toBe(1);
        registerControl("1", () => {}); // 重新注册
        expect(getControlCount()).toBe(2);
        clearControls();
        expect(getControlCount()).toBe(0);
    });
});

// ===================================================================
// registerControlWithElement — DOM 断连自动清扫（防内存泄漏）
// ===================================================================
// 背景：initControl（ui-rows.ts）每次渲染都 registerControl，但控件对应的 DOM 行
// 在菜单刷新时被销毁，注册表里的 updater 仍持有旧 DOM 引用 → 泄漏 + 空转。
// 修复方向：registerControlWithElement 在元素断连时自动 unregister。

describe("registerControlWithElement", () => {
    beforeEach(() => {
        clearControls();
        setControlRegistry(null);
        document.body.innerHTML = "";
    });

    afterEach(() => {
        clearControls();
        setControlRegistry(null);
        document.body.innerHTML = "";
    });

    it("注册后控件可被 getControl 取出", () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const fn = vi.fn();
        registerControlWithElement("el-test", fn, el);
        expect(getControl("el-test")).toBe(fn);
        expect(getControlCount()).toBe(1);
    });

    it("元素断连后控件应自动 unregister（核心：防泄漏）", async () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const fn = vi.fn();
        registerControlWithElement("el-gc", fn, el);
        expect(getControlCount()).toBe(1);
        expect(getControl("el-gc")).toBe(fn);

        // 模拟 DOM 行被销毁（菜单刷新）
        el.remove();

        // MutationObserver 异步清扫，等待完成
        await vi.waitFor(() => {
            expect(getControl("el-gc")).toBeUndefined();
        });
        expect(getControlCount()).toBe(0);
    });

    it("元素未断连时控件保留", () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const fn = vi.fn();
        registerControlWithElement("el-keep", fn, el);
        expect(getControlCount()).toBe(1);

        // 元素仍在 DOM 中
        expect(document.body.contains(el)).toBe(true);
        expect(getControl("el-keep")).toBe(fn);
        expect(getControlCount()).toBe(1);
    });

    it("多个控件：仅断连的被清扫，未断连的保留", async () => {
        const el1 = document.createElement("div");
        const el2 = document.createElement("div");
        document.body.appendChild(el1);
        document.body.appendChild(el2);

        const fn1 = vi.fn();
        const fn2 = vi.fn();
        registerControlWithElement("el-multi-1", fn1, el1);
        registerControlWithElement("el-multi-2", fn2, el2);
        expect(getControlCount()).toBe(2);

        // 只断开 el1
        el1.remove();

        // MutationObserver 异步清扫
        await vi.waitFor(() => {
            expect(getControl("el-multi-1")).toBeUndefined();
        });
        expect(getControl("el-multi-2")).toBe(fn2);
        expect(getControlCount()).toBe(1);
    });

    it("重复注册同一 id + 不同元素：以最后一次为准", async () => {
        const el1 = document.createElement("div");
        const el2 = document.createElement("div");
        document.body.appendChild(el1);
        document.body.appendChild(el2);

        const fn1 = vi.fn();
        const fn2 = vi.fn();
        registerControlWithElement("el-dup", fn1, el1);
        registerControlWithElement("el-dup", fn2, el2);

        expect(getControlCount()).toBe(1);
        expect(getControl("el-dup")).toBe(fn2);

        // 断开 el2 → 控件应被清扫
        el2.remove();
        await vi.waitFor(() => {
            expect(getControl("el-dup")).toBeUndefined();
        });
        expect(getControlCount()).toBe(0);
    });
});