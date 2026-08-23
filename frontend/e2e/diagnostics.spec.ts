// ===== E2E 测试：诊断页（diagnostics，ADR-037 覆盖深化）=====
// 验证诊断与冲突页的交互：
//   1. 操作按钮渲染（日志/运行时/冲突）
//   2. 点击切换面板（log → runtime）
//   3. 日志空态（mock GetImportLogs=[] → No logs yet）
// diagnostics 组件在 app-content shadowRoot 内渲染，用 evaluate 穿透。
import { test, expect, type Page } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

/** 在 app-content shadowRoot 中统计 .diag-btn 数量 */
async function diagBtnCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const content = document.querySelector("app-content");
    return content?.shadowRoot?.querySelectorAll(".diag-btn").length ?? 0;
  });
}

/** 查询某诊断面板是否可见（面板 id 为 #diag-log / #diag-runtime / #diag-conflict，
 *  按钮的 data-diag 属性只是切换钮，不能用来断言面板 display） */
async function panelVisible(page: Page, name: string): Promise<boolean> {
  return page.evaluate((n: string) => {
    const content = document.querySelector("app-content");
    const panel = content?.shadowRoot?.getElementById(`diag-${n}`) as HTMLElement | null;
    return Boolean(panel && getComputedStyle(panel).display !== "none");
  }, name);
}

test.describe("诊断页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    const diagnosticsNav = page.locator(
      '[data-testid="nav-item"][data-page="diagnostics"]',
    );
    await diagnosticsNav.click();
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        return Boolean(content?.shadowRoot?.querySelector(".diag-btn"));
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
  });

  test("诊断页 → 操作按钮渲染（日志/运行时/冲突）", async ({ page }) => {
    const count = await diagBtnCount(page);
    expect(count).toBeGreaterThanOrEqual(3);
    // 默认激活「日志」按钮
    const logActive = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const btn = content.shadowRoot!.querySelector('.diag-btn[data-diag="log"]');
      return btn?.classList.contains("active") ?? false;
    });
    expect(logActive).toBe(true);
  });

  test("诊断页 → 点击运行时按钮 → 面板切换", async ({ page }) => {
    // 默认日志面板可见
    expect(await panelVisible(page, "log")).toBe(true);
    // 点击「运行时」按钮
    await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const btn = content.shadowRoot!.querySelector('.diag-btn[data-diag="runtime"]') as HTMLElement | null;
      btn?.click();
    });
    // 面板切换：log 面板隐藏、runtime 面板可见（原实现只断言按钮 active 类，
    // 未验证面板 display；且 panelVisible 曾查到按钮本身恒 true——已修）
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content")!;
        const log = content.shadowRoot!.getElementById("diag-log") as HTMLElement | null;
        const runtime = content.shadowRoot!.getElementById("diag-runtime") as HTMLElement | null;
        return Boolean(
          log && runtime &&
            getComputedStyle(log).display === "none" &&
            getComputedStyle(runtime).display !== "none",
        );
      },
      undefined,
      { timeout: 5000, polling: 200 },
    );
  });

  test("诊断页 → 日志空态提示（mock GetImportLogs=[]）", async ({ page }) => {
    // 日志区应显示「No logs yet」（mock 空数组 → 空态分支；locale=en-US）
    const listText = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const list = content.shadowRoot!.getElementById("diag-log-list");
      return list?.textContent ?? "";
    });
    expect(listText).toContain("No logs yet");
  });
});
