// @vitest-environment node
// ===== morph-siblings 视图壳数据准备测试 =====
// 覆盖：resolveMorphSiblings（GetRepoRoot(CustomMorph) → ScanModelEntriesFiltered(root, 'CustomMorph', '', '自定义表情')，
// 预览候选白名单 = CustomMorph extensions 剔容器（.vpd，previewCandidateExtsOf 派生，
// 锐评 G2 收口——替代原手写 /\.vpd$/i 正则）；根为空 / 扫描失败 / getApp 拒绝 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { resolveMorphSiblings } from "./siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveMorphSiblings", () => {
  it("GetRepoRoot(CustomMorph) → ScanModelEntriesFiltered(root, 'CustomMorph', '', '自定义表情')，只保留 .vpd（大小写不敏感）", async () => {
    getRepoRootMock.mockResolvedValue("/repo/mmd/CustomMorph");
    scanFilteredMock.mockResolvedValue([
      { Path: "/repo/mmd/CustomMorph/喜.a.vpd" },
      { Path: "/repo/mmd/CustomMorph/怒.B.VPD" },
      { Path: "/repo/mmd/CustomMorph/notes.txt" },
      { Path: "/repo/mmd/CustomMorph/model.vpd.zip" },
      { Path: "/repo/mmd/CustomMorph/stage.vpdx" },
    ]);
    expect(await resolveMorphSiblings()).toEqual([
      "/repo/mmd/CustomMorph/喜.a.vpd",
      "/repo/mmd/CustomMorph/怒.B.VPD",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("CustomMorph");
    expect(scanFilteredMock).toHaveBeenCalledWith(
      "/repo/mmd/CustomMorph",
      "CustomMorph",
      "",
      "自定义表情",
    );
  });

  it("Path 缺失 / 空串的条目被过滤（防列表出现不可应用条目）", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockResolvedValue([
      { Name: "no-path-entry" },
      { Path: "" },
      { Path: "/r/ok.vpd" },
    ]);
    expect(await resolveMorphSiblings()).toEqual(["/r/ok.vpd"]);
  });

  it("扫描返回 null → []", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockResolvedValue(null);
    expect(await resolveMorphSiblings()).toEqual([]);
  });

  it("根为空 → [] 且不发起扫描", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveMorphSiblings()).toEqual([]);
    expect(scanFilteredMock).not.toHaveBeenCalled();
  });

  it("扫描失败 / getApp 拒绝 → []（不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("/r");
    scanFilteredMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveMorphSiblings()).toEqual([]);
    getAppMock.mockRejectedValue(new Error("bridge down"));
    expect(await resolveMorphSiblings()).toEqual([]);
  });
});
