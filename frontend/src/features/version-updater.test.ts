// ===== 版本更新检查测试 =====
// 覆盖：频次限制、静默检查成功/失败、手动检查（modalConfirm 确认/取消、下载失败 toast）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    CheckUpdate: vi.fn(),
    DoUpdate: vi.fn(),
    RestartApplication: vi.fn(),
    modalConfirm: vi.fn(),
    modalProgress: vi.fn(),
    progressHandle: { update: vi.fn(), close: vi.fn() },
    eventsOn: vi.fn(),
  };
  return { mocks };
});

vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    CheckUpdate: mocks.CheckUpdate,
    DoUpdate: mocks.DoUpdate,
    RestartApplication: mocks.RestartApplication,
  }),
}));

vi.mock("../utils/dom/dialogs/modal.ts", () => ({
  esc: (s: unknown): string => String(s),
  modalConfirm: mocks.modalConfirm,
  modalProgress: mocks.modalProgress,
}));

vi.mock("@wailsio/runtime", () => ({
  Events: { On: mocks.eventsOn },
}));

vi.mock("../utils/dom/errors.ts", () => ({
  friendlyError: (e: unknown): string =>
    e instanceof Error ? e.message : String(e),
}));

const CHECK_KEY = "ysm_lastUpdateCheck";

let cleanups: Array<() => void> = [];
let unsubSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
  localStorage.clear();
  mocks.CheckUpdate.mockResolvedValue({
    available: true,
    latest: "v2",
    current: "v1",
  });
  mocks.DoUpdate.mockResolvedValue("success");
  mocks.modalConfirm.mockResolvedValue(true);
  // 进度弹窗默认返回句柄；update:progress 监听默认返回注销函数
  unsubSpy = vi.fn();
  mocks.modalProgress.mockReturnValue(mocks.progressHandle);
  mocks.eventsOn.mockReturnValue(unsubSpy);
  // 默认超过 6h 频次限制
  localStorage.setItem(CHECK_KEY, "0");
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

function spyToasts() {
  const toasts: Array<{ msg: string; type: string; click?: () => void }> = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string; click?: () => void })),
  );
  return toasts;
}

describe("checkUpdateSilent", () => {
  it("频次限制内（6h 内）→ 跳过检查", async () => {
    localStorage.setItem(CHECK_KEY, String(Date.now()));
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await checkUpdateSilent();
    expect(mocks.CheckUpdate).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it("有新版本 → 发可点击 toast 并记录检查时间", async () => {
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await checkUpdateSilent();

    expect(mocks.CheckUpdate).toHaveBeenCalledTimes(1);
    expect(toasts.some((t) => t.msg.includes("发现新版本 v2") && typeof t.click === "function")).toBe(true);
    expect(localStorage.getItem(CHECK_KEY)).not.toBe("0");
  });

  it("静默 toast 点击 → modalConfirm → 下载 → 重启（贯通链路）", async () => {
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await checkUpdateSilent();

    const t = toasts.find((x) => typeof x.click === "function");
    expect(t).toBeTruthy();
    t!.click!();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.modalConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: "发现新版本", okText: "⬇️ 下载更新" }));
    expect(mocks.DoUpdate).toHaveBeenCalled();
    expect(mocks.RestartApplication).toHaveBeenCalled();
  });

  it("无新版本 → 不发 toast 但记录检查时间", async () => {
    mocks.CheckUpdate.mockResolvedValue({ available: false, latest: "v1", current: "v1" });
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await checkUpdateSilent();
    expect(toasts).toHaveLength(0);
    expect(localStorage.getItem(CHECK_KEY)).not.toBe("0");
  });

  it("CheckUpdate 抛错 → 静默失败不阻塞", async () => {
    mocks.CheckUpdate.mockRejectedValue(new Error("net down"));
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await expect(checkUpdateSilent()).resolves.toBeUndefined();
    expect(toasts).toHaveLength(0);
  });

  it("localStorage 损坏为非数字 → 视为未检查过，不永久禁用", async () => {
    localStorage.setItem(CHECK_KEY, "abc"); // parseInt → NaN
    const toasts = spyToasts();
    const { checkUpdateSilent } = await import("./version-updater.ts");
    await checkUpdateSilent();
    expect(mocks.CheckUpdate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHECK_KEY)).not.toBe("abc"); // 检查成功后重写
  });
});

