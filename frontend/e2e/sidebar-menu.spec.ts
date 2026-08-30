// ===== E2E 测试：侧栏 push/pull 下拉菜单（ADR-037）=====
// 验证 app-sidebar 的推送/拉取下拉菜单：按钮存在、点击展开、菜单项渲染。
// 切页用 page.evaluate 原生 click（Playwright locator 点击 app-nav shadow 内元素不可靠）。
// app-sidebar 在 app-content shadow root 内且有自身 shadow root——两层嵌套用 evaluate 穿透。
import { test, expect } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";
import { ALL_RESOURCE_TYPES } from "../src/utils/resource/types.ts";

/** 导航到整合包管理页（原生 click 触发 nav:change） */
async function gotoInstances(page: import("@playwright/test").Page): Promise<void> {
  await gotoApp(page);

  // 等待 app-content 挂载完成（nav:change 监听器注册后点击才不丢失）
  await page.evaluate(async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const content = document.querySelector("app-content") as { _current?: string } | null;
      if (content && content._current) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  // 原生点击 instances 导航项
  await page.evaluate(() => {
    const nav = document.querySelector("app-nav") as { shadowRoot?: ShadowRoot } | null;
    const items = nav?.shadowRoot?.querySelectorAll('[data-testid="nav-item"]');
    if (items?.[1]) (items[1] as HTMLElement).click();
  });

  // 轮询等待 _current 切到 instances
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const current = await page.evaluate(
      () => (document.querySelector("app-content") as { _current?: string } | null)?._current,
    );
    if (current === "instances") break;
    await page.waitForTimeout(200);
  }
}

/** 轮询等待 sidebar 渲染出 push/pull 按钮 */
async function waitForSidebarButtons(page: import("@playwright/test").Page, timeout = 8000): Promise<{ push: number; pull: number }> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const btns = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
      if (!sidebar?.shadowRoot) return { push: 0, pull: 0 };
      return {
        push: sidebar.shadowRoot.querySelectorAll('[data-testid="sidebar-push"]').length,
        pull: sidebar.shadowRoot.querySelectorAll('[data-testid="sidebar-pull"]').length,
      };
    });
    if (btns.push > 0 && btns.pull > 0) return btns;
    await page.waitForTimeout(300);
  }
  return { push: 0, pull: 0 };
}

/** 点击 push/pull 按钮（evaluate 原生 click） */
async function clickSidebarButton(
  page: import("@playwright/test").Page,
  testid: string,
): Promise<boolean> {
  return page.evaluate((tid) => {
    const content = document.querySelector("app-content");
    const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
    const btn = sidebar?.shadowRoot?.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  }, testid);
}

/** 读取下拉菜单中的资源类型选项数量（menuTestid = sidebar-push-menu / sidebar-pull-menu） */
async function getMenuItems(page: import("@playwright/test").Page, menuTestid: string): Promise<number> {
  return page.evaluate((tid) => {
    const content = document.querySelector("app-content");
    const sidebar = content?.shadowRoot?.querySelector("app-sidebar");
    if (!sidebar?.shadowRoot) return 0;
    const menu = sidebar.shadowRoot.querySelector(`[data-testid="${tid}"]`);
    return menu ? menu.querySelectorAll(".dd-item").length : 0;
  }, menuTestid);
}

test.describe("侧栏 push/pull 菜单", () => {
  test.beforeEach(async ({ page }) => {
    await gotoInstances(page);
  });

  test("整合包页 → push/pull 按钮存在", async ({ page }) => {
    const btns = await waitForSidebarButtons(page);
    expect(btns.push).toBeGreaterThan(0);
    expect(btns.pull).toBeGreaterThan(0);
  });

  test("点击推送按钮 → 下拉菜单显示资源类型选项", async ({ page }) => {
    const btns = await waitForSidebarButtons(page);
    expect(btns.push).toBeGreaterThan(0);

    const clicked = await clickSidebarButton(page, "sidebar-push");
    expect(clicked).toBe(true);
    // P3 修复（子代理审计）：菜单 display 是同步置 block（app-sidebar/index.ts:146），
    // 固定 waitForTimeout(300) 纯属多余且是 flake 源——改 expect.poll 轮询菜单项数
    await expect
      .poll(async () => getMenuItems(page, "sidebar-push-menu"), { timeout: 3000 })
      .toBe(ALL_RESOURCE_TYPES.length + 1);

    // 下拉菜单应包含资源类型选项（全部 + 8 种资源类型 = 9 项，含 maid-model 兜底追加）
    const itemCount = await getMenuItems(page, "sidebar-push-menu");
    expect(itemCount).toBe(ALL_RESOURCE_TYPES.length + 1);
  });

  test("点击拉取按钮 → 下拉菜单显示资源类型选项", async ({ page }) => {
    const btns = await waitForSidebarButtons(page);
    expect(btns.pull).toBeGreaterThan(0);

    const clicked = await clickSidebarButton(page, "sidebar-pull");
    expect(clicked).toBe(true);
    await expect
      .poll(async () => getMenuItems(page, "sidebar-pull-menu"), { timeout: 3000 })
      .toBe(ALL_RESOURCE_TYPES.length + 1);

    const itemCount = await getMenuItems(page, "sidebar-pull-menu");
    expect(itemCount).toBe(ALL_RESOURCE_TYPES.length + 1);
  });
});
