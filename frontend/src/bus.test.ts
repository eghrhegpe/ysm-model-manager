// ===== 全局事件总线测试（bus.ts）=====
// on / off / emit / once 的类型化事件总线，覆盖：
// 1. 常规订阅与取消
// 2. 返回的 unsub 函数行为
// 3. once 只触发一次
// 4. 多重 listener 先后顺序
// 5. 无 listener 时 emit 不抛错
// 6. 带 payload 事件
// 7. void 事件（无 payload）
// 8. handler 内移除自身不干扰其他 listener
// 9. handler 内 emit 不导致无限循环
// bus 是全局单例：每个用例注册的 listener 必须显式清理，
// 否则跨用例泄漏（后续 emit 会触发过期 handler）。
import { describe, it, expect, afterEach } from "vitest";
import { bus } from "./bus.ts";

const unsubs: Array<() => void> = [];

afterEach(() => {
  // 清理本文件注册的全部 listener，防污染其他用例
  unsubs.splice(0).forEach((fn) => fn());
});

function track<T>(unsub: () => void): void {
  unsubs.push(unsub);
}

describe("事件总线 — 基础订阅/取消", () => {
  it("on 注册后 emit 触发 listener", () => {
    let called = 0;
    const unsub = bus.on("stats:refresh", () => { called++; });
    track(unsub);
    bus.emit("stats:refresh");
    expect(called).toBe(1);
  });

  it("off 取消后不再触发", () => {
    let called = 0;
    const fn = () => { called++; };
    track(bus.on("stats:refresh", fn));
    bus.off("stats:refresh", fn);
    bus.emit("stats:refresh");
    expect(called).toBe(0);
  });

  it("unsub 返回函数取消订阅", () => {
    let called = 0;
    const unsub = bus.on("stats:refresh", () => { called++; });
    unsub();
    bus.emit("stats:refresh");
    expect(called).toBe(0);
  });

  it("同一事件多 listener 按注册顺序触发", () => {
    const order: number[] = [];
    track(bus.on("stats:refresh", () => order.push(1)));
    track(bus.on("stats:refresh", () => order.push(2)));
    bus.emit("stats:refresh");
    expect(order).toEqual([1, 2]);
  });

  it("off 不存在的 listener 不抛错", () => {
    const fn = () => {};
    expect(() => bus.off("stats:refresh", fn)).not.toThrow();
  });

  it("emit 无 listener 的事件不抛错", () => {
    expect(() => bus.emit("stats:refresh")).not.toThrow();
  });
});

describe("事件总线 — once", () => {
  it("once 只触发一次", () => {
    let count = 0;
    // once 内部注册 wrapper 并自动 off（触发后），无需外部清理
    bus.once("stats:refresh", () => { count++; });
    bus.emit("stats:refresh");
    bus.emit("stats:refresh");
    expect(count).toBe(1);
  });
});

describe("事件总线 — 带 payload 事件", () => {
  it("emit 带 payload 传递给 listener", () => {
    let received: string | undefined;
    track(bus.on("tree:set-search", (payload) => { received = payload; }));
    bus.emit("tree:set-search", "test query");
    expect(received).toBe("test query");
  });

  it("emit 复杂对象 payload", () => {
    let received: unknown;
    track(bus.on("nav:change", (p) => { received = p; }));
    bus.emit("nav:change", { page: "settings" });
    expect(received).toEqual({ page: "settings" });
  });

  it("toast:show payload 含可选字段", () => {
    let received: unknown;
    track(bus.on("toast:show", (p) => { received = p; }));
    bus.emit("toast:show", { msg: "hi", type: "error" });
    expect(received).toMatchObject({ msg: "hi", type: "error" });
  });
});

describe("事件总线 — void 事件（无 payload）", () => {
  it("void 事件 emit 不传第二参数", () => {
    let called = false;
    track(bus.on("loading:start", () => { called = true; }));
    bus.emit("loading:start");
    expect(called).toBe(true);
  });
});

describe("事件总线 — 边界安全", () => {
  it("handler 内移除自身不影响其他 listener", () => {
    let a = 0, b = 0;
    const fnA = () => { a++; bus.off("stats:refresh", fnA); };
    const fnB = () => { b++; };
    track(bus.on("stats:refresh", fnA));
    track(bus.on("stats:refresh", fnB));
    bus.emit("stats:refresh");
    expect(a).toBe(1);
    expect(b).toBe(1);
    // 第二次 emit：fnA 已移除，fnB 还在
    bus.emit("stats:refresh");
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("handler 内 emit 不导致无限循环（快照派发）", () => {
    let count = 0;
    const fn = () => {
      count++;
      if (count < 5) bus.emit("stats:refresh");
    };
    track(bus.on("stats:refresh", fn));
    bus.emit("stats:refresh");
    // 快照拷贝：第一次 emit 触发 1 次，handler 内 emit 递归触发新快照
    expect(count).toBe(5);
  });

  it("handler 抛异常不阻止其他 handler", () => {
    let b = 0;
    const errFn = () => { throw new Error("boom"); };
    const okFn = () => { b++; };
    track(bus.on("stats:refresh", errFn));
    track(bus.on("stats:refresh", okFn));
    expect(() => bus.emit("stats:refresh")).not.toThrow();
    expect(b).toBe(1);
  });
});
