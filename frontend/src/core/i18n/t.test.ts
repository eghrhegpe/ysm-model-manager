// @vitest-environment node
// ===== i18n 翻译函数测试 =====
// 覆盖真实 t()/tOf()：缺失 key 返回 key + warnMissingKey、参数插值、
// 残留占位符守卫（模板有 {n} 而漏传参 → 裸占位符上屏 + 单次告警）。
// test-setup.ts 全局 mock 了 t.ts（查 zhCN），此处以 vi.mock + importActual 取回真实实现（替代 vi.resetModules 动态 import 杂技）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getBundle, getLang, warnMissingKey } = vi.hoisted(() => ({
  getBundle: vi.fn(),
  getLang: vi.fn(),
  warnMissingKey: vi.fn(),
}));

// 取回真实 t.ts（覆盖 test-setup 的全局 mock）
vi.mock("./t.ts", async () => {
  const actual = await vi.importActual<typeof import("./t.ts")>("./t.ts");
  return { ...actual };
});

vi.mock("./locale.ts", async () => {
  const actual = await vi.importActual<typeof import("./locale.ts")>("./locale.ts");
  return {
    ...actual, // 保留 SUPPORTED_LANGS 等真实导出（断言用）
    getBundle, // 覆盖为 mock（控制翻译表）
    getLang, // 覆盖为 mock（控制当前语言）
    warnMissingKey, // 覆盖为 mock（缺失告警节流本身由 locale.test.ts 覆盖）
  };
});

import { interpolate, t, tOf } from "./t.ts";
import { SUPPORTED_LANGS } from "./locale.ts";
import { __resetI18nResidualsForTest } from "./t.ts";

beforeEach(() => {
  vi.clearAllMocks();
  __resetI18nResidualsForTest(); // 重置残留占位符告警节流（替代 vi.resetModules 状态隔离）
  getBundle.mockReturnValue({
    "nav.repository": "模型仓库",
    "import.addedToQueue": "已加入队列: {n} 个文件",
    "import.date": "年月",
  });
});

describe("t()", () => {
  it("命中 key → 返回翻译文本（无参数不做替换）", () => {
    expect(t("nav.repository")).toBe("模型仓库");
  });

  it("参数插值：{n} 被替换", () => {
    expect(t("import.addedToQueue", { n: 3 })).toBe("已加入队列: 3 个文件");
  });

  it("缺失 key → 返回 key 本身 + warnMissingKey", () => {
    // 故意用非 LocaleKey 的运行时 key（变量绕开编译期 keyof 校验）测「JSON 语言包滞后」降级语义
    const missingKey = "nav.notExist" as unknown as Parameters<typeof t>[0];
    expect(t(missingKey)).toBe("nav.notExist");
    expect(warnMissingKey).toHaveBeenCalledWith("nav.notExist");
  });

  it("tOf：string 版动态 key 入口（缺失语义与 t 同构）", () => {
    const dynKey = "nav.repository" as string;
    expect(tOf(dynKey)).toBe("模型仓库");
    const missingKey = "nav.missingDyn" as string;
    expect(tOf(missingKey)).toBe("nav.missingDyn");
    expect(warnMissingKey).toHaveBeenCalledWith("nav.missingDyn");
  });

  it("残留占位符守卫：模板含 {n} 而漏传参 → 裸文本上屏 + 按签名告警一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(t("import.addedToQueue")).toBe("已加入队列: {n} 个文件");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("残留插值占位符"));
      const callsAfterFirst = warn.mock.calls.length;
      t("import.addedToQueue"); // 同签名第二次 → 静默
      expect(warn.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      warn.mockRestore();
    }
  });

  it("残留占位符守卫：参数覆盖占位符 → 无告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(t("import.addedToQueue", { n: 2 })).toBe("已加入队列: 2 个文件");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("残留签名超 RESIDUAL_SIG_MAX → 淘汰最旧，被淘汰签名重发可再告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // 动态 key（tOf 任意 string）会让签名空间无限扩张：用 513 个不同 context 灌满并越过上限
      for (let i = 0; i < 513; i++) {
        interpolate("已加入 {n} 个文件", undefined, `residual-${i}`);
      }
      const callsAfterFill = warn.mock.calls.length;
      // 最旧签名（residual-0）已被淘汰 → 重发不再被节流，应再告警一次
      interpolate("已加入 {n} 个文件", undefined, "residual-0");
      expect(warn.mock.calls.length).toBe(callsAfterFill + 1);
    } finally {
      warn.mockRestore();
    }
  });

  it("SUPPORTED_LANGS 包含 zh-CN、en 与 ja", () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toEqual(["zh-CN", "en", "ja"]);
  });
});

describe("tOf() — 多级回退 current → en → key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetI18nResidualsForTest();
    getLang.mockReturnValue("zh-CN");
  });

  it("当前 locale 命中 → 返回当前翻译，不查 en", () => {
    getBundle.mockImplementation((lang?: string) => {
      if (lang === "en") return { "ctx.busyWait": "Operation in progress" };
      return { "ctx.busyWait": "操作进行中" };
    });
    expect(tOf("ctx.busyWait")).toBe("操作进行中");
  });

  it("当前 locale 缺失 → 回退到 en", () => {
    getBundle.mockImplementation((lang?: string) => {
      if (lang === "en") return { "ctx.busyWait": "Operation in progress" };
      return {}; // zh-CN 缺失
    });
    expect(tOf("ctx.busyWait")).toBe("Operation in progress");
  });

  it("当前 locale + en 都缺失 → 返回裸 key + warn", () => {
    getBundle.mockReturnValue({});
    expect(tOf("ctx.missing")).toBe("ctx.missing");
    expect(warnMissingKey).toHaveBeenCalledWith("ctx.missing");
  });

  it("当前 locale 就是 en → 不再回退（避免死循环）", () => {
    getLang.mockReturnValue("en");
    // getBundle() 无参 = 当前 locale → en 包（缺失）
    // getBundle("en") 显式 = en 包（同样缺失）
    getBundle.mockReturnValue({});
    // 当前是 en，en 缺失 → 直接返回裸 key，不再回退 zh-CN
    expect(tOf("ctx.busyWait")).toBe("ctx.busyWait");
    expect(warnMissingKey).toHaveBeenCalledWith("ctx.busyWait");
  });

  it("en 回退 + 插值参数", () => {
    getBundle.mockImplementation((lang?: string) => {
      if (lang === "en") return { "ctx.moveOk": "Moved to {folder}" };
      return {}; // zh-CN 缺失
    });
    expect(tOf("ctx.moveOk", { folder: "目标" })).toBe("Moved to 目标");
  });
});
