// ===== E2E 测试：设置页导航（ADR-037）=====
// 验证导航到设置页和基本内容渲染。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";

test.describe("设置页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("导航到设置页", async ({ page }) => {
    // 桌面模式应渲染全部 6 项（含 instances）；此断言本身即是数量契约
    const count = await page.locator('[data-testid="nav-item"]').count();
    expect(count).toBe(6);
    // 语义定位「设置」项，等待 active 高亮切换（实断言替代裸等待）
    const settings = navItem(page, "settings");
    await settings.click();
    await expect(settings).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到创作者频道页", async ({ page }) => {
    // id="workshop" 的 UI 文案是「创作者频道」（历史命名错位，见 helpers.ts NavPage）
    const creators = navItem(page, "workshop");
    await creators.click();
    await expect(creators).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到创意工坊页", async ({ page }) => {
    // id="github" 的 UI 文案是「创意工坊」（历史命名错位，见 helpers.ts NavPage）
    const workshopPage = navItem(page, "github");
    await workshopPage.click();
    await expect(workshopPage).toHaveClass(/active/, { timeout: 5000 });
  });

  test("导航到诊断页", async ({ page }) => {
    const diag = navItem(page, "diagnostics");
    await diag.click();
    await expect(diag).toHaveClass(/active/, { timeout: 5000 });
  });

  test("设置页点击游戏根目录 → SelectDirectory → SaveAppConfig + toast", async ({ page }) => {
    // nav:change listener 由 app-content 挂载时注册——nav 渲染不代表已就绪，
    // 必须先等 app-content shadowRoot（对齐 dnd.spec 的 app-content 挂载时序教训）
    await page.waitForFunction(
      () => Boolean(document.querySelector("app-content")?.shadowRoot),
      undefined,
      { timeout: 10000, polling: 200 },
    );
    await navItem(page, "settings").click();
    // 等待设置页渲染（shadow DOM 内路径卡片出现；诊断证实点击后约 2s 就绪）
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        return Boolean(
          content?.shadowRoot?.querySelector('[data-testid="set-mc-path"]'),
        );
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
    // 成功 toast 语义定位（ADR-133 阶段 C+）：原 filter({hasText:"Path updated"})
    // 硬编码 en-US 文案，改文案/切 locale 即静默失效；改断言 data-toast-type
    // 语义属性 + 计数增量——既隔离页面加载期的其它 toast，又与文案完全解耦。
    const successToasts = page.locator(
      '[data-testid="toast"][data-toast-type="success"]',
    );
    const before = await successToasts.count();
    // 点击游戏根目录路径卡片（bindPathClick 绑定，桌面走 SelectDirectory）
    await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const el = content.shadowRoot!.querySelector(
        '[data-testid="set-mc-path"]',
      ) as HTMLElement;
      el.click();
    });
    // mock SelectDirectory 返回 /e2e/mc → saveCfg → SaveAppConfig → success toast
    await expect
      .poll(() => successToasts.count(), { timeout: 5000, intervals: [100] })
      .toBeGreaterThan(before);
    // P3 修复（code review）：删除死代码 addInitScript 块——原注释声称「覆盖
    // SelectDirectory 使断言成为真变化断言」，但回调实际无操作（window.__ysme2e
    // 未声明，void orig 是 no-op），且 addInitScript 只在未来文档加载执行而
    // gotoApp 已发生，永不运行；真实变化断言是上方 toast 可见性（覆盖
    // pickDirectory→saveCfg→SaveAppConfig→toast 全链路）
    const text = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const el = content.shadowRoot!.querySelector('[data-testid="set-mc-path"]')!;
      return el.textContent ?? "";
    });
    // 断言方向修正：不再断言具体路径值（mock 同值恒真），改为非空 + 非 Loading…
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("Loading");
  });

  test("设置页 stg-card / tab-body 样式在 shadow 内真实生效（computed style 断言）", async ({ page }) => {
    // 背景：2026-08-24 复盘——.stg-* / .tab-body 曾误置于全局 components.css <link>，
    // 被 app-content 的 Shadow DOM 边界阻断，computed style 全裸奔（CI 全绿但视觉失效）。
    // 纯 DOM 存在性断言抓不到此类回归，必须断言 computed style。
    // 进入设置页
    await navItem(page, "settings").click();
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        const card = content?.shadowRoot?.querySelector(".stg-card");
        return Boolean(card);
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );

    const styles = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const sr = content.shadowRoot!;
      const card = sr.querySelector(".stg-card") as HTMLElement;
      const tabBody = sr.querySelector(".tab-body") as HTMLElement;
      const cs = card ? getComputedStyle(card) : null;
      const tcs = tabBody ? getComputedStyle(tabBody) : null;
      return {
        cardBorderStyle: cs?.borderTopStyle ?? "missing",
        cardBorderWidth: cs?.borderTopWidth ?? "missing",
        cardBackground: cs?.backgroundColor ?? "missing",
        tabDisplay: tcs?.display ?? "missing",
        tabFlexDir: tcs?.flexDirection ?? "missing",
      };
    });

    // .stg-card 必须有边框（border:1px solid var(--bd)）→ 裸奔时为 'none' / '0px'
    expect(styles.cardBorderStyle).toBe("solid");
    expect(styles.cardBorderWidth).not.toBe("0px");
    // .stg-card 背景应取自 --surf（非透明初始值）
    expect(styles.cardBackground).not.toBe("rgba(0, 0, 0, 0)");
    // .tab-body 必须 flex 布局（display:flex;flex-direction:column）
    expect(styles.tabDisplay).toBe("flex");
    expect(styles.tabFlexDir).toBe("column");
  });
});
// 注：本 computed-style 断言仅锚定 .stg-card / .tab-body 两个类，证明「shadow 内样式真实生效」机制成立；
// 非「设置页全部样式均生效」的全面证明。其余类（.stg-title/.stg-grid/.settings-group/.setting-row 等）
// 由 scripts/css-layer-check.mjs（pre-push 门禁）兜越界，二者互补而非互替（评审 2026-08-24 第 4 条）。
