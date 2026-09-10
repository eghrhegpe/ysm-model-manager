// @vitest-environment node
// ===== COI Service Worker 注册测试（ADR-079 M1）=====
// 仅网页版注册；首次注册 reload 一次（localStorage 标记防循环，sessionStorage 镜像兜底）；
// 已控制/已隔离不 reload；标记带时间戳+次数上限——窗口内不重试、超窗口可重试、达上限放弃；
// localStorage 不可用时记录经 sessionStorage 留存，防循环闸门不旁路。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCrossOriginIsolated, registerCoiServiceWorker } from "./coi-sw.ts";

const { isWebPlatformMock } = vi.hoisted(() => ({
  isWebPlatformMock: vi.fn(() => true),
}));
vi.mock("@/backend/platform.ts", () => ({
  isWebPlatform: isWebPlatformMock,
}));

// safeGet/safeSet 走 storage.ts——mock 掉避免污染；safeGet 可逐用例控制返回值
const storageMock = vi.hoisted(() => ({
  safeGet: vi.fn<(key: string) => string | null>(() => null),
  safeSet: vi.fn(),
}));
vi.mock("@/utils/base/primitives/storage.ts", () => storageMock);

const registerMock = vi.fn();
const reloadMock = vi.fn();

/** 构造 reload 标记值（真实实现存 JSON {t,n}；旧版存 "1"） */
function reloadRec(t: number, n: number): string {
  return JSON.stringify({ t, n });
}

/** 构造 Map 支撑的 sessionStorage 并 stub 全局（返回 Map 供断言/预置记录；用例间由 unstubAllGlobals 清理） */
function stubSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000); // 固定 now
  isWebPlatformMock.mockReturnValue(true);
  registerMock.mockResolvedValue({});
  storageMock.safeGet.mockReturnValue(null);
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
  vi.useRealTimers();
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

  it("首次注册（无标记 + 无 controller + 未隔离）→ reload 一次并写标记", async () => {
    registerCoiServiceWorker();
    await Promise.resolve(); // 等 register().then
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith("ysm:coi-reload", reloadRec(1700000000000, 1));
  });

  it("SW 已控制当前页 → 不 reload（无论标记有无）", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { register: registerMock, controller: {} },
    });
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(storageMock.safeSet).not.toHaveBeenCalled();
  });

  it("已跨源隔离（crossOriginIsolated=true）→ 不 reload", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("窗口内（上次 reload <30s）→ 不再 reload（防循环）", async () => {
    storageMock.safeGet.mockReturnValue(reloadRec(1700000000000 - 5_000, 1)); // 5s 前 reload 过
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("超窗口（>30s）且未达上限 → 再次 reload 并递增次数", async () => {
    storageMock.safeGet.mockReturnValue(reloadRec(1700000000000 - 60_000, 1)); // 60s 前 reload 过
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith("ysm:coi-reload", reloadRec(1700000000000, 2));
  });

  it("达上限（n>=3）→ 永久放弃，不再 reload（防无限循环）", async () => {
    storageMock.safeGet.mockReturnValue(reloadRec(1700000000000 - 60_000, 3));
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("旧版标记 '1' 兼容：视为可重试（n=0），超窗口后 reload", async () => {
    storageMock.safeGet.mockReturnValue("1");
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith("ysm:coi-reload", reloadRec(1700000000000, 1));
  });

  it("损坏 JSON → 视为无记录，允许 reload（n=1）", async () => {
    storageMock.safeGet.mockReturnValue("not-json");
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith("ysm:coi-reload", reloadRec(1700000000000, 1));
  });

  it("localStorage 不可用（safeGet 读空/safeSet 不写）→ 记录经 sessionStorage 留存，窗口内第二次调用不再 reload", async () => {
    const store = stubSessionStorage(); // 默认 safeGet→null、safeSet no-op 即模拟 localStorage 不可用
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(store.get("ysm:coi-reload")).toBe(reloadRec(1700000000000, 1)); // 兜底记录已镜像写入
    registerCoiServiceWorker(); // 第二次：localStorage 仍不可用 → 回退读 sessionStorage → 窗口内跳过
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("localStorage 不可用 + sessionStorage 记录达上限（n>=3）→ 兜底闸门同样永久放弃", async () => {
    const store = stubSessionStorage();
    store.set("ysm:coi-reload", reloadRec(1700000000000 - 60_000, 3)); // 60s 前且达上限
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("localStorage 不可用 + sessionStorage 记录超窗口未达上限 → 可重试并递增次数（镜像回写）", async () => {
    const store = stubSessionStorage();
    store.set("ysm:coi-reload", reloadRec(1700000000000 - 60_000, 1)); // 60s 前 reload 过
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(store.get("ysm:coi-reload")).toBe(reloadRec(1700000000000, 2));
  });

  it("sessionStorage 访问抛 SecurityError（存储被策略禁用）→ 守卫静默跳过，读/写两侧不抛、闸门按无记录放行", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("Storage access denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });
    expect(() => {
      registerCoiServiceWorker();
      void Promise.resolve();
    }).not.toThrow();
    await Promise.resolve();
    // readSessionRecord / writeSessionRecord 的 try/catch 吃掉抛错 → 视为无兜底记录 → 首次 reload（n=1）
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith("ysm:coi-reload", reloadRec(1700000000000, 1));
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
