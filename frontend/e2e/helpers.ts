// ===== E2E 共享 helpers（ADR-037，子代理审核 P4：消除 4 处 shadow DOM 穿透重复）=====
// app-content → app-tree 双层 Shadow DOM 穿透 + 轮询等待逻辑在
// file-tree / tree-search / tree-multiselect / sidebar-menu 各自内联实现，
// 易漂移。统一收敛到本文件，spec 只 import 不重复。
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 导航页 id —— 与 app-nav/index.ts 的 items[].id 同源，渲染为 data-page 属性。
 * 注意历史命名错位（非笔误）：id="workshop" 的 UI 文案是「创作者频道」，
 * id="github" 的 UI 文案才是「创意工坊」。以 id 为准，勿按文案推断。
 */
export type NavPage =
  | "repository"
  | "instances"
  | "workshop"
  | "github"
  | "diagnostics"
  | "settings";

/**
 * 按语义定位导航项，替代 `.nth(N)` 序号定位（ADR-133 阶段 C+）。
 *
 * 为何必须弃用序号：instances 项在查看器模式下不渲染（app-nav/index.ts 的
 * `can("ListVersionInstances")` 能力门控，ADR-049），导航项 6→5，其后所有序号
 * 整体前移一格 —— nth(4) 由 diagnostics 变 settings、nth(5) 直接越界。
 * 更危险的是错位未必报红（如 workshop→github 结构相近），可能静默假绿。
 * data-page 语义定位对导航项增删、重排、显隐一律免疫。
 */
export function navItem(page: Page, target: NavPage): Locator {
  return page.locator(`[data-testid="nav-item"][data-page="${target}"]`);
}

/** 应用启动序列：goto("/") → nav-item 可见 → app-content shadowRoot 就绪（时序竞态护栏） */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  const navItems = page.locator('[data-testid="nav-item"]');
  await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  // nav:change listener 由 app-content 挂载时注册（dnd/settings 实证竞态，必须等 shadowRoot）
  await page.waitForFunction(
    () => Boolean(document.querySelector("app-content")?.shadowRoot),
    undefined,
    { timeout: 10000, polling: 200 },
  );
}

/** 在 app-content → app-tree 双层 shadow DOM 内查询指定 testid 行的中心坐标 */
export async function getTreeBox(
  page: Page,
  testid: string,
  idx = 0,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ tid, i }) => {
      const content = document.querySelector("app-content")!;
      const tree = content.shadowRoot!.querySelector("app-tree")!;
      const row = tree.shadowRoot!.querySelectorAll(
        `[data-testid="${tid}"]`,
      )[i] as HTMLElement;
      const rect = row.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    { tid: testid, i: idx },
  );
}

/** 对树行执行右键（取坐标 → right click），返回菜单是否可交互由调用方按 testid 断言 */
export async function rightClickTree(
  page: Page,
  testid: string,
  idx = 0,
): Promise<void> {
  const box = await getTreeBox(page, testid, idx);
  await page.mouse.click(box.x, box.y, { button: "right" });
}

/** 在 app-content → app-tree 双层 shadow DOM 内查询 tree 元素数量 */
export function countInTree(
  page: Page,
  testid: string,
): Promise<number> {
  return page.evaluate((tid) => {
    const content = document.querySelector("app-content");
    const tree = content?.shadowRoot?.querySelector("app-tree");
    if (!tree?.shadowRoot) return 0;
    return tree.shadowRoot.querySelectorAll(`[data-testid="${tid}"]`).length;
  }, testid);
}

/** 轮询等待 tree 渲染完成，返回指定 testid 元素数量（超时返回 0） */
export async function waitForTreeCount(
  page: Page,
  testid: string,
  timeout = 8000,
): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await countInTree(page, testid);
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

/** 对指定 tree-file 行派发带修饰键的 click 事件（Shift+Click / Ctrl+Click 多选） */
export async function clickTreeFile(
  page: Page,
  idx: number,
  opts: { ctrl?: boolean; shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ i, ctrl, shift }) => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      const rows = tree?.shadowRoot?.querySelectorAll('[data-testid="tree-file"]');
      const row = rows?.[i] as HTMLElement | undefined;
      if (!row) return;
      row.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          ctrlKey: !!ctrl,
          metaKey: !!ctrl,
          shiftKey: !!shift,
        }),
      );
    },
    { i: idx, ctrl: opts.ctrl, shift: opts.shift },
  );
}

/** 获取指定 tree-file 行的中心坐标（右键菜单/点击用；语义别名，复用 getTreeBox） */
export function getTreeFileBox(
  page: Page,
  idx = 0,
): Promise<{ x: number; y: number }> {
  return getTreeBox(page, "tree-file", idx);
}
