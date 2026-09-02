// ===== runtime 桥契约测试（ADR-049 收口验证）=====
// 覆盖：桌面模式委托真 @wailsio/runtime、web 模式 no-op 桩不抛错、导出面锁定。
// vi.mock 被 vitest 提升到顶层，通过 vi.resetModules + 动态 import 隔离模块级状态。
import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== 辅助 =====

function resetPlatform() {
  delete (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
  delete (globalThis as Record<string, unknown>)["__YSM_WEB__"];
}

beforeEach(() => {
  vi.resetModules();
  resetPlatform();
});

/** web 模式公共桩：mock 真 @wailsio/runtime + platform 后动态 import（隔离模块状态）。 */
async function loadWebRuntime() {
  vi.doMock("@wailsio/runtime", () => ({
    Events: { On: vi.fn(), OnMultiple: vi.fn(), Off: vi.fn(), Emit: vi.fn() },
    Window: {},
  }));
  vi.doMock("./platform-web.ts", () => ({
    isWebPlatform: () => true,
  }));
  return import("./runtime.ts");
}

// ===== Tests =====

describe("桌面模式（isWeb=false）— 委托真 @wailsio/runtime", () => {
  it("Events 和 Window 直接透传 WailsEvents / WailsWindow", async () => {
    const mockOn = vi.fn().mockReturnValue(() => {});
    const mockOff = vi.fn();
    const mockEmit = vi.fn();
    const mockOnMultiple = vi.fn().mockReturnValue(() => {});
    const mockSetTitle = vi.fn().mockResolvedValue(undefined);
    const mockShow = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@wailsio/runtime", () => ({
      Events: { On: mockOn, OnMultiple: mockOnMultiple, Off: mockOff, Emit: mockEmit },
      Window: { SetTitle: mockSetTitle, Show: mockShow },
    }));
    vi.doMock("./platform-web.ts", () => ({
      isWebPlatform: () => false,
    }));

    const { Events, Window } = await import("./runtime.ts");

    // Events 是真 WailsEvents（mock 透传）
    expect(Events.On).toBe(mockOn);
    expect(Events.Emit).toBe(mockEmit);
    expect(Events.Off).toBe(mockOff);
    expect(Events.OnMultiple).toBe(mockOnMultiple);

    // Window 是真 WailsWindow（mock 透传）
    expect(Window.SetTitle).toBe(mockSetTitle);
    expect(Window.Show).toBe(mockShow);
  });
});

describe("web 模式（isWeb=true）— no-op 桩不抛错", () => {
  it("Events.On / OnMultiple 返回 no-op unsubscribe 函数", async () => {
    const { Events } = await loadWebRuntime();

    const unsubOn = Events.On("test-event", () => {});
    expect(typeof unsubOn).toBe("function");
    expect(() => unsubOn()).not.toThrow();

    const unsubMultiple = Events.OnMultiple("test-event", () => {}, 3);
    expect(typeof unsubMultiple).toBe("function");
    expect(() => unsubMultiple()).not.toThrow();
  });

  it("Events.Off / Emit 是 no-op（不抛错）", async () => {
    const { Events } = await loadWebRuntime();

    expect(() => Events.Off("test-event")).not.toThrow();
    expect(() => Events.Emit("test-event", {})).not.toThrow();
    // 与真值返回值类型一致：Emit 返回 Promise<boolean>；web 桩诚实报告 false
    const ret = Events.Emit("test-event", {});
    expect(ret).toBeInstanceOf(Promise);
    await expect(ret).resolves.toBe(false);
  });

  it("Window 所有方法返回 resolved Promise（不抛错）", async () => {
    const { Window } = await loadWebRuntime();

    // 通过 Proxy 的 get 动态派发——任意方法名都应返回 resolved Promise
    const win = Window as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    const result1 = win.SetTitle("test");
    expect(result1).toBeInstanceOf(Promise);
    await expect(result1).resolves.toBeUndefined();

    const result2 = win.Show();
    await expect(result2).resolves.toBeUndefined();

    const result3 = win.Hide();
    await expect(result3).resolves.toBeUndefined();

    const result4 = win.OpenDevTools();
    await expect(result4).resolves.toBeUndefined();

    const result5 = win.Reload();
    await expect(result5).resolves.toBeUndefined();

    // 未定义的方法同样返回 resolved Promise（Proxy get 一律返回 () => Promise.resolve()）
    const result6 = win.NonExistentMethod();
    await expect(result6).resolves.toBeUndefined();
  });

  it("Window 不是 thenable：.then 返回 undefined，await Window 不挂起（browser-adapter 对称守卫）", async () => {
    const { Window } = await loadWebRuntime();
    // thenable 探测陷阱：await/`Promise.resolve(Window)` 会访问 .then——
    // 若返回 async 函数会被误判为 thenable，await 调它后 onFulfilled 永不被调 → 永久挂起。
    // 守卫返回 undefined，让 Window 不是 thenable（与 browser-adapter.ts:75 对称）。
    expect((Window as unknown as Record<string, unknown>).then).toBeUndefined();
    // await 非 thenable 值直接返回自身（不挂起；若误判 thenable 这里会超时挂起）
    const awaited = await Window;
    expect(awaited).toBe(Window);
  });
});

describe("导出面锁定", () => {
  it("仅导出 Events 和 Window 两个符号", async () => {
    vi.doMock("@wailsio/runtime", () => ({
      Events: { On: vi.fn(), OnMultiple: vi.fn(), Off: vi.fn(), Emit: vi.fn() },
      Window: { SetTitle: vi.fn(), Show: vi.fn() },
    }));
    vi.doMock("./platform-web.ts", () => ({
      isWebPlatform: () => false,
    }));

    const mod = await import("./runtime.ts");
    const keys = Object.keys(mod).sort();
    expect(keys).toEqual(["Events", "Window"]);
  });
});
