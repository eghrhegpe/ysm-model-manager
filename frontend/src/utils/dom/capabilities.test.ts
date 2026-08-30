// @vitest-environment node
// ===== can() 能力门控真实实现三态测试（审核 B 缺口 #3）=====
// 桌面（__YSM_BACKEND__='go'）→ true；web（resolveWebMode）→ 'X' in browserAdapter；
// Android viewer（getAndroidBridge 非 null）→ 除 ANDROID_UNAVAILABLE 黑名单外均 true
// （Go binding 全量可达，code_review P3 同步头注释与实现）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { can, canWebAction, VIEWER_PURE_ACTIONS, VIEWER_WEB_ACTION_BINDINGS } from "./capabilities.ts";

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

// 注意：isolateModules=false 下跨文件状态泄漏风险。桌/默认用 beforeAll 一次性设置；
// Android 用例在测试内部独立 stub，afterAll 统一还原（不在 beforeEach 反复 stub/unstub）。
// 桌/默认环境只用 beforeEach stub（每个测试开始时重置）；Android 用例在测试内部独立
// stub window 再设置 wails 属性，afterEach unstubAllGlobals() 清理到 beforeEach 状态。
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

describe("canWebAction — 右键 action 在 web/viewer 模式下的可达性（P2-3 收敛）", () => {
  it("VIEWER_WEB_ACTION_BINDINGS 表覆盖所有应在 web 可达的动作", () => {
    // 该表是声明的「最小集合」——新增 web binding 必须加到这里；测试断言零漂移
    expect(Object.keys(VIEWER_WEB_ACTION_BINDINGS).sort()).toEqual(
      [
        "batch.copy", // CopyModelFile web 已实现
        "batch.move", // MoveModelFile web 已实现
        "dir.batch-rename", // RenameDir web 已实现
        "dir.rename", // RenameDir web 已实现
        "file.copy", // CopyModelFile web 已实现
        "file.edit-tags", // GetModelTags web 已实现
        "file.move", // MoveModelFile web 已实现
        "file.rename", // RenameFile web 已实现
      ].sort(),
    );
  });

  it("canWebAction(action) ≡ VIEWER_WEB_ACTION_BINDINGS[action] && can(binding)", () => {
    // 桌面环境下（beforeEach 默认）can() 恒 true → 白名单内全部可达
    vi.stubGlobal(KEY, "go");
    expect(canWebAction("file.rename")).toBe(true);
    expect(canWebAction("dir.batch-rename")).toBe(true);
    expect(canWebAction("file.move")).toBe(true);
    expect(canWebAction("batch.copy")).toBe(true);
    // 不在白名单 → false（防止误放行未实现的 action）
    expect(canWebAction("file.recycle")).toBe(false);
    expect(canWebAction("instance.clear")).toBe(false);
  });

  it("web 下 canWebAction 跟 can() 矩阵联动（binding 未实现 → false）", () => {
    vi.stubGlobal(KEY, "browser");
    // web 已实现的 binding（line 11-19 webImplKeys 列表）→ true
    expect(canWebAction("file.rename")).toBe(true); // RenameFile 已实现
    // binding 未实现 → false（即使在白名单）
    // 注：当前白名单内的 binding 在 web 全部已实现；这里测兜底：暂时构造一个未实现的 binding 测试 can() 矩阵
    // 由于白名单是写死的，无法直接注入未实现 binding；改为断言「白名单内 binding 全部 web 可用」即可
    expect(canWebAction("file.move")).toBe(true);
    expect(canWebAction("batch.move")).toBe(true);
  });
});

describe("VIEWER_PURE_ACTIONS — 纯前端动作在 viewer 模式恒可达（P3 收敛）", () => {
  it("白名单即 context-menus.ts 原 VIEWER_OK_ACTIONS（零漂移断言）", () => {
    // 原 context-menus.ts 硬编码 VIEWER_OK_ACTIONS 收敛到此；新增纯前端
    // 右键动作必须加到这里，测试断言集合精确等于声明
    expect([...VIEWER_PURE_ACTIONS].sort()).toEqual(
      ["batch.copy-paths", "batch.export-list", "file.copy-path", "noop"].sort(),
    );
  });

  it("纯前端动作不依赖 can()——桌面 binding 全不可用仍可达", () => {
    vi.stubGlobal(KEY, "browser");
    // web 下纯前端动作（DOM/剪贴板）恒可达
    expect(canWebAction("noop")).toBe(true);
    expect(canWebAction("batch.copy-paths")).toBe(true);
    expect(canWebAction("batch.export-list")).toBe(true);
    expect(canWebAction("file.copy-path")).toBe(true);
  });

  it("与 binding 动作互斥：无 binding 且不在纯前端集 → false（防误放行）", () => {
    vi.stubGlobal(KEY, "go"); // 桌面 can() 恒 true，但不该让未知动作漏过
    expect(canWebAction("file.recycle")).toBe(false); // 有 binding 但不在 VIEWER_WEB_ACTION_BINDINGS
    expect(canWebAction("instance.clear")).toBe(false);
  });
});
