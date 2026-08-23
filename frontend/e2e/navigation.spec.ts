// ===== E2E 冒烟测试：导航切换（ADR-037）=====
// 验证核心导航路径：点击 nav-item → 页面切换。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

test.describe("导航切换", () => {
  test("首页加载 → 渲染导航栏 7 项", async ({ page }) => {
    await gotoApp(page);
    // 等待导航栏渲染
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems).toHaveCount(7);
  });

  test("点击「整合包管理」→ 页内容切换", async ({ page }) => {
    await gotoApp(page);
    const navItems = page.locator('[data-testid="nav-item"]');
    // 点击第二个导航项（整合包管理）
    await navItems.nth(1).click();
    // 页面内容应切换（app-content 响应 nav:change 事件）
    // 断言 instances 页实际元素（原断言 content-tab 是 repository 页的标签，
    // 切换后不可见属假绿——依赖旧时序才通过；实例页稳定钩子是 ins-content）
    await expect(page.locator("#ins-content")).toBeVisible({ timeout: 5000 });
  });

  test("依次点击所有导航项 → 不抛错", async ({ page }) => {
    await gotoApp(page);
    const navItems = page.locator('[data-testid="nav-item"]');
    const count = await navItems.count();
    for (let i = 0; i < count; i++) {
      // P2 修复（子代理审计）：跳过 workshop 项——app-content/index.ts:214-216
      // 进入工坊页后 nav.style.display="none"（全宽浏览），后续 nth(i).click()
      // 目标不可见 → Playwright 等 15s 超时 → 测试确定性失败（retries:0 直接红）
      const dataPage = await navItems
        .nth(i)
        .getAttribute("data-page");
      if (dataPage === "workshop") continue;
      await navItems.nth(i).click();
      // 等待 nav-item 高亮切换（弱断言改实断言：点击后当前项应有 active 态）
      await expect(navItems.nth(i)).toHaveClass(/active/, { timeout: 5000 });
    }
  });
});
