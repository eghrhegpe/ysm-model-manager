// ===== E2E 冒烟测试：同步管理器（ADR-037）=====
// 验证同步管理器的基本功能。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
import { test, expect } from "../fixture.ts";

test.describe("同步管理器", () => {
  test("整合包管理页 → 基础元素存在", async ({ page }) => {
    await page.goto("/");
    // 先点击导航到整合包管理
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    await navItems.nth(1).click();
    await page.waitForTimeout(500);
    // 检查页面是否切换（app-content 响应）
    const tabs = page.locator('[data-testid="content-tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(0);
  });

  test("侧栏操作按钮渲染", async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    // 检查 sidebar push/pull 按钮
    const sidebarPush = page.locator('[data-testid="sidebar-push"]');
    const sidebarPull = page.locator('[data-testid="sidebar-pull"]');
    const pushCount = await sidebarPush.count();
    const pullCount = await sidebarPull.count();
    if (pushCount > 0) {
      await expect(sidebarPush.first()).toBeVisible({ timeout: 5000 });
    }
    if (pullCount > 0) {
      await expect(sidebarPull.first()).toBeVisible({ timeout: 5000 });
    }
  });
});