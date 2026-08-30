// @vitest-environment happy-dom
// ===== i18n locale 模块测试（语言状态管理）=====
// 覆盖 loadLocale 失败重试 / getBundle 回落链 / setLang 代际竞争与早退 /
// detectSystemLang 多分支 / initI18n 初始化链。模块级状态（_currentLang/bundles）
// 跨用例污染 → 每用例 vi.resetModules + 动态 import 重载（bus 必须同实例重载，
// 否则事件监听落在旧 bus 上）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bus } from "../../bus.ts";
import type { LangCode } from "./locale.ts";

type LocaleModule = typeof import("../../core/i18n/locale.ts");

interface Fresh {
  locale: LocaleModule;
  bus: Bus;
}

async function freshModule(): Promise<Fresh> {
  vi.resetModules();
  const locale = await import("../../core/i18n/locale.ts");
  const busMod = await import("../../bus.ts");
  return { locale, bus: busMod.bus };
}

const origFetch = globalThis.fetch;

function mockFetch(ok: boolean, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function mockFetchFailure() {
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch;
}

function setLanguages(langs: string[] | undefined) {
  Object.defineProperty(navigator, "languages", {
    value: langs,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  mockFetch(true, { "hello": "你好" });
  // 显式重置系统语言（happy-dom 默认可能为 en-US，污染 detectSystemLang 分支）
  setLanguages(["zh-CN"]);
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("loadLocale", () => {
  it("成功加载并缓存（幂等：二次调用不重复 fetch）", async () => {
    const { locale } = await freshModule();
    await locale.loadLocale("zh-CN");
    await locale.loadLocale("zh-CN");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(locale.getBundle("zh-CN")["hello"]).toBe("你好");
  });

  it("失败不缓存（delete 键）→ 重试可自愈", async () => {
    const { locale } = await freshModule();
    mockFetchFailure();
    await locale.loadLocale("zh-CN");
    // 失败后 getBundle 回落（zh-CN 也未加载 → {}）
    expect(Object.keys(locale.getBundle("zh-CN"))).toHaveLength(0);
    // 重试成功
    mockFetch(true, { "ok": "好" });
    await locale.loadLocale("zh-CN");
    expect(locale.getBundle("zh-CN")["ok"]).toBe("好");
  });

  it("HTTP 非 2xx 视为失败（可重试）", async () => {
    const { locale } = await freshModule();
    mockFetch(false, {});
    await locale.loadLocale("ja");
    expect(Object.keys(locale.getBundle("ja"))).toHaveLength(0);
  });

  it("在途去重：并发加载同一未缓存语言只 fetch 一次（P3 审核修复）", async () => {
    const { locale } = await freshModule();
    // 挂起 fetch，制造「下载中」窗口
    let resolveFetch: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise((r) => { resolveFetch = r; }),
    ) as unknown as typeof fetch;

    const p1 = locale.loadLocale("ja");
    const p2 = locale.loadLocale("ja");
    const p3 = locale.loadLocale("ja");
    resolveFetch({ ok: true, json: async () => ({ "hello": "こんにちは" }) });
    await Promise.all([p1, p2, p3]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(locale.getBundle("ja")["hello"]).toBe("こんにちは");
    // 在途表已清空：失败重试不受污染
    expect(await locale.loadLocale("ja")).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("在途失败 → 在途表清空，后续调用可重新 fetch", async () => {
    const { locale } = await freshModule();
    let rejectFetch: (e: unknown) => void = () => {};
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise((_, rej) => { rejectFetch = rej; }),
    ) as unknown as typeof fetch;

    const p1 = locale.loadLocale("ja");
    const p2 = locale.loadLocale("ja");
    rejectFetch(new TypeError("network down"));
    await Promise.all([p1, p2]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    mockFetch(true, { "retry": "成功" });
    await locale.loadLocale("ja");
    // mockFetch 换了新 vi.fn，计数重新起算：重试确实发了新请求
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(locale.getBundle("ja")["retry"]).toBe("成功");
  });
});

describe("getBundle 回落链", () => {
  it("未加载语言 → 回落 zh-CN", async () => {
    const { locale } = await freshModule();
    await locale.loadLocale("zh-CN");
    expect(locale.getBundle("ja")["hello"]).toBe("你好");
  });

  it("全部未加载 → 返回空对象", async () => {
    const { locale } = await freshModule();
    expect(locale.getBundle("zh-CN")).toEqual({});
  });
});

describe("setLang", () => {
  it("同语言早退：不 fetch 不 emit", async () => {
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("zh-CN"); // 默认 zh-CN
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("不支持的语言早退（运行时收窄）", async () => {
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("fr" as unknown as LangCode);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(locale.getLang()).toBe("zh-CN");
  });

  it("切换成功：更新状态 + localStorage + html lang + 事件", async () => {
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("en");
    expect(locale.getLang()).toBe("en");
    expect(localStorage.getItem("uiLang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(onChanged).toHaveBeenCalledWith({ lang: "en" });
  });

  it("代际竞争：慢请求后到被丢弃（gen 守卫）", async () => {
    const { locale } = await freshModule();
    // 第一次 setLang 的 fetch 慢（手动控制 resolve）；后续调用正常快速完成
    let call = 0;
    let resolveSlow!: (v: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return new Promise<Response>((resolve) => { resolveSlow = resolve; });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p1 = locale.setLang("en"); // gen=1，挂起在 fetch
    const p2 = locale.setLang("ja"); // gen=2，快速完成
    await p2;
    expect(locale.getLang()).toBe("ja");

    // 放行慢请求：gen=1 != 2 → 过期写入丢弃
    resolveSlow({ ok: true, json: async () => ({}) } as Response);
    await p1;
    expect(locale.getLang()).toBe("ja"); // 仍为 ja，en 被丢弃
  });
});

describe("detectSystemLang（经 initI18n 观察）", () => {
  it("繁体中文家族 → zh-CN（暂回落简体）", async () => {
    setLanguages(["zh-TW"]);
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("zh-CN");
  });

  it("日语 → ja", async () => {
    setLanguages(["ja-JP"]);
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("ja");
  });

  it("英语 → en", async () => {
    setLanguages(["en-US"]);
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("en");
  });

  it("未知语言 + 无 saved → 回落 zh-CN", async () => {
    setLanguages(["fr-FR"]);
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("zh-CN");
  });

  it("navigator.languages undefined 防御（老 WebView）", async () => {
    setLanguages(undefined);
    Object.defineProperty(navigator, "language", { value: "", configurable: true });
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("zh-CN"); // 不抛 TypeError
  });
});

describe("initI18n", () => {
  it("saved 有效 → 优先于系统检测", async () => {
    localStorage.setItem("uiLang", "ja");
    setLanguages(["en-US"]);
    const { locale } = await freshModule();
    await locale.initI18n();
    expect(locale.getLang()).toBe("ja");
  });

  it("加载成功 → 补发 lang:changed（首帧重渲染通道）", async () => {
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.initI18n();
    expect(onChanged).toHaveBeenCalledWith({ lang: "zh-CN" });
  });

  it("加载失败 → 不补发事件（留待重试，不污染订阅通道）", async () => {
    mockFetchFailure();
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.initI18n();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
