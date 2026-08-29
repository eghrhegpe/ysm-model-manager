// ===== debug.dbg 环形缓冲 + debugGetSpec 测试（happy-dom 版）=====
// 兄弟文件 debug.test.ts 为 node 环境（ENABLED=false，dbg 直通）；本文件用 happy-dom
// 让 ENABLED=true，锁 dbg 的 console 输出、_DBG_RING 环形缓冲（200 上限一次性截断）、
// ring 写入失败兜底、safeStr JSON.stringify undefined 分支、window.debugGetSpec 装配。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { dbg, safeStr } from "./debug.ts";

beforeEach(() => {
  window._DBG_RING = [];
  localStorage.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dbg 环形缓冲", () => {
  it("输出 [DBG:tag] 前缀并写入 ring（args 经 safeStr 序列化）", () => {
    dbg("ui-click", { id: "btn" }, "plain");
    expect(console.log).toHaveBeenCalledWith("[DBG:ui-click]", { id: "btn" }, "plain");
    const ring = window._DBG_RING;
    expect(ring).toHaveLength(1);
    expect(ring[0].tag).toBe("ui-click");
    expect(ring[0].args).toEqual([JSON.stringify({ id: "btn" }), "plain"]);
    expect(ring[0].t).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("超 200 条一次性截断（外部预置大 ring 也收敛）", () => {
    // P3 回归护栏：外部预置 250 条 → 一次 dbg 后必须收敛到 200
    for (let i = 0; i < 250; i++) window._DBG_RING.push({ t: "x", tag: "seed", args: [] });
    dbg("burst", 1);
    expect(window._DBG_RING.length).toBe(200);
    expect(window._DBG_RING[0].tag).toBe("seed"); // 最旧的被裁掉
    expect(window._DBG_RING[199].tag).toBe("burst");
  });

  it("ring 写入抛错 → console.error 兜底不炸", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    (window as unknown as { _DBG_RING: unknown })._DBG_RING = {
      push: () => {
        throw new Error("quota");
      },
    };
    expect(() => dbg("boom-tag", 1)).not.toThrow();
    expect(err).toHaveBeenCalledWith("[DBG] ring 写入失败:", expect.any(Error));
  });
});

describe("safeStr JSON.stringify undefined 分支", () => {
  it("函数 / symbol（stringify 为 undefined）→ String 兜底", () => {
    const fn = () => 42;
    expect(safeStr(fn)).toBe(String(fn));
    expect(safeStr(Symbol("s"))).toBe(String(Symbol("s")));
  });
});

describe("window.debugGetSpec 装配", () => {
  it("GetModel3DSpec 成功 → 返回解析后的 spec 并写 dbg ring", async () => {
    getAppMock.mockResolvedValue({
      GetModel3DSpec: vi.fn().mockResolvedValue(JSON.stringify({ bones: [1, 2] })),
    });
    const spec = await window.debugGetSpec("/models/a.ysm");
    expect(spec).toEqual({ bones: [1, 2] });
    expect(window._DBG_RING.some((e) => e.tag === "model3d")).toBe(true);
  });

  it("GetModel3DSpec 拒绝 → console.error + 返回 null", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    getAppMock.mockResolvedValue({
      GetModel3DSpec: vi.fn().mockRejectedValue(new Error("spec down")),
    });
    expect(await window.debugGetSpec()).toBeNull();
    expect(err).toHaveBeenCalledWith("[DEBUG]", expect.any(Error));
  });
});
