// ===== i18n 翻译函数测试 =====
// 覆盖真实 t()：缺失 key 返回 key + 单次告警、参数插值、无参数不替换。
// test-setup.ts 全局 mock 了 t.ts（查 zhCN），此处 vi.unmock 取真实实现。
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("../../core/i18n/t.ts");

const { getBundle } = vi.hoisted(() => ({
  getBundle: vi.fn(),
}));

vi.mock("../../core/i18n/locale.ts", () => ({
  getBundle,
  _warned: new Set<string>(),
}));

import { t } from "../../core/i18n/t.ts";
import { SUPPORTED_LANGS } from "../../core/i18n/locale.ts";

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

  it("缺失 key → 返回 key 本身 + console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(t("nav.notExist")).toBe("nav.notExist");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("缺失 key"));
    } finally {
      warn.mockRestore();
    }
  });

  it("同一缺失 key 只告警一次（_warned 节流）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      t("dup.missing");
      t("dup.missing");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("SUPPORTED_LANGS 包含 zh-CN、en 与 ja", () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toEqual(["zh-CN", "en", "ja"]);
  });
});
