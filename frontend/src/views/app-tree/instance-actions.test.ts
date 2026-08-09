// ===== 整合包右键操作测试 =====
// 覆盖：instance:install（安装到整合包）/ instance:sync（同步到仓库）成功与失败分支
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import type { ToastPayload } from "../../bus.ts";

const { appMock, requireMcRootMock } = vi.hoisted(() => {
  const appMock = {
    SelectDirectory: vi.fn(),
    LoadAppConfig: vi.fn(),
    ListVersionInstances: vi.fn(),
    InstallModelWithOverlay: vi.fn(),
    GetRepoRoot: vi.fn(),
    SyncCustomToRepo: vi.fn(),
    AddImportLog: vi.fn(),
  };
  return { appMock, requireMcRootMock: vi.fn() };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue(appMock),
}));
vi.mock("../../core/handlers/require-mcroot.ts", () => ({
  requireMcRoot: requireMcRootMock,
}));

import { initInstanceActions } from "./instance-actions.ts";

// vm 在 handler 中未被引用，传空对象即可
const vm = {} as never;

let unsubs: Array<() => void> = [];
let allToasts: ToastPayload[] = [];
let toastOff: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  unsubs = initInstanceActions(vm);
  allToasts = [];
  // bus.emit 同步派发——必须提前注册持久监听收集，事后注册收不到
  toastOff = bus.on("toast:show", (p) => allToasts.push(p as ToastPayload));
  // 默认值
  appMock.SelectDirectory.mockResolvedValue(null);
  appMock.LoadAppConfig.mockResolvedValue({ mcRoot: "/mc" });
  appMock.ListVersionInstances.mockResolvedValue([]);
  appMock.InstallModelWithOverlay.mockResolvedValue(true);
  appMock.GetRepoRoot.mockResolvedValue("/repo");
  appMock.SyncCustomToRepo.mockResolvedValue(3);
  requireMcRootMock.mockResolvedValue("/mc");
});

afterEach(() => {
  toastOff();
  unsubs.forEach((fn) => fn());
});

describe("instance:install 安装到整合包", () => {
  it("成功 → InstallModelWithOverlay + AddImportLog + stats:refresh", async () => {
    appMock.SelectDirectory.mockResolvedValue("/pick/某目录");
    appMock.ListVersionInstances.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    const refreshed: number[] = [];
    const off = bus.on("stats:refresh", () => refreshed.push(1));

    bus.emit("instance:install", { name: "包A" });
    await vi.waitFor(() => expect(appMock.InstallModelWithOverlay).toHaveBeenCalled());

    expect(appMock.InstallModelWithOverlay).toHaveBeenCalledWith(
      "/pick/某目录",
      "/mc/versions/包A",
    );
    // addImportLog 口径：modelName=整合包名、source=用户选择目录、target=整合包目录
    expect(appMock.AddImportLog).toHaveBeenCalledWith(
      "包A",
      "/pick/某目录",
      "/mc/versions/包A",
      0,
      "success",
      "安装成功",
    );
    expect(refreshed.length).toBeGreaterThan(0);
    off();
  });

  it("未配置游戏目录 → warn toast，不调 InstallModelWithOverlay", async () => {
    appMock.SelectDirectory.mockResolvedValue("/pick/x");
    appMock.LoadAppConfig.mockResolvedValue({ mcRoot: "" });
    bus.emit("instance:install", { name: "包A" });
    await vi.waitFor(() => {
      const ts = allToasts;
      expect(ts.some((t) => t.type === "warn" && t.msg.includes("游戏目录"))).toBe(true);
    });
    expect(appMock.InstallModelWithOverlay).not.toHaveBeenCalled();
  });

  it("未找到整合包目录 → error toast", async () => {
    appMock.SelectDirectory.mockResolvedValue("/pick/x");
    appMock.ListVersionInstances.mockResolvedValue([
      { Name: "包B", CustomDir: "/mc/versions/包B" },
    ]);
    bus.emit("instance:install", { name: "包A" });
    await vi.waitFor(() => {
      const ts = allToasts;
      expect(ts.some((t) => t.type === "error" && t.msg.includes("整合包目录"))).toBe(true);
    });
  });

  it("InstallModelWithOverlay 抛错 → friendlyError toast", async () => {
    appMock.SelectDirectory.mockResolvedValue("/pick/x");
    appMock.ListVersionInstances.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    appMock.InstallModelWithOverlay.mockRejectedValue(new Error("EACCES: permission denied"));
    bus.emit("instance:install", { name: "包A" });
    await vi.waitFor(() => {
      const ts = allToasts;
      expect(ts.some((t) => t.type === "error")).toBe(true);
    });
  });
});

describe("instance:sync 同步到仓库", () => {
  it("成功 → SyncCustomToRepo + toast 含上传数", async () => {
    appMock.ListVersionInstances.mockResolvedValue([
      { Name: "包A", CustomDir: "/mc/versions/包A" },
    ]);
    bus.emit("instance:sync", { name: "包A" });
    await vi.waitFor(() => expect(appMock.SyncCustomToRepo).toHaveBeenCalled());

    expect(appMock.SyncCustomToRepo).toHaveBeenCalledWith(
      "/mc/versions/包A",
      "/repo",
    );
    const ts = allToasts;
    expect(ts.some((t) => t.type === "success" && t.msg.includes("3"))).toBe(true);
  });

  it("缺少 mcRoot 或仓库根 → warn toast，不调 SyncCustomToRepo", async () => {
    requireMcRootMock.mockResolvedValue("/mc");
    appMock.GetRepoRoot.mockResolvedValue("");
    bus.emit("instance:sync", { name: "包A" });
    await vi.waitFor(() => {
      const ts = allToasts;
      expect(ts.some((t) => t.type === "warn" && t.msg.includes("配置路径"))).toBe(true);
    });
    expect(appMock.SyncCustomToRepo).not.toHaveBeenCalled();
  });
});

