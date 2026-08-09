// ===== app-modules 主题/隐私模式启动链测试（app-modules.ts）=====
// 覆盖 P3 隐私模式修复（a25c64d）：safeGet/safeSet 在 localStorage 抛错时兜底、
// initTheme 白名单归一化+回写、applyUIPrefs 默认值兜底、_devtools 隐私模式降级。
// 顶层副作用（视图注册/启动 IIFE/checkUpdateSilent）用 vi.mock 隔离，
// 只测导出的纯逻辑函数（不 import 整模块触发 IIFE）。
// ADR-044 策略 A：safeGet/safeSet 已收敛至 utils/dom/storage.ts（app-modules 不再导出）。
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import {
  normalizeTheme,
  applyTheme,
  initTheme,
  applyUIPrefs,
} from "./app-modules.ts";
import { safeGet, safeSet } from "./utils/dom/storage.ts";

/** 隐私模式模拟：让 localStorage 读写抛错（happy-dom 的 localStorage 是 getter 保护，必须 vi.spyOn） */
function breakLocalStorage() {
  const getSpy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const setSpy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  return () => {
    getSpy.mockRestore();
    setSpy.mockRestore();
  };
}

// getApp 动态 import 链：mock 返回可控 LoadAppConfig
const { LoadAppConfigMock } = vi.hoisted(() => ({
  LoadAppConfigMock: vi.fn(),
}));
vi.mock("./wails/app.ts", () => ({
  getApp: () => Promise.resolve({ LoadAppConfig: LoadAppConfigMock }),
}));
// Window（@wailsio/runtime）仅 devtools 分支用到，mock 防未定义
vi.mock("@wailsio/runtime", () => ({
  Events: { On: () => () => {} },
  Window: { OpenDevTools: vi.fn() },
}));
// version-updater：checkUpdateSilent 走后端，测试不触发
vi.mock("./features/version-updater.ts", () => ({
  checkUpdateSilent: vi.fn().mockResolvedValue(undefined),
}));
// 视图侧链（bus 依赖纯净，视图只在动态 import 顶层执行，mock 空避免组件副作用）
vi.mock("./core/error-diary.ts", () => ({ registerErrorDiary: vi.fn() }));
vi.mock("./services/registry.ts", () => ({
  register: () => {},
  get: () => undefined,
  has: () => false,
  unregister: () => {},
  clear: () => {},
}));
vi.mock("./views/app-sidebar/loader.ts", () => ({ loadInstances: vi.fn() }));
vi.mock("./views/app-tree/loader.ts", () => ({ loadEntries: vi.fn() }));
// 顶层动态 import 的视图：mock 为空，避免测试环境 teardown 期间加载组件链
//（app-modules.ts 启动 IIFE 的 import("./views/...") 跨环境边界失败会刷 warning）
vi.mock("./views/app-tree/index.ts", () => ({}));
vi.mock("./views/app-sidebar/index.ts", () => ({}));
vi.mock("./views/app-content/index.ts", () => ({}));
vi.mock("./views/app-resource-manager/index.ts", () => ({}));
vi.mock("./views/app-sync-manager/index.ts", () => ({}));

describe("normalizeTheme 白名单归一化", () => {
  it("合法主题原样返回", () => {
    for (const t of ["cyber", "warm", "pro", "sakura", "ocean", "mint", "system"]) {
      expect(normalizeTheme(t)).toBe(t);
    }
  });
  it("非法主题（脏数据如 time）回落 system", () => {
    expect(normalizeTheme("time")).toBe("system");
    expect(normalizeTheme("")).toBe("system");
  });
});

