// ===== clipboard.copyText 契约测试（审计④收口）=====
// 覆盖：Clipboard API 成功 / 拒绝降级 textarea+execCommand 成功/失败 /
//       navigator.clipboard 不存在（非安全上下文）走降级 / execCommand 抛错清理。
// 默认 happy-dom 环境，可操作 document.body。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard.ts";

function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

describe("copyText", () => {
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    // 恢复 execCommand（若原值为 undefined 也恢复 undefined）
    Object.defineProperty(document, "execCommand", {
      value: originalExecCommand,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("Clipboard API 成功 → true", async () => {
    stubClipboard({ writeText: vi.fn(async () => {}) });
    await expect(copyText("hi")).resolves.toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Clipboard API 拒绝且 execCommand 成功 → true 并清理 textarea", async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => true),
      configurable: true,
    });
    await expect(copyText("hi")).resolves.toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Clipboard API 拒绝且 execCommand 返回 false → false 并清理 textarea", async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => false),
      configurable: true,
    });
    await expect(copyText("hi")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("navigator.clipboard 不存在（非安全上下文）→ 走降级路径", async () => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => true),
      configurable: true,
    });
    await expect(copyText("hi")).resolves.toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("execCommand 抛错 → false 且清理 textarea", async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => { throw new Error("no user gesture"); }),
      configurable: true,
    });
    await expect(copyText("hi")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("降级路径把原文写入 textarea 并调用 select", async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    const select = vi.fn();
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => true), configurable: true });
    // 拦截动态创建的 textarea，验证 select 被调用
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag) as HTMLTextAreaElement;
      if (tag === "textarea") el.select = select;
      return el;
    });

    await expect(copyText("hi")).resolves.toBe(true);
    expect(select).toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });
});