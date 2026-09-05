// @vitest-environment node
// ===== fbx-siblings 测试（ADR-112 地基拓展：P0-1 预览内切换）=====
// 覆盖：resolveFbxSiblings 委托通用 resolveSiblingsByType，Go 按注册表过滤；
// GetRepoRoot 为空 / 扫描失败 → []。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { FBX: "fbx" },
  RESOURCE_TYPE_LABELS: { fbx: "FBX 模型" },
}));

import { resolveFbxSiblings } from "./fbx-siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveFbxSiblings", () => {
  it("委托通用底座，Go 按注册表过滤 .fbx（排除 .vmd 等异格式）", async () => {
    getRepoRootMock.mockResolvedValue("/mmd-root/CustomAnim");
    scanFilteredMock.mockResolvedValue([
      { Path: "/mmd-root/CustomAnim/dance.fbx" },
      { Path: "/mmd-root/CustomAnim/walk.FBX" },
    ]);
    expect(await resolveFbxSiblings()).toEqual([
      "/mmd-root/CustomAnim/dance.fbx",
      "/mmd-root/CustomAnim/walk.FBX",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("fbx");
    expect(scanFilteredMock).toHaveBeenCalledWith(
      "/mmd-root/CustomAnim",
      "fbx",
      "",
      "FBX 模型",
    );
  });

  it("GetRepoRoot 为空 / 扫描失败 → []", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveFbxSiblings()).toEqual([]);
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockRejectedValue(new Error("x"));
    expect(await resolveFbxSiblings()).toEqual([]);
  });
});
