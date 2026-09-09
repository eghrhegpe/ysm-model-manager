// @vitest-environment node
// ===== i18n locale 模块测试（语言状态管理，ADR-210 D1 host 注入引擎无关）=====
// 覆盖 loadLocale（host 通道：成功缓存 / 失败重试 / 在途去重 / 无 host 跳过）/ getBundle 回落链 /
// setLang 代际竞争与早退 / detectFromLangs 纯策略分支 / initI18n 初始化链。
// 模块级状态（_currentLang/bundles/host）跨用例污染 → 每用例 vi.resetModules + 动态 import 重载
// （bus 必须同实例重载，否则事件监听落在旧 bus 上）。
// ADR-210 D1：浏览器全局（fetch/navigator/document）全经 fake host 注入，node 环境即可，免 happy-dom。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Bus } from "@/bus";
import type { LangCode, LocaleHost } from "./locale.ts";

type LocaleModule = typeof import("./locale.ts");

/** fake LocaleHost：可控制加载通道 / 系统语言候选 / 记录 <html lang> 调用 */
function makeFakeHost() {
  let loader = async (_lang: string): Promise<Record<string, string> | null> => ({
    hello: "你好",
  });
  let langs: string[] = ["zh-CN"];
  const htmlLangCalls: string[] = [];
  let loadCalls = 0;
  const host: LocaleHost = {
    loadBundle: async (lang: string) => {
      loadCalls++;
      return loader(lang);
    },
    systemLanguages: () => langs,
    setHtmlLang: (code: string) => {
      htmlLangCalls.push(code);
    },
  };
  return {
    host,
    setLoadBundle: (fn: (lang: string) => Promise<Record<string, string> | null>) => {
      loader = fn;
    },
    setSystemLanguages: (l: string[]) => {
      langs = l;
    },
    htmlLangCalls,
    loadCallCount: () => loadCalls,
  };
}
type FakeHost = ReturnType<typeof makeFakeHost>;

interface Fresh {
  locale: LocaleModule;
  bus: Bus;
  fake: FakeHost;
}

async function freshModule(): Promise<Fresh> {
  vi.resetModules();
  const locale = await import("./locale.ts");
  const busMod = await import("@/bus");
  const fake = makeFakeHost();
  locale.setLocaleHost(fake.host); // 默认接线：用例按需替换 loader / 系统语言 / 清 host
  return { locale, bus: busMod.bus, fake };
}

beforeEach(() => {
  localStorage.clear();
});

