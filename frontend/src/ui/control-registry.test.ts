// @vitest-environment node
// 纯逻辑注册表，无 DOM 依赖，node 环境（~0ms 启动，省 happy-dom 重建开销）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    setControlRegistry,
    registerControl,
    getControl,
    unregisterControl,
    iterateControls,
    clearControls,
    getControlCount,
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