// @vitest-environment node
// ===== mmd-siblings 视图壳数据准备测试 =====
// 覆盖：resolveMmdSiblings（委托共享底座 resolveSiblingsByType：
// GetRepoRoot(EntityPlayer) → ScanModelEntriesFiltered(root, rtype, '', label)；
// 根为空/扫描失败 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { MMD: "EntityPlayer" },
  RESOURCE_TYPE_LABELS: { EntityPlayer: "角色模型" },
}));

import { resolveMmdSiblings } from "./mmd-siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveMmdSiblings", () => {
  it("委托共享底座：GetRepoRoot(EntityPlayer) → ScanModelEntriesFiltered(root, rtype, '', label)", async () => {
    getRepoRootMock.mockResolvedValue("/mmd-root");
    scanFilteredMock.mockResolvedValue([
      { Name: "a.pmx", Path: "/mmd-root/模型A/a.pmx" },
      { Name: "b.pmd", Path: "/mmd-root/模型B/b.pmd" },
      { Name: "readme.txt", Path: "/mmd-root/模型C/readme.txt" },
    ]);
    expect(await resolveMmdSiblings()).toEqual([
      "/mmd-root/模型A/a.pmx",
      "/mmd-root/模型B/b.pmd",
      "/mmd-root/模型C/readme.txt",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("EntityPlayer");
    expect(scanFilteredMock).toHaveBeenCalledWith("/mmd-root", "EntityPlayer", "", "角色模型");
  });

  it("根为空 / 扫描失败 → []（下拉不渲染，不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveMmdSiblings()).toEqual([]);
    getRepoRootMock.mockResolvedValue("/mmd-root");
    scanFilteredMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveMmdSiblings()).toEqual([]);
  });
});
