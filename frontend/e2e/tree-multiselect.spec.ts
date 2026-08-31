// ===== E2E 测试：文件树多选（Shift+Click / Ctrl+Click）（ADR-037）=====
// 验证 app-tree 的多选交互：单击选中、Ctrl+Click 多选、Shift+Click 范围选择。
// tree-file 在 app-content → app-tree 两层 Shadow DOM 内，用 page.evaluate 派发 MouseEvent。
// 树穿透查询/点击复用 e2e/helpers.ts（子代理审核 P4：消除重复实现）。
import { test, expect } from "./fixture.ts";
import { waitForTreeCount, clickTreeFile, gotoApp } from "./helpers.ts";

/** 读取底部选中计数（经 data-count 数据通道，与文案/locale 解耦） */
async function getSelectedCount(page: import("@playwright/test").Page): Promise<number> {
  const count = await page.evaluate(() => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    const el = tree?.shadowRoot?.querySelector('[data-testid="tree-ftr-stat"]');
    return el?.getAttribute("data-count") || "";
  });
  return parseInt(count, 10) || 0;
}

test.describe("文件树多选", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("单击选中单行 → 已选 1 个", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThan(0);
    await clickTreeFile(page, 0);
    expect(await getSelectedCount(page)).toBe(1);
  });

  test("Ctrl+Click 多选两行 → 已选 2 个", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { ctrl: true });
    expect(await getSelectedCount(page)).toBe(2);
  });

  test("Shift+Click 范围选择 → 已选 2 个", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { shift: true });
    expect(await getSelectedCount(page)).toBe(2);
  });

  test("再次单击清空多选 → 已选 1 个", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
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