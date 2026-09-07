// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const busEmit = vi.fn();
vi.mock("../bus.ts", () => ({
  bus: { emit: (...a: unknown[]) => busEmit(...a) },
}));
vi.mock("../utils/dom/errors.ts", () => ({
  friendlyError: (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
}));

import { loadView } from "../app-modules.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadView 懒加载", () => {
  it("importer 成功 → 无 toast", async () => {
    const importer = vi.fn(() => Promise.resolve());
    loadView("test-ok", importer);
    await new Promise((r) => setTimeout(r, 0));
    expect(importer).toHaveBeenCalledOnce();
    expect(busEmit).not.toHaveBeenCalled();
  });

  it("importer 失败 → toast:show 含错误信息", async () => {
    const importer = vi.fn(() => Promise.reject(new Error("network timeout")));
    loadView("test-fail", importer);
    await new Promise((r) => setTimeout(r, 0));
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "❌ network timeout",
      duration: 5000,
      type: "error",
    });
  });

  it("importer 抛非 Error → toast 用 fallback 文案", async () => {
    const importer = vi.fn(() => Promise.reject("string err"));
    loadView("test-err", importer);
    await new Promise((r) => setTimeout(r, 0));
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "❌ 组件加载失败",
      duration: 5000,
      type: "error",
    });
  });

  it("importer 抛 null → toast 用 fallback 文案", async () => {
    const importer = vi.fn(() => Promise.reject(null));
    loadView("test-null", importer);
    await new Promise((r) => setTimeout(r, 0));
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "❌ 组件加载失败",
      duration: 5000,
      type: "error",
    });
  });
});
