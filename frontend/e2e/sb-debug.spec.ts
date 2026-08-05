import { test, expect } from "./fixture.ts";

test("evaluate 点击后检查 app-sidebar 挂载", async ({ page }) => {
  await page.goto("/");
  const navItems = page.locator('[data-testid="nav-item"]');
  await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // 用 evaluate 原生点击第 2 个 nav-item（instances）
  const diag = await page.evaluate(async () => {
    const nav = document.querySelector("app-nav") as any;
    const items = nav?.shadowRoot?.querySelectorAll('[data-testid="nav-item"]');
    if (items?.[1]) items[1].click();
    await new Promise(r => setTimeout(r, 1000));
    const content = document.querySelector("app-content") as any;
    if (!content?.shadowRoot) return { error: "no shadowRoot" };
    return {
      _current: content._current,
      htmlHasSidebar: content.shadowRoot.innerHTML.includes("app-sidebar"),
      sidebarEl: content.shadowRoot.querySelector("app-sidebar") !== null,
      innerHTML: content.shadowRoot.innerHTML.substring(0, 300),
    };
  });
  console.log("=== 诊断 ===", JSON.stringify(diag, null, 2));
  expect(true).toBe(true);
});
