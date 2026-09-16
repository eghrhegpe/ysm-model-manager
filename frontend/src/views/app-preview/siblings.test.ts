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
vi.mock("@/utils/resource/types.ts", () => ({
  RESOURCE_TYPE_LABELS: { fbx: "FBX 模型", EntityPlayer: "MMD 模型", SceneModel: "场景模型" },
  RESOURCE_TYPES: { MMD: "EntityPlayer", FBX: "fbx", SCENE: "SceneModel", CUSTOM_MORPH: "CustomMorph" },
  extOf: (p: string): string => (p.split(".").pop() || "").toLowerCase(),
  previewCandidateExtsOf: (): readonly string[] => ["pmx", "pmd"],
}));

import { resolveSiblingsByType, resolveSiblingsForRoute } from "./siblings.ts";

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

describe("resolveSiblingsForRoute（ADR-253 D1 路由层单一出口）", () => {
  it("routeKey=mmd → 同 MMD 口径（扫 EntityPlayer 根）", async () => {
    getRepoRootMock.mockResolvedValue("/mmd");
    scanFilteredMock.mockResolvedValue([{ Path: "/mmd/a.pmx" }]);
    expect(await resolveSiblingsForRoute("mmd", "EntityPlayer")).toEqual(["/mmd/a.pmx"]);
    expect(getRepoRootMock).toHaveBeenCalledWith("EntityPlayer");
  });

  it("routeKey=fbx → 扫 FBX 根", async () => {
    getRepoRootMock.mockResolvedValue("/fbx");
    scanFilteredMock.mockResolvedValue([{ Path: "/fbx/a.fbx" }]);
    expect(await resolveSiblingsForRoute("fbx", "fbx")).toEqual(["/fbx/a.fbx"]);
    expect(getRepoRootMock).toHaveBeenCalledWith("fbx");
  });

  it("routeKey=mmd-scene → 场景口径带 ext 白名单（过滤加载不了的条目）", async () => {
    getRepoRootMock.mockResolvedValue("/scene");
    scanFilteredMock.mockResolvedValue([
      { Path: "/scene/a.pmx" },
      { Path: "/scene/b.vrm" },
      { Path: "/scene/pack.zip" },
    ]);
    expect(await resolveSiblingsForRoute("mmd-scene", "SceneModel")).toEqual(["/scene/a.pmx"]);
    expect(getRepoRootMock).toHaveBeenCalledWith("SceneModel");
  });

  it("未登记 routeKey → 回退按 rtype 裸扫描", async () => {
    getRepoRootMock.mockResolvedValue("/vrm");
    scanFilteredMock.mockResolvedValue([{ Path: "/vrm/a.vrm" }]);
    expect(await resolveSiblingsForRoute("vrm", "vrm")).toEqual(["/vrm/a.vrm"]);
    expect(getRepoRootMock).toHaveBeenCalledWith("vrm");
  });

  it("扫描失败 → []（不抛，交由调用方退化为不下拉）", async () => {
    getRepoRootMock.mockRejectedValue(new Error("boom"));
    expect(await resolveSiblingsForRoute("fbx", "fbx")).toEqual([]);
  });
});
