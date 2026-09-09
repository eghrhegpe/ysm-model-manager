// ===== makeLocaleHost 适配器测试（ADR-210 D1：DOM 副作用实现）=====
// 策略语义（回落链 / 去重 / 告警节流）归 locale.test.ts；本文件只钉「宿主实现正确转接浏览器全局」。
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeLocaleHost } from "./locale-host.ts";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("makeLocaleHost", () => {
  it("loadBundle 成功 → 返回 JSON 包", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ a: "b" }),
    }) as unknown as typeof fetch;
    const host = makeLocaleHost();
    expect(await host.loadBundle("en")).toEqual({ a: "b" });
  });

  it("loadBundle HTTP 非 2xx → null + 告警留痕（不缓存、可重试）", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = makeLocaleHost();
      expect(await host.loadBundle("xx")).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("loadBundle 网络拒绝 → null（不抛出，core 侧按未载到处理）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("network down"),
    ) as unknown as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = makeLocaleHost();
      expect(await host.loadBundle("zh-CN")).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("systemLanguages → navigator.languages（老 WebView undefined 兜底空 language）", () => {
    Object.defineProperty(navigator, "languages", {
      value: ["ja-JP", "en-US"],
      configurable: true,
    });
    const host = makeLocaleHost();
    expect(host.systemLanguages()).toEqual(["ja-JP", "en-US"]);
    Object.defineProperty(navigator, "languages", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "language", {
      value: "",
      configurable: true,
    });
    expect(host.systemLanguages()).toEqual([""]); // 不抛 TypeError
  });

  it("setHtmlLang → <html lang> 属性（映射值由 core 策略给出，宿主只设属性）", () => {
    const host = makeLocaleHost();
    host.setHtmlLang("zh-Hans");
    expect(document.documentElement.lang).toBe("zh-Hans");
    host.setHtmlLang("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