describe("applyTheme 主题 class 切换", () => {
  beforeEach(() => {
    document.body.className = "";
  });
  it("显式主题 → 加对应 class", () => {
    applyTheme("pro");
    expect(document.body.classList.contains("theme-pro")).toBe(true);
    expect(document.body.classList.contains("theme-cyber")).toBe(false);
  });
  it("非法主题回落 system 并跟随 matchMedia", () => {
    applyTheme("bogus");
    // happy-dom matchMedia 默认 matches=false → warm
    expect(document.body.classList.contains("theme-warm")).toBe(true);
  });
  it("非法主题不在 body 留下脏 class", () => {
    applyTheme("cyber");
    applyTheme("time");
    expect(document.body.classList.contains("theme-cyber")).toBe(false);
    expect(document.body.classList.contains("theme-warm")).toBe(true);
  });
});

describe("safeGet / safeSet 隐私模式兜底", () => {
  it("localStorage 正常：read/write 透传", () => {
    localStorage.setItem("k1", "v1");
    expect(safeGet("k1")).toBe("v1");
    safeSet("k2", "v2");
    expect(localStorage.getItem("k2")).toBe("v2");
  });
  it("localStorage 抛错：safeGet 返回 null、safeSet 静默", () => {
    const restore = breakLocalStorage();
    try {
      expect(safeGet("theme")).toBeNull();
      expect(() => safeSet("theme", "pro")).not.toThrow();
    } finally {
      restore();
    }
  });
});

describe("initTheme 隐私模式 + 白名单回写", () => {
  beforeEach(() => {
    localStorage.clear();
    LoadAppConfigMock.mockReset();
    document.body.className = "";
  });

  it("配置合法 → 应用并回写 localStorage", async () => {
    LoadAppConfigMock.mockResolvedValue({ theme: "sakura" });
    await initTheme();
    expect(document.body.classList.contains("theme-sakura")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("sakura");
  });

  it("localStorage 非法值 → 归一化 system 后回写", async () => {
    localStorage.setItem("theme", "time");
    LoadAppConfigMock.mockResolvedValue({ theme: "pro" });
    await initTheme();
    expect(localStorage.getItem("theme")).toBe("system");
    expect(document.body.classList.contains("theme-warm")).toBe(true);
  });

  it("getApp 拒绝 → 走 catch 用 localStorage 兜底", async () => {
    localStorage.setItem("theme", "cyber");
    LoadAppConfigMock.mockRejectedValue(new Error("binding down"));
    await initTheme();
    expect(document.body.classList.contains("theme-cyber")).toBe(true);
  });

  it("隐私模式 localStorage 抛错 → initTheme 不中断、fallback 默认 THEME_DARK", async () => {
    const restore = breakLocalStorage();
    try {
      // cfg 也无主题 → 隐私模式 safeGet 返回 null → 默认 THEME_DARK=cyber（合法值 → cyber）
      LoadAppConfigMock.mockResolvedValue({ theme: "" });
      await expect(initTheme()).resolves.toBeUndefined();
      expect(document.body.classList.contains("theme-cyber")).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("applyUIPrefs 字号/密度/动画偏好", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.cssText = "";
    document.documentElement.classList.remove("no-animations");
  });
  it("正常偏好 → CSS 变量与 class 生效", () => {
    localStorage.setItem("ui-font-size", "large");
    localStorage.setItem("ui-card-density", "spacious");
    localStorage.setItem("ui-animations", "off");
    applyUIPrefs();
    expect(document.documentElement.style.getPropertyValue("--fs-scale")).toBe("2px");
    expect(document.documentElement.style.getPropertyValue("--card-padding")).toBe("10px 14px");
    expect(document.documentElement.classList.contains("no-animations")).toBe(true);
  });
  it("隐私模式抛错 → 默认 normal/compact/动画开", () => {
    const restore = breakLocalStorage();
    try {
      applyUIPrefs();
      expect(document.documentElement.style.getPropertyValue("--fs-scale")).toBe("0px");
      expect(document.documentElement.style.getPropertyValue("--card-padding")).toBe("6px 10px");
      expect(document.documentElement.classList.contains("no-animations")).toBe(false);
    } finally {
      restore();
    }
  });
});

afterAll(() => {
  localStorage.clear();
});