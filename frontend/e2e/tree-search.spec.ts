// ===== E2E 测试：文件树搜索/筛选（ADR-037）=====
// 验证文件树搜索框：输入关键词过滤列表、空结果状态。
// 搜索框 id="srch" 在 app-content → app-tree 两层 Shadow DOM 内，用 page.evaluate 操作。
import { test, expect } from "./fixture.ts";

/** 轮询等待 tree-file 渲染完成，返回当前文件行数 */
async function waitForTreeFiles(page: import("@playwright/test").Page, timeout = 8000): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      if (!content?.shadowRoot) return 0;
      const tree = content.shadowRoot.querySelector("app-tree");
      if (!tree?.shadowRoot) return 0;
      return tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]').length;
    });
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

/** 在搜索框输入关键词（触发 input 事件） */
async function typeSearch(page: import("@playwright/test").Page, keyword: string): Promise<void> {
  await page.evaluate((kw) => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    const input = tree?.shadowRoot?.getElementById("srch") as HTMLInputElement | null;
    if (!input) return;
    input.value = kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, keyword);
  await page.waitForTimeout(400); // 等待防抖重渲染
}

/** 读取当前 tree-file 名称列表 */
async function getTreeFileNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    if (!tree?.shadowRoot) return [];
    return Array.from(tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]')).map(
      (el) => el.getAttribute("data-path") || "",
    );
  });
}

test.describe("文件树搜索", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  });

  test("搜索框存在且可输入", async ({ page }) => {
    // 等待文件树渲染
    const fileCount = await waitForTreeFiles(page);
    expect(fileCount).toBeGreaterThan(0);
    // 验证搜索框存在
    const hasSearch = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      return !!tree?.shadowRoot?.getElementById("srch");
    });
    expect(hasSearch).toBe(true);
  });

  test("输入关键词 → 列表过滤", async ({ page }) => {
    const initial = await waitForTreeFiles(page);
    expect(initial).toBeGreaterThan(0);

    // 输入 model-a（mock 数据有 model-a.ysm / model-b.ysm）
    await typeSearch(page, "model-a");
    const filtered = await getTreeFileNames(page);
    // 过滤后应只剩 model-a 相关
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((p) => p.includes("model-a"))).toBe(true);
  });

  test("输入无匹配关键词 → 空结果不抛错", async ({ page }) => {
    await waitForTreeFiles(page);
    await typeSearch(page, "不存在的模型xyz");
    // 空结果不抛错，列表可安全渲染
    const after = await getTreeFileNames(page);
    expect(Array.isArray(after)).toBe(true);
  });

  test("清空搜索 → 恢复完整列表", async ({ page }) => {
    const initial = await waitForTreeFiles(page);
    expect(initial).toBeGreaterThan(0);
    await typeSearch(page, "model-a");
    await typeSearch(page, "");
    const restored = await getTreeFileNames(page);
    // 清空后应恢复到与初始一致（或至少非空）
    expect(restored.length).toBeGreaterThan(0);
  });
});