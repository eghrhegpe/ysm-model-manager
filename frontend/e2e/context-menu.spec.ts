// ===== E2E 测试：右键菜单触发与交互（ADR-037）=====
// 验证右键菜单的触发、显示和点击。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
// 注意：tree-file 在 app-content → app-tree 两层 Shadow DOM 内，
// 穿透查询/坐标获取复用 e2e/helpers.ts（消除内联重复实现）。
// 文案定位说明（P3-8 子代理审计）：本文件断言「Copy File Path」等文案来自
// en.ts 的 menu.copyFilePath，调整文案需同步本 spec（文案定位较脆弱）。
import { test, expect } from "./fixture.ts";
import { gotoApp, waitForTreeCount, rightClickTree } from "./helpers.ts";

/** 轮询等待 tree-file 在嵌套 Shadow DOM 中出现（复用 helpers 的 waitForTreeCount） */
async function waitForTreeFile(page: import("@playwright/test").Page, timeout = 8000): Promise<boolean> {
  return (await waitForTreeCount(page, "tree-file", timeout)) > 0;
}

test.describe("右键菜单", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("页面加载 → 菜单组件已注册", async ({ page }) => {
    const ctxMenu = page.locator("context-menu");
    const ctxCount = await ctxMenu.count();
    // 弱断言改实断言：组件应恰好 1 个（静态存在于 DOM），防注册静默失效
    expect(ctxCount).toBe(1);
  });

  test("文件树文件上右键 → contextmenu 事件触发", async ({ page }) => {
    // 轮询等待 tree-file 渲染
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip(true, "tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");
    // 右键后菜单项应出现（原 expect(true).toBe(true) 恒真，itemCount 是死代码）
    const ctxItems = page.locator('[data-testid="ctx-item"]');
    const itemCount = await ctxItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test("右键菜单项可点击", async ({ page }) => {
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip(true, "tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");
    // 尝试点击菜单项
    const ctxItems = page.locator('[data-testid="ctx-item"]');
    const itemCount = await ctxItems.count();
    if (itemCount === 0) {
      test.skip(true, "右键菜单未渲染菜单项");
      return;
    }
    await ctxItems.first().click();
    // 弱断言改实断言：点击后菜单应隐藏（onClick 的 finally 调 hide）
    await expect(ctxItems.first()).not.toBeVisible({ timeout: 3000 });
  });

  test("右键 → 点击「Copy File Path」→ action 执行 + toast 反馈", async ({ page }) => {
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip(true, "tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");

    // 语义定位（ADR-133 阶段 C+）：按 data-action 匹配 action 标识，
    // 替代原 filter({hasText:"Copy File Path"}) —— 文案硬编码 en-US，改文案即静默失效
    const copyItem = page.locator(
      '[data-testid="ctx-item"][data-action="file.copy-path"]',
    );
    // 硬断言替代原「count===0 就 skip」：那条兜底是「按 i18n 文案定位」时代的防御
    // （文案对不上就当环境问题跳过），而 data-action 定位后目标已确定——
    // file 菜单必含 copy-path（context-menus.test.ts 断言查看器模式亦保留），
    // 继续保留 skip 等于给「菜单构建回归」留一条静默逃逸通道。
    await expect(copyItem.first()).toBeVisible({ timeout: 3000 });
    // 反馈 toast 计数基线（copy-path 成功走 success、失败走 error，两分支均有反馈）
    const feedbackToasts = page.locator(
      '[data-testid="toast"][data-toast-type="success"], [data-testid="toast"][data-toast-type="error"]',
    );
    const before = await feedbackToasts.count();
    await copyItem.first().click();
    // action 执行后必弹反馈 toast（原按中文文案 filter，语言/文案变更即失效）
    await expect
      .poll(() => feedbackToasts.count(), { timeout: 5000, intervals: [100] })
      .toBeGreaterThan(before);
    // 顺带断言菜单已隐藏（onClick finally 调 hide）
    await expect(page.locator('[data-testid="ctx-item"]').first()).not.toBeVisible({
      timeout: 3000,
    });
  });
});
