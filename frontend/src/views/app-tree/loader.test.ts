// @vitest-environment node
// ===== 文件树数据加载层测试 =====
// 覆盖：loadEntries 空 repoRoot / 空 raw / banned / relPath / 异常 toast / subdir 覆盖类型 ID
// mock 基线来自 e2e/mock-data.ts（共享单源：改 Go 数据只改一处，防双源漂移），
// 测试专用值用 override 覆盖（如反斜杠路径用例）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appFn, resetAppMock } from "@/test-utils/mock-app.ts";
import { MOCK_DATA } from "../../../e2e/mock-data.ts";
// bus 不静态 import：beforeEach resetModules 后动态拿，保证与 loader 新实例同源
// （裸 resetModules 会让 loader 的 bus 与 spy 的 bus 分叉，toast 收不到——见 141 行注）
import type { Bus } from "../../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    getAndroidBridge: vi.fn(),
  };
  return { mocks };
});
// app 方法经 appFn 注册（唯一事实源，code_review 54ef29d3 #10：hoisted 旧条目
// 已被 Object.assign 覆盖成死代码，双源真相有漂移风险——仅保留非 app mock）
Object.assign(mocks, {
  GetRepoRoot: appFn("GetRepoRoot"),
  ScanModelEntriesFiltered: appFn("ScanModelEntriesFiltered"),
  IsFileBanned: appFn("IsFileBanned"),
});



vi.mock("@/backend/app.ts", async () => {
  const { setupAppMock } = await import("@/test-utils/mock-app.ts");
  return setupAppMock();
});

vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPE_LABELS: { ysm: "YSM模型", pack: "资源包", SceneModel: "场景模型" },
}));

vi.mock("../../utils/dom/errors.ts", () => ({
  friendlyError: (e: unknown, fallback: string): string =>
    e instanceof Error ? e.message : fallback,
}));

vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: mocks.getAndroidBridge,
}));

let cleanups: Array<() => void> = [];
let bus: Bus;

beforeEach(async () => {
  cleanups = [];
  // isolate:false 共享模块图下 per-file mock 先到先得：resetModules 让 loader.ts
  // 及其依赖（backend/app.ts、android-bridge.ts）按本文件 mock 表重新求值，
  // 避免被兄弟文件先求值的真实绑定固化（同 errors.test.ts 修复模式）。
  // bus 必须动态 import 拿同一实例——否则 loader 新实例与 spy 的 bus 分叉，toast 收不到。
  vi.resetModules();
  bus = (await import("../../bus.ts")).bus;
  vi.clearAllMocks();
  // 共享基线：GetRepoRoot 取 MOCK_DATA 值（"/e2e/repo"），与 e2e 一致
  mocks.GetRepoRoot.mockResolvedValue(MOCK_DATA.GetRepoRoot);
  mocks.IsFileBanned.mockResolvedValue(false);
  mocks.ScanModelEntriesFiltered.mockResolvedValue([]);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  // B 簇（code_review 54ef29d3 #3/#7）：isolate=false + shuffle 下 globalThis store
  // 跨文件存活（本文件还 resetModules + 内层 describe mockReset 共享 fn 留下
  // undefined-success），GetRepoRoot/ScanModelEntriesFiltered 残留会给 recycle-bin/
  // sync 等后跑文件——清回 fail-closed 起点，对齐 mock-app.ts 头注释契约
  resetAppMock();
});

function spyToasts() {
  const toasts: Array<{ msg: string; type: string }> = [];
  cleanups.push(bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })));
  return toasts;
}

