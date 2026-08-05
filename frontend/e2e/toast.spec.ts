// ===== E2E 测试：Toast 通知（ADR-037）=====
// 验证 toast 通知的显示、关闭功能。
// 走真实 bus.emit 路径（window.bus 由 bus.ts 暴露），非 CustomEvent 模拟。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
import { test, expect } from "./fixture.ts";

test.describe("Toast 通知", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 确保导航栏渲染完成（页面完全加载）
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  });

  test("bus.emit toast:show → toast 元素出现", async ({ page }) => {
    // 通过 window.bus.emit 走真实事件路径
    const shown = await page.evaluate(() => {
      if (typeof window.bus?.emit !== "function") return false;
      window.bus.emit("toast:show", { msg: "E2E 测试消息", duration: 3000 });
      return true;
    });
    expect(shown).toBe(true);

    // 等待 toast 渲染
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
    await expect(toast.first()).toContainText("E2E 测试消息");
  });

  test("close 按钮 → 移除 toast", async ({ page }) => {
    await page.evaluate(() => {
      window.bus?.emit("toast:show", { msg: "可关闭的 toast", duration: 5000 });
    });
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });

    // 点击关闭按钮
    const closeBtn = toast.locator(".close-btn");
    await expect(closeBtn).toBeVisible({ timeout: 2000 });
    await closeBtn.click();
    // 等待 slideOut 动画完成
    await page.waitForTimeout(500);
    await expect(toast).not.toBeVisible();
  });

  test("撤销按钮 → 触发回调", async ({ page }) => {
    let undoCalled = false;
    await page.exposeFunction("e2eUndoCallback", () => {
      undoCalled = true;
    });
    await page.evaluate(() => {
      window.bus?.emit("toast:show", {
        msg: "可撤销",
        duration: 5000,
        undo: () => (window as unknown as Record<string, unknown>).e2eUndoCallback(),
      });
    });
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });

    // 点击撤销按钮
    const undoBtn = toast.locator(".undo-btn");
    await expect(undoBtn).toBeVisible({ timeout: 2000 });
    await undoBtn.click();
    await page.waitForTimeout(300);
    expect(undoCalled).toBe(true);
  });

  test("type 参数 → 正确添加 CSS class", async ({ page }) => {
    await page.evaluate(() => {
      window.bus?.emit("toast:show", { msg: "错误消息", type: "error", duration: 3000 });
    });
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
    // 验证 error class
    await expect(toast.first()).toHaveClass(/error/);
  });
});