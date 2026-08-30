// ===== E2E 冒烟测试：同步管理器（ADR-037）=====
// 验证同步管理器的基本功能。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";

test.describe("同步管理器", () => {
  test("整合包管理页 → 页内容切换", async ({ page }) => {
    await gotoApp(page);
    await navItem(page, "instances").click();
    // 断言 instances 页真实内容（原 tabCount >= 0 恒真且 content-tab 仅存在于
    // repository 页，切换后必然为 0——未验证任何行为）
    await expect(page.locator('[data-testid="ins-content"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("侧栏操作按钮渲染", async ({ page }) => {
    await gotoApp(page);
    // P1 修复（子代理审计）：原实现停在 repository 页，而 app-sidebar 只在 instances
    // 页渲染（tpl.ts）→ push/pull count 恒 0 → if 条件断言零断言通过（假绿）。
    // 先导航到整合包管理页再硬断言按钮可见
    await navItem(page, "instances").click();
    await expect(page.locator('[data-testid="ins-content"]')).toBeVisible({
      timeout: 5000,
    });
    // 检查 sidebar push/pull 按钮（instances 页必渲染）
    const sidebarPush = page.locator('[data-testid="sidebar-push"]');
    const sidebarPull = page.locator('[data-testid="sidebar-pull"]');
    await expect(sidebarPush.first()).toBeVisible({ timeout: 5000 });
    await expect(sidebarPull.first()).toBeVisible({ timeout: 5000 });
  });
});