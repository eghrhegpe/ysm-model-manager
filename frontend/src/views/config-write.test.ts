// ===== config-write（views 级配置写唯一实参点）单元测试 =====
// 锁定 ADR-313 的四条语义：① patch 未传字段取**重读**的最新落盘值（防旧快照覆盖）；
// ② theme/themeAuto 缺省同样取磁盘重读值（localStorage 缺席不得冲掉备份，锐评 2026-10-15 P1），
//    磁盘亦无值时才回落 THEME_DARK（"dark" 非法值任何时候都不得被写入）；
// ③ 重读失败不中断保存（退化为空串，Go 端 orDefault 保留旧值）；
// ④ 六位置实参顺序与 Go 端签名一致（fieldsRoot, rpRoot, mcRoot, linkMode, theme, themeAuto）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { THEME_DARK } from "@/theme-core";

const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));

import { bus } from "@/bus";
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
      THEME_DARK, // localStorage 的 "ocean" 不再影响磁盘写入：磁盘无值故回落默认（见下方 describe）
      "",
    );
  });

  it("theme/themeAuto 缺省：磁盘无值时 theme 回落 THEME_DARK（绝不写 \"dark\"）", async () => {
    const app = mockApp({
      LoadAppConfig: vi.fn().mockResolvedValue({
        filesRoot: "/files",
        resourcepackRoot: "/rp",
        mcRoot: "/old-mc",
        linkMode: "copy",
      }), // 磁盘无 theme 字段
    });
    localStorage.setItem("theme", "ocean"); // 此刻 localStorage 有值但**不参与**决策
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
    // 默认 mock 的 LoadAppConfig 带 theme:"cyber"/themeAuto:"off" → 缺省字段取这两个磁盘值
    mockApp();
    const resolved = await writeAppConfig({ filesRoot: "/new-files" });
    expect(resolved).toEqual({
      filesRoot: "/new-files",
      rpRoot: "/rp",
      mcRoot: "/old-mc",
      linkMode: "copy",
      theme: "cyber",
      themeAuto: "off",
    });
  });

  // 2026-10 架构补件：落盘成功后广播 config:changed（载荷 = 实际写入的六元组）——
  // 配置读取方（app-sidebar 底部 MC 路径）据此零 IPC 即时刷新，不再靠每轮 reload 重拉。
  it("落盘成功 → 广播 config:changed，载荷 = 实际写入六元组", async () => {
    mockApp();
    const seen: unknown[] = [];
    const off = bus.on("config:changed", (p) => seen.push(p));
    const resolved = await writeAppConfig({ mcRoot: "/mc" });
    off();
    expect(seen).toEqual([resolved]);
    expect(seen[0]).toEqual({
      filesRoot: "/files",
      rpRoot: "/rp",
      mcRoot: "/mc",
      linkMode: "copy",
      theme: "cyber",
      themeAuto: "off",
    });
  });

  // 只在成功后发：失败时读取方保持旧显示值，比广播「半份配置」诚实
  it("落盘失败 → 不广播（读取方保持旧值）", async () => {
    mockApp({ SaveAppConfig: vi.fn().mockRejectedValue(new Error("save down")) });
    let emitted = 0;
    const off = bus.on("config:changed", () => {
      emitted++;
    });
    await expect(writeAppConfig({ mcRoot: "/mc" })).rejects.toThrow("save down");
    off();
    expect(emitted).toBe(0);
  });

  // P1 回归（锐评 2026-10-15）：theme/themeAuto 缺省必须取**磁盘重读值**。
  // 原实现读 localStorage 兜底，localStorage 一旦为空（WebView2 profile 重置 / 清站点数据），
  // 任何一次无关保存（如侧栏自动检测游戏目录后写 { mcRoot }）都会把磁盘上的主题备份
  // 冲成 THEME_DARK —— 用户只改了路径，主题却被静默改成默认。
  describe("theme/themeAuto 缺省取磁盘重读值（不读 localStorage）", () => {
    it("localStorage 为空 + 磁盘有主题 → 保留磁盘主题，不被 THEME_DARK 冲掉", async () => {
      const app = mockApp({
        LoadAppConfig: vi.fn().mockResolvedValue({
          filesRoot: "/f",
          resourcepackRoot: "/r",
          mcRoot: "/old",
          linkMode: "copy",
          theme: "ocean",
          themeAuto: "time",
        }),
      });
      localStorage.clear(); // 模拟 localStorage 被清空
      await writeAppConfig({ mcRoot: "/new-mc" });
      const args = app.SaveAppConfig.mock.calls[0]!;
      expect(args[4]).toBe("ocean"); // 磁盘备份保住
      expect(args[5]).toBe("time");
    });

    it("localStorage 与磁盘不一致 → 以磁盘为准（磁盘是备份权威）", async () => {
      const app = mockApp({
        LoadAppConfig: vi.fn().mockResolvedValue({
          filesRoot: "/f",
          resourcepackRoot: "/r",
          mcRoot: "/old",
          linkMode: "copy",
          theme: "sakura",
          themeAuto: "system",
        }),
      });
      localStorage.setItem("theme", "mint");
      localStorage.setItem("theme-auto", "off");
      await writeAppConfig({ mcRoot: "/new-mc" });
      const args = app.SaveAppConfig.mock.calls[0]!;
      expect(args[4]).toBe("sakura");
      expect(args[5]).toBe("system");
    });

    it("磁盘也无主题（首次运行）→ 回落 THEME_DARK", async () => {
      const app = mockApp({
        LoadAppConfig: vi.fn().mockResolvedValue({
          filesRoot: "/f",
          resourcepackRoot: "/r",
          mcRoot: "",
          linkMode: "copy",
        }),
      });
      await writeAppConfig({ mcRoot: "/new-mc" });
      expect(app.SaveAppConfig.mock.calls[0]![4]).toBe(THEME_DARK);
    });

    it("显式 patch theme/themeAuto 仍优先于磁盘重读值", async () => {
      const app = mockApp({
        LoadAppConfig: vi.fn().mockResolvedValue({
          filesRoot: "/f",
          resourcepackRoot: "/r",
          mcRoot: "/old",
          linkMode: "copy",
          theme: "ocean",
          themeAuto: "time",
        }),
      });
      await writeAppConfig({ theme: "warm", themeAuto: "off" });
      const args = app.SaveAppConfig.mock.calls[0]!;
      expect(args[4]).toBe("warm");
      expect(args[5]).toBe("off");
    });
  });
});
