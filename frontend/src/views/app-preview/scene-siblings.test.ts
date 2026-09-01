// @vitest-environment node
// ===== scene-siblings 视图壳数据准备测试 =====
// 覆盖：resolveSceneSiblings（GetRepoRoot(SceneModel) → ScanModelEntriesFiltered(root, 'SceneModel', '', '场景模型')，
// 前端最小扩展名守卫只留 .pmx/.pmd；根为空 / 扫描失败 / getApp 拒绝 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { resolveSceneSiblings } from "./siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveSceneSiblings", () => {
  it("GetRepoRoot(SceneModel) → ScanModelEntriesFiltered(root, 'SceneModel', '', '场景模型')，只保留 .pmx/.pmd（大小写不敏感）", async () => {
    getRepoRootMock.mockResolvedValue("/repo/mmd/SceneModel");
    scanFilteredMock.mockResolvedValue([
      { Path: "/repo/mmd/SceneModel/舞台A/stage.pmx" },
      { Path: "/repo/mmd/SceneModel/舞台B/STAGE.PMD" },
      { Path: "/repo/mmd/SceneModel/舞台C/actor.vrm" },
      { Path: "/repo/mmd/SceneModel/舞台D/bgm.mp3" },
      { Path: "/repo/mmd/SceneModel/舞台E/bundle.zip" },
    ]);
    // Go 白名单含 .vrm/.zip，前端 pmx/pmd 守卫剔除加载不了的条目
    expect(await resolveSceneSiblings()).toEqual([
      "/repo/mmd/SceneModel/舞台A/stage.pmx",
      "/repo/mmd/SceneModel/舞台B/STAGE.PMD",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("SceneModel");
    expect(scanFilteredMock).toHaveBeenCalledWith(
      "/repo/mmd/SceneModel",
      "SceneModel",
      "",
      "场景模型",
    );
  });

  it("Path 缺失 / 空串的条目被过滤", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockResolvedValue([
      { Name: "no-path-entry" },
      { Path: "" },
      { Path: "/r/ok.pmx" },
    ]);
    expect(await resolveSceneSiblings()).toEqual(["/r/ok.pmx"]);
  });

  it("扫描返回 null → []", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockResolvedValue(null);
    expect(await resolveSceneSiblings()).toEqual([]);
  });

  it("根为空 → [] 且不发起扫描", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveSceneSiblings()).toEqual([]);
    expect(scanFilteredMock).not.toHaveBeenCalled();
  });

  it("扫描失败 / getApp 拒绝 → []（不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveSceneSiblings()).toEqual([]);
    getAppMock.mockRejectedValue(new Error("bridge down"));
    expect(await resolveSceneSiblings()).toEqual([]);
  });
});
