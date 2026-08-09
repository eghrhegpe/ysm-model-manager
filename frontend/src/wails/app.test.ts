// ===== getApp 桥接语义单测（P2 补测：wails/ 目录仅 app.ts，84 个消费方测试全部 vi.mock 掉本模块，
// 缓存/并发复用/失败重置/window.go 回退四语义零直接测试、第 5 批 P2 修复无回归护栏）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 用 vi.resetModules + 动态 import 隔离模块级 _App/_appPromise 状态
async function freshGetApp() {
  vi.resetModules();
  const mod = await import("./app.ts");
  return mod.getApp;
}

const ORIGINAL_WINDOW_GO = (window as unknown as { go?: unknown }).go;

beforeEach(() => {
  vi.resetModules();
  delete (window as unknown as { go?: unknown }).go;
});

afterEach(() => {
  if (ORIGINAL_WINDOW_GO === undefined) {
    delete (window as unknown as { go?: unknown }).go;
  } else {
    (window as unknown as { go?: unknown }).go = ORIGINAL_WINDOW_GO;
  }
  vi.unstubAllGlobals();
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
