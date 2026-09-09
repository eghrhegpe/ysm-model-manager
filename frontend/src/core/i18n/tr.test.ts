// @vitest-environment node
// ===== tr / trDynamic 测试 — i18n 缺失键兜底双入口（ADR-207 D3）=====
// 防菜单/控件退化显示原始 key 字面量（如 "menu.openFolder"）——
// 缺失键时统一走 fallback 字符串（经同参插值）；发版前漏译也能给用户可读文案。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tr, trDynamic } from "./tr.ts";

// 与 i18n 模块解耦测试：mock tOf（缺失/命中两种状态）；
// interpolate 保留真实实现（tr 的 fallback 插值依赖它）
const { tOfMock } = vi.hoisted(() => ({ tOfMock: vi.fn() }));
vi.mock("./t.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./t.ts")>();
  return { ...actual, tOf: tOfMock };
});

beforeEach(() => {
  tOfMock.mockReset();
});

describe("tr(key: LocaleKey, fallback) — 严格字面量 key 兜底", () => {
  it("键存在时返回翻译结果（不取 fallback）", () => {
    tOfMock.mockReturnValue("打开文件夹");
    expect(tr("menu.openFolder", "Open Folder")).toBe("打开文件夹");
    expect(tOfMock).toHaveBeenCalledWith("menu.openFolder", undefined);
  });

  it("键缺失（tOf 返回 key 本身）时走 fallback", () => {
    // tOf 缺失键语义：返回 key 字符串（「v === key 即缺失」判定单一事实源）
    tOfMock.mockImplementation((key: string) => key);
    // 故意用不存在的 key（cast 绕开编译期 LocaleKey 校验，模拟 JSON 语言包滞后场景）
    const missing = "menu.nonexistent" as unknown as Parameters<typeof tr>[0];
    expect(tr(missing, "Open Folder")).toBe("Open Folder");
  });

  it("键缺失 + fallback 为空串 → 返回空串（保底，不抛错）", () => {
    tOfMock.mockImplementation((key: string) => key);
    const missing = "menu.nonexistent" as unknown as Parameters<typeof tr>[0];
    expect(tr(missing, "")).toBe("");
  });

  it("键存在 + 带插值参数时透传 tOf(key, params)", () => {
    tOfMock.mockImplementation((_key: string, params?: Record<string, string | number>) =>
      `已复制 ${params?.n} 个路径`,
    );
    expect(tr("ctx.copyPathsOk", "Copied {n} paths", { n: 3 })).toBe("已复制 3 个路径");
    expect(tOfMock).toHaveBeenCalledWith("ctx.copyPathsOk", { n: 3 });
  });

  it("fallback 与键翻译相同时仍返回翻译（判定条件是 v === key 而非 v === fallback）", () => {
    tOfMock.mockReturnValue("Open Folder");
    expect(tr("menu.openFolder", "Open Folder")).toBe("Open Folder");
  });

  it("键缺失时 fallback 也经同参插值（裸占位符不上屏）", () => {
    tOfMock.mockImplementation((key: string) => key);
    expect(tr("ctx.copyPathsOk", "Copied {n} paths", { n: 5 })).toBe("Copied 5 paths");
  });
});

describe("trDynamic(key: string, fallback) — 数据驱动动态 key 兜底", () => {
  it("动态 key 命中 → 返回翻译", () => {
    tOfMock.mockReturnValue("呼吸");
    expect(trDynamic("preview.perceptionBreath", "Breathing")).toBe("呼吸");
  });

  it("动态 key 缺失 → fallback（典型：labelKey 未入语言包时用原文兜底）", () => {
    tOfMock.mockImplementation((key: string) => key);
    expect(trDynamic("skin.png", "skin.png")).toBe("skin.png");
  });

  it("动态 key + 参数 → fallback 插值", () => {
    tOfMock.mockImplementation((key: string) => key);
    expect(trDynamic("ctx.moveOk", "Moved {n} files", { n: 7 })).toBe("Moved 7 files");
  });
});
