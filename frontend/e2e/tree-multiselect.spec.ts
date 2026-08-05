// ===== E2E 测试：文件树多选（Shift+Click / Ctrl+Click）（ADR-037）=====
// 验证 app-tree 的多选交互：单击选中、Ctrl+Click 多选、Shift+Click 范围选择。
// tree-file 在 app-content → app-tree 两层 Shadow DOM 内，用 page.evaluate 派发 MouseEvent。
import { test, expect } from "./fixture.ts";

/** 轮询等待 tree-file 渲染，返回文件行数 */
async function waitForTreeFiles(page: import("@playwright/test").Page, timeout = 8000): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      if (!tree?.shadowRoot) return 0;
      return tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]').length;
    });
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

/** 对指定 tree-file 行派发带修饰键的 click 事件 */
async function clickTreeFile(
  page: import("@playwright/test").Page,
  idx: number,
  opts: { ctrl?: boolean; shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ i, ctrl, shift }) => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      const rows = tree?.shadowRoot?.querySelectorAll('[data-testid="tree-file"]');
      const row = rows?.[i] as HTMLElement | undefined;
      if (!row) return;
      row.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          ctrlKey: !!ctrl,
          metaKey: !!ctrl,
          shiftKey: !!shift,
        }),
      );
    },
    { i: idx, ctrl: opts.ctrl, shift: opts.shift },
  );
  await page.waitForTimeout(300); // 等待重渲染
}

/** 读取底部选中统计文本（如「已选 2 个文件」），返回选中数 */
async function getSelectedCount(page: import("@playwright/test").Page): Promise<number> {
  const stat = await page.evaluate(() => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    const el = tree?.shadowRoot?.getElementById("ftr-stat");
    return el?.textContent || "";
  });
  const m = stat.match(/已选\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

test.describe("文件树多选", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  });

  test("单击选中单行 → 已选 1 个", async ({ page }) => {
    const fileCount = await waitForTreeFiles(page);
    expect(fileCount).toBeGreaterThan(0);
    await clickTreeFile(page, 0);
    expect(await getSelectedCount(page)).toBe(1);
  });

  test("Ctrl+Click 多选两行 → 已选 2 个", async ({ page }) => {
    const fileCount = await waitForTreeFiles(page);
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { ctrl: true });
    expect(await getSelectedCount(page)).toBe(2);
  });

  test("Shift+Click 范围选择 → 已选 2 个", async ({ page }) => {
    const fileCount = await waitForTreeFiles(page);
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { shift: true });
    expect(await getSelectedCount(page)).toBe(2);
  });

  test("再次单击清空多选 → 已选 1 个", async ({ page }) => {
    const fileCount = await waitForTreeFiles(page);
    expect(fileCount).toBeGreaterThanOrEqual(2);
    // 先多选 2 个
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { ctrl: true });
    expect(await getSelectedCount(page)).toBe(2);
    // 纯单击第三行应清空重选为 1
    await clickTreeFile(page, 0);
    expect(await getSelectedCount(page)).toBe(1);
  });
});