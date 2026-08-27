// @vitest-environment node
// ===== 跨平台模式统一判定测试（ADR-123 P3）=====
// resolvePlatformMode 三态判定 + CAPABILITY_MATRIX 能力矩阵——收敛原
// capabilities.ts 内部「desktop 恒 true / web 查 adapter has / Android 查黑名单」
// 的三路散装逻辑。平台信号源：Tier 0 入口声明 > Tier 1 构建模式 > Android 桥探测。
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

const { declaredMock, entryModeMock } = vi.hoisted(() => ({
  declaredMock: vi.fn<() => "go" | "browser" | undefined>(() => undefined),
  entryModeMock: vi.fn<() => boolean>(() => false),
}));

vi.mock("./platform.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readDeclaredBackend: declaredMock,
  isWebEntryMode: entryModeMock,
}));

import { resolvePlatformMode, canBinding, ANDROID_UNAVAILABLE } from "./platform-web.ts";

beforeEach(() => {
  declaredMock.mockReset().mockReturnValue(undefined);
  entryModeMock.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePlatformMode — 三态判定", () => {
  it("Tier 0 声明 'go' → desktop（权威信号最高优先）", () => {
    declaredMock.mockReturnValue("go");
    expect(resolvePlatformMode()).toBe("desktop");
  });

  it("Tier 0 声明 'browser' → web（误嵌 WebView 也强制 web）", () => {
    declaredMock.mockReturnValue("browser");
    expect(resolvePlatformMode()).toBe("web");
  });

  it("Tier 0 权威压过 Android 桥残留（桌面声明 + wails 桥并存 → desktop）", () => {
    declaredMock.mockReturnValue("go");
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    expect(resolvePlatformMode()).toBe("desktop");
  });

  it("未声明 + MODE=web 构建 → web", () => {
    entryModeMock.mockReturnValue(true);
    expect(resolvePlatformMode()).toBe("web");
  });

  it("未声明 + 无构建标记 + 存在 wails 桥 → android", () => {
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    expect(resolvePlatformMode()).toBe("android");
  });

  it("全无信号 → desktop（纯桌面兜底）", () => {
    vi.stubGlobal("window", {});
    expect(resolvePlatformMode()).toBe("desktop");
  });
});

describe("canBinding — 能力矩阵（对齐 ADR-176 capabilities 矩阵范式）", () => {
  it("Android 黑名单四项不可用，其余 Go binding 全量可达", () => {
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    for (const b of ["RevealInExplorer", "OpenFolder", "RestartApplication", "ListVersionInstances"]) {
      expect(canBinding(b)).toBe(false);
    }
    expect(canBinding("EnqueueDownloads")).toBe(true);
    expect(canBinding("ReadFileBytes")).toBe(true);
  });

  it("web 按 adapter has 探测：已实现 true、已移除项 false（ADR-123 P2 回归锚）", () => {
    entryModeMock.mockReturnValue(true);
    expect(canBinding("ScanModelEntries")).toBe(true);
    expect(canBinding("ExecuteCLI")).toBe(false); // P2 移除后门控必须命中
  });

  it("desktop 恒可用（Go 桥全量）", () => {
    declaredMock.mockReturnValue("go");
    expect(canBinding("ExecuteCLI")).toBe(true);
    expect(canBinding("RevealInExplorer")).toBe(true);
  });

  it("ANDROID_UNAVAILABLE 仅含桌面专属四项（黑名单单一事实源自 platform-web 导出）", () => {
    expect([...ANDROID_UNAVAILABLE].sort()).toEqual([
      "ListVersionInstances",
      "OpenFolder",
      "RestartApplication",
      "RevealInExplorer",
    ]);
  });
});
