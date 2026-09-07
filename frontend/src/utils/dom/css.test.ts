// @vitest-environment node
// ===== css.ts Shadow DOM 样式常量基础断言 =====
// 防止误改导致 UI 回归：关键类名/选择器必须存在于对应常量中。
import { describe, it, expect } from "vitest";
import { btnBaseCSS, focusVisibleCSS } from "./css.ts";

describe("btnBaseCSS", () => {
  it("包含 .btn-base 主类名", () => {
    expect(btnBaseCSS).toContain(".btn-base");
  });

  it("包含 :focus-visible 可访问性规则", () => {
    expect(btnBaseCSS).toContain(":focus-visible");
  });

  it("包含 disabled 状态样式", () => {
    expect(btnBaseCSS).toContain(":disabled");
  });

  it("包含 primary/warn/danger/accent 变体类", () => {
    expect(btnBaseCSS).toContain(".primary");
    expect(btnBaseCSS).toContain(".danger");
    expect(btnBaseCSS).toContain(".warn");
    expect(btnBaseCSS).toContain(".accent");
  });
});

describe("focusVisibleCSS", () => {
  it("包含 :focus-visible 选择器", () => {
    expect(focusVisibleCSS).toContain(":focus-visible");
  });
});
