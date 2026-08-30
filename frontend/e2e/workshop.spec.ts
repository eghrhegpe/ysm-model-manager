// ===== E2E 测试：创意工坊页（workshop，ADR-037 覆盖深化）=====
// 验证导航到创意工坊后的真实交互：
//   1. 站点 tab 动态渲染（mock DefaultWorkshopSites 2 个站点）
//   2. 默认选中第一个站点（B站）并显示其内容视图
// 断言基于 data-testid 稳定钩子（ADR-133 阶段 C+：原走 #id，与契约通道脱节）——
// workshop 组件在 app-content shadowRoot 内。
import { test, expect, type Page } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";

/** 在 app-content shadowRoot 中按 testid 查询元素文本 */
async function shadowEl(page: Page, testid: string): Promise<string | null> {
  return page.evaluate((tid) => {
    const content = document.querySelector("app-content");
    const el = content?.shadowRoot?.querySelector(`[data-testid="${tid}"]`);
    return el ? (el.textContent ?? "").trim() : null;
  }, testid);
}

test.describe("创意工坊页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    // 语义定位（原 nth(2)：导航项显隐/重排即错位，且 workshop→github 结构相近会静默假绿）
    await navItem(page, "workshop").click();
    // 等待 workshop 初始化（站点 tab 渲染）
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        const tabs = content?.shadowRoot?.querySelector('[data-testid="ws-tabs"]');
        return Boolean(tabs && tabs.querySelectorAll("button").length > 0);
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
  });

  test("创意工坊 → 站点 tab 动态渲染（mock 2 站点）", async ({ page }) => {
    const tabCount = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tabs = content.shadowRoot!.querySelector('[data-testid="ws-tabs"]')!;
      return tabs.querySelectorAll("button").length;
    });
    expect(tabCount).toBeGreaterThanOrEqual(2);
    // 第一个 tab 应包含 B站 文案
    const firstTab = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tabs = content.shadowRoot!.querySelector('[data-testid="ws-tabs"]')!;
      return tabs.querySelector("button")?.textContent ?? "";
    });
    expect(firstTab).toContain("B站");
  });

  test("创意工坊 → 默认选中第一个站点并显示内容视图", async ({ page }) => {
    // 默认选中第一个 tab（active class）
    const firstActive = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tabs = content.shadowRoot!.querySelector('[data-testid="ws-tabs"]')!;
      const btn = tabs.querySelector("button");
      return btn ? btn.classList.contains("active") : false;
    });
    expect(firstActive).toBe(true);
    // 内容视图应渲染（搜索视图存在且非 loading 占位）
    const searchText = await shadowEl(page, "ws-search-view");
    expect(searchText).not.toBeNull();
    const loadingGone = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const results = content.shadowRoot!.querySelector('[data-testid="ws-search-results"]');
      return Boolean(results && results.querySelectorAll("input,button,a").length > 0);
    });
    // 有内容（非空断言，防静默空白页）——P3 修复（子代理审计）：原 OR 合并断言
    // （loadingGone || results 非空）因 B站默认视图有搜索 input 使 loadingGone 恒真，
    // 几乎恒真假绿；改为确定性：渲染出的搜索结果区含可交互元素才算通过
    expect(loadingGone).toBe(true);
  });

  test("创意工坊 → 点击 GitHub 站点 tab → 内容切换", async ({ page }) => {
    // 点击第二个 tab（GitHub）
    await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tabs = content.shadowRoot!.querySelector('[data-testid="ws-tabs"]')!;
      const buttons = tabs.querySelectorAll("button");
      if (buttons.length > 1) buttons[1].click();
    });
    // 第二个 tab 变为 active
    const secondActive = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tabs = content.shadowRoot!.querySelector('[data-testid="ws-tabs"]')!;
      const buttons = tabs.querySelectorAll("button");
      return buttons.length > 1 ? buttons[1].classList.contains("active") : false;
    });
    expect(secondActive).toBe(true);
    // GitHub 站点带 searchUrl → 应渲染搜索视图（fillSearch 分支）
    await page.waitForFunction(
      () => {
        const c = document.querySelector("app-content")?.shadowRoot;
        const results = c?.querySelector('[data-testid="ws-search-results"]');
        return Boolean(results && results.querySelectorAll("input,button,a").length > 0);
      },
      undefined,
      { timeout: 5000, polling: 200 },
    );
  });

  test("创意工坊 → 创作者卡片渲染（mock LoadWorkshopCreators）", async ({ page }) => {
    // 等待创作者卡片渲染（site/render.ts createCrCard → .cr-creator-card；
    // 容器不固定，直接查 shadowRoot 内任意卡片）
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        if (!content?.shadowRoot) return false;
        return content.shadowRoot.querySelectorAll(".cr-creator-card").length >= 2;
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
    // 卡片包含创作者名
    const cardTexts = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const cards = Array.from(
        content.shadowRoot!.querySelectorAll(".cr-creator-card"),
      );
      return cards.map((c) => c.textContent ?? "");
    });
    expect(cardTexts.some((t) => t.includes("测试创作者A"))).toBe(true);
  });
});
