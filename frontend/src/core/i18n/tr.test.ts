// @vitest-environment node
// ===== tr(key, fallback) 测试 — i18n 缺失键兜底（与 preview-menu/core.ts 同形）=====
// 防菜单项退化显示原始 key 字面量（如 "menu.openFolder"）——
// 缺失键时统一走 fallback 字符串；发版前漏译也能给用户可读文案。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tr } from "./tr.ts";

// 与 i18n 模块解耦测试：mock t() 模拟「缺失」「存在」两种状态
const { tMock } = vi.hoisted(() => ({ tMock: vi.fn() }));
vi.mock("./t.ts", () => ({ t: tMock }));

beforeEach(() => {
  tMock.mockReset();
});

describe("tr(key, fallback) — i18n 缺失键兜底", () => {
  it("键存在时返回翻译结果（不取 fallback）", () => {
    tMock.mockReturnValue("打开文件夹");
    expect(tr("menu.openFolder", "Open Folder")).toBe("打开文件夹");
    expect(tMock).toHaveBeenCalledWith("menu.openFolder");
  });

  it("键缺失（t 返回 key 本身）时走 fallback", () => {
    // t() 缺失键语义：返回 key 字符串（与 t.ts:21 一致）
    tMock.mockImplementation((key) => key);
    expect(tr("menu.nonexistent", "Open Folder")).toBe("Open Folder");
  });

  it("键缺失 + 无 fallback 时返回 key（保底，不抛错）", () => {
    tMock.mockImplementation((key) => key);
    expect(tr("menu.nonexistent", "")).toBe("");
  });

  it("fallback 与键翻译相同时仍返回翻译（不取 fallback）", () => {
    // 翻译恰好等于 fallback 不会触发 fallback 分支——
    // 因为判定条件是「v === key」而非「v === fallback」。
    tMock.mockReturnValue("Open Folder");
    expect(tr("menu.openFolder", "Open Folder")).toBe("Open Folder");
  });
});