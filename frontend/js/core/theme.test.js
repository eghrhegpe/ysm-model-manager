// ===== 主题切换测试（ADR-021 扩展）=====
// theme.ts 无导出（纯副作用模块）：注入涟漪样式 + #btn-theme 点击循环切换。
// 预置按钮 + 动态 import，使模块加载时 bindThemeBtn 能绑定点击。
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

describe("theme 模块", () => {
  let btn;
  const applyThemeMock = vi.fn();

  beforeAll(async () => {
    // 预置按钮 → 动态 import，模块加载时 bindThemeBtn 立即绑定
    btn = document.createElement("button");
    btn.id = "btn-theme";
    document.body.appendChild(btn);
    window.applyTheme = applyThemeMock;
    await import("./theme.ts");
  });

  beforeEach(() => {
    applyThemeMock.mockClear();
  });

  it("模块加载注入涟漪动画样式", () => {
    const style = [...document.head.querySelectorAll("style")].find((s) =>
      s.textContent.includes("@keyframes themeRipple"),
    );
    expect(style).toBeTruthy();
  });

  it("点击按钮按 TMODES 循环切换主题并更新 localStorage/按钮文本", () => {
    localStorage.setItem("theme", "warm");
    btn.click();
    expect(applyThemeMock).toHaveBeenCalledWith("pro");
    expect(localStorage.getItem("theme")).toBe("pro");
    expect(btn.textContent).toBe("⚪ 极简深邃");
  });

  it("system（最后一个）之后回到 cyber（循环）", () => {
    localStorage.setItem("theme", "system");
    btn.click();
    expect(applyThemeMock).toHaveBeenCalledWith("cyber");
    expect(localStorage.getItem("theme")).toBe("cyber");
    expect(btn.textContent).toBe("🌙 赛博霓虹");
  });

  it("未知主题回退到列表首位 cyber", () => {
    localStorage.setItem("theme", "unknown-mode");
    btn.click();
    expect(applyThemeMock).toHaveBeenCalledWith("cyber");
    expect(localStorage.getItem("theme")).toBe("cyber");
  });
});
