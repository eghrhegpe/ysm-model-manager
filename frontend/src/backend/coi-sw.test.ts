// @vitest-environment node
// ===== COI Service Worker 注册测试（ADR-079 M1）=====
// 仅网页版注册；首次注册 reload 一次（localStorage 标记防循环）；已控制/已隔离不 reload。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCrossOriginIsolated, registerCoiServiceWorker } from "./coi-sw.ts";
import { isWebPlatform } from "./platform-web.ts";

const { isWebPlatformMock } = vi.hoisted(() => ({
  isWebPlatformMock: vi.fn(() => true),
}));
vi.mock("./platform-web.ts", () => ({
  isWebPlatform: isWebPlatformMock,
  readDeclaredBackend: () => undefined,
}));

// safeGet/safeSet 走 storage.ts——mock 掉避免污染
vi.mock("../utils/dom/storage.ts", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
}));

const registerMock = vi.fn();
const reloadMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  isWebPlatformMock.mockReturnValue(true);
  registerMock.mockResolvedValue({});
  vi.stubGlobal("crossOriginIsolated", false);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: registerMock,
      controller: null,
    },
  });
  vi.stubGlobal("location", { reload: reloadMock });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("COI Service Worker（ADR-079 M1）", () => {
  it("仅网页版注册（isWebPlatform=true → register 调用；false → 不调）", () => {
    registerCoiServiceWorker();
    expect(registerMock).toHaveBeenCalledWith(expect.stringMatching(/sw\.js$/), { scope: expect.any(String) });
    isWebPlatformMock.mockReturnValue(false);
    registerCoiServiceWorker();
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it("首次注册（无 controller + 未隔离）→ reload 一次", async () => {
    registerCoiServiceWorker();
    await Promise.resolve(); // 等 register().then
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("SW 已控制当前页 → 不 reload", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { register: registerMock, controller: {} },
    });
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("已跨源隔离（crossOriginIsolated=true）→ 不 reload", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("无 serviceWorker 支持 → 静默 no-op（渐进增强）", () => {
    vi.stubGlobal("navigator", {});
    expect(() => registerCoiServiceWorker()).not.toThrow();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("isCrossOriginIsolated：布尔属性判定", () => {
    expect(isCrossOriginIsolated()).toBe(false);
    vi.stubGlobal("crossOriginIsolated", true);
    expect(isCrossOriginIsolated()).toBe(true);
  });
});
