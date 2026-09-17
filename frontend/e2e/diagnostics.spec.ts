// ===== E2E 测试：诊断页（diagnostics，ADR-037 覆盖深化 / ADR-258 顶部 repo-tab 范式）=====
// ADR-258 把诊断页左栏分段收敛为顶部统一 repo-tab，旧选择器 `.diag-btn[data-diag]` 已随之废弃，
// 本 spec 同步改写（原版仍在等 `.diag-btn` 渲染，10s 必然超时——已失效）。
//
// 常驻回归防线（2026-09-17 事故）：diagnosticsHTML() 曾漏一个 </div>，`#diag-tab-log` 把后续
// 7 个面板全吞进自己内部；bindTabs 切页时把 `#diag-tab-log` 置 display:none，嵌在里面的面板
// 一并消失 —— 切任何 tab 都只剩空白。单元层的子串断言对此失明（面板 id 仍在字符串里，
// toContain 恒真），**只有真实浏览器的可见性/布局判定能抓**，故「切到每个 tab 后该面板真实可见」
// 列为常驻用例。
// diagnostics 组件在 app-content shadowRoot 内渲染，用 evaluate 穿透。

import { expect, type Page, test } from "./fixture.ts";
import { gotoApp, navItem } from "./helpers.ts";

/** 顶部 repo-tab 的 data-tab 全集（与 tpl.ts diagnosticsHTML 一一对应） */
const DIAG_TABS = [
  "log",
  "single",
  "gui",
  "hist",
  "trace",
  "conflict",
  "health",
  "sync-conflict",
] as const;

/** 面板**真实可见**：display 非 none **且**占据布局尺寸（嵌套吞并时尺寸会塌成 0） */
function panelMeasuredVisible(page: Page, id: string): Promise<boolean> {
  return page.evaluate((n: string) => {
    const root = document.querySelector("app-content")?.shadowRoot;
    const panel = root?.querySelector(`#diag-tab-${n}`) as HTMLElement | null;
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return getComputedStyle(panel).display !== "none" && rect.width > 0 && rect.height > 0;
  }, id);
}

/** 面板 id → 是否显示（仅 display 口径，用于互斥可见性断言） */
function panelDisplay(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const root = document.querySelector("app-content")?.shadowRoot;
    const read = (testid: string): boolean => {
      const el = root?.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      return !!el && getComputedStyle(el).display !== "none";
    };
    return { op: read("diag-log-list"), runtime: read("diag-runtime") };
  });
}

async function clickBySelector(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const root = document.querySelector("app-content")?.shadowRoot;
    (root?.querySelector(sel) as HTMLElement | null)?.click();
  }, selector);
}

