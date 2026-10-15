import { describe, it, expect, vi, beforeEach } from "vitest";
import { initThemeSection } from "./theme.ts";

const { safeGet, safeSet, getApp, applyTheme, applyTimeTheme } = vi.hoisted(() => ({
  safeGet: vi.fn((_key: string) => ""),
  safeSet: vi.fn((_key: string, _val: string) => {}),
  getApp: vi.fn(),
  applyTheme: vi.fn((_name: string) => {}),
  // 默认白天：applyTimeTheme 返回 warm；夜晚用例在用例内 mockReturnValue("cyber")
  applyTimeTheme: vi.fn(() => "warm"),
}));

vi.mock("@/utils/base/primitives/storage.ts", () => ({
  safeGet: (...a: unknown[]) => safeGet(...(a as [string])),
  safeSet: (...a: unknown[]) => safeSet(...(a as [string, string])),
}));

vi.mock("@/backend/app.ts", () => ({
  getApp: () => getApp(),
}));

vi.mock("@/theme-core", () => ({
  // 缺省主题常量（theme.ts 现引 THEME_DARK 而非 "cyber" 字面量——mock 须同步导出）
  THEME_DARK: "cyber",
  applyTheme: (...a: unknown[]) => applyTheme(...(a as [string])),
  // mock applyTimeTheme 复刻真实行为：取返回值 + 调 applyTheme（否则 applyTheme 调 0 次）
  applyTimeTheme: () => {
    const r = applyTimeTheme();
    applyTheme(r);
    return r;
  },
}));

vi.mock("./store.ts", () => ({
  getCfg: () => ({ filesRoot: "/test", resourcepackRoot: "", mcRoot: "", linkMode: "copy" }),
}));

function makeRoot(savedTheme = "cyber", savedAuto = "off") {
  safeGet.mockImplementation((key: string) => {
    if (key === "theme") return savedTheme;
    if (key === "theme-auto") return savedAuto;
    return "";
  });
  const picker = document.createElement("div");
  picker.id = "theme-picker";
  const card1 = document.createElement("button");
  card1.type = "button";
  card1.className = "theme-card";
  card1.dataset.theme = "cyber";
  const card2 = document.createElement("button");
  card2.type = "button";
  card2.className = "theme-card";
  card2.dataset.theme = "warm";
  // 每卡三个色点（data-var 声明）——供色点回填回归测试断言
  for (const card of [card1, card2]) {
    for (const v of ["bg", "accent", "bd"]) {
      const dot = document.createElement("span");
      dot.dataset["var"] = v;
      card.appendChild(dot);
    }
  }
  picker.append(card1, card2);

  const autoSelect = document.createElement("select");
  autoSelect.id = "theme-auto";
  for (const v of ["off", "system", "time"]) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    autoSelect.appendChild(opt);
  }

  const root = {
    getElementById: (id: string) => {
      if (id === "theme-picker") return picker;
      if (id === "theme-auto") return autoSelect;
      return null;
    },
  } as unknown as ShadowRoot;

  return { root, picker, card1, card2, autoSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 绑 P1 ③ 后的写入端（SaveAppConfigPatch）。⚠️ 此前 mock 的是旧的 SaveAppConfig，
  // 改写端后这些用例仍「绿」但落盘其实失败了（错误被 theme.ts 的 catch 记进 stderr
  // ——假绿：断言只看 applyTheme，不断言保存）。绑定名对不上是静默失败，不是断言失败。
  getApp.mockResolvedValue({ SaveAppConfigPatch: vi.fn().mockResolvedValue(undefined) });
});

