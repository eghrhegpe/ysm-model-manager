// ===== app-tree 工具函数测试（ADR-021 扩展）=====
// flashBtn：添加 flash class，400ms 后移除；null 安全。
import { describe, it, expect, vi, afterEach } from "vitest";
import { flashBtn } from "./utils.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("flashBtn", () => {
  it("null 入参不抛错", () => {
    expect(() => flashBtn(null)).not.toThrow();
  });

  it("添加 flash class", () => {
    const el = { classList: { add: vi.fn(), remove: vi.fn() } } as unknown as HTMLElement;
    flashBtn(el);
    expect(el.classList.add).toHaveBeenCalledWith("flash");
  });

  it("400ms 后移除 flash class", () => {
    vi.useFakeTimers();
    const el = { classList: { add: vi.fn(), remove: vi.fn() } } as unknown as HTMLElement;
    flashBtn(el);
    vi.advanceTimersByTime(399);
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });
});
