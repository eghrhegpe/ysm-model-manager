// ===== 文件树数据加载层测试 =====
// 覆盖：loadEntries 空 repoRoot / 空 raw / 扩展名过滤 / banned / relPath / 异常 toast
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    getExts: vi.fn(),
    GetRepoRoot: vi.fn(),
    ScanModelEntriesWithLabel: vi.fn(),
    IsFileBanned: vi.fn(),
  };
  return { mocks };
});

vi.mock("../../utils/resource/extensions.ts", () => ({
  getExts: mocks.getExts,
}));

vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPE_LABELS: { ysm: "YSM模型", pack: "资源包" },
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: mocks.GetRepoRoot,
    ScanModelEntriesWithLabel: mocks.ScanModelEntriesWithLabel,
    IsFileBanned: mocks.IsFileBanned,
  }),
}));

vi.mock("../../utils/dom/errors.ts", () => ({
  friendlyError: (e: unknown, fallback: string): string =>
    e instanceof Error ? e.message : fallback,
}));

let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
  mocks.getExts.mockReturnValue([".ysm", ".zip"]);
  mocks.GetRepoRoot.mockResolvedValue("/repo");
  mocks.IsFileBanned.mockResolvedValue(false);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

function spyToasts() {
  const toasts: Array<{ msg: string; type: string }> = [];
  cleanups.push(bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })));
  return toasts;
}

describe("loadEntries", () => {
  it("repoRoot 未配置 → 空结果，不扫文件", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ repoRoot: "", entries: [] });
    expect(mocks.ScanModelEntriesWithLabel).not.toHaveBeenCalled();
  });

  it("扫描结果为空 → 空 entries", async () => {
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ repoRoot: "/repo", entries: [] });
  });

  it("按扩展名过滤（.ban 后缀先剥离）并计算相对路径、并入 banned 状态", async () => {
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: "/repo/sub/a.ysm", Size: 10, ModTime: 1 },
      { Name: "b.ban", Path: "/repo/sub/b.ban", Size: 10, ModTime: 1 },
      { Name: "c.txt", Path: "/repo/sub/c.txt", Size: 10, ModTime: 1 },
      { Name: "d.ysm", Path: "/repo/sub/d.ysm", Size: 10, ModTime: 1 },
    ]);
    mocks.IsFileBanned.mockImplementation((p: string) =>
      Promise.resolve(p.endsWith("d.ysm")),
    );
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");

    // b.ban 剥离后缀后为 "b"，不匹配 .ysm/.zip → 过滤；c.txt 直接过滤
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({
      name: "a.ysm",
      path: "sub/a.ysm", // 去掉 repoRoot 前缀
      fullPath: "/repo/sub/a.ysm",
      banned: false,
    });
    expect(r.entries[1]).toMatchObject({ name: "d.ysm", path: "sub/d.ysm", banned: true });
  });

  it("banned 检查失败兜底为 false（不中断加载）", async () => {
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: "/repo/a.ysm", Size: 0, ModTime: 0 },
    ]);
    mocks.IsFileBanned.mockRejectedValue(new Error("lock"));
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r.entries[0].banned).toBe(false);
  });

  it("仓库根路径带反斜杠时也能剥离前缀", async () => {
    mocks.GetRepoRoot.mockResolvedValue("C:\\repo");
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: "C:\\repo\\sub\\a.ysm", Size: 0, ModTime: 0 },
    ]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r.entries[0].path).toBe("sub/a.ysm");
  });

  it("ScanModelEntriesWithLabel 抛错 → error toast + 空结果", async () => {
    mocks.ScanModelEntriesWithLabel.mockRejectedValue(new Error("boom"));
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ repoRoot: "", entries: [] });
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("boom"))).toBe(true);
  });
});
