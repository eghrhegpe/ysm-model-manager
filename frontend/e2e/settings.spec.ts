// ===== E2E 测试：设置页导航（ADR-037）=====
// 验证导航到设置页和基本内容渲染。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

test.describe("设置页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("导航到设置页", async ({ page }) => {
    const settingsNav = page.locator(
      '[data-testid="nav-item"][data-page="settings"]',
    );
    await settingsNav.click();
    await expect(settingsNav).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到创作者频道页", async ({ page }) => {
    const workshopNav = page.locator(
      '[data-testid="nav-item"][data-page="workshop"]',
    );
    await workshopNav.click();
    await expect(workshopNav).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到创意工坊页", async ({ page }) => {
    const githubNav = page.locator(
      '[data-testid="nav-item"][data-page="github"]',
    );
    await githubNav.click();
    await expect(githubNav).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到诊断页", async ({ page }) => {
    const diagnosticsNav = page.locator(
      '[data-testid="nav-item"][data-page="diagnostics"]',
    );
    await diagnosticsNav.click();
    await expect(diagnosticsNav).toHaveClass(/active/, { timeout: 5000 });
  });

  test("设置页点击游戏根目录 → SelectDirectory → SaveAppConfig + toast", async ({ page }) => {
    // nav:change listener 由 app-content 挂载时注册——nav 渲染不代表已就绪，
    // 必须先等 app-content shadowRoot（对齐 dnd.spec 的 app-content 挂载时序教训）
    await page.waitForFunction(
      () => Boolean(document.querySelector("app-content")?.shadowRoot),
      undefined,
      { timeout: 10000, polling: 200 },
    );
    const settingsNav = page.locator(
      '[data-testid="nav-item"][data-page="settings"]',
    );
    await settingsNav.click();
    // 等待设置页渲染（shadow DOM 内路径卡片出现；诊断证实点击后约 2s 就绪）
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        return Boolean(content?.shadowRoot?.getElementById("set-mc-path"));
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
    // 点击游戏根目录路径卡片（bindPathClick 绑定，桌面走 SelectDirectory）
    await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const el = content.shadowRoot!.getElementById("set-mc-path")!;
      el.click();
    });
    // mock SelectDirectory 返回 /e2e/mc → saveCfg → SaveAppConfig → toast「Path updated」
    // 欢迎 toast（YSM 管理器 v1.0 预告版）每次加载必弹，必须 filter 定位自己的
    // toast（原 toast.first() 会命中欢迎 toast 假红，settings 是最后漏修的 spec）
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "Path updated" });
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    // P3 修复（code review）：删除死代码 addInitScript 块——原注释声称「覆盖
    // SelectDirectory 使断言成为真变化断言」，但回调实际无操作（window.__ysme2e
    // 未声明，void orig 是 no-op），且 addInitScript 只在未来文档加载执行而
    // gotoApp 已发生，永不运行；真实变化断言是上方 toast 可见性（覆盖
    // pickDirectory→saveCfg→SaveAppConfig→toast 全链路）
    const text = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const el = content.shadowRoot!.getElementById("set-mc-path")!;
      return el.textContent ?? "";
    });
    // 断言方向修正：不再断言具体路径值（mock 同值恒真），改为非空 + 非 Loading…
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("Loading");
  });
});
