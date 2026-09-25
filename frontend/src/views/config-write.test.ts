// ===== config-write（views 级配置写唯一实参点）单元测试 =====
// 锁定 ADR-313 的四条语义：① patch 未传字段取**重读**的最新落盘值（防旧快照覆盖）；
// ② theme/themeAuto 缺省自 localStorage 且回退 THEME_DARK（"dark" 非法值不再被写入）；
// ③ 重读失败不中断保存（退化为空串，Go 端 orDefault 保留旧值）；
// ④ 六位置实参顺序与 Go 端签名一致（fieldsRoot, rpRoot, mcRoot, linkMode, theme, themeAuto）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { THEME_DARK } from "@/theme-core";

const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));

import { writeAppConfig } from "./config-write.ts";

function mockApp(over: Record<string, unknown> = {}) {
  const m = {
    LoadAppConfig: vi.fn().mockResolvedValue({
      filesRoot: "/files",
      resourcepackRoot: "/rp",
      mcRoot: "/old-mc",
      linkMode: "copy",
      theme: "cyber",
      themeAuto: "off",
    }),
    SaveAppConfig: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  getAppMock.mockResolvedValue(m);
  return m;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("writeAppConfig — views 级唯一实参点", () => {
  it("未传字段取重读的最新值，只覆盖 patch 字段（防旧快照覆盖）", async () => {
    const app = mockApp({
      LoadAppConfig: vi.fn().mockResolvedValue({
        filesRoot: "/latest",
        resourcepackRoot: "/latest-rp",
        mcRoot: "/latest-mc",
        linkMode: "hardlink",
      }),
    });
    localStorage.setItem("theme", "ocean");
    await writeAppConfig({ mcRoot: "/new-mc" });
    expect(app.SaveAppConfig).toHaveBeenCalledWith(
      "/latest",
      "/latest-rp",
      "/new-mc",
      "hardlink",
      "ocean",
      "",
    );
  });

  it("theme/themeAuto 缺省：localStorage 无值时 theme 回落 THEME_DARK（绝不写 \"dark\"）", async () => {
    const app = mockApp();
    await writeAppConfig({ mcRoot: "/mc" });
    const args = app.SaveAppConfig.mock.calls[0]!;
    expect(args[4]).toBe(THEME_DARK);
    expect(args[4]).not.toBe("dark"); // THEME_VALID 无 "dark"，写它会被 normalizeTheme 静默转成 system
    expect(args[5]).toBe("");
  });

  it("linkMode 缺省回落 LINK_MODE_DEFAULT（不手抄 \"copy\" 字面量）", async () => {
    const app = mockApp({
      LoadAppConfig: vi.fn().mockResolvedValue({ filesRoot: "/f", resourcepackRoot: "/r" }),
    });
    await writeAppConfig({ mcRoot: "/mc" });
    expect(app.SaveAppConfig).toHaveBeenCalledWith("/f", "/r", "/mc", "copy", THEME_DARK, "");
  });

  it("显式 patch 的 theme/themeAuto 优先于 localStorage", async () => {
    const app = mockApp();
    localStorage.setItem("theme", "ocean");
    localStorage.setItem("theme-auto", "time");
    await writeAppConfig({ theme: "warm", themeAuto: "off" });
    expect(app.SaveAppConfig).toHaveBeenCalledWith(
      "/files",
      "/rp",
      "/old-mc",
      "copy",
      "warm",
      "off",
    );
  });

  it("重读失败 → 空串兜底（Go 端 orDefault 保留旧值），保存照常执行", async () => {
    const app = mockApp({ LoadAppConfig: vi.fn().mockRejectedValue(new Error("cfg down")) });
    await writeAppConfig({ mcRoot: "/mc" });
    expect(app.SaveAppConfig).toHaveBeenCalledWith("", "", "/mc", "copy", THEME_DARK, "");
  });

  it("返回值 = 实际写入的六元组（便于调用方同步内存快照）", async () => {
    mockApp();
    const resolved = await writeAppConfig({ filesRoot: "/new-files" });
    expect(resolved).toEqual({
      filesRoot: "/new-files",
      rpRoot: "/rp",
      mcRoot: "/old-mc",
      linkMode: "copy",
      theme: THEME_DARK,
      themeAuto: "",
    });
  });
});
