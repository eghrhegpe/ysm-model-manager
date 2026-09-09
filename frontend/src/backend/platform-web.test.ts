// @vitest-environment node
// ===== 跨平台模式统一判定测试（ADR-123 P3 / ADR-217 收敛）=====
// resolvePlatformMode 三态判定 + CAPABILITY_MATRIX 能力矩阵。
// ADR-217 后 resolvePlatformMode 委托 platform.ts 的单一 resolveTier，
// 故本测试 mock resolveTier 控制平台判定结果（原语拼接逻辑由 resolveTier
// 自身与 platform-parity.test.ts 真实信号对拍覆盖）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { tierMock } = vi.hoisted(() => ({
  tierMock: vi.fn<() => "desktop" | "web" | "android">(() => "desktop"),
}));

vi.mock("./platform.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveTier: tierMock,
}));

import { resolvePlatformMode, canBinding, ANDROID_UNAVAILABLE } from "./platform-web.ts";

beforeEach(() => {
  tierMock.mockReset().mockReturnValue("desktop");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePlatformMode — 三态判定（委托 resolveTier）", () => {
  it("Tier 0 声明 'go' → desktop（权威信号最高优先）", () => {
    tierMock.mockReturnValue("desktop");
    expect(resolvePlatformMode()).toBe("desktop");
  });

  it("Tier 0 声明 'browser' → web（误嵌 WebView 也强制 web）", () => {
    tierMock.mockReturnValue("web");
    expect(resolvePlatformMode()).toBe("web");
  });

  it("Tier 0 权威压过 Android 桥残留（桌面声明 + wails 桥并存 → desktop）", () => {
    tierMock.mockReturnValue("desktop");
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    expect(resolvePlatformMode()).toBe("desktop");
  });

  it("未声明 + MODE=web 构建 → web", () => {
    tierMock.mockReturnValue("web");
    expect(resolvePlatformMode()).toBe("web");
  });

  it("未声明 + 无构建标记 + 存在 wails 桥 → android", () => {
    tierMock.mockReturnValue("android");
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    expect(resolvePlatformMode()).toBe("android");
  });

  it("全无信号 → desktop（纯桌面兜底）", () => {
    tierMock.mockReturnValue("desktop");
    vi.stubGlobal("window", {});
    expect(resolvePlatformMode()).toBe("desktop");
  });
});

describe("canBinding — 能力矩阵（对齐 ADR-176 capabilities 矩阵范式）", () => {
  it("Android 黑名单不可用，其余 Go binding 全量可达", () => {
    tierMock.mockReturnValue("android");
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    // 原始四项
    for (const b of ["RevealInExplorer", "OpenFolder", "RestartApplication", "ListVersionInstances"]) {
      expect(canBinding(b)).toBe(false);
    }
    // 扩展项（PR 中新增）
    for (const b of ["OpenInBrowser", "GetMinecraftPaths", "ValidateMinecraftDir",
      "SelectDirectory", "SelectImportFile",
      "NavigatePlazaWindow", "ClosePlazaWindow", "PlazaGoBack", "PlazaGoForward",
      "PlazaReload", "PlazaZoomIn", "PlazaZoomOut", "PlazaZoomReset",
      "SetMainWindow", "SetApp"]) {
      expect(canBinding(b), `${b} 应为 false`).toBe(false);
    }
    expect(canBinding("EnqueueDownloads")).toBe(true);
    expect(canBinding("ReadFileBytes")).toBe(true);
  });

  it("web 按 adapter has 探测：已实现 true、已移除项 false（ADR-123 P2 回归锚）", () => {
    tierMock.mockReturnValue("web");
    expect(canBinding("ScanModelEntries")).toBe(true);
    expect(canBinding("ExecuteCLI")).toBe(false); // P2 移除后门控必须命中
  });

  it("desktop 恒可用（Go 桥全量）", () => {
    tierMock.mockReturnValue("desktop");
    expect(canBinding("ExecuteCLI")).toBe(true);
    expect(canBinding("RevealInExplorer")).toBe(true);
  });

  it("ANDROID_UNAVAILABLE 含所有桌面专属 binding（黑名单单一事实源自 platform-web 导出）", () => {
    expect([...ANDROID_UNAVAILABLE].sort()).toEqual([
      "ClosePlazaWindow",
      "GetMinecraftPaths",
      "ListVersionInstances",
      "NavigatePlazaWindow",
      "OpenFolder",
      "OpenInBrowser",
      "PlazaGoBack",
      "PlazaGoForward",
      "PlazaReload",
      "PlazaZoomIn",
      "PlazaZoomOut",
      "PlazaZoomReset",
      "RestartApplication",
      "RevealInExplorer",
      "SelectDirectory",
      "SelectImportFile",
      "SetApp",
      "SetMainWindow",
      "ValidateMinecraftDir",
    ]);
  });
});
