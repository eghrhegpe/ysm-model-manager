// ===== E2E 测试：侧栏 push/pull 下拉菜单（ADR-037）=====
// 验证 app-sidebar 的推送/拉取下拉菜单：按钮存在、点击展开、菜单项渲染。
// app-sidebar 在 app-content shadow root 内（instances 页），且有自身 shadow root——
// 两层嵌套，用 page.evaluate 穿透。
import { test, expect } from "./fixture.ts";

/** 导航到整合包管理页，等待 app-sidebar 渲染完成 */
async function gotoInstances(page: import("@playwright/test").Page): Promise<void> {
  const navItems = page.locator('[data-testid="nav-item"]');
  await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  await navItems.nth(1).click(); // 整合包管理
  await page.waitForTimeout(1500);
}

/** 在嵌套 Shadow DOM 中查询 sidebar push/pull 按钮是否存在 */
async function getSidebarButtons(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const content = document.querySelector("app-content");
    const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
    if (!sidebar?.shadowRoot) return { push: 0, pull: 0 };
    return {
      push: sidebar.shadowRoot.querySelectorAll('[data-testid="sidebar-push"]').length,
      pull: sidebar.shadowRoot.querySelectorAll('[data-testid="sidebar-pull"]').length,
    };
  });
}

/** 点击 push/pull 按钮并返回下拉菜单是否可见 */
async function clickSidebarButton(
  page: import("@playwright/test").Page,
  testid: string,
): Promise<boolean> {
  return page.evaluate((tid) => {
    const content = document.querySelector("app-content");
    const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
    if (!sidebar?.shadowRoot) return false;
    const btn = sidebar.shadowRoot.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  }, testid);
}

/** 读取下拉菜单中的资源类型选项数量 */
async function getMenuItems(page: import("@playwright/test").Page, menuId: string): Promise<number> {
  return page.evaluate((mid) => {
    const content = document.querySelector("app-content");
    const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
    if (!sidebar?.shadowRoot) return 0;
    const menu = sidebar.shadowRoot.getElementById(mid);
    return menu ? menu.querySelectorAll(".dd-item").length : 0;
  }, menuId);
}

test.describe("侧栏 push/pull 菜单", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await gotoInstances(page);
  });

  test("整合包页 → push/pull 按钮存在", async ({ page }) => {
    // 轮询等待 sidebar 渲染（instances 数据加载）
    const deadline = Date.now() + 8000;
    let btns = { push: 0, pull: 0 };
    while (Date.now() < deadline) {
      btns = await getSidebarButtons(page);
      if (btns.push > 0 && btns.pull > 0) break;
      await page.waitForTimeout(300);
    }
    expect(btns.push).toBeGreaterThan(0);
    expect(btns.pull).toBeGreaterThan(0);
  });

  test("点击推送按钮 → 下拉菜单显示资源类型选项", async ({ page }) => {
    const deadline = Date.now() + 8000;
    let btns = { push: 0, pull: 0 };
    while (Date.now() < deadline) {
      btns = await getSidebarButtons(page);
      if (btns.push > 0) break;
      await page.waitForTimeout(300);
    }
    expect(btns.push).toBeGreaterThan(0);

    const clicked = await clickSidebarButton(page, "sidebar-push");
    expect(clicked).toBe(true);
    await page.waitForTimeout(300);

    // 下拉菜单应包含资源类型选项（全部/YSM/MMD/VRC/资源包/光影包/蓝图/投影 = 8 项）
    const itemCount = await getMenuItems(page, "sidebar-push-menu");
    expect(itemCount).toBeGreaterThanOrEqual(3);
  });

  test("点击拉取按钮 → 下拉菜单显示资源类型选项", async ({ page }) => {
    const deadline = Date.now() + 8000;
    let btns = { push: 0, pull: 0 };
    while (Date.now() < deadline) {
      btns = await getSidebarButtons(page);
      if (btns.pull > 0) break;
      await page.waitForTimeout(300);
    }
    expect(btns.pull).toBeGreaterThan(0);

    const clicked = await clickSidebarButton(page, "sidebar-pull");
    expect(clicked).toBe(true);
    await page.waitForTimeout(300);

    const itemCount = await getMenuItems(page, "sidebar-pull-menu");
    expect(itemCount).toBeGreaterThanOrEqual(3);
  });
});