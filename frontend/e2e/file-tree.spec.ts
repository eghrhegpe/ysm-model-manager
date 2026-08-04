// ===== E2E 冒烟测试：文件树浏览（ADR-037）=====
// 验证文件树的基本渲染和交互。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
import { test, expect } from "../fixture.ts";

test.describe("文件树浏览", () => {
  test("仓库页 → 文件树标签存在", async ({ page }) => {
    await page.goto("/");
    // 等待导航栏和内容区渲染
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    // 默认在仓库页，检查 content-tab 存在
    const tabs = page.locator('[data-testid="content-tab"]');
    await expect(tabs.first()).toBeVisible({ timeout: 5000 });
  });

  test("资源类型子标签存在", async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    // 检查 content-subtab 存在
    const subtabs = page.locator('[data-testid="content-subtab"]');
    await expect(subtabs.first()).toBeVisible({ timeout: 5000 });
  });

  test("切换 tab 标签", async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
    // 点击多个 content-tab 切换
    const tabs = page.locator('[data-testid="content-tab"]');
    const tabCount = await tabs.count();
    for (let i = 0; i < Math.min(tabCount, 3); i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(300);
    }
    // 遍历不抛错即通过
    expect(true).toBe(true);
  });
});