// @vitest-environment node
// ===== perf-common.ts 共享工具层测试 =====
// 覆盖：sectionHeader 纯函数 + 守卫/错误辅助的输入输出契约。
import { describe, it, expect, vi } from "vitest";

// 先 mock bus（bindPerfCopyHandlers 用得到）
vi.mock("@/bus", () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import { sectionHeader, bindPerfCopyHandlers, getOutBox, setBusy, setErrorMsg, setErrorResp, setErrorCatch, respHasOutput } from "./perf-common.ts";

describe("sectionHeader", () => {
  it("icon + label → 带 icon 和 label 的 HTML", () => {
    const html = sectionHeader("📊", "性能概览");
    expect(html).toContain("📊");
    expect(html).toContain("性能概览");
  });

  it("带 rawText → HTML 包含 rawText（encodeURIComponent 编码）", () => {
    const html = sectionHeader("🔍", "慢查询", "TOP 10");
    expect(html).toContain("🔍");
    expect(html).toContain("慢查询");
    expect(html).toContain(encodeURIComponent("TOP 10"));
  });

  it("无 rawText → 不抛错", () => {
    expect(() => sectionHeader("⚙", "配置")).not.toThrow();
  });

  it("空字符串参数 → 不抛错", () => {
    expect(() => sectionHeader("", "")).not.toThrow();
  });
});

describe("getOutBox", () => {
  it("找不到元素返回 null", () => {
    const root = { getElementById: vi.fn(() => null) } as unknown as ShadowRoot;
    expect(getOutBox(root, "nope")).toBeNull();
  });
});

describe("setBusy / setErrorMsg", () => {
  it("setBusy 注入占位文案", () => {
    const el = { innerHTML: "" } as HTMLElement;
    setBusy(el);
    expect(el.innerHTML).toContain("⏳");
  });

  it("setErrorMsg 注入错误文案（经 esc 转义）", () => {
    const el = { innerHTML: "" } as HTMLElement;
    const esc = vi.fn((s: string) => s.replace(/</g, "&lt;")) as unknown as (s: unknown) => string;
    setErrorMsg(el, "<script>", esc);
    expect(esc).toHaveBeenCalledWith("<script>");
    // ADR-238：图标由 emoji 改走 SVG（随主题变色 + 随字号缩放），断言形态随之更新。
    // 断言「是 SVG 图标」而非某个具体路径，避免图标库改路径时本测试无谓报警。
    expect(el.innerHTML).toContain('<svg class="ws-icon"');
    // 转义契约不变：文案仍须经 esc（注入意图未因换图标而放松）
    expect(el.innerHTML).toContain("&lt;script>");
  });
});

describe("setErrorResp / setErrorCatch", () => {
  it("setErrorResp 取 resp.error.message", () => {
    const el = { innerHTML: "" } as HTMLElement;
    const resp = { status: "error", error: { message: "boom" } } as any;
    setErrorResp(el, resp, (s: unknown) => s as string);
    expect(el.innerHTML).toContain("boom");
  });

  it("setErrorCatch 取 safeErrorMessage", () => {
    const el = { innerHTML: "" } as HTMLElement;
    setErrorCatch(el, new Error("x"), (s: unknown) => s as string);
    expect(el.innerHTML).toContain("x");
  });
});

describe("respHasOutput", () => {
  it("success + output → true", () => {
    expect(respHasOutput({ status: "success", data: { output: "ok" } } as any)).toBe(true);
  });
  it("success + 无 output → false", () => {
    expect(respHasOutput({ status: "success", data: {} } as any)).toBe(false);
  });
  it("error → false", () => {
    expect(respHasOutput({ status: "error" } as any)).toBe(false);
  });
  // 类型谓词必须保证断言出来的类型真的成立：output 非字符串时返回 true 会让消费方
  // 按 string 调 .split() 等即 TypeError（与 cli-bridge 的 `as` 断言同源病）
  it("success + output 非字符串 → false（类型谓词诚实性）", () => {
    expect(respHasOutput({ status: "success", data: { output: 123 } } as any)).toBe(false);
    expect(respHasOutput({ status: "success", data: { output: null } } as any)).toBe(false);
    expect(respHasOutput({ status: "success", data: { output: {} } } as any)).toBe(false);
  });
  it("success + output 空串 → false（空输出与无输出同义）", () => {
    expect(respHasOutput({ status: "success", data: { output: "" } } as any)).toBe(false);
  });
});

describe("bindPerfCopyHandlers", () => {
  it("无对应容器 → 不抛错", () => {
    const root = { getElementById: vi.fn(() => null) } as unknown as ShadowRoot;
    expect(() => bindPerfCopyHandlers(root)).not.toThrow();
  });
});
