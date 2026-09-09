// @vitest-environment node
// ===== i18n 翻译函数测试 =====
// 覆盖真实 t()/tOf()：缺失 key 返回 key + warnMissingKey、参数插值、
// 残留占位符守卫（模板有 {n} 漏传参 → 裸占位符上屏 + 单次告警）。
// test-setup.ts 全局 mock 了 t.ts（查 zhCN），此处 vi.unmock 取真实实现。
import { describe, it, expect, vi, beforeEach } from "vitest";

// isolate:false 共享模块图下，兄弟文件的 per-file vi.mock("@/core/i18n/t.ts")
// （如 errors.test.ts 的 key 版 mock）先到先得会固化 t.ts 绑定，unmock 无法改写
// 已求值模块 → 本文件拿到 key 版 t()（命中 key 返回 key 而非翻译）。
// resetModules + 动态 import 把真实 t.ts 的求值限定在本文件作用域内。
vi.unmock("../../core/i18n/t.ts");
vi.resetModules();
const { t, tOf } = await import("./t.ts");

const { getBundle, warnMissingKey } = vi.hoisted(() => ({
  getBundle: vi.fn(),
  warnMissingKey: vi.fn(),
}));

vi.mock("@/core/i18n/locale.ts", async () => {
  const actual = await vi.importActual<typeof import("./locale.ts")>("../../core/i18n/locale.ts");
  return {
    ...actual, // 保留 SUPPORTED_LANGS 等真实导出（断言用）
    getBundle, // 覆盖为 mock（控制翻译表）
    warnMissingKey, // 覆盖为 mock（缺失告警节流本身由 locale.test.ts 覆盖）
  };
});

import { SUPPORTED_LANGS } from "./locale.ts";

beforeEach(() => {
  vi.clearAllMocks();
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

  it("SUPPORTED_LANGS 包含 zh-CN、en 与 ja", () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toEqual(["zh-CN", "en", "ja"]);
  });
});