describe("warnMissingKey（缺失 key 告警节流，ADR-207 D3 收编）", () => {
  it("每 key 只告警一次", async () => {
    const { locale } = await freshModule();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      locale.warnMissingKey("a.b");
      locale.warnMissingKey("a.b");
      locale.warnMissingKey("c.d");
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("loadLocale（host 通道，ADR-210 D1）", () => {
  it("成功加载并缓存（幂等：二次调用不重复加载）", async () => {
    const { locale, fake } = await freshModule();
    await locale.loadLocale("zh-CN");
    await locale.loadLocale("zh-CN");
    expect(fake.loadCallCount()).toBe(1);
    expect(locale.getBundle("zh-CN")["hello"]).toBe("你好");
  });

  it("失败（null）不缓存（delete 键）→ 重试可自愈", async () => {
    const { locale, fake } = await freshModule();
    fake.setLoadBundle(async () => null);
    await locale.loadLocale("zh-CN");
    // 失败后 getBundle 回落（zh-CN 也未加载 → {}）
    expect(Object.keys(locale.getBundle("zh-CN"))).toHaveLength(0);
    // 重试成功
    fake.setLoadBundle(async () => ({ ok: "好" }));
    await locale.loadLocale("zh-CN");
    expect(locale.getBundle("zh-CN")["ok"]).toBe("好");
  });

  it("在途去重：并发加载同一未缓存语言只调 loadBundle 一次（P3 审核修复）", async () => {
    const { locale, fake } = await freshModule();
    // 挂起 loadBundle，制造「下载中」窗口
    let resolveLoad: (v: Record<string, string>) => void = () => {};
    fake.setLoadBundle(
      () =>
        new Promise((r) => {
          resolveLoad = r;
        }),
    );

    const p1 = locale.loadLocale("ja");
    const p2 = locale.loadLocale("ja");
    const p3 = locale.loadLocale("ja");
    resolveLoad({ hello: "こんにちは" });
    await Promise.all([p1, p2, p3]);

    expect(fake.loadCallCount()).toBe(1);
    expect(locale.getBundle("ja")["hello"]).toBe("こんにちは");
    // 在途表已清空：已缓存后再次调用不再触发加载
    expect(await locale.loadLocale("ja")).toBeUndefined();
    expect(fake.loadCallCount()).toBe(1);
  });

  it("在途拒绝 → 在途表清空，后续调用可重新加载", async () => {
    const { locale, fake } = await freshModule();
    let rejectLoad: (e: unknown) => void = () => {};
    fake.setLoadBundle(
      () =>
        new Promise((_r, rej) => {
          rejectLoad = rej;
        }),
    );

    const p1 = locale.loadLocale("ja");
    const p2 = locale.loadLocale("ja");
    rejectLoad(new TypeError("network down"));
    await Promise.all([p1, p2]);
    expect(fake.loadCallCount()).toBe(1);

    fake.setLoadBundle(async () => ({ retry: "成功" }));
    await locale.loadLocale("ja");
    expect(fake.loadCallCount()).toBe(2);
    expect(locale.getBundle("ja")["retry"]).toBe("成功");
  });

  it("未注入 host → 告警一次并跳过（fail-open），host 就绪后重试自愈", async () => {
    const { locale, fake } = await freshModule();
    locale.setLocaleHost(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await locale.loadLocale("zh-CN");
      await locale.loadLocale("zh-CN");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("未注入");
      expect(Object.keys(locale.getBundle("zh-CN"))).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
    // host 重新注入 → 重试自愈
    locale.setLocaleHost(fake.host);
    await locale.loadLocale("zh-CN");
    expect(locale.getBundle("zh-CN")["hello"]).toBe("你好");
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

  it("无参 = 当前语言（ADR-210 D2：_activeBundle 手工缓存已删，直查表语义不变）", async () => {
    const { locale } = await freshModule();
    await locale.setLang("en");
    expect(locale.getBundle()["hello"]).toBe("你好");
  });
});

describe("setLang", () => {
  it("同语言早退：不加载不 emit", async () => {
    const { locale, bus, fake } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("zh-CN"); // 默认 zh-CN
    expect(fake.loadCallCount()).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("不支持的语言早退（运行时收窄）", async () => {
    const { locale, bus, fake } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("fr" as unknown as LangCode);
    expect(fake.loadCallCount()).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
    expect(locale.getLang()).toBe("zh-CN");
  });

  it("切换成功：更新状态 + localStorage + html lang（经 host）+ 事件", async () => {
    const { locale, bus, fake } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.setLang("en");
    expect(locale.getLang()).toBe("en");
    expect(localStorage.getItem("uiLang")).toBe("en");
    expect(fake.htmlLangCalls).toEqual(["en"]);
    expect(onChanged).toHaveBeenCalledWith({ lang: "en" });
  });

  it("html lang 映射 zh-CN → zh-Hans（映射策略留 core，host 只设属性）", async () => {
    const { locale, fake } = await freshModule();
    await locale.setLang("en");
    await locale.setLang("zh-CN");
    expect(fake.htmlLangCalls).toEqual(["en", "zh-Hans"]);
  });

  it("代际竞争：慢请求后到被丢弃（gen 守卫）", async () => {
    const { locale, fake } = await freshModule();
    // 第一次 setLang 的加载慢（手动控制 resolve）；后续调用正常快速完成
    let call = 0;
    let resolveSlow: (v: Record<string, string>) => void = () => {};
    fake.setLoadBundle(() => {
      call++;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveSlow = resolve;
        });
      }
      return Promise.resolve({});
    });

    const p1 = locale.setLang("en"); // gen=1，挂起在 loadBundle
    const p2 = locale.setLang("ja"); // gen=2，快速完成
    await p2;
    expect(locale.getLang()).toBe("ja");

    // 放行慢请求：gen=1 != 2 → 过期写入丢弃
    resolveSlow({});
    await p1;
    expect(locale.getLang()).toBe("ja"); // 仍为 ja，en 被丢弃
  });
});

describe("detectFromLangs（纯策略，ADR-210 D1：navigator 读取经 host 注入）", () => {
  it("繁体中文家族 → zh-CN（暂回落简体）", async () => {
    const { locale } = await freshModule();
    expect(locale.detectFromLangs(["zh-TW"])).toBe("zh-CN");
    expect(locale.detectFromLangs(["zh-HK", "en-US"])).toBe("zh-CN");
    expect(locale.detectFromLangs(["zh-Hant"])).toBe("zh-CN");
  });

  it("日语 → ja / 英语 → en（按序首个命中）", async () => {
    const { locale } = await freshModule();
    expect(locale.detectFromLangs(["ja-JP"])).toBe("ja");
    expect(locale.detectFromLangs(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(locale.detectFromLangs(["en-US"])).toBe("en");
  });

  it("未知语言 / 空列表 → null（调用方回落 zh-CN）", async () => {
    const { locale } = await freshModule();
    expect(locale.detectFromLangs(["fr-FR"])).toBeNull();
    expect(locale.detectFromLangs([])).toBeNull();
  });
});

describe("initI18n", () => {
  it("saved 有效 → 优先于系统检测", async () => {
    localStorage.setItem("uiLang", "ja");
    const { locale, fake } = await freshModule();
    fake.setSystemLanguages(["en-US"]);
    await locale.initI18n();
    expect(locale.getLang()).toBe("ja");
  });

  it("无 saved → 系统语言检测（经 host.systemLanguages）", async () => {
    const { locale, fake } = await freshModule();
    fake.setSystemLanguages(["ja-JP"]);
    await locale.initI18n();
    expect(locale.getLang()).toBe("ja");
  });

  it("未知系统语言 + 无 saved → 回落 zh-CN（不抛错）", async () => {
    const { locale, fake } = await freshModule();
    fake.setSystemLanguages([]); // 老 WebView 空候选防御
    await locale.initI18n();
    expect(locale.getLang()).toBe("zh-CN");
  });

  it("启动即设 <html lang>（经 host，先于语言包加载）", async () => {
    const { locale, fake } = await freshModule();
    fake.setSystemLanguages(["en-US"]);
    await locale.initI18n();
    expect(fake.htmlLangCalls).toEqual(["en"]);
  });

  it("加载成功 → 补发 lang:changed（首帧重渲染通道）", async () => {
    const { locale, bus } = await freshModule();
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.initI18n();
    expect(onChanged).toHaveBeenCalledWith({ lang: "zh-CN" });
  });

  it("加载失败 → 不补发事件（留待重试，不污染订阅通道）", async () => {
    const { locale, bus, fake } = await freshModule();
    fake.setLoadBundle(async () => null);
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    await locale.initI18n();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("未注入 host → zh-CN 默认 + 不抛错（fail-open 不挂启动链）", async () => {
    const { locale, bus } = await freshModule();
    locale.setLocaleHost(null);
    const onChanged = vi.fn();
    bus.on("lang:changed", onChanged);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await locale.initI18n();
      expect(locale.getLang()).toBe("zh-CN");
      expect(onChanged).not.toHaveBeenCalled(); // 未加载成功不补发
    } finally {
      warn.mockRestore();
    }
  });
});

describe("FALLBACK_LANG（ADR-210 D4：兜底语言单一事实源）", () => {
  it("定义为 en（成员守卫归 locales-consistency.test.ts）", async () => {
    const { locale } = await freshModule();
    expect(locale.FALLBACK_LANG).toBe("en");
  });
});
