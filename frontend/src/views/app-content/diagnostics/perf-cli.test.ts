// @vitest-environment node
// ===== perf-cli.ts 纯函数堆测试（补盲区）=====
// 覆盖唯一导出 sectionHeader：icon + label + rawText → HTML 字符串。
import { describe, it, expect } from "vitest";
import { sectionHeader } from "./perf-cli.ts";

describe("sectionHeader", () => {
  it("icon + label → 带 icon 和 label 的 HTML", () => {
    const html = sectionHeader("📊", "性能概览");
    expect(html).toContain("📊");
    expect(html).toContain("性能概览");
  });

  it("带 rawText → HTML 包含 rawText", () => {
    const html = sectionHeader("🔍", "慢查询", "TOP 10");
    expect(html).toContain("🔍");
    expect(html).toContain("慢查询");
    expect(html).toContain("TOP 10");
  });

  it("无 rawText → 不抛错", () => {
    expect(() => sectionHeader("⚙", "配置")).not.toThrow();
  });

  it("空字符串参数 → 不抛错", () => {
    expect(() => sectionHeader("", "")).not.toThrow();
  });
});
