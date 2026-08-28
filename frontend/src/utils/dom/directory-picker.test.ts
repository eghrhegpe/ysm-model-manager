// @vitest-environment node
// ===== 跨平台目录选择器测试（directory-picker.ts，ADR-046 P2）=====
// 覆盖四分支：桌面（Wails Dialog）/ 网页版（定位虚拟根 /web）/ Android 未授权（引导 +
// 返回 null）/ Android 已授权（GetDefaultRepoRoot 自动定位 + toast + 返回路径）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pickDirectory, resolveAndroidRepoDir } from "./directory-picker.ts";
import type { WailsAndroidBridge } from "./android-bridge.ts";

// ── hoisted mocks（供 vi.mock 工厂引用）──
const { mocks } = vi.hoisted(() => ({
  mocks: {
    SelectDirectory: vi.fn(),
    GetDefaultRepoRoot: vi.fn(),
    getAndroidBridge: vi.fn(),
    isViewerMode: vi.fn(),
    isWebPlatform: vi.fn(() => false),
    busEmit: vi.fn(),
    t: vi.fn((key: string) => key),
  },
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SelectDirectory: mocks.SelectDirectory,
    GetDefaultRepoRoot: mocks.GetDefaultRepoRoot,
  }),
}));

vi.mock("./android-bridge.ts", () => ({
  getAndroidBridge: mocks.getAndroidBridge,
  isViewerMode: mocks.isViewerMode,
}));

vi.mock("../../backend/platform-web.ts", () => ({
  isWebPlatform: mocks.isWebPlatform,
}));

vi.mock("../../bus.ts", () => ({
  bus: { emit: mocks.busEmit },
}));

vi.mock("../../core/i18n/t.ts", () => ({
  t: mocks.t,
}));

/** 构造 Android 桥（默认未授权） */
function makeBridge(overrides: Partial<WailsAndroidBridge> = {}): WailsAndroidBridge {
  return {
    hasStoragePermission: () => false,
    requestStoragePermission: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.SelectDirectory.mockResolvedValue("/desktop/path");
  mocks.GetDefaultRepoRoot.mockResolvedValue("/storage/emulated/0/YSM-Model-Manager");
  mocks.isViewerMode.mockReturnValue(false);
  mocks.isWebPlatform.mockReturnValue(false);
});

describe("pickDirectory — 桌面（非查看器模式）", () => {
  it("isViewerMode=false 时走 Wails Dialog（SelectDirectory）", async () => {
    mocks.isViewerMode.mockReturnValue(false);
    const dir = await pickDirectory();
    expect(mocks.SelectDirectory).toHaveBeenCalledTimes(1);
    expect(dir).toBe("/desktop/path");
    expect(mocks.GetDefaultRepoRoot).not.toHaveBeenCalled();
  });

  it("网页版（isViewerMode=true）→ 走 resolveAndroidRepoDir 定位虚拟根，不调 SelectDirectory", async () => {
    mocks.isViewerMode.mockReturnValue(true);
    mocks.getAndroidBridge.mockReturnValue(null);
    mocks.isWebPlatform.mockReturnValue(true);
    mocks.GetDefaultRepoRoot.mockResolvedValue("/web");
    const dir = await pickDirectory();
    expect(mocks.SelectDirectory).not.toHaveBeenCalled();
    expect(mocks.GetDefaultRepoRoot).toHaveBeenCalledTimes(1);
    expect(dir).toBe("/web");
  });
});

describe("resolveAndroidRepoDir — 桌面（无 Android 桥）", () => {
  it("返回 null，调用方自行走 Wails Dialog", async () => {
    mocks.getAndroidBridge.mockReturnValue(null);
    const dir = await resolveAndroidRepoDir();
    expect(dir).toBeNull();
    expect(mocks.SelectDirectory).not.toHaveBeenCalled();
    expect(mocks.GetDefaultRepoRoot).not.toHaveBeenCalled();
  });

  it("网页版（__YSM_BACKEND__=browser，无桥）→ 定位虚拟根 /web + toast", async () => {
    mocks.getAndroidBridge.mockReturnValue(null);
    mocks.isWebPlatform.mockReturnValue(true);
    mocks.GetDefaultRepoRoot.mockResolvedValue("/web");
    const dir = await resolveAndroidRepoDir();
    expect(dir).toBe("/web");
    expect(mocks.GetDefaultRepoRoot).toHaveBeenCalledTimes(1);
    expect(mocks.SelectDirectory).not.toHaveBeenCalled();
  });

  // P3 补测（审核）：网页版定位失败（虚拟根为空）→ 返回 null 且不发成功 toast
  it("网页版 GetDefaultRepoRoot 返回空 → null 且无 info toast", async () => {
    mocks.getAndroidBridge.mockReturnValue(null);
    mocks.isWebPlatform.mockReturnValue(true);
    mocks.GetDefaultRepoRoot.mockResolvedValue("");
    const dir = await resolveAndroidRepoDir();
    expect(dir).toBeNull();
    expect(mocks.GetDefaultRepoRoot).toHaveBeenCalledTimes(1);
    expect(mocks.busEmit).not.toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "info" }),
    );
  });
});

describe("pickDirectory — Android 未授权", () => {
  it("引导 requestStoragePermission 并返回 null", async () => {
    const bridge = makeBridge();
    mocks.getAndroidBridge.mockReturnValue(bridge);
    mocks.isViewerMode.mockReturnValue(true);
    const dir = await pickDirectory();

    expect(dir).toBeNull();
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);
    // 引导 toast（needStoragePermission）
    expect(mocks.busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "warn" }),
    );
    expect(mocks.SelectDirectory).not.toHaveBeenCalled();
  });
});

describe("pickDirectory — Android 已授权", () => {
  it("自动定位公共仓库目录并返回路径", async () => {
    const bridge = makeBridge({ hasStoragePermission: () => true });
    mocks.getAndroidBridge.mockReturnValue(bridge);
    mocks.isViewerMode.mockReturnValue(true);
    const dir = await pickDirectory();

    expect(dir).toBe("/storage/emulated/0/YSM-Model-Manager");
    expect(mocks.GetDefaultRepoRoot).toHaveBeenCalledTimes(1);
    expect(bridge.requestStoragePermission).not.toHaveBeenCalled();
    // 定位成功 toast（autoRepoRoot）
    expect(mocks.busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "info" }),
    );
  });

  it("GetDefaultRepoRoot 返回空时返回 null 且不发成功 toast", async () => {
    const bridge = makeBridge({ hasStoragePermission: () => true });
    mocks.getAndroidBridge.mockReturnValue(bridge);
    mocks.isViewerMode.mockReturnValue(true);
    mocks.GetDefaultRepoRoot.mockResolvedValue("");
    const dir = await pickDirectory();

    expect(dir).toBeNull();
    // 不应出现成功定位 toast（autoRepoRoot 未消费）
    expect(mocks.busEmit).not.toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "info" }),
    );
  });
});