describe("initThemeSection", () => {
  it("applies saved theme on init (no auto)", () => {
    const { root } = makeRoot("warm");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("warm");
  });

  it("defaults to cyber when no saved theme", () => {
    const { root } = makeRoot("");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("cyber");
  });

  it("card click applies theme + saves + disables auto + updates aria-pressed", () => {
    const { root, card1, card2 } = makeRoot("cyber");
    initThemeSection(root);
    expect(card1.getAttribute("aria-pressed")).toBe("true");
    expect(card2.getAttribute("aria-pressed")).toBe("false");
    applyTheme.mockClear();
    card2.click();
    expect(applyTheme).toHaveBeenCalledWith("warm");
    expect(safeSet).toHaveBeenCalledWith("theme", "warm");
    expect(safeSet).toHaveBeenCalledWith("theme-auto", "off");
    expect(card1.getAttribute("aria-pressed")).toBe("false");
    expect(card2.getAttribute("aria-pressed")).toBe("true");
  });

  it("auto=system applies system theme", () => {
    const { root, card1, card2 } = makeRoot("cyber", "system");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("system");
    expect(card1.getAttribute("aria-pressed")).toBe("false");
    expect(card2.getAttribute("aria-pressed")).toBe("false");
  });

  it("auto=time 白天 → applyTimeTheme 返回 warm，应用 warm + 写 theme=warm", () => {
    applyTimeTheme.mockReturnValue("warm");
    const { root } = makeRoot("cyber", "time");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("warm");
    expect(safeSet).toHaveBeenCalledWith("theme", "warm");
  });

  it("auto=time 夜晚 → applyTimeTheme 返回 cyber，应用 cyber + 写 theme=cyber", () => {
    applyTimeTheme.mockReturnValue("cyber");
    const { root } = makeRoot("cyber", "time");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("cyber");
    expect(safeSet).toHaveBeenCalledWith("theme", "cyber");
  });

  it("auto select change to system applies system", () => {
    const { root, autoSelect } = makeRoot("cyber", "off");
    initThemeSection(root);
    applyTheme.mockClear();
    autoSelect.value = "system";
    autoSelect.dispatchEvent(new Event("change"));
    expect(applyTheme).toHaveBeenCalledWith("system");
    expect(safeSet).toHaveBeenCalledWith("theme", "system");
  });

  it("auto select change to time → applyTimeTheme 返回值应用 + 写 theme", () => {
    applyTimeTheme.mockReturnValue("warm");
    const { root, autoSelect } = makeRoot("cyber", "off");
    initThemeSection(root);
    applyTheme.mockClear();
    autoSelect.value = "time";
    autoSelect.dispatchEvent(new Event("change"));
    expect(applyTheme).toHaveBeenCalledWith("warm");
    expect(safeSet).toHaveBeenCalledWith("theme", "warm");
  });

  it("no picker element still applies theme", () => {
    const root = {
      getElementById: () => null,
    } as unknown as ShadowRoot;
    safeGet.mockReturnValue("");
    initThemeSection(root);
    expect(applyTheme).toHaveBeenCalledWith("cyber");
  });

  it("卡片色点按各自主题回填真实色（Shadow DOM 同色缺陷回归）", () => {
    // 关键修复回归（2026-09）：设置页在 Shadow DOM 内，卡片 .theme-x 类解析不到
    // document 层 variables.css，var() 只会拿到当前主题 → 六卡同色。
    // initThemeSection 用 document 探针逐主题取 --bg/--accent/--bd 回填 inline。
    // 这里以 spy 模拟「document 层已解析出各主题真实值」，验证回填按卡片归属生效。
    const cssByTheme: Record<string, Record<string, string>> = {
      "theme-cyber": {
        "--bg": "#11111b",
        "--accent": "#9575cd",
        "--bd": "color-mix(in srgb, rgb(149, 117, 205) 10%, transparent)",
      },
      "theme-warm": {
        "--bg": "#f5f0e1",
        "--accent": "#8b4513",
        "--bd": "color-mix(in srgb, rgb(139, 69, 19) 12%, transparent)",
      },
    };
    const getCS = vi
      .spyOn(globalThis, "getComputedStyle")
      .mockImplementation((el: Element) => {
        const key = (el as HTMLElement).className;
        return {
          getPropertyValue: (prop: string) => cssByTheme[key]?.[prop] ?? "",
        } as CSSStyleDeclaration;
      });
    const { root, picker } = makeRoot("cyber");
    initThemeSection(root);
    expect(picker.querySelectorAll(".theme-card [data-var]").length).toBe(6);
    // cyber 卡回填 cyber 色
    expect(
      (picker.querySelector('.theme-card[data-theme="cyber"] [data-var="bg"]') as HTMLElement).style.background,
    ).toBe("#11111b");
    expect(
      (picker.querySelector('.theme-card[data-theme="cyber"] [data-var="accent"]') as HTMLElement).style.background,
    ).toBe("#9575cd");
    // warm 卡回填 warm 色——与 cyber 不同，六卡不再同色
    expect(
      (picker.querySelector('.theme-card[data-theme="warm"] [data-var="bg"]') as HTMLElement).style.background,
    ).toBe("#f5f0e1");
    expect(
      (picker.querySelector('.theme-card[data-theme="warm"] [data-var="accent"]') as HTMLElement).style.background,
    ).toBe("#8b4513");
    getCS.mockRestore();
  });
});

