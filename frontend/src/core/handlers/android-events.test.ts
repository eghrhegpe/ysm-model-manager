// @vitest-environment node
// ===== Android 系统事件消费回归测试（P1-1 修复闸门）=====
// 验证 MainActivity 经 WailsBridge.emitEvent(CustomEvent 通道) 发出的事件名，
// 能被前端 registerAndroidEvents 正确消费且处理逻辑正确。
// 关键回归点：
//  1. 事件名须与 Java 发射名逐字匹配（android:back / storage:permissionGranted / ...）
//  2. emitEvent 通道下前端收到 string payload，typeof raw !== "string" 守卫不得误伤
//  3. 非 string payload（异常通道）不崩溃、不静默失效
//  4. 返回键：有活动弹窗时消费返回、不触发退出提示
//  5. storage:permissionGranted → tree:reload + stats:refresh 各一次
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { zhCN } from "../../core/i18n/locales/zh-CN.ts";

type Evt = { data?: unknown };
const { handlers } = vi.hoisted(() => {
  const handlers: Record<string, ((e?: Evt) => void) | undefined> = {};
  return { handlers };
});

// 覆盖 test-setup.ts 的空 Events.On，改为可捕获回调
vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: (name: string, cb: (e?: Evt) => void) => {
      handlers[name] = cb;
      return () => {
        delete handlers[name];
      };
    },
  },
  Window: { Show: vi.fn(), Hide: vi.fn(), SetTitle: vi.fn(), OpenDevTools: vi.fn(), Reload: vi.fn() },
}));

vi.mock("../../features/dialogs/modal.ts", () => ({
  closeActiveDialog: vi.fn().mockReturnValue(false),
}));

vi.mock("../../utils/dom/android-bridge.ts", () => ({
  emitAndroidBack: vi.fn().mockReturnValue(false),
}));

import { closeActiveDialog } from "../../features/dialogs/modal.ts";

let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  for (const k of Object.keys(handlers)) delete handlers[k];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

async function register(): Promise<void> {
  const { registerAndroidEvents } = await import("./android-events.ts");
  const unsubs: Array<() => void> = [];
  registerAndroidEvents(unsubs);
  cleanups.push(...unsubs);
}

function spyBus() {
  const toasts: Array<{ msg: string; type?: string }> = [];
  const reloaded: string[] = [];
  const refreshed: string[] = [];
  cleanups.push(
    bus.on("toast:show", (t) => toasts.push(t as { msg: string; type?: string })),
    bus.on("tree:reload", () => reloaded.push("tree:reload")),
    bus.on("stats:refresh", () => refreshed.push("stats:refresh")),
  );
  return { toasts, reloaded, refreshed };
}

function fire(name: string, e?: Evt): void {
  const h = handlers[name];
  if (!h) throw new Error(`事件 ${name} 未注册`);
  h(e);
}

describe("registerAndroidEvents — 事件名注册", () => {
  it("注册全部 6 个 Android 事件回调（与 Java 发射名逐字匹配）", async () => {
    await register();
    for (const name of [
      "android:back",
      "android:NetworkChanged",
      "android:ScreenLocked",
      "storage:permissionGranted",
      "android:BatteryChanged",
      "android:ThemeChanged",
    ]) {
      expect(handlers[name], `事件 ${name} 未注册`).toBeTypeOf("function");
    }
  });
});

describe("android:back", () => {
  it("无活动弹窗 → 发 info toast 提示再按一次退出", async () => {
    await register();
    const { toasts } = spyBus();
    fire("android:back");
    expect(toasts).toContainEqual(
      expect.objectContaining({ msg: zhCN["android.backExit"], type: "info" }),
    );
  });

  it("有活动弹窗 → 关闭弹窗并消费返回，不发 toast", async () => {
    (closeActiveDialog as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    await register();
    const { toasts } = spyBus();
    fire("android:back");
    expect(closeActiveDialog).toHaveBeenCalledTimes(1);
    expect(toasts.length).toBe(0);
  });
});

describe("storage:permissionGranted", () => {
  it("触发 tree:reload + stats:refresh 各一次", async () => {
    await register();
    const { reloaded, refreshed } = spyBus();
    fire("storage:permissionGranted");
    expect(reloaded.length).toBe(1);
    expect(refreshed.length).toBe(1);
  });
});

describe("android:NetworkChanged", () => {
  it("connected=false（JSON 字符串 payload）→ 发 warn 离线 toast", async () => {
    await register();
    const { toasts } = spyBus();
    fire("android:NetworkChanged", { data: '{"connected":false}' });
    expect(toasts).toContainEqual(
      expect.objectContaining({ msg: zhCN["android.networkOffline"], type: "warn" }),
    );
  });

  it("connected=true（JSON 字符串 payload）→ 不发 toast", async () => {
    await register();
    const { toasts } = spyBus();
    fire("android:NetworkChanged", { data: '{"connected":true}' });
    expect(toasts.length).toBe(0);
  });

  it("非 string payload（异常通道）→ 不崩溃、不发 toast（守卫生效）", async () => {
    await register();
    const { toasts } = spyBus();
    expect(() => fire("android:NetworkChanged", { data: { connected: false } })).not.toThrow();
    expect(toasts.length).toBe(0);
  });
});

describe("预留事件（ScreenLocked / BatteryChanged / ThemeChanged）", () => {
  it("调用不抛错", async () => {
    await register();
    expect(() => {
      fire("android:ScreenLocked");
      fire("android:BatteryChanged", { data: "{}" });
      fire("android:ThemeChanged", { data: "{}" });
    }).not.toThrow();
  });
});
