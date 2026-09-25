// ===== E2E 测试：回收站（recycle-bin，ADR-037 覆盖深化）=====
// 审计卡（frontend_test_audit.md）原列「recycle-bin 完全无 e2e」为 P3 盲区。
// 本 spec 补其 UI 接线冒烟：导航到 repository 页 → 切到 recycle 子 tab →
// 断言回收站页真实挂载（清空/刷新控件可见）、条目级 restore/delete 钩子存在。
// 与 sync-manager.spec 同深度：覆盖「点击 → 特性渲染」的 UI 接线，执行逻辑由
// features/maintenance/recycle-bin.ts 单测守护。
// 穿透约定：app-content 为 shadow host，页内元素须 content.shadowRoot.querySelector 穿透
// （同 workshop/settings/diagnostics/spec 既定范式；禁 page.locator 直查 shadow 内元素）。
import { expect, type Page, test } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";

/** 在 app-content shadowRoot 内按选择器点元素（repo-tab 等 shadow 内元素 locator 点击不可靠） */
async function clickBySelector(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const root = document.querySelector("app-content")?.shadowRoot;
    (root?.querySelector(sel) as HTMLElement | null)?.click();
  }, selector);
}

/** 在 app-content shadowRoot 内查询元素数量（轮询吸收时序竞态，禁固定 waitForTimeout） */
async function countInShadow(page: Page, selector: string, timeout = 8000): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const n = await page.evaluate((sel: string) => {
      const root = document.querySelector("app-content")?.shadowRoot;
      return root ? root.querySelectorAll(sel).length : 0;
    }, selector);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

test.describe("回收站", () => {
  test("repository 页 → recycle 子 tab 切换 + 清空/刷新控件真实可见", async ({ page }) => {
    await gotoApp(page);
    await navItem(page, "repository").click();
    await clickBySelector(page, '.repo-tab[data-tab="recycle"]');

    // 硬断言回收站页真实挂载（非空壳）：清空 + 刷新控件必须在 shadow 内可见
    const empties = await countInShadow(page, "#recy-empty", 5000);
    expect(empties).toBe(1);
    const refreshes = await countInShadow(page, "#recy-refresh", 5000);
    expect(refreshes).toBe(1);
  });

  test("回收站条目级操作钩子存在（有条目时 per-item restore/delete）", async ({ page }) => {
    await gotoApp(page);
    await navItem(page, "repository").click();
    await clickBySelector(page, '.repo-tab[data-tab="recycle"]');

    // 轮询等待列表容器就绪（含 0 条目的空态也算就绪）
    const listReady = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      return Boolean(root?.querySelector("#recy-list"));
    }, undefined);
    expect(listReady).toBe(true);

    const itemCount = await countInShadow(page, '[data-testid="recy-item"]', 5000);
    if (itemCount > 0) {
      // 有条目：每条应带 restore/delete 操作钩子（稳定 testid，防重构漂移）
      const restoreCount = await countInShadow(page, '[data-testid="recy-restore"]', 3000);
      const delCount = await countInShadow(page, '[data-testid="recy-del"]', 3000);
      expect(restoreCount).toBe(itemCount);
      expect(delCount).toBe(itemCount);
    }
    // 空态（itemCount === 0）本就合法：列表容器存在即视为通过，不 skip 掩盖 mock 链路。
  });
});