test.describe("诊断页", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    // 语义定位（原 nth(4)：viewer 模式 instances 不渲染 → nth(4) 变 settings 页，静默跑错页）
    await navItem(page, "diagnostics").click();
    // 等待顶部 repo-tab 就绪（ADR-258 后不再是 .diag-btn）
    await page.waitForFunction(
      () => {
        const root = document.querySelector("app-content")?.shadowRoot;
        return (root?.querySelectorAll(".repo-tab").length ?? 0) >= 8;
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
  });

  test("顶部 8 个 repo-tab 渲染，默认激活「日志」", async ({ page }) => {
    const info = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const tabs = [...(root?.querySelectorAll(".repo-tab") ?? [])] as HTMLElement[];
      return {
        ids: tabs.map((t) => t.dataset.tab ?? ""),
        active: tabs.filter((t) => t.classList.contains("active")).map((t) => t.dataset.tab ?? ""),
      };
    });
    expect(info.ids).toEqual([...DIAG_TABS]);
    expect(info.active).toEqual(["log"]);
  });

  test("切到每个 tab → 该面板真实可见（空白页回归防线）", async ({ page }) => {
    for (const id of DIAG_TABS) {
      await clickBySelector(page, `.repo-tab[data-tab="${id}"]`);
      await expect
        .poll(() => panelMeasuredVisible(page, id), {
          timeout: 5000,
          message: `切到「${id}」后该面板不可见（疑被前一面板嵌套吞并）`,
        })
        .toBe(true);
    }
  });

  test("日志工具栏两行语义分组：行1=子tab+动作，行2=筛选+搜索", async ({ page }) => {
    // 2026-09-17 版面收口（方案 A）：9 按钮 + 1 输入框挤单行时分组语义错乱（清空与筛选同组、
    // 刷新/复制被 spacer 推远），且 spacer 随 flex-wrap 折行挤散动作组。本用例锁两行结构与归属。
    const layout = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      const rect = (
        sel: string,
      ): { top: number; bottom: number; left: number; right: number } | null => {
        const el = root?.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const rows = [
        ...(root?.querySelectorAll(".diag-log-bar .diag-log-row") ?? []),
      ] as HTMLElement[];
      return {
        rows: rows.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
        subTabs: rect(".diag-log-subtabs"),
        refresh: rect("#diag-refresh"),
        copy: rect("#diag-copy"),
        clear: rect("#diag-clear"),
        filter: rect("#diag-log-filter"),
        search: rect("#diag-log-search"),
      };
    });
    expect(layout.rows).toHaveLength(2);
    // 显式守卫收窄类型（biome 禁非空断言）：单行旧范式下 rows 为空，此处先炸即抓到回归
    const [row1, row2] = layout.rows;
    if (!row1 || !row2) throw new Error("日志工具栏不是两行");
    /** 取出元素盒模型，缺失即判失败（避免 `!` 断言） */
    const box = (
      name: string,
      r: { top: number; bottom: number; left: number; right: number } | null,
    ): { top: number; bottom: number; left: number; right: number } => {
      if (!r) throw new Error(`日志工具栏缺少元素：${name}`);
      return r;
    };
    // 行1 严格位于行2 上方（互不重叠）
    expect(row1.bottom).toBeLessThanOrEqual(row2.top);
    // 行1 归属：子 tab + 三个动作按钮
    const subTabs = box("subTabs", layout.subTabs);
    const refresh = box("refresh", layout.refresh);
    const copy = box("copy", layout.copy);
    const clear = box("clear", layout.clear);
    for (const r of [subTabs, refresh, copy, clear]) {
      expect(r.top).toBeGreaterThanOrEqual(row1.top);
      expect(r.bottom).toBeLessThanOrEqual(row1.bottom);
    }
    // 行1 语义次序：导航靠左、动作被 spacer 顶到右侧，且破坏性「清空」殿后
    expect(subTabs.right).toBeLessThan(refresh.left);
    expect(refresh.left).toBeLessThan(copy.left);
    expect(copy.left).toBeLessThan(clear.left);
    // 行2 归属：筛选 chips 容器 + 搜索框（清空不得混入筛选行）
    for (const r of [box("filter", layout.filter), box("search", layout.search)]) {
      expect(r.top).toBeGreaterThanOrEqual(row2.top);
      expect(r.bottom).toBeLessThanOrEqual(row2.bottom);
    }
  });

  test("日志子 tab：操作日志与运行时日志互斥可见", async ({ page }) => {
    // 默认：操作日志可见、运行时隐藏
    expect(await panelDisplay(page)).toEqual({ op: true, runtime: false });
    await clickBySelector(page, '.diag-sub-tab[data-log="runtime"]');
    await expect
      .poll(() => panelDisplay(page), { timeout: 5000 })
      .toEqual({ op: false, runtime: true });
  });

  test("日志空态提示（mock GetImportLogs=[] → No logs yet）", async ({ page }) => {
    const listText = await page.evaluate(() => {
      const root = document.querySelector("app-content")?.shadowRoot;
      return root?.querySelector('[data-testid="diag-log-list"]')?.textContent ?? "";
    });
    expect(listText).toContain("No logs yet");
  });
});
