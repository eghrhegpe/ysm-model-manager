// 主题纯逻辑层直接测试（theme-core.ts）。
// theme.test.ts 测的是设置页消费层（initThemeSection），把 @/theme-core 整体 mock 掉，
// 故 normalizeTheme / 时段 / applyThemeAuto 等纯逻辑此前零直接覆盖——本文件补上。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeGet, safeSet } = vi.hoisted(() => ({
  safeGet: vi.fn((_key: string) => ""),
  safeSet: vi.fn((_key: string, _val: string) => {}),
}));

vi.mock("@/utils/base/primitives/storage.ts", () => ({
  safeGet: (...a: unknown[]) => safeGet(...(a as [string])),
  safeSet: (...a: unknown[]) => safeSet(...(a as [string, string])),
}));

// applyThemeAuto 不依赖后端；initTheme 的间接路径由 theme.test.ts 覆盖，此处不重复 mock。
import {
  SYSTEM_DARK_THEME,
  SYSTEM_LIGHT_THEME,
  THEME_DARK,
  THEME_VALID,
  applyTheme,
  applyThemeAuto,
  normalizeTheme,
  timeThemeForHour,
} from "./theme-core";

describe("normalizeTheme", () => {
  it("白名单内原样返回", () => {
    for (const t of THEME_VALID) {
      expect(normalizeTheme(t)).toBe(t);
    }
  });

  it("非法值回落 system（防脏值污染持久层）", () => {
    for (const bad of ["dark", "time", "", "auto", "light", "cyber2"]) {
      expect(normalizeTheme(bad)).toBe("system");
    }
  });
});

describe("主题常量（锁定默认值，防误改漂移）", () => {
  it("THEME_DARK = cyber（默认暗色基线，initTheme 兜底用）", () => {
    expect(THEME_DARK).toBe("cyber");
  });

  it("SYSTEM 映射：暗=cyber / 亮=warm（均须在白名单内）", () => {
    expect(SYSTEM_DARK_THEME).toBe("cyber");
    expect(SYSTEM_LIGHT_THEME).toBe("warm");
    expect(THEME_VALID).toContain(SYSTEM_DARK_THEME);
    expect(THEME_VALID).toContain(SYSTEM_LIGHT_THEME);
  });
});

describe("timeThemeForHour（纯函数时段判定）", () => {
  // 6:00–17:59 白天 → warm；其余夜晚 → cyber
  it("白天时段（6/9/12/17）→ warm", () => {
    for (const h of [6, 9, 12, 17]) {
      expect(timeThemeForHour(h)).toBe("warm");
    }
  });

  it("夜晚时段（0/5/18/23）→ cyber", () => {
    for (const h of [0, 5, 18, 23]) {
      expect(timeThemeForHour(h)).toBe("cyber");
    }
  });
});

describe("applyTheme（system 深/浅映射走命名常量）", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("system + prefersDark=true → theme-cyber（SYSTEM_DARK_THEME）", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("dark"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    applyTheme("system");
    expect(document.body.classList.contains("theme-cyber")).toBe(true);
    expect(document.body.classList.contains("theme-warm")).toBe(false);
  });

  it("system + prefersDark=false → theme-warm（SYSTEM_LIGHT_THEME）", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    applyTheme("system");
    expect(document.body.classList.contains("theme-warm")).toBe(true);
    expect(document.body.classList.contains("theme-cyber")).toBe(false);
  });

  it("具体主题 → theme-x，且先清旧主题类", () => {
    document.body.classList.add("theme-cyber");
    applyTheme("ocean");
    expect(document.body.classList.contains("theme-ocean")).toBe(true);
    expect(document.body.classList.contains("theme-cyber")).toBe(false);
  });
});

describe("applyThemeAuto（启动链按自动模式重算）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.className = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("theme-auto=time 白天 → 应用 warm + 写 theme=warm（重启重算，不定格旧值）", () => {
    safeGet.mockImplementation((k: string) => (k === "theme-auto" ? "time" : ""));
    vi.useFakeTimers().setSystemTime(new Date(2026, 0, 1, 12)); // 正午
    applyThemeAuto();
    expect(document.body.classList.contains("theme-warm")).toBe(true);
    expect(safeSet).toHaveBeenCalledWith("theme", "warm");
  });

  it("theme-auto=time 夜晚 → 应用 cyber + 写 theme=cyber", () => {
    safeGet.mockImplementation((k: string) => (k === "theme-auto" ? "time" : ""));
    vi.useFakeTimers().setSystemTime(new Date(2026, 0, 1, 22));
    applyThemeAuto();
    expect(document.body.classList.contains("theme-cyber")).toBe(true);
    expect(safeSet).toHaveBeenCalledWith("theme", "cyber");
  });

  it("theme-auto=off → 不重算（沿用 initTheme 定格值，不写 theme 键）", () => {
    safeGet.mockImplementation((k: string) => (k === "theme-auto" ? "off" : "warm"));
    applyThemeAuto();
    expect(safeSet).not.toHaveBeenCalled();
  });

  it("theme-auto=system → applyThemeAuto 不接管（initTheme 经 theme 键已处理，避免重复）", () => {
    safeGet.mockImplementation((k: string) => (k === "theme-auto" ? "system" : "system"));
    applyThemeAuto();
    expect(safeSet).not.toHaveBeenCalled();
  });

  it("theme-auto 缺失 → 不动", () => {
    safeGet.mockImplementation(() => "");
    applyThemeAuto();
    expect(safeSet).not.toHaveBeenCalled();
  });
});
