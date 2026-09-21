// ===== 监听器集合工厂测试（ADR-216 提级：原 scene-capability 3 用例 + payload 变体）=====
import { describe, it, expect, vi } from "vitest";
import { createListenerSet } from "./listener-set.ts";

describe("createListenerSet — 无参通知（原 3D 域 ground/water 共用样板）", () => {
  it("notify 触发全部已订阅监听器", () => {
    const { subscribe, notify } = createListenerSet();
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    notify();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("取消订阅后不再触发", () => {
    const { subscribe, notify } = createListenerSet();
    const a = vi.fn();
    const unsub = subscribe(a);
    unsub();
    notify();
    expect(a).not.toHaveBeenCalled();
  });

  it("多次 notify 每次触发；订阅回调可安全访问自身状态", () => {
    const { subscribe, notify } = createListenerSet();
    let count = 0;
    subscribe(() => {
      count++;
    });
    notify();
    notify();
    expect(count).toBe(2);
  });

  it("同一函数重复 subscribe 只登记一次（Set 去重）", () => {
    const { subscribe, notify } = createListenerSet();
    const a = vi.fn();
    const u1 = subscribe(a);
    const u2 = subscribe(a);
    u1();
    u2(); // 幂等删除
    notify();
    expect(a).not.toHaveBeenCalled();
  });

  // [ADR-293 复核 P0] notify 同步栈内「退订旧 + 订阅新」重绑（面板 refresh → 渲染器
  // 重建闭包）若走活 Set 迭代，新监听器会被同一轮 notify 再触发 → 无穷兄弟循环。
  // 快照迭代断链：本轮只通知 notify 时刻已在册者（DOM EventTarget 同语义）。
  it("notify 迭代期间 subscribe 的新监听器不参与本轮（快照迭代，防重入自激循环）", () => {
    const { subscribe, notify } = createListenerSet();
    let lateCalls = 0;
    subscribe(() => {
      subscribe(() => {
        lateCalls++;
      });
    });
    notify();
    expect(lateCalls).toBe(0); // 本轮快照里没有新订阅者
    notify();
    expect(lateCalls).toBe(1); // 下一轮才收到
  });

  it("notify 迭代期间 unsubscribe 的靠后监听器本轮即跳过（快照 + 在册校验）", () => {
    const { subscribe, notify } = createListenerSet();
    const b = vi.fn();
    subscribe(() => {
      unsubB();
    });
    const unsubB = subscribe(b);
    notify();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("createListenerSet<T> — 状态快照订阅（带载荷）", () => {
  it("notify(payload) 把载荷传给全部订阅者", () => {
    const { subscribe, notify } = createListenerSet<{ v: number }>();
    const fn = vi.fn();
    subscribe(fn);
    notify({ v: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ v: 1 });
  });

  it("多次 notify 载荷逐次更新（订阅者读到通知时刻的状态）", () => {
    const { subscribe, notify } = createListenerSet<number>();
    const seen: number[] = [];
    subscribe((n) => {
      seen.push(n);
    });
    notify(1);
    notify(2);
    expect(seen).toEqual([1, 2]);
  });

  it("取消订阅后不再收到载荷", () => {
    const { subscribe, notify } = createListenerSet<string>();
    const fn = vi.fn();
    const unsub = subscribe(fn);
    notify("a");
    unsub();
    notify("b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });
});