// ===== 自动模式落盘（2026-10-15 锐评 P0：theme 与 themeAuto 须同笔落盘）=====
// 病根：initTheme 翻转为 disk 优先后，auto 分支若只把 themeAuto 落盘，disk 里的
// theme 恒为旧手动定格值——重启时 initTheme 先应用陈旧值（并把 localStorage 的
// "system" 覆盖掉），跟随系统模式永远回不来。
// 回归锁随 P1 ③ 改形：写入端从 `SaveAppConfig` 六个位置实参改为
// `SaveAppConfigPatch({ theme, themeAuto })` patch 对象（P0 要锁的**语义**
// ——同笔落盘、单次写、off 时不带 theme 键——不变，只是载体从位置实参换成 patch）。
function mockConfigSave(diskTheme = "warm", diskAuto = "off") {
  const saveAppConfigPatch = vi.fn();
  const loadAppConfig = vi.fn().mockResolvedValue({ theme: diskTheme, themeAuto: diskAuto });
  getApp.mockResolvedValue({ SaveAppConfigPatch: saveAppConfigPatch, LoadAppConfig: loadAppConfig });
  return saveAppConfigPatch;
}

describe("自动模式落盘（P0 disk 权威）", () => {
  it("system 变更同笔落盘 theme=system + themeAuto=system（单次写，无重复）", async () => {
    const saveAppConfig = mockConfigSave();
    const { root, autoSelect } = makeRoot("cyber", "off");
    initThemeSection(root);
    autoSelect.value = "system";
    autoSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(saveAppConfig).toHaveBeenCalledTimes(1));
    expect(saveAppConfig.mock.calls[0][0]).toEqual({ theme: "system", themeAuto: "system" });
  });

  it("time 变更同笔落盘重算后的时段主题 + themeAuto=time（单次写）", async () => {
    applyTimeTheme.mockReturnValue("warm");
    const saveAppConfig = mockConfigSave("pro", "time");
    const { root, autoSelect } = makeRoot("cyber", "off");
    initThemeSection(root);
    autoSelect.value = "time";
    autoSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(saveAppConfig).toHaveBeenCalledTimes(1));
    expect(saveAppConfig.mock.calls[0][0]).toEqual({ theme: "warm", themeAuto: "time" });
  });

  // off 模式：patch **不含 theme 键** → Go 侧取磁盘现值（="sakura"）不动，
  // 即 P4「off 沿用定格主题」口径。⚠️ 与 P0 修复前的断言形态不同：旧断言看的是
  // 位置实参里 theme 位被前端重读填成磁盘值；新语义下前端根本不提 theme，
  // 「不冲掉磁盘定格值」由 Go 的 nil 契约保证（app_config_patch_test.go 对应锁）。
  it("off 变更 patch 不含 theme 键（Go 取磁盘现值，不冲掉定格主题）", async () => {
    const saveAppConfig = mockConfigSave("sakura");
    const { root, autoSelect } = makeRoot("cyber", "system");
    initThemeSection(root);
    autoSelect.value = "off";
    autoSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(saveAppConfig).toHaveBeenCalledTimes(1));
    const patch = saveAppConfig.mock.calls[0][0];
    expect(patch).toEqual({ themeAuto: "off" });
    expect("theme" in patch).toBe(false);
  });

  it("打开设置页不触发 auto 模式落盘（读路径写零，2026-10-15 写放大收口）", async () => {
    const saveAppConfig = mockConfigSave("pro", "time");
    const { root } = makeRoot("cyber", "time");
    initThemeSection(root);
    // 给 void fire-and-forget 的落盘链（await 两层）留足微任务窗口再断言缺席，
    // 防「未落盘就断言」假绿
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAppConfig).not.toHaveBeenCalled();
  });
});
