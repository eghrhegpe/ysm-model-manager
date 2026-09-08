// @vitest-environment node
// ===== storage.ts localStorage 安全读写独立测试 =====
// 子代理审计 P3：storage 无独立测试且 safeRemove 零覆盖（仅 app-modules.test 间接
// 覆盖 safeGet/safeSet 正常路径）。此处覆盖：正常透传、存储抛错降级（safeGet→null、
// safeSet/safeRemove 静默不抛）、safeRemove 清零、互不污染。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeGet, safeSet, safeRemove, safeGetJSON } from "./storage.ts";

// node 环境无 localStorage——内存实现（对齐 happy-dom 语义；makeStorageThrow 覆盖抛错版）
const memStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
})();

/** 让 localStorage.getItem/setItem/removeItem 抛错（模拟隐私模式/存储禁用） */
function makeStorageThrow(): void {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => {
      throw new Error("SecurityError: access is denied");
    }),
    setItem: vi.fn(() => {
      throw new Error("QuotaExceededError");
    }),
    removeItem: vi.fn(() => {
      throw new Error("SecurityError");
    }),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  });
}

describe("storage 安全读写", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("localStorage", memStorage);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("safeGet 正常透传：已存值返回、未存返回 null", () => {
    localStorage.setItem("k1", "v1");
    expect(safeGet("k1")).toBe("v1");
    expect(safeGet("missing")).toBeNull();
  });

  it("safeGet 存储抛错 → 返回 null（调用方走默认值回退，不中断）", () => {
    makeStorageThrow();
    expect(safeGet("k1")).toBeNull();
  });

  it("safeSet 正常写入可读回", () => {
    safeSet("k2", "v2");
    expect(localStorage.getItem("k2")).toBe("v2");
  });

  it("safeSet 存储抛错 → 静默不抛（调用方不中断）", () => {
    makeStorageThrow();
    expect(() => safeSet("k2", "v2")).not.toThrow();
  });

  it("safeRemove 正常删除", () => {
    localStorage.setItem("k3", "v3");
    safeRemove("k3");
    expect(localStorage.getItem("k3")).toBeNull();
  });

  it("safeRemove 存储抛错 → 静默不抛", () => {
    makeStorageThrow();
    expect(() => safeRemove("k3")).not.toThrow();
  });

  it("safeGetJSON 正常解析已存 JSON", () => {
    safeSet("json-k", JSON.stringify({ a: 1, b: "x" }));
    expect(safeGetJSON("json-k", { a: 0, b: "" })).toEqual({ a: 1, b: "x" });
  });

  it("safeGetJSON 未命中 key → 返回 fallback", () => {
    expect(safeGetJSON("json-missing", [])).toEqual([]);
  });

  it("safeGetJSON 损坏 JSON → 返回 fallback（不抛错中断启动链）", () => {
    safeSet("json-corrupt", "{not valid json[");
    expect(safeGetJSON("json-corrupt", { ok: false })).toEqual({ ok: false });
  });

  it("safeGet/safeSet/safeRemove 互不污染（不同 key 独立）", () => {
    safeSet("a", "1");
    safeSet("b", "2");
    expect(safeGet("a")).toBe("1");
    expect(safeGet("b")).toBe("2");
    safeRemove("a");
    expect(safeGet("a")).toBeNull();
    expect(safeGet("b")).toBe("2");
  });
});
