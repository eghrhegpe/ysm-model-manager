// ===== app-modules.ts 启动装配测试（boot 级，2026-08-29 覆盖率补强）=====
// 兄弟文件 app-modules.test.ts 专测神桶拆分后的 theme-core 纯逻辑；app-modules
// 本体承载顶层副作用（服务注册 / 四视图装配 / 启动 IIFE / 系统主题跟随 /
// devtools 接线），import 即求值。本文件用 vi.resetModules + 动态 import 反复
// 求值本体，锁住各 try/catch 失败降级分支与事件接线。
// 依赖全部 mock（真链会拖入 Web Component / Wails 桥），断言走 hoisted spy；
// bus / registry / module-loader / storage 保持真实（它们是装配行为的观察点）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TOAST_MS } from "./utils/dom/toast-ms.ts";

// [治本] 文件级真实 timer 登记：boot 期间注册的所有 setTimeout 句柄（含 app-modules
// 顶层 IIFE 的 setTimeout(2000) 预取与 flush 泵的 setTimeout(0)）统一登记，afterEach
// 逐个 clearTimeout。vi.useFakeTimers() 只劫持新注册定时器、**不取消已挂起的真实
// 定时器**——上一用例 boot 残留的 real 2s timer 会在下一用例 await 间隙触发，污染
// mock 断言（竞态根因）；mockClear 只清调用记录不清时钟，是治标。此处治本。
const realTimerHandles = new Set<ReturnType<typeof setTimeout>>();

// [治本] 重装配用例（resetModules + 7 视图动态 import + 20 轮真实宏任务泵）在 CI
// 全量负载下真实耗时可能超过默认 5s testTimeout——放宽文件级上限至 20s。非掩盖：
// 真死锁会远超 20s 仍红；此放宽只吸收调度延迟造成的偶发超时。
vi.setConfig({ testTimeout: 20000 });

// ── hoisted mock 池（vi.mock factory 只能引用 hoisted 变量）──
const m = vi.hoisted(() => ({
  registerErrorDiary: vi.fn(),
  registerCoiServiceWorker: vi.fn(),
  prefetchStatsWorker: vi.fn(),
  initI18n: vi.fn(),
  checkUpdateSilent: vi.fn(),
  applyUIPrefs: vi.fn(),
  initTheme: vi.fn(),
  applyTheme: vi.fn(),
  normalizeTheme: vi.fn((t: string) => t),
  windowShow: vi.fn(),
  openDevTools: vi.fn(),
  // revealMainWindow 观察点：记录收到的 show 回调（模块内写死 () => Window.Show()）
  revealCalls: [] as unknown[],
  // app-nav 动态 import 失败开关（factory 内读取，resetModules 后重求值时生效）
  failNav: { value: false },
}));

// 动态 import 执行标记：证明 loadView 的 importer 箭头确实被调用
const loaded = vi.hoisted(() => ({ views: [] as string[] }));

vi.mock("./core/error-diary.ts", () => ({ registerErrorDiary: m.registerErrorDiary }));
vi.mock("./workers/coi-sw.ts", () => ({ registerCoiServiceWorker: m.registerCoiServiceWorker }));
vi.mock("./backend/browser-adapter.ts", () => ({ prefetchStatsWorker: m.prefetchStatsWorker }));
vi.mock("./core/i18n/locale.ts", () => ({ initI18n: m.initI18n }));
vi.mock("./features/version-updater.ts", () => ({ checkUpdateSilent: m.checkUpdateSilent }));
vi.mock("./views/app-content/settings/ui-prefs.ts", () => ({ applyUIPrefs: m.applyUIPrefs }));
vi.mock("./theme-core.ts", () => ({
  normalizeTheme: m.normalizeTheme,
  applyTheme: m.applyTheme,
  initTheme: m.initTheme,
}));
vi.mock("./backend/runtime.ts", () => ({
  Window: { Show: m.windowShow, OpenDevTools: m.openDevTools },
}));
// revealMainWindow 真身依赖 readyState/rAF——mock 成"直接调 show 并兜错"，
// 既触发模块内 () => Window.Show() 箭头，又让 boot 完成可观测
vi.mock("./startup-reveal.ts", () => ({
  revealMainWindow: async (show: () => void | Promise<void>) => {
    m.revealCalls.push(show);
    try {
      await show();
    } catch {
      // 真身对 show() 失败也是静默（web 模式无原生窗口）
    }
  },
}));

