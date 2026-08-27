// @vitest-environment node
// ===== can() 能力门控真实实现三态测试（审核 B 缺口 #3）=====
// 桌面（__YSM_BACKEND__='go'）→ true；web（resolveWebMode）→ 'X' in browserAdapter；
// Android viewer（getAndroidBridge 非 null）→ 除 ANDROID_UNAVAILABLE 黑名单外均 true
// （Go binding 全量可达，code_review P3 同步头注释与实现）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { can } from "./capabilities.ts";

const KEY = "__YSM_BACKEND__";

const webImplKeys = [
  "ScanModelEntries",
  "ToggleModelEnable",
  "ToggleEnable",
  "DeleteResourcePack",
  "RenameFile",
  "ReadPackMeta",
  "GetNbtVoxelData",
];

beforeEach(() => {
  vi.stubGlobal(KEY, undefined);
  // node 环境无 window——android-bridge.getAndroidBridge 读 window.wails（非全局 wails）
  vi.stubGlobal("window", { wails: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("can() — 三级能力门控", () => {
  it("桌面（声明 go）→ 恒 true（Go 桥全量可用）", () => {
    vi.stubGlobal(KEY, "go");
    expect(can("DeleteResourcePack")).toBe(true);
    expect(can("MoveModelFile")).toBe(true);
  });

  it("网页版（resolveWebMode）→ binding in browserAdapter（has trap）", async () => {
    // 模拟 web：MODE=web 无法在 vitest 直接设，用 __YSM_BACKEND__='browser'（Tier 0）
    vi.stubGlobal(KEY, "browser");
    // webImpls 已实现的 binding → true
    for (const k of webImplKeys) {
      expect(can(k)).toBe(true);
    }
    // 未实现（fail-fast）→ false
    expect(can("MoveModelFile")).toBe(true); // 已实现（57f6d84f）
    expect(can("GetPackInfo")).toBe(true); // web-fs.ts 实现，返回最小 PackInfo
    expect(can("CheckUpdate")).toBe(false);
    expect(can("OpenFolder")).toBe(false);
  });

  it("Android viewer（getAndroidBridge 非 null）→ Go binding 可达，仅桌面专属/无意义项 false", () => {
    // Android Java 桥：window.wails 带 requestStoragePermission（android-bridge.ts:13-16 检测）
    // 实证（@wailsio/runtime runtime.js:184-231 + pathmgr_android.go）：Android 经 window.wails
    // → Go binding 全量可达，授权 MANAGE_EXTERNAL_STORAGE 后 os.* 直读公共仓库——
    // 文件读写类 binding 不再一刀切 false（2026-08 修），仅黑名单桌面专属项不可用
    vi.stubGlobal(KEY, undefined);
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    // 授权公共目录下可读写 → true
    expect(can("ToggleEnable")).toBe(true);
    expect(can("ToggleModelEnable")).toBe(true);
    expect(can("ScanModelEntries")).toBe(true);
    expect(can("DeleteResourcePack")).toBe(true);
    expect(can("RenameFile")).toBe(true);
    // 桌面专属/无 MC 整合包概念 → false（对齐 go-android-platform-guard.md）
    expect(can("OpenFolder")).toBe(false);
    expect(can("RevealInExplorer")).toBe(false);
    expect(can("RestartApplication")).toBe(false);
    expect(can("ListVersionInstances")).toBe(false);
  });

  it("默认环境（无声明/无 web/无 android）→ true（视作桌面/测试环境）", () => {
    expect(can("ScanModelEntries")).toBe(true);
  });
});
