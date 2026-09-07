// @vitest-environment node
// ===== 主题核心测试（theme-core.ts，2026-08-17 神桶拆分后直测纯逻辑）=====
// 覆盖 P3 隐私模式修复（a25c64d）：safeGet/safeSet 在 localStorage 抛错时兜底、
// initTheme 白名单归一化+回写、_devtools 隐私模式降级。
// 原 app-modules.ts 承载启动装配（Web Component import / 启动 IIFE / window 挂载），
// import 即触发全部顶层副作用——神桶拆分后 theme-core.ts 无顶层副作用，测试直测。
// ADR-044 策略 A：safeGet/safeSet 已收敛至 utils/dom/storage.ts（app-modules 不再导出）。
// 2026-08-17 切 node 环境：test-setup.ts 已注入全局 localStorage 内存实现；
// applyTheme 断言 document.body.classList + window.matchMedia → 下方 stubGlobal 最小 DOM。
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import {
  normalizeTheme,
  applyTheme,
  initTheme,
} from "./theme-core.ts";
import { applyUIPrefs } from "@/views/app-content/settings/ui-prefs.ts";
import { safeGet, safeSet } from "@/utils/dom/storage.ts";

/** 隐私模式模拟：让 localStorage 读写抛错（node 环境 test-setup 注入的全局 localStorage，必须 vi.spyOn） */
function breakLocalStorage() {
  const getSpy = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  return () => {
    getSpy.mockRestore();
    setSpy.mockRestore();
  };
}

// node 环境无 DOM：stubGlobal 最小 document/window（applyTheme/applyUIPrefs 依赖）
// classList 用真实 Set 语义（add/remove/contains），断言可正确读回；
// matchMedia 与 happy-dom 默认一致（matches=false → warm）。
const _bodyClasses = new Set<string>();
const _docClasses = new Set<string>();
// applyUIPrefs 写 CSS 变量（setProperty），断言用 getPropertyValue 读回——带存储语义
const _docStyle = new Map<string, string>();
vi.stubGlobal("document", {
  body: {
    className: "",
    classList: {
      add: (c: string) => void _bodyClasses.add(c),
      remove: (...cs: string[]) => void cs.forEach((c) => _bodyClasses.delete(c)),
      contains: (c: string) => _bodyClasses.has(c),
    },
  },
  documentElement: {
    style: {
      removeProperty: (k: string) => void _docStyle.delete(k),
      setProperty: (k: string, v: string) => void _docStyle.set(k, v),
      getPropertyValue: (k: string) => _docStyle.get(k) ?? "",
    },
    // applyUIPrefs 动画偏好写 documentElement.classList（no-animations）——补同构 Set
    classList: {
      add: (c: string) => void _docClasses.add(c),
      remove: (...cs: string[]) => void cs.forEach((c) => _docClasses.delete(c)),
      contains: (c: string) => _docClasses.has(c),
      toggle: (c: string, force?: boolean) => {
        const want = force ?? !_docClasses.has(c);
        if (want) _docClasses.add(c);
        else _docClasses.delete(c);
        return want;
      },
    },
  },
});
vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
afterEach(() => {
  _bodyClasses.clear();
  _docClasses.clear();
  _docStyle.clear();
});

// getApp 动态 import 链：mock 返回可控 LoadAppConfig
const { LoadAppConfigMock } = vi.hoisted(() => ({
  LoadAppConfigMock: vi.fn(),
}));
vi.mock("./backend/app.ts", () => ({
  getApp: () => Promise.resolve({ LoadAppConfig: LoadAppConfigMock }),
}));
// Window（@wailsio/runtime）仅 devtools 分支用到，mock 防未定义
vi.mock("@wailsio/runtime", () => ({
  Events: { On: () => () => {} },
  Window: { OpenDevTools: vi.fn() },
}));

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