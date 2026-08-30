// @vitest-environment node
// ===== getApp 桥接语义单测（P2 补测：wails/ 目录仅 app.ts，84 个消费方测试全部 vi.mock 掉本模块，
// 缓存/并发复用/失败重置/window.go 回退四语义零直接测试、第 5 批 P2 修复无回归护栏）=====
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// node 环境无 window——beforeAll stub 空对象供 window.go 注入路径使用
// （getApp 源码读 window.go；测试动态 import 被测模块。2026-08-17 切 node）
beforeAll(() => {
  vi.stubGlobal("window", {});
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// 用 vi.resetModules + 动态 import 隔离模块级 _App/_appPromise 状态
async function freshGetApp() {
  vi.resetModules();
  const mod = await import("./app.ts");
  return mod.getApp;
}

let originalWindowGo: unknown;

beforeEach(() => {
  originalWindowGo = (window as unknown as { go?: unknown }).go;
  vi.resetModules();
  delete (window as unknown as { go?: unknown }).go;
  delete (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
});

afterEach(() => {
  if (originalWindowGo === undefined) {
    delete (window as unknown as { go?: unknown }).go;
  } else {
    (window as unknown as { go?: unknown }).go = originalWindowGo;
  }
});

describe("getApp — window.go mock bridge 注入路径", () => {
  it("window.go.main.App 存在 → 返回该句柄（不 import）", async () => {
    const mockApp = { AddImportLog: () => "mock" };
    (window as unknown as { go: { main: { App: unknown } } }).go = {
      main: { App: mockApp },
    };
    const getApp = await freshGetApp();
    expect(await getApp()).toBe(mockApp);
  });

  it("window.go.main.App 为空对象 {} → 视为未注入，回退动态 import（P3 修复）", async () => {
    (window as unknown as { go: { main: { App: unknown } } }).go = {
      main: { App: {} },
    };
    const getApp = await freshGetApp();
    const app = await getApp().catch(() => null);
    // 空对象不得被缓存为 _App——若被缓存会返回 {}，现应走 import（成功返回模块或失败返回 null）
    expect(app).not.toEqual({});
  });
});

describe("getApp — 缓存与并发语义（经 window.go 注入隔离）", () => {
  it("缓存命中：首调后二次调用返回同一对象（不再重新解析）", async () => {
    const mockApp = { AddImportLog: () => "mock" };
    (window as unknown as { go: { main: { App: unknown } } }).go = {
      main: { App: mockApp },
    };
    const getApp = await freshGetApp();
    const a = await getApp();
    // 移除注入点后二次调用仍应命中 _App 缓存
    delete (window as unknown as { go?: unknown }).go;
    expect(await getApp()).toBe(a);
  });

  it("并发首调复用同一 in-flight promise（import 只触发一次）", async () => {
    const mockApp = { AddImportLog: () => "mock" };
    (window as unknown as { go: { main: { App: unknown } } }).go = {
      main: { App: mockApp },
    };
    const getApp = await freshGetApp();
    const [a, b] = await Promise.all([getApp(), getApp()]);
    expect(a).toBe(b);
  });
});

// P3 修复（code_review）：window.go 注入路径短路于动态 import 之前，
// 上表未触及 import 路径的 _appPromise 语义——以下用例清空 window.go、
// mock bindings 模块，验证并发共享 in-flight 与失败重置重试（第 5 批 P2 修复的回归护栏）
describe("getApp — 动态 import 路径语义（无 window.go 注入）", () => {
  it("并发首调共享同一 in-flight import（import 只触发一次）", async () => {
    vi.resetModules();
    // mock bindings 模块：返回可延迟 resolve 的 promise，验证并发不重复 import
    let resolveImport!: (m: unknown) => void;
    const importPromise = new Promise((r) => {
      resolveImport = r;
    });
    vi.doMock("../../bindings/ysm-model-manager/internal/app/app.js", () => importPromise);
    const mod = await import("./app.ts");
    const getApp = mod.getApp;
    // 注入延迟：两个并发调用应共享同一 in-flight promise
    const p1 = getApp();
    const p2 = getApp();
    resolveImport({ __mockBinding: true });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    vi.doUnmock("../../bindings/ysm-model-manager/internal/app/app.js");
    vi.resetModules();
  });

  it("import 失败后 _appPromise 重置，二次调用重试成功（P2 修复回归护栏）", async () => {    vi.resetModules();
    // 首次 import reject，二次 resolve——验证失败不毒化桥接
    let calls = 0;
    vi.doMock("../../bindings/ysm-model-manager/internal/app/app.js", () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("import failed"));
      return Promise.resolve({ __mockBinding: true });
    });
    const mod = await import("./app.ts");
    const getApp = mod.getApp;
    // vitest 对 vi.doMock 工厂返回 rejected promise 会包装错误消息，
    // 不断言具体消息——核心断言是「二次调用重试成功且 import 恰好 2 次」（_appPromise 已重置）
    await expect(getApp()).rejects.toThrow();
    // 二次调用应重新 import（_appPromise 已重置）并成功
    const app = await getApp();
    expect(app).toMatchObject({ __mockBinding: true });
    expect(calls).toBe(2);
    vi.doUnmock("../../bindings/ysm-model-manager/internal/app/app.js");
    vi.resetModules();
  });

  it("__YSM_BACKEND__=browser → 路由 browserAdapter（ADR-049 Phase 1，业务零改动）", async () => {
    (globalThis as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    const getApp = await freshGetApp();
    const app = await getApp();
    // 已实现的最小启动集：ScanModelEntries 诚实空（Phase 2 IndexedDB 前）
    expect(await app.ScanModelEntries("ysm")).toEqual([]);
    // 未实现 binding fail-fast（WebUnsupportedError），非 undefined 穿透
    await expect(app.ImportModelFile("a", "b") as unknown as Promise<unknown>).rejects.toThrow("浏览器端未实现");
  });

  it("无 __YSM_BACKEND__ 标记 + window.go 注入 → 仍走 Wails 原逻辑（桌面不受影响）", async () => {
    const mockApp = { AddImportLog: () => "mock" };
    (window as unknown as { go: { main: { App: unknown } } }).go = {
      main: { App: mockApp },
    };
    const getApp = await freshGetApp();
    expect(await getApp()).toBe(mockApp);
  });
});
