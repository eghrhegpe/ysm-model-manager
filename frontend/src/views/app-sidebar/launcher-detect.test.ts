// ===== launcher-detect（实例页空态版）单元测试 =====
// 自 settings/launcher-detection.test.ts 搬家适配：装配逻辑（按钮注入/MutationObserver）
// 随设置页版删除不再覆盖，检测流程各分支语义保持等价（happy-dom + mock 桥）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { bus, type BusEvents } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";

const { getAppMock, pickDirMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  pickDirMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/dom/directory-picker.ts", () => ({ pickDirectory: pickDirMock }));

import { runLauncherDetect, runMcSearch } from "./launcher-detect.ts";

type MockFn = ReturnType<typeof vi.fn>;

/** getApp mock 返回的桥绑定（配置读写 + 实例检测 + 资源根设置） */
function mockApp(over: Record<string, MockFn> = {}) {
  const m: Record<string, MockFn> = {
    LoadAppConfig: vi.fn().mockResolvedValue({
      filesRoot: "/files",
      resourcepackRoot: "/rp",
      mcRoot: "/old-mc",
      linkMode: "copy",
    }),
    DetectLauncherInstances: vi.fn().mockResolvedValue([]),
    SetResourceRoot: vi.fn().mockResolvedValue(undefined),
    SaveAppConfig: vi.fn().mockResolvedValue(undefined),
    GetMinecraftPaths: vi.fn().mockResolvedValue([]),
    ...over,
  };
  getAppMock.mockResolvedValue(m);
  return m;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 监听 bus 事件收集载荷（测试结束 off 防幽灵监听器） */
function watchBus<K extends keyof BusEvents>(event: K): {
  events: BusEvents[K][];
  off: () => void;
} {
  const events: BusEvents[K][] = [];
  const off = bus.on(event, (p) => events.push(p));
  return { events, off };
}

function makeInstance(over: Record<string, unknown> = {}) {
  return {
    launcher: "HMCL",
    name: "Instance One",
    gameVersion: "1.20.1",
    gameRoot: "/mc/root",
    gameDir: "/mc/game",
    customDir: "/mc/custom",
    exists: true,
    ...over,
  };
}

/** runLauncherDetect 触发后等待实例选择器弹层出现 */
async function openPicker(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    // modalPicker 统一弹窗脚手架：弹层根（行列表 / 取消按钮 / footer 表单均在层内）
    const el = document.querySelector<HTMLElement>("[data-testid='dlg-overlay']");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("runLauncherDetect", () => {
  it("用户取消目录选择 → 不检测、不保存、无 toast", async () => {
    const app = mockApp();
    pickDirMock.mockResolvedValue(null);
    const { events: toasts, off } = watchBus("toast:show");
    try {
      await runLauncherDetect();
      expect(app.DetectLauncherInstances).not.toHaveBeenCalled();
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(0);
    } finally {
      off();
    }
  });

  it("未发现实例 → warn toast，不弹选择器、不保存", async () => {
    const app = mockApp(); // DetectLauncherInstances → []
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      await runLauncherDetect();
      expect(app.DetectLauncherInstances).toHaveBeenCalledWith("/picked");
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toEqual([
        { msg: t("launcher.detect.noInstances"), duration: TOAST_MS.normal, type: "warn" },
      ]);
      expect(document.querySelector("[data-testid='dlg-overlay']")).toBeNull();
    } finally {
      off();
    }
  });

  it("实例检测失败 → error toast（❌ 统一出口）", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockRejectedValue(new Error("detect boom")),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      await runLauncherDetect();
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect((toasts[0].msg || "").startsWith("❌")).toBe(true);
    } finally {
      off();
    }
  });

  it("用户取消实例选择 → 不保存、无成功 toast、弹层关闭", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([makeInstance()]),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      const p = runLauncherDetect();
      const picker = await openPicker();
      (picker.querySelector("[data-testid='dlg-cancel']") as HTMLElement).click();
      await p;
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(app.SetResourceRoot).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(0);
      expect(document.querySelector("[data-testid='dlg-overlay']")).toBeNull();
    } finally {
      off();
    }
  });

  it("完整成功路径：esc 转义 + 保存 mcRoot + SetResourceRoot(ysm) + stats:refresh + 成功 toast", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([
        makeInstance({ name: "Fab<b>ulous" }),
        makeInstance({ launcher: "PCL", name: "Two", gameRoot: "/mc/root2", customDir: "/mc/custom2" }),
      ]),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off: offToast } = watchBus("toast:show");
    const { events: stats, off: offStats } = watchBus("stats:refresh");
    try {
      const p = runLauncherDetect();
      const picker = await openPicker();
      // esc 转义：实例名中的 HTML 注入片段被转义后才进入弹层
      expect(picker.innerHTML).toContain("Fab&lt;b&gt;ulous");
      (picker.querySelector('[data-idx="0"]') as HTMLElement).click();
      await p;

      // SaveAppConfig 五参（filesRoot/resourcepackRoot 原样回写，theme 缺省 dark）
      expect(app.SaveAppConfig).toHaveBeenCalledTimes(1);
      expect(app.SaveAppConfig).toHaveBeenCalledWith("/files", "/rp", "/mc/root", "copy", "dark");
      // 默认勾选「用作 YSM 根目录」→ SetResourceRoot
      expect(app.SetResourceRoot).toHaveBeenCalledTimes(1);
      expect(app.SetResourceRoot).toHaveBeenCalledWith("ysm", "/mc/custom");
      // 副作用：全局刷新 + 成功 toast + 弹层关闭
      expect(stats).toHaveLength(1);
      expect(toasts).toEqual([
        { msg: t("launcher.detect.success", { launcher: "HMCL", version: "1.20.1" }), duration: 3000, type: "success" },
      ]);
      expect(document.querySelector("[data-testid='dlg-overlay']")).toBeNull();
    } finally {
      offToast();
      offStats();
    }
  });

  it("取消「用作 YSM 根目录」勾选 → 只保存 mcRoot，不写 ysm 资源根", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([makeInstance()]),
    });
    pickDirMock.mockResolvedValue("/picked");
    const p = runLauncherDetect();
    const picker = await openPicker();
    (picker.querySelector("[data-launcher-default]") as HTMLInputElement).checked = false;
    (picker.querySelector('[data-idx="0"]') as HTMLElement).click();
    await p;
    expect(app.SaveAppConfig).toHaveBeenCalledTimes(1);
    expect(app.SaveAppConfig).toHaveBeenCalledWith("/files", "/rp", "/mc/root", "copy", "dark");
    expect(app.SetResourceRoot).not.toHaveBeenCalled();
  });

  it("SetResourceRoot 失败 → 回滚保存 previousMcRoot + error toast", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([makeInstance()]),
      SetResourceRoot: vi.fn().mockRejectedValue(new Error("set-root boom")),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      const p = runLauncherDetect();
      const picker = await openPicker();
      (picker.querySelector('[data-idx="0"]') as HTMLElement).click();
      await p;
      // 第一次保存 mcRoot=/mc/root；失败后回滚 previousMcRoot=/old-mc
      expect(app.SaveAppConfig).toHaveBeenCalledTimes(2);
      expect(app.SaveAppConfig.mock.calls[0][2]).toBe("/mc/root");
      expect(app.SaveAppConfig.mock.calls[1][2]).toBe("/old-mc");
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
    } finally {
      off();
    }
  });
});

describe("runMcSearch", () => {
  it("未找到游戏目录 → warn 提示，不保存", async () => {
    const app = mockApp(); // GetMinecraftPaths → []
    const { events: toasts, off } = watchBus("toast:show");
    try {
      await runMcSearch();
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("warn");
    } finally {
      off();
    }
  });

  it("单一直达：唯一路径直接保存 + stats:refresh + 成功 toast", async () => {
    const app = mockApp({
      GetMinecraftPaths: vi.fn().mockResolvedValue(["/auto/minecraft"]),
    });
    const { events: toasts, off: offToast } = watchBus("toast:show");
    const { events: stats, off: offStats } = watchBus("stats:refresh");
    try {
      await runMcSearch();
      expect(app.SaveAppConfig).toHaveBeenCalledWith("/files", "/rp", "/auto/minecraft", "copy", "dark");
      expect(stats).toHaveLength(1);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("success");
    } finally {
      offToast();
      offStats();
    }
  });
});