// ── 视图组件 mock（静态 2 + 动态 5）：factory 推 marker 证明 import 执行 ──
// 全部走 boot() 内 vi.doMock 而非 hoisted vi.mock：vitest 的 mock factory 求值
// 结果缓存独立于 vi.resetModules，成功一次后不再重跑 factory，marker 会失真；
// 每次重注册才能保证每次 boot 都真实执行动态 import。app-nav 额外受 m.failNav 控制。
const mockViews = () => {
  vi.doMock("./views/context-menu/index.ts", () => {
    loaded.views.push("context-menu");
    return {};
  });
  vi.doMock("./views/app-toast/index.ts", () => {
    loaded.views.push("app-toast");
    return {};
  });
  vi.doMock("./views/app-tree/index.ts", () => {
    loaded.views.push("app-tree");
    return {};
  });
  vi.doMock("./views/app-sidebar/index.ts", () => {
    loaded.views.push("app-sidebar");
    return {};
  });
  vi.doMock("./views/app-content/index.ts", () => {
    loaded.views.push("app-content");
    return {};
  });
  vi.doMock("./views/app-sync-manager/index.ts", () => {
    loaded.views.push("app-sync-manager");
    return {};
  });
  vi.doMock("./views/app-nav/index.ts", () => {
    // 失败开关打开 → 动态 import 拒绝，走模块内 catch → toast 降级
    if (m.failNav.value) throw new Error("nav boot fail");
    loaded.views.push("app-nav");
    return {};
  });
};

// ── boot 基建 ──
/** 泵任务队列：启动 IIFE 全链均为 mock；动态 import 拒绝路径可能跨宏任务，
 *  故微任务 50 轮 + 每轮插一个真实 setTimeout(0) 宏任务 tick（fake timers 用例除外） */
const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
  }
};
/** 纯微任务泵（fake timers 下宏任务被劫持，只能走微任务；成功路径全链 mock 足够） */
const flushMicro = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

/** resetModules 后重新求值 app-modules；先挂 bus toast 观察点再 import。
 *  视图 mock 每次重注册（见 mockViews），m.failNav 控制 app-nav 动态 import 是否失败。
 *  [治本] 真实 timer 登记仅在**真实计时器环境**（默认 flush）激活：spy 全局 setTimeout
 *  透传登记 app-modules 顶层 IIFE 的 setTimeout(2000) 预取句柄，import 完成立即
 *  mockRestore，afterEach 统一 clear 防跨用例竞态。fake timers 用例（microFlush）**不
 *  登记**：其 timer 是 fake 实现，advanceTimersByTimeAsync 已推进、useRealTimers 丢弃，
 *  且 spy×fake timers 的恢复链互相干扰（spyOn 保存/恢复的是 fake 实现，会把全局
 *  setTimeout 恢复错乱，导致后续用例 flush 泵挂起 20s 超时——实测主题跟随/devtools
 *  用例全挂）。 */
async function boot(opts: { microFlush?: boolean } = {}) {
  // [治本] vi.resetModules 清模块缓存但不清 document 上残留的 keydown listener；
  // 上一用例 _devMode=true 注册的匿名 listener 会跨用例残留，当本用例
  // dispatchEvent(F12) 时触发旧 Window.OpenDevTools 闭包 → m.openDevTools
  // 被调用 → 「未启用」断言失败。每次 boot 前用 unregisterDevtools 清旧 listener。
  try {
    const prev = await import("./app-modules.ts");
    prev.unregisterDevtools?.();
  } catch { /* 首次 import 无残留 */ }
  vi.resetModules();
  mockViews();
  const { bus } = await import("./bus.ts");
  const toasts: Array<{ msg: string; duration?: number; type?: string }> = [];
  bus.on("toast:show", (p) => toasts.push(p as { msg: string; duration?: number; type?: string }));
  let timerSpy: ReturnType<typeof vi.spyOn> | undefined;
  if (!opts.microFlush) {
    const origSetTimeout = globalThis.setTimeout;
    timerSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((...a: Parameters<typeof setTimeout>) => {
        const h = origSetTimeout(...a);
        realTimerHandles.add(h);
        return h;
      }) as typeof setTimeout);
  }
  try {
    await import("./app-modules.ts");
  } finally {
    timerSpy?.mockRestore();
  }
  await (opts.microFlush ? flushMicro() : flush());
  return { toasts };
}

/** 捕获系统主题跟随回调：包装 matchMedia 使 addEventListener(change) 可被记录 */
function captureThemeChange() {
  const cbs: Array<(e: { matches: boolean }) => void> = [];
  const orig = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation(((q: string) => {
    const mql = orig(q);
    const add = mql.addEventListener.bind(mql) as typeof mql.addEventListener;
    (mql as unknown as { addEventListener: typeof add }).addEventListener = (
      type: string,
      cb: never,
      opts?: never,
    ) => {
      if (type === "change") cbs.push(cb as (e: { matches: boolean }) => void);
      return add(type, cb, opts);
    };
    return mql;
  }) as typeof window.matchMedia);
  return cbs;
}

