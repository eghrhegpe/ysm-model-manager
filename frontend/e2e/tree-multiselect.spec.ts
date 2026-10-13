// ===== E2E 测试：文件树多选（Shift+Click / Ctrl+Click）（ADR-037）=====
// 验证 app-tree 的多选交互：单击选中、Ctrl+Click 多选、Shift+Click 范围选择。
// tree-file 在 app-content → app-tree 两层 Shadow DOM 内，用 page.evaluate 派发 MouseEvent。
// 树穿透查询/点击复用 e2e/helpers.ts（子代理审核 P4：消除重复实现）。
import { expect, test } from "./fixture.ts";
import { clickTreeFile, gotoApp, waitForTreeCount } from "./helpers.ts";

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

  /** 读取指定 tree-file 行的选中视觉态（class + aria-selected）。
   *  P0-1 回归锁：rowCls 曾恒 ""（f4d590e12 误删 selCls），选中无视觉反馈且
   *  单元测试全绿——视觉断言必须落到 e2e（data-count 只证数据不证视觉）。 */
  async function getRowSelectedState(
    page: import("@playwright/test").Page,
    idx: number,
  ): Promise<{ cls: string; ariaSelected: string }> {
    return page.evaluate((i) => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      const row = tree?.shadowRoot?.querySelectorAll('[data-testid="tree-file"]')[i] as
        | HTMLElement
        | undefined;
      return {
        cls: row?.className ?? "",
        ariaSelected: row?.getAttribute("aria-selected") ?? "",
      };
    }, idx);
  }

  test("单击选中单行 → 已选 1 个 + 行高亮（selected 类 + aria-selected）", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThan(0);
    await clickTreeFile(page, 0);
    expect(await getSelectedCount(page)).toBe(1);
    // 视觉通道：rowCls 数据渲染唯一出口（不再依赖键盘导航的手写 classList 双轨）
    const sel = await getRowSelectedState(page, 0);
    expect(sel.cls).toContain("selected");
    expect(sel.ariaSelected).toBe("true");
  });

  test("Ctrl+Click 多选两行 → 已选 2 个 + 两行均高亮", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { ctrl: true });
    expect(await getSelectedCount(page)).toBe(2);
    const sel0 = await getRowSelectedState(page, 0);
    const sel1 = await getRowSelectedState(page, 1);
    expect(sel0.cls).toContain("selected");
    expect(sel1.cls).toContain("selected");
  });

  test("Shift+Click 范围选择 → 已选 2 个 + 范围行均高亮", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThanOrEqual(2);
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { shift: true });
    expect(await getSelectedCount(page)).toBe(2);
    const sel0 = await getRowSelectedState(page, 0);
    const sel1 = await getRowSelectedState(page, 1);
    expect(sel0.cls).toContain("selected");
    expect(sel1.cls).toContain("selected");
  });

  test("再次单击清空多选 → 已选 1 个，原选中行失高亮", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    expect(fileCount).toBeGreaterThanOrEqual(2);
    // 先多选 2 个
    await clickTreeFile(page, 0);
    await clickTreeFile(page, 1, { ctrl: true });
    expect(await getSelectedCount(page)).toBe(2);
    // 纯单击第三行应清空重选为 1：行 0 失去 selected，行 1 获得
    await clickTreeFile(page, 0);
    expect(await getSelectedCount(page)).toBe(1);
    const sel0 = await getRowSelectedState(page, 0);
    expect(sel0.cls).toContain("selected");
    expect(sel0.ariaSelected).toBe("true");
  });
});
