// @vitest-environment node
// ===== stage-siblings 舞台包资源扫描测试 =====
// 覆盖：resolveStageSiblings（GetRepoRoot(StageAnim) → ScanModelEntriesFiltered(root, 'StageAnim', '', '舞台动画')，
// 按扩展名分档 vmd / audio / config，其余跳过；根为空 / 扫描失败 / getApp 拒绝 → []）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanFilteredMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanFilteredMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { resolveStageSiblings } from "./stage-siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntriesFiltered: scanFilteredMock,
  });
});

describe("resolveStageSiblings", () => {
  it("GetRepoRoot(StageAnim) → ScanModelEntriesFiltered(root, 'StageAnim', '', '舞台动画')", async () => {
    getRepoRootMock.mockResolvedValue("/repo/mmd/StageAnim");
    scanFilteredMock.mockResolvedValue([{ Path: "/repo/mmd/StageAnim/包A/dance.vmd" }]);
    await resolveStageSiblings();
    expect(getRepoRootMock).toHaveBeenCalledWith("StageAnim");
    expect(scanFilteredMock).toHaveBeenCalledWith(
      "/repo/mmd/StageAnim",
      "StageAnim",
      "",
      "舞台动画",
    );
  });

  it("按扩展名分档：vmd / audio（mp3|ogg|wav，大小写不敏感）/ config", async () => {
    getRepoRootMock.mockResolvedValue("/s");
    scanFilteredMock.mockResolvedValue([
      { Path: "/s/包A/dance.vmd" },
      { Path: "/s/包A/CAMERA.VMD" },
      { Path: "/s/包A/bgm.mp3" },
      { Path: "/s/包A/voice.OGG" },
      { Path: "/s/包A/notify.wav" },
      { Path: "/s/包A/stage_config.json" },
      { Path: "/s/包B/STAGE_CONFIG.JSON" }, // basename 小写后比对，同样归 config
    ]);
    expect(await resolveStageSiblings()).toEqual([
      { path: "/s/包A/dance.vmd", kind: "vmd" },
      { path: "/s/包A/CAMERA.VMD", kind: "vmd" },
      { path: "/s/包A/bgm.mp3", kind: "audio" },
      { path: "/s/包A/voice.OGG", kind: "audio" },
      { path: "/s/包A/notify.wav", kind: "audio" },
      { path: "/s/包A/stage_config.json", kind: "config" },
      { path: "/s/包B/STAGE_CONFIG.JSON", kind: "config" },
    ]);
  });

  it("Windows 反斜杠路径同样正确取 basename 分档", async () => {
    getRepoRootMock.mockResolvedValue("/s");
    scanFilteredMock.mockResolvedValue([{ Path: "C:\\repo\\StageAnim\\包A\\bgm.MP3" }]);
    expect(await resolveStageSiblings()).toEqual([{ path: "C:\\repo\\StageAnim\\包A\\bgm.MP3", kind: "audio" }]);
  });

  it("无关扩展名（readme.txt / stage_config.json.bak）与空 Path 条目跳过", async () => {
    getRepoRootMock.mockResolvedValue("/s");
    scanFilteredMock.mockResolvedValue([
      { Path: "/s/包A/readme.txt" },
      { Path: "/s/包A/stage_config.json.bak" },
      { Path: "" },
      { Name: "no-path-entry" },
    ]);
    expect(await resolveStageSiblings()).toEqual([]);
  });

  it("扫描返回 null → []", async () => {
    getRepoRootMock.mockResolvedValue("/s");
    scanFilteredMock.mockResolvedValue(null);
    expect(await resolveStageSiblings()).toEqual([]);
  });

  it("根为空 → [] 且不发起扫描", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveStageSiblings()).toEqual([]);
    expect(scanFilteredMock).not.toHaveBeenCalled();
  });

  it("扫描失败 / getApp 拒绝 → []（不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("/s");
    scanFilteredMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveStageSiblings()).toEqual([]);
    getAppMock.mockRejectedValue(new Error("bridge down"));
    expect(await resolveStageSiblings()).toEqual([]);
  });
});
