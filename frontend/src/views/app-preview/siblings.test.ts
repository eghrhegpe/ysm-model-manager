// @vitest-environment node
// ===== 同类型候选列表通用底座测试 =====
// 覆盖：resolveSiblingsByType（GetRepoRoot(rtype) → ScanModelEntriesFiltered(root, rtype, "", label)；
// Go 按注册表过滤；根为空 / 扫描失败 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPE_LABELS: { fbx: "FBX 模型" },
}));

import { resolveSiblingsByType } from "./siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveSiblingsByType", () => {
  it("GetRepoRoot(rtype) → ScanModelEntriesFiltered(root, rtype, '', label)（Go 过滤）", async () => {
    getRepoRootMock.mockResolvedValue("/root");
    scanFilteredMock.mockResolvedValue([
      { Path: "/root/a.fbx" },
      { Path: "/root/c.FBX" },
    ]);
    expect(await resolveSiblingsByType("fbx")).toEqual([
      "/root/a.fbx",
      "/root/c.FBX",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("fbx");
    expect(scanFilteredMock).toHaveBeenCalledWith("/root", "fbx", "", "FBX 模型");
  });

  it("根为空 / 扫描失败 → []（优雅降级，不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveSiblingsByType("fbx")).toEqual([]);
    getRepoRootMock.mockResolvedValue("/root");
    scanFilteredMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveSiblingsByType("fbx")).toEqual([]);
  });
});
