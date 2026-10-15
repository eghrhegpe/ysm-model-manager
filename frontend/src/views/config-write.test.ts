// ===== config-write（views 级配置写唯一入口）单元测试 =====
// P1 ③（锐评 2026-10-15）后本文件锁的是**新契约**：writeAppConfig 是薄透传，
// 把 patch 原样交给 Go 侧 `SaveAppConfigPatch`，未传字段的「取当前落盘值」由 Go 在
// configWriteMu 锁内重读决定（不再由前端预读拼接）。
//
// 为什么旧用例整批删除而非改写：旧断言锁的是「前端拼出完整六元组」这套实现细节
// （theme 缺省回落 THEME_DARK / 重读失败兜底 / 六位置实参顺序）。这套逻辑连同它的
// 病（前端 read-then-write 的 TOCTOU：两个 await 之间别的写入口改的字段会被整份
// 回写冲掉）已随本次下沉到 Go 侧。保留旧断言等于锁死一个已被删除的行为。
// 对应的 Go 侧回归在 internal/app/app_config_patch_test.go：
//   TestSaveAppConfigPatch_PreservesUnspecifiedFields（未传字段保留，含 8 个运行阈值）
//   TestSaveAppConfigPatch_EmptyPatchIsNoOp（空补丁不改任何字段）
//   TestSaveAppConfigPatch_ConcurrentNoFieldLoss（跨入口并发无字段丢失，-race 验过）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));

import { bus } from "@/bus";
import { writeAppConfig } from "./config-write.ts";

function mockApp(over: Record<string, unknown> = {}) {
  const m = {
    // LoadAppConfig 仍在 mock 里：断言「writeAppConfig **不再**调它」用得上
    //（前端预读正是 P1 ③ 要消灭的 TOCTOU 来源）
    LoadAppConfig: vi.fn().mockResolvedValue({
      filesRoot: "/files",
      resourcepackRoot: "/rp",
      mcRoot: "/old-mc",
      linkMode: "copy",
      theme: "cyber",
      themeAuto: "off",
    }),
    SaveAppConfigPatch: vi.fn().mockResolvedValue(undefined),
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

describe("writeAppConfig — 薄透传给 Go 侧原子 patch", () => {
  it("patch 原样传给 SaveAppConfigPatch（字段不增不减、不填默认值）", async () => {
    const app = mockApp();
    await writeAppConfig({ mcRoot: "/new-mc" });
    expect(app.SaveAppConfigPatch).toHaveBeenCalledWith({ mcRoot: "/new-mc" });
  });

  // P1 ③ 核心断言：前端不得再预读磁盘。前端读一次 + 写一次之间存在 TOCTOU 窗口，
  // 期间别的写入口（SaveThresholds / SetDownloadMirror / 另一处 writeAppConfig）
  // 改的字段会被本次整份回写冲掉——这正是本次下沉要消灭的病。
  it("不调 LoadAppConfig（读盘必须发生在 Go 锁内，否则 TOCTOU 窗口重现）", async () => {
    const app = mockApp();
    await writeAppConfig({ theme: "warm" });
    expect(app.LoadAppConfig).not.toHaveBeenCalled();
  });

  // 单次 IPC：旧实现是「读 + 写」两次调用，count=1 锁住 IPC 次数不反弹
  it("单次绑定调用（读+写两步不再由前端编排）", async () => {
    const app = mockApp();
    await writeAppConfig({ filesRoot: "/f" });
    expect(app.SaveAppConfigPatch).toHaveBeenCalledTimes(1);
  });

  // 未传字段**不得**由前端补默认值：补了就是「前端以为的现值」，可能是陈旧快照。
  // 值域校验（THEME_VALID / LINK_MODE 合法值 / mcRoot 可达性）现由 Go 侧负责。
  it("未传字段保持缺席（不补 THEME_DARK / 不补 \"copy\"）", async () => {
    const app = mockApp();
    await writeAppConfig({ mcRoot: "/mc" });
    const p = app.SaveAppConfigPatch.mock.calls[0]![0];
    expect(p).toEqual({ mcRoot: "/mc" });
    expect("theme" in p).toBe(false);
    expect("linkMode" in p).toBe(false);
  });

  // localStorage 不参与写入决策：磁盘是备份权威，读 localStorage 兜底曾把磁盘备份冲掉
  it("localStorage 有 theme 时不参与 patch（磁盘是备份权威）", async () => {
    const app = mockApp();
    localStorage.setItem("theme", "ocean");
    localStorage.setItem("theme-auto", "time");
    await writeAppConfig({ mcRoot: "/mc" });
    const p = app.SaveAppConfigPatch.mock.calls[0]![0];
    expect(p.theme).toBeUndefined();
    expect(p.themeAuto).toBeUndefined();
  });

  // 显式空串 = 用户真的清空，**不是**「未传」（与 Go 侧 *string 的 nil 契约对应：
  // undefined→nil=未传，""→非 nil=写入空串）。若前端把 "" 归一成 undefined，
  // 「清空游戏目录」这类操作会静默失效。
  it("显式空串透传为 \"\"（清空语义，不与 undefined 混同）", async () => {
    const app = mockApp();
    await writeAppConfig({ mcRoot: "" });
    expect(app.SaveAppConfigPatch).toHaveBeenCalledWith({ mcRoot: "" });
  });

  it("返回值 = 本次 patch（供调用方同步内存快照）", async () => {
    mockApp();
    const resolved = await writeAppConfig({ filesRoot: "/new-files" });
    expect(resolved).toEqual({ filesRoot: "/new-files" });
  });

  // 2026-10 架构补件：落盘成功后广播 config:changed——配置读取方（app-sidebar 底部
  // MC 路径）据此零 IPC 即时刷新，不再靠每轮 reload 重拉。P1 ③ 起载荷 = 本次 patch
  // （键可选），订阅方按「键缺失 = 未改」消费。
  it("落盘成功 → 广播 config:changed，载荷 = 本次 patch", async () => {
    mockApp();
    const seen: unknown[] = [];
    const off = bus.on("config:changed", (p) => seen.push(p));
    const resolved = await writeAppConfig({ mcRoot: "/mc" });
    off();
    expect(seen).toEqual([resolved]);
    expect(seen[0]).toEqual({ mcRoot: "/mc" });
  });

  // 只在成功后发：失败时读取方保持旧显示值，比广播「半份配置」诚实
  it("落盘失败 → reject 且不广播（读取方保持旧值）", async () => {
    mockApp({ SaveAppConfigPatch: vi.fn().mockRejectedValue(new Error("save down")) });
    let emitted = 0;
    const off = bus.on("config:changed", () => {
      emitted++;
    });
    await expect(writeAppConfig({ mcRoot: "/mc" })).rejects.toThrow("save down");
    off();
    expect(emitted).toBe(0);
  });

  // Go 侧校验失败（mcRoot 不合法 / 写盘失败）必须让调用方看见——静默吞掉会让 UI 显示
  // 「保存成功」而磁盘未变（SaveAppConfig 历史上就踩过：返回 nil 是假成功）
  it("Go 侧校验错误原样抛出（不吞、不当成功）", async () => {
    mockApp({
      SaveAppConfigPatch: vi.fn().mockRejectedValue(new Error("游戏目录校验失败: 未检测到 .minecraft")),
    });
    await expect(writeAppConfig({ mcRoot: "C:/nope" })).rejects.toThrow("游戏目录校验失败");
  });
});
