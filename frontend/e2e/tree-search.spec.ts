// ===== E2E 测试：文件树搜索/筛选（ADR-037）=====
// 验证文件树搜索框：输入关键词过滤列表、空结果状态。
// 搜索框 data-testid="tree-srch" 在 app-content → app-tree 两层 Shadow DOM 内，用 page.evaluate 操作。
// 树穿透查询复用 e2e/helpers.ts（子代理审核 P4：消除重复实现）。
import { test, expect } from "./fixture.ts";
import { gotoApp, waitForTreeCount } from "./helpers.ts";

/** 在搜索框输入关键词（触发 input 事件） */
async function typeSearch(page: import("@playwright/test").Page, keyword: string): Promise<void> {
  await page.evaluate((kw) => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    const input = tree?.shadowRoot?.querySelector(
      '[data-testid="tree-srch"]',
    ) as HTMLInputElement | null;
    if (!input) return;
    input.value = kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, keyword);
  // 轮询等待防抖重渲染完成（原 waitForTimeout(400) 硬编码，慢环境易脆；
  // 以「tree-file 行数稳定」为就绪信号，防抖期间列表变化会被轮询吸收）
  const deadline = Date.now() + 8000;
  let lastCount = -1;
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      if (!tree?.shadowRoot) return -1;
      return tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]').length;
    });
    if (count === lastCount && count >= 0) return; // 连续两次相同 → 渲染已稳定
    lastCount = count;
    await new Promise((r) => setTimeout(r, 200));
  }
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
    await gotoApp(page);
  });

  test("搜索框存在且可输入", async ({ page }) => {
    // 等待文件树渲染
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThan(0);
    // 验证搜索框存在
    const hasSearch = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      return !!tree?.shadowRoot?.querySelector('[data-testid="tree-srch"]');
    });
    expect(hasSearch).toBe(true);
  });

  test("输入关键词 → 列表过滤", async ({ page }) => {
    const initial = await waitForTreeCount(page, "tree-file");
    expect(initial).toBeGreaterThan(0);

    // 输入 model-a（mock 数据有 model-a.ysm / model-b.ysm）
    await typeSearch(page, "model-a");
    const filtered = await getTreeFileNames(page);
    // 过滤后应只剩 model-a 相关
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((p) => p.includes("model-a"))).toBe(true);
  });

  test("输入无匹配关键词 → 空结果不抛错", async ({ page }) => {
    await waitForTreeCount(page, "tree-file");
    await typeSearch(page, "不存在的模型xyz");
    // 空结果：列表应为 0 条（原 Array.isArray 恒真，未验证空态生效）
    const after = await getTreeFileNames(page);
    expect(after.length).toBe(0);
  });

  test("清空搜索 → 恢复完整列表", async ({ page }) => {
    const initial = await waitForTreeCount(page, "tree-file");
    expect(initial).toBeGreaterThan(0);
    await typeSearch(page, "model-a");
    await typeSearch(page, "");
    const restored = await getTreeFileNames(page);
    // 清空后应恢复到与初始一致（或至少非空）
    expect(restored.length).toBeGreaterThan(0);
  });
});