describe("initVersionUpdater（手动检查）", () => {
  async function setupRoot(): Promise<{ btn: HTMLButtonElement }> {
    // initVersionUpdater 只接受 Document | ShadowRoot（root.getElementById），需挂真实文档
    document.body.innerHTML = '<button id="set-check-update">🔄 检查更新</button>';
    const btn = document.body.querySelector<HTMLButtonElement>("#set-check-update")!;
    const { initVersionUpdater } = await import("./version-updater.ts");
    initVersionUpdater(document);
    return { btn };
  }

  it("无可用更新 → success toast 提示已是最新，按钮恢复", async () => {
    mocks.CheckUpdate.mockResolvedValue({ available: false, latest: "v1", current: "v1" });
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("已是最新版本") && t.type === "success")).toBe(true);
    expect(btn.textContent).toBe("🔄 检查更新");
    expect(btn.disabled).toBe(false);
  });

  it("有可用更新且确认 → 执行下载并重启", async () => {
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.modalConfirm).toHaveBeenCalled();
    expect(mocks.DoUpdate).toHaveBeenCalledWith("", "");
    expect(mocks.RestartApplication).toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it("确认后打开进度弹窗并注册 update:progress 监听，完成后注销+关闭", async () => {
    spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // 下载开始：打开只读进度弹窗 + 注册 update:progress
    expect(mocks.modalProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: "正在更新" }),
    );
    expect(mocks.eventsOn).toHaveBeenCalledWith("update:progress", expect.any(Function));

    // 下载完成：注销监听 + 关闭弹窗
    await new Promise((r) => setTimeout(r, 0));
    expect(unsubSpy).toHaveBeenCalled();
    expect(mocks.progressHandle.close).toHaveBeenCalled();
  });

  it("update:progress 事件驱动进度弹窗更新", async () => {
    let captured: ((e: { data: unknown[] }) => void) | null = null;
    mocks.eventsOn.mockImplementation(
      (_name: string, cb: (e: { data: unknown[] }) => void) => {
        captured = cb;
        return unsubSpy;
      },
    );
    spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Go 侧 Emit 多参打包为数组 → e.data 解构
    captured!({ data: [5242880, 10485760] });
    expect(mocks.progressHandle.update).toHaveBeenCalledWith(5242880, 10485760);
  });

  it("有可用更新但用户取消 → 不下载", async () => {
    mocks.modalConfirm.mockResolvedValue(false);
    spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.DoUpdate).not.toHaveBeenCalled();
  });

  it("下载失败 → error toast（含底层错误信息），按钮恢复", async () => {
    mocks.DoUpdate.mockRejectedValue(new Error("磁盘已满"));
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("更新失败: 磁盘已满"))).toBe(true);
    expect(btn.textContent).toBe("🔄 检查更新");
  });

  it("DoUpdate 返回非 success 字符串 → error toast 透传 Go 错误", async () => {
    mocks.DoUpdate.mockResolvedValue("download failed");
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("download failed"))).toBe(true);
    expect(btn.disabled).toBe(false);
  });

  it("RestartApplication reject → error toast 且按钮恢复", async () => {
    mocks.RestartApplication.mockRejectedValue(new Error("restart fail"));
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("restart fail"))).toBe(true);
    expect(btn.textContent).toBe("🔄 检查更新");
    expect(btn.disabled).toBe(false);
  });

  it("CheckUpdate 抛错 → error toast", async () => {
    mocks.CheckUpdate.mockRejectedValue(new Error("API 500"));
    const toasts = spyToasts();
    const { btn } = await setupRoot();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("API 500"))).toBe(true);
  });
});