beforeEach(() => {
  vi.restoreAllMocks(); // 恢复上一用例的 matchMedia/console spy
  // resetAllMocks：clearAllMocks 不清实现，上一用例的 mockImplementation(throw) 会
  // 泄漏进后续 boot（stderr 噪声 + 分支串扰）
  vi.resetAllMocks();
  m.normalizeTheme.mockImplementation((t: string) => t);
  loaded.views.length = 0;
  m.revealCalls.length = 0;
  m.failNav.value = false;
  // 默认成功路径，失败路径用例内单独覆写
  m.initI18n.mockResolvedValue(undefined);
  m.initTheme.mockResolvedValue(undefined);
  m.checkUpdateSilent.mockResolvedValue(undefined);
  m.windowShow.mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  // [治本] 统一清理本用例登记的真实 timer：上一用例 IIFE 的 setTimeout(2000) 若不
  // 清掉，会跨用例残留（useFakeTimers 不取消已挂起真实定时器）——这正是竞态根因。
  for (const h of realTimerHandles) clearTimeout(h);
  realTimerHandles.clear();
});

describe("app-modules 启动装配", () => {
  it("装配全部视图（含动态 import 执行）", async () => {
    await boot();
    // registry.ts 已删（架构锐评 P1-2 修正版）：loadInstances/loadEntries 由
    // sidebar/tree 的 loader.ts 直连提供，无启动注册断言
    // 静态 2（context-menu/app-toast）+ loadView 4 + IIFE 内 app-nav
    expect([...loaded.views].sort()).toEqual([
      "app-content",
      "app-nav",
      "app-sidebar",
      "app-sync-manager",
      "app-toast",
      "app-tree",
      "context-menu",
    ]);
  });

  it("成功路径：各初始化按序执行且窗口 reveal（show 回调被真实调用）", async () => {
    await boot();
    expect(m.registerErrorDiary).toHaveBeenCalledTimes(1);
    expect(m.registerCoiServiceWorker).toHaveBeenCalledTimes(1);
    expect(m.initI18n).toHaveBeenCalledTimes(1);
    expect(m.initTheme).toHaveBeenCalledTimes(1);
    expect(m.applyUIPrefs).toHaveBeenCalledTimes(1);
    expect(m.checkUpdateSilent).toHaveBeenCalledTimes(1);
    // 调用顺序：error-diary → i18n → 主题 → ui-prefs
    expect(m.registerErrorDiary.mock.invocationCallOrder[0]).toBeLessThan(
      m.initI18n.mock.invocationCallOrder[0],
    );
    expect(m.initI18n.mock.invocationCallOrder[0]).toBeLessThan(
      m.initTheme.mock.invocationCallOrder[0],
    );
    expect(m.initTheme.mock.invocationCallOrder[0]).toBeLessThan(
      m.applyUIPrefs.mock.invocationCallOrder[0],
    );
    // finally：await appContentReady 后 reveal，show 回调（Window.Show）被调用
    expect(m.revealCalls).toHaveLength(1);
    expect(m.windowShow).toHaveBeenCalledTimes(1);
    expect(m.openDevTools).not.toHaveBeenCalled();
  });

  it("registerErrorDiary 抛错 → 警告不阻断启动", async () => {
    m.registerErrorDiary.mockImplementation(() => {
      throw new Error("diary down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toasts } = await boot();
    expect(warn).toHaveBeenCalledWith("[error-diary] 错误日志注册失败:", expect.any(Error));
    expect(m.revealCalls).toHaveLength(1);
    expect(toasts).toHaveLength(0); // error-diary 失败不 toast，仅 warn
  });

  it("initI18n 失败 → error toast（⚠️ 前缀 + long 时长）且启动继续", async () => {
    m.initI18n.mockRejectedValue(new Error("i18n down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toasts } = await boot();
    expect(warn).toHaveBeenCalledWith("[i18n] 初始化失败，界面将缺翻译:", expect.any(Error));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain("⚠️");
    expect(toasts[0].msg).toContain("语言资源加载失败");
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].duration).toBe(TOAST_MS.long);
    expect(m.revealCalls).toHaveLength(1);
  });

  it("app-nav 动态加载失败 → error toast 且不阻塞其余装配", async () => {
    m.failNav.value = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toasts } = await boot();
    expect(loaded.views).not.toContain("app-nav");
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain("❌");
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].duration).toBe(TOAST_MS.long);
    // 其余视图与 reveal 不受影响
    expect(loaded.views).toContain("app-content");
    expect(m.revealCalls).toHaveLength(1);
  });

  it("initTheme 失败 → error toast 主题初始化失败", async () => {
    m.initTheme.mockRejectedValue(new Error("theme down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toasts } = await boot();
    expect(warn).toHaveBeenCalledWith("[theme] 主题初始化失败:", expect.any(Error));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain("主题初始化失败");
    expect(toasts[0].type).toBe("error");
  });

  it("applyUIPrefs 抛错 → console.warn 不阻断（不 toast）", async () => {
    m.applyUIPrefs.mockImplementation(() => {
      throw new Error("prefs down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toasts } = await boot();
    expect(warn).toHaveBeenCalledWith("[ui-prefs] 界面偏好应用失败:", expect.any(Error));
    expect(toasts).toHaveLength(0);
    expect(m.revealCalls).toHaveLength(1);
  });

  it("checkUpdateSilent 拒绝 → console.warn [updater] 静默", async () => {
    m.checkUpdateSilent.mockRejectedValue(new Error("net down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
    expect(warn).toHaveBeenCalledWith("[updater] 静默检查失败:", expect.any(Error));
  });

  it("启动 2s 后后台预取 stats.worker（非阻塞）", async () => {
    vi.useFakeTimers();
    // 跨用例竞态清零：上一用例 boot 的 IIFE 注册的是真实 setTimeout(2000)，
    // 全量慢跑下可能在本用例 boot 前后到点触发 mock；先清零再锁「本 boot 不预取」。
    // boot 的 flushMicro 是纯微任务泵（宏任务无插入点），boot 后同步断言无竞速窗口。
    m.prefetchStatsWorker.mockClear();
    await boot({ microFlush: true });
    expect(m.prefetchStatsWorker).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.prefetchStatsWorker).toHaveBeenCalledTimes(1);
  });
});

describe("app-modules 系统主题跟随", () => {
  it("theme=system：跟随 matches 切换主题并 toast（深/浅两路）", async () => {
    localStorage.setItem("theme", "system");
    const cbs = captureThemeChange();
    const { toasts } = await boot();
    expect(cbs).toHaveLength(1);
    m.applyTheme.mockClear();
    toasts.length = 0;

    cbs[0]({ matches: true });
    expect(m.applyTheme).toHaveBeenCalledWith("system");
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain("深色");
    expect(toasts[0].type).toBe("info");
    expect(toasts[0].duration).toBe(TOAST_MS.success);

    cbs[0]({ matches: false });
    expect(toasts).toHaveLength(2);
    expect(toasts[1].msg).toContain("浅色");
    expect(m.applyTheme).toHaveBeenCalledTimes(2);
  });

  it("theme 为显式值：不跟随系统切换、不 toast", async () => {
    localStorage.setItem("theme", "pro");
    const cbs = captureThemeChange();
    const { toasts } = await boot();
    cbs[0]({ matches: true });
    expect(m.applyTheme).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it("theme 未存（safeGet null）→ 按 system 语义跟随", async () => {
    const cbs = captureThemeChange();
    const { toasts } = await boot();
    cbs[0]({ matches: true });
    expect(m.applyTheme).toHaveBeenCalledWith("system");
    expect(toasts).toHaveLength(1);
  });
});

describe("app-modules devtools 快捷键接线", () => {
  it("未启用（无 _devtools 标志）→ F12 不触发 OpenDevTools", async () => {
    await boot();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F12", cancelable: true }),
    );
    expect(m.openDevTools).not.toHaveBeenCalled();
  });

  it("_devtools=1 → F12 / Ctrl+Shift+I 打开 DevTools 并 preventDefault，其他按键不触发", async () => {
    localStorage.setItem("_devtools", "1");
    await boot();

    const f12 = new KeyboardEvent("keydown", { key: "F12", cancelable: true });
    document.dispatchEvent(f12);
    expect(f12.defaultPrevented).toBe(true);
    expect(m.openDevTools).toHaveBeenCalledTimes(1);

    const combo = new KeyboardEvent("keydown", {
      key: "I",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(combo);
    expect(combo.defaultPrevented).toBe(true);
    expect(m.openDevTools).toHaveBeenCalledTimes(2);

    // 半组合 / 普通按键不触发（无 preventDefault）
    const half = new KeyboardEvent("keydown", { key: "I", ctrlKey: true, cancelable: true });
    document.dispatchEvent(half);
    const plain = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    document.dispatchEvent(plain);
    expect(m.openDevTools).toHaveBeenCalledTimes(2);
    expect(half.defaultPrevented).toBe(false);
    expect(plain.defaultPrevented).toBe(false);
  });
});
