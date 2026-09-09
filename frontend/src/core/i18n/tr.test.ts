// @vitest-environment node
// ===== tr / trDynamic 测试 — deprecated 薄委托层（ADR-207 D3）=====
// tr/trDynamic 现已标记 deprecated，实现委托 tOf()（内置 current → en → key 多级回退）。
// 本测试仅验证委托行为，fallback 逻辑由 tOf() 自身测试覆盖。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tr, trDynamic } from "./tr.ts";

// 与 i18n 模块解耦测试：mock tOf（委托目标）
const { tOfMock } = vi.hoisted(() => ({ tOfMock: vi.fn() }));
vi.mock("./t.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./t.ts")>();
  return { ...actual, tOf: tOfMock };
});

beforeEach(() => {
  tOfMock.mockReset();
});

describe("tr(key, fallback) — deprecated 薄委托", () => {
  it("委托 tOf(key, params)，忽略 fallback 参数", () => {
    tOfMock.mockReturnValue("打开文件夹");
    expect(tr("menu.openFolder", "Open Folder")).toBe("打开文件夹");
    expect(tOfMock).toHaveBeenCalledWith("menu.openFolder", undefined);
  });

  it("带插值参数时透传 tOf(key, params)", () => {
    tOfMock.mockReturnValue("已复制 3 个路径");
    expect(tr("ctx.copyPathsOk", "Copied {n} paths", { n: 3 })).toBe("已复制 3 个路径");
    expect(tOfMock).toHaveBeenCalledWith("ctx.copyPathsOk", { n: 3 });
  });
});

describe("trDynamic(key, fallback) — deprecated 薄委托", () => {
  it("委托 tOf(key, params)，忽略 fallback 参数", () => {
    tOfMock.mockReturnValue("呼吸");
    expect(trDynamic("preview.perceptionBreath", "Breathing")).toBe("呼吸");
    expect(tOfMock).toHaveBeenCalledWith("preview.perceptionBreath", undefined);
  });

  it("动态 key + 参数 → 透传", () => {
    tOfMock.mockReturnValue("Moved 7 files");
    expect(trDynamic("ctx.moveOk", "Moved {n} files", { n: 7 })).toBe("Moved 7 files");
    expect(tOfMock).toHaveBeenCalledWith("ctx.moveOk", { n: 7 });
  });
});
