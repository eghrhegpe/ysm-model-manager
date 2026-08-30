// ===== E2E 测试：Toast 通知（ADR-037）=====
// 验证 toast 通知的显示、关闭功能。
// 走真实 bus.emit 路径（window.bus 由 bus.ts 暴露），非 CustomEvent 模拟。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

test.describe("Toast 通知", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("bus.emit toast:show → toast 元素出现", async ({ page }) => {
    // 通过 window.bus.emit 走真实事件路径
    const shown = await page.evaluate(() => {
      if (typeof window.bus?.emit !== "function") return false;
      window.bus.emit("toast:show", { msg: "E2E 测试消息", duration: 3000 });
      return true;
    });
    expect(shown).toBe(true);

    // 按消息文本定位自己的 toast（index.html 每次加载会弹欢迎 toast，
    // first()/last() 会命中它导致假红/假绿——filter 消除污染）
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "E2E 测试消息" });
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText("E2E 测试消息");
  });

  test("close 按钮 → 移除 toast", async ({ page }) => {
    await page.evaluate(() => {
      window.bus?.emit("toast:show", { msg: "可关闭的 toast", duration: 5000 });
    });
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "可关闭的 toast" });
    await expect(toast).toBeVisible({ timeout: 3000 });

    // 点击关闭按钮
    const closeBtn = toast.locator('[data-testid="toast-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 2000 });
    await closeBtn.click();
    // 等待 slideOut 动画完成（自动重试替代 waitForTimeout）
    await expect(toast).not.toBeVisible({ timeout: 3000 });
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
        undo: () => {
          (window as unknown as { e2eUndoCallback: () => void }).e2eUndoCallback();
        },
      });
    });
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "可撤销" });
    await expect(toast).toBeVisible({ timeout: 3000 });

    // 点击撤销按钮（poll 等待异步回调，替代固定 300ms）
    const undoBtn = toast.locator('[data-testid="toast-undo"]');
    await expect(undoBtn).toBeVisible({ timeout: 2000 });
    await undoBtn.click();
    await expect.poll(() => undoCalled, { timeout: 3000 }).toBe(true);
  });

  test("type 参数 → 正确添加 CSS class", async ({ page }) => {
    await page.evaluate(() => {
      window.bus?.emit("toast:show", { msg: "错误消息", type: "error", duration: 3000 });
    });
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "错误消息" });
    await expect(toast).toBeVisible({ timeout: 3000 });
    // 验证 error class
    await expect(toast).toHaveClass(/error/);
  });
});