describe("loadEntries", () => {
  it("repoRoot 未配置 → 空结果，不扫文件", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: "", entries: [] });
    expect(mocks.ScanModelEntriesFiltered).not.toHaveBeenCalled();
  });

  it("扫描结果为空 → 空 entries", async () => {
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: MOCK_DATA.GetRepoRoot, entries: [] });
  });

  it("禁用态由 Go 扫描结果下发（e.banned），前端不再逐文件 IsFileBanned（N+1 消除）", async () => {
    // Path 前缀与共享基线 GetRepoRoot（/e2e/repo）一致，动态拼接防再次硬编码漂移
    const repo = MOCK_DATA.GetRepoRoot;
    mocks.ScanModelEntriesFiltered.mockResolvedValue([
      { Name: "a.ysm", Path: `${repo}/sub/a.ysm`, Size: 10, ModTime: 1 },
      { Name: "b.ban", Path: `${repo}/sub/b.ban`, Size: 10, ModTime: 1, banned: true },
      { Name: "d.ysm", Path: `${repo}/sub/d.ysm`, Size: 10, ModTime: 1, banned: true },
    ]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");

    // 3 条全部保留（后端 ScanModelEntriesFiltered 已过滤，前端不再过滤）
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({
      name: "a.ysm",
      path: "sub/a.ysm", // 去掉 repoRoot 前缀
      fullPath: `${repo}/sub/a.ysm`,
      banned: false,
    });
    expect(r.entries[2]).toMatchObject({ name: "d.ysm", path: "sub/d.ysm", banned: true });
    // N+1 回归守卫：前端不得再逐文件调 IsFileBanned
    expect(mocks.IsFileBanned).not.toHaveBeenCalled();
  });

  it("仓库根路径带反斜杠时也能剥离前缀", async () => {
    mocks.GetRepoRoot.mockResolvedValue("C:\\repo");
    mocks.ScanModelEntriesFiltered.mockResolvedValue([
      { Name: "a.ysm", Path: "C:\\repo\\sub\\a.ysm", Size: 0, ModTime: 0 },
    ]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r.entries[0].path).toBe("sub/a.ysm");
  });

  it("ScanModelEntriesFiltered 抛错 → error toast + 空结果", async () => {
    mocks.ScanModelEntriesFiltered.mockRejectedValue(new Error("boom"));
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: "", entries: [] });
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("boom"))).toBe(true);
  });
});

// ---- maybePromptAndroidStorage（经 loadEntries 失败路径触发，ADR-046 P2）----
// 库加载失败时若 Android 未授权 → 引导 requestStoragePermission（5s 节流）。
// _lastStoragePromptAt / _lastErrorToastAt 是模块级节流变量：fake 时间从真实
// 基线起步每用例递增 60s（>5s 窗口）自然过期。
const realStartMs = Date.now();
describe("maybePromptAndroidStorage（loadEntries 失败触发）", () => {
  let fakeMs = 0;
  beforeEach(() => {
    fakeMs += 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(realStartMs + fakeMs));
    // 显式制造 loadEntries 失败
    mocks.ScanModelEntriesFiltered.mockRejectedValue(new Error("load-fail"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBridge(hasPermission: boolean) {
    const bridge = {
      hasStoragePermission: vi.fn(() => hasPermission),
      requestStoragePermission: vi.fn(),
    };
    mocks.getAndroidBridge.mockReturnValue(bridge);
    return bridge;
  }

  it("桌面（无桥）→ 不引导授权", async () => {
    mocks.getAndroidBridge.mockReturnValue(null);
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    expect(toasts.some((t) => t.type === "error")).toBe(true);
    expect(toasts.some((t) => t.type === "warn")).toBe(false);
  });

  it("Android 未授权 → 调用 requestStoragePermission + warn toast", async () => {
    const bridge = makeBridge(false);
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);
    expect(toasts.some((t) => t.type === "warn")).toBe(true);
  });

  it("Android 已授权 → 不引导", async () => {
    const bridge = makeBridge(true);
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).not.toHaveBeenCalled();
  });

  it("5s 节流：连续失败只引导一次", async () => {
    const bridge = makeBridge(false);
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);
  });
});

describe("扁平化 subdir 路由", () => {
  beforeEach(() => {
    mocks.GetRepoRoot.mockReset();
    mocks.ScanModelEntriesFiltered.mockReset();
  });

  it("subdir 作为类型 ID 直接查表 — GetRepoRoot(\"SceneModel\") 而非拼接路径", async () => {
    mocks.GetRepoRoot.mockResolvedValue("/repo/mmd/SceneModel");
    mocks.ScanModelEntriesFiltered.mockResolvedValue([
      { Name: "a.pmx", Path: "/repo/mmd/SceneModel/场景1/a.pmx", Size: 1, ModTime: 1 },
    ]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("EntityPlayer", "SceneModel");
    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("SceneModel");
    expect(mocks.ScanModelEntriesFiltered).toHaveBeenCalledWith(
      "/repo/mmd/SceneModel",
      "SceneModel",
      "",
      "场景模型",
    );
    expect(r.filesRoot).toBe("/repo/mmd/SceneModel");
  });

  it("无 subdir 时直接用 rtype 查表", async () => {
    mocks.GetRepoRoot.mockResolvedValue("/repo/ysm");
    mocks.ScanModelEntriesFiltered.mockResolvedValue([]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("ysm");
    expect(mocks.ScanModelEntriesFiltered).toHaveBeenCalledWith(
      "/repo/ysm",
      "ysm",
      "",
      "YSM模型",
    );
    expect(r.filesRoot).toBe("/repo/ysm");
  });
});
