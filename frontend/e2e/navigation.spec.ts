// ===== E2E 冒烟测试：导航切换（ADR-037）=====
// 验证核心导航路径：点击 nav-item → 页面切换。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
import { test, expect } from "../fixture.ts";

test.describe("导航切换", () => {
  test("首页加载 → 渲染导航栏 6 项", async ({ page }) => {
    await page.goto("/");
    // 等待导航栏渲染
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    await expect(navItems).toHaveCount(6);
  });

  test("点击「整合包管理」→ 页内容切换", async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    // 点击第二个导航项（整合包管理）
    await navItems.nth(1).click();
    // 页面内容应切换（app-content 响应 nav:change 事件）
    // 检查是否有内容标签出现
    await expect(page.locator('[data-testid="content-tab"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("依次点击所有导航项 → 不抛错", async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    const count = await navItems.count();
    for (let i = 0; i < count; i++) {
      await navItems.nth(i).click();
      // 短暂等待以确保页面切换完成
      await page.waitForTimeout(500);
    }
    // 遍历完不抛错即通过
    expect(true).toBe(true);
  });
});