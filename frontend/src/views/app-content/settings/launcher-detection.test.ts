// ===== launcher-detection 单元测试（happy-dom：需要 DOM 注入 + 实例选择器交互）=====
// 装配逻辑：registerLauncherDetection 注入按钮 → handleLauncherDetect 各分支。
// 模式 4（vitest-env-switch）：mock getApp 阻断 Wails 桥；mock pickDirectory
// 阻断目录选择器（同时切断 android-bridge / platform-web import 链）。
// store.ts / path-cards.ts 保持真实：SaveAppConfig 参数与 cfg 回写均走真实代码路径。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus, type BusEvents } from "../../../bus.ts";

const { getAppMock, pickDirMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  pickDirMock: vi.fn(),
}));
// 模式 4：app.ts 在函数体内访问 window.go，测试不可真跑动态 import 链
vi.mock("../../../backend/app.ts", () => ({ getApp: getAppMock }));
// 模式 3：mock 顶层模块阻断 import 链（directory-picker → android-bridge 等）
vi.mock("../../../utils/dom/directory-picker.ts", () => ({ pickDirectory: pickDirMock }));

import { registerLauncherDetection } from "./launcher-detection.ts";
import {
  resetSettingsStore,
  cfg,
  cardRefreshers,
  isBusy,
  setBusy,
  type SettingsCfg,
} from "./store.ts";

/** 构造 SettingsCfg（字段以 store/saveCfg/handleLauncherDetect 消费面为准） */
function makeCfg(over: Record<string, unknown> = {}): SettingsCfg {
  return {
    filesRoot: "/files",
    resourcepackRoot: "/rp",
    mcRoot: "/old-mc",
    linkMode: "copy",
    ...over,
  } as unknown as SettingsCfg;
}

type MockFn = ReturnType<typeof vi.fn>;

/** getApp mock 返回的桥绑定（saveCfg 重读/保存 + 实例检测 + SetResourceRoot） */
function mockApp(over: Record<string, MockFn> = {}) {
  const m: Record<string, MockFn> = {
    LoadAppConfig: vi.fn().mockResolvedValue(makeCfg()),
    DetectLauncherInstances: vi.fn().mockResolvedValue([]),
    SetResourceRoot: vi.fn().mockResolvedValue(undefined),
    SaveAppConfig: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  getAppMock.mockResolvedValue(m);
  return m;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 搭建 app-content host + shadow 内 anchor（set-mc-detect），返回 shadow root */
function setupSettingsDom(): ShadowRoot {
  const host = document.createElement("app-content");
  const root = host.attachShadow({ mode: "open" });
  // anchor 须有 Element 父节点（installIntoSettings 用 anchor.parentElement.insertBefore，
  // 直挂 ShadowRoot 时 parentElement 为 null）——对齐真实设置页 DOM 层级
  const wrap = document.createElement("div");
  const anchor = document.createElement("button");
  anchor.id = "set-mc-detect";
  wrap.appendChild(anchor);
  root.appendChild(wrap);
  document.body.appendChild(host);
  return root;
}

/** 注册注入逻辑并等待 queueMicrotask(attach) 完成 */
async function injectButton(): Promise<ShadowRoot> {
  const root = setupSettingsDom();
  registerLauncherDetection();
  await flush();
  return root;
}

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

/** 点击注入按钮后等待实例选择器弹层出现 */
async function openPicker(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-launcher-picker]");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

// 文件顶层 afterEach：registerLauncherDetection 依赖全局 querySelector("app-content")，
// 旧用例的 host 残留会让 attach 命中旧 shadow root（防重入守卫提前 return）——
// 每个用例后必须清空 body，保证「同一时刻 body 只有一个 app-content」
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("registerLauncherDetection", () => {
  it("在 set-mc-detect 锚点前注入检测按钮", async () => {
    const root = await injectButton();
    const btn = root.getElementById("set-launcher-detect");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("🎮 HMCL / PCL");
    expect(root.getElementById("set-mc-detect")!.previousElementSibling).toBe(btn);
  });

  it("已注入时防重入（set-launcher-detect 已存在则跳过）", async () => {
    const root = await injectButton();
    registerLauncherDetection(); // 第二次注册 → installIntoSettings 命中防重入守卫
    await flush();
    expect(root.querySelectorAll("#set-launcher-detect")).toHaveLength(1);
  });

  it("无 set-mc-detect 锚点 → 不注入", async () => {
    const host = document.createElement("app-content");
    const root = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);
    registerLauncherDetection();
    await flush();
    expect(root.getElementById("set-launcher-detect")).toBeNull();
  });
});

describe("handleLauncherDetect（经注入按钮点击触发）", () => {
  let root: ShadowRoot;
  let btn: HTMLElement;

  beforeEach(() => {
    resetSettingsStore(makeCfg());
  });

  beforeEach(async () => {
    root = await injectButton();
    btn = root.getElementById("set-launcher-detect") as HTMLElement;
  });

  it("busy 中点击 → 直接忽略（不选目录、不检测，busy 保持 true）", async () => {
    const app = mockApp();
    setBusy(true);
    btn.click();
    await flush();
    expect(pickDirMock).not.toHaveBeenCalled();
    expect(app.DetectLauncherInstances).not.toHaveBeenCalled();
    // 直接 return 发生在 try/finally 之前，busy 不会被 finally 释放
    expect(isBusy()).toBe(true);
    setBusy(false); // 手动复位，避免污染后续用例
  });

  it("用户取消目录选择 → 不检测、不保存、无 toast、busy 释放", async () => {
    const app = mockApp();
    pickDirMock.mockResolvedValue(null);
    const { events: toasts, off } = watchBus("toast:show");
    try {
      btn.click();
      await flush();
      expect(app.DetectLauncherInstances).not.toHaveBeenCalled();
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(0);
      expect(isBusy()).toBe(false);
    } finally {
      off();
    }
  });

  it("未发现实例 → warn toast，不弹选择器、不保存", async () => {
    const app = mockApp(); // DetectLauncherInstances → []
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      btn.click();
      await flush();
      expect(app.DetectLauncherInstances).toHaveBeenCalledWith("/picked");
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(toasts).toEqual([
        { msg: "No HMCL/PCL Minecraft instance found", duration: 3500, type: "warn" },
      ]);
      expect(document.querySelector("[data-launcher-picker]")).toBeNull();
      expect(isBusy()).toBe(false);
    } finally {
      off();
    }
  });

  it("实例检测失败 → error toast（toastError 统一出口）", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockRejectedValue(new Error("detect boom")),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      btn.click();
      await flush();
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
      btn.click();
      const picker = await openPicker();
      (picker.querySelector("[data-launcher-cancel]") as HTMLElement).click();
      await flush();
      expect(app.SaveAppConfig).not.toHaveBeenCalled();
      expect(app.SetResourceRoot).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(0);
      expect(document.querySelector("[data-launcher-picker]")).toBeNull();
      expect(isBusy()).toBe(false);
    } finally {
      off();
    }
  });

  it("完整成功路径：转义实例名 + 保存 mcRoot + SetResourceRoot(ysm) + 刷新卡片 + 成功 toast", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([
        makeInstance({ name: "Fab<b>ulous" }),
        makeInstance({ launcher: "PCL", name: "Two", gameRoot: "/mc/root2", customDir: "/mc/custom2" }),
      ]),
    });
    pickDirMock.mockResolvedValue("/picked");
    const refreshSpy = vi.fn();
    cardRefreshers.push(refreshSpy);
    const { events: toasts, off: offToast } = watchBus("toast:show");
    const { events: stats, off: offStats } = watchBus("stats:refresh");
    try {
      btn.click();
      const picker = await openPicker();
      // esc 转义：实例名中的 HTML 注入片段被转义后才进入弹层
      expect(picker.innerHTML).toContain("Fab&lt;b&gt;ulous");
      (picker.querySelector('[data-launcher-instance="0"]') as HTMLElement).click();
      await flush();

      // saveCfg({ mcRoot }) → SaveAppConfig 五参（重读 latest + theme 缺省 dark）
      expect(app.SaveAppConfig).toHaveBeenCalledTimes(1);
      expect(app.SaveAppConfig).toHaveBeenCalledWith("/files", "/rp", "/mc/root", "copy", "dark");
      // 默认勾选「用作 YSM 根目录」→ SetResourceRoot + cfg 内存回写
      expect(app.SetResourceRoot).toHaveBeenCalledTimes(1);
      expect(app.SetResourceRoot).toHaveBeenCalledWith("ysm", "/mc/custom");
      expect(cfg.mcRoot).toBe("/mc/root");
      const mutableCfg = cfg as unknown as Record<string, unknown>;
      expect(mutableCfg.ysmRoot).toBe("/mc/custom");
      expect((mutableCfg.customRoots as Record<string, string>).ysm).toBe("/mc/custom");
      // 副作用：卡片刷新 + 全局刷新 + 成功 toast + 弹层关闭
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(stats).toHaveLength(1);
      expect(toasts).toEqual([
        { msg: "✅ HMCL · Minecraft 1.20.1", duration: 3000, type: "success" },
      ]);
      expect(document.querySelector("[data-launcher-picker]")).toBeNull();
      expect(isBusy()).toBe(false);
    } finally {
      offToast();
      offStats();
    }
  });

  it("取消「用作 YSM 根目录」勾选 → 只保存 mcRoot，不写 ysmRoot", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([makeInstance()]),
    });
    pickDirMock.mockResolvedValue("/picked");
    btn.click();
    const picker = await openPicker();
    (picker.querySelector("[data-launcher-default]") as HTMLInputElement).checked = false;
    (picker.querySelector('[data-launcher-instance="0"]') as HTMLElement).click();
    await flush();
    expect(app.SaveAppConfig).toHaveBeenCalledTimes(1);
    expect(app.SaveAppConfig).toHaveBeenCalledWith("/files", "/rp", "/mc/root", "copy", "dark");
    expect(app.SetResourceRoot).not.toHaveBeenCalled();
    expect((cfg as unknown as Record<string, unknown>).ysmRoot).toBeUndefined();
  });

  it("SetResourceRoot 失败 → 回滚保存 previousMcRoot + error toast", async () => {
    const app = mockApp({
      DetectLauncherInstances: vi.fn().mockResolvedValue([makeInstance()]),
      SetResourceRoot: vi.fn().mockRejectedValue(new Error("set-root boom")),
    });
    pickDirMock.mockResolvedValue("/picked");
    const { events: toasts, off } = watchBus("toast:show");
    try {
      btn.click();
      const picker = await openPicker();
      (picker.querySelector('[data-launcher-instance="0"]') as HTMLElement).click();
      await flush();
      // 第一次保存 mcRoot=/mc/root；失败后回滚 previousMcRoot=/old-mc
      expect(app.SaveAppConfig).toHaveBeenCalledTimes(2);
      expect(app.SaveAppConfig.mock.calls[0][2]).toBe("/mc/root");
      expect(app.SaveAppConfig.mock.calls[1][2]).toBe("/old-mc");
      expect(cfg.mcRoot).toBe("/old-mc");
      expect((cfg as unknown as Record<string, unknown>).ysmRoot).toBeUndefined();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect(isBusy()).toBe(false);
    } finally {
      off();
    }
  });
});
