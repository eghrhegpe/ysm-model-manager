// ===== E2E 测试：树内拖拽移动（ADR-336）=====
// 真实浏览器构造 DataTransfer + 应用内拖源 MIME（x-ysm-tree-move），
// 断言 ADR-336 §3.3 验收口径：
//   1. 双通道互斥：tree-move 拖源不触发导入链（ImportModelFile mock 未被调），
//      Files 拖源不触发移动链（MoveModelFile mock 未被调）
//   2. 拖行到文件夹行 drop → MoveModelFile 被调（src, dstDir=filesRoot/dir）
//   3. drop 后选中态清空（移动后旧路径失效，防批量误删）
//   4. drop-target 视觉态：dragover 文件夹行加类 / 离开或 drop 摘除
// mock 桥的调用记录走 window.__e2eCalls（fixture overrides 注入的包装函数）。
import { expect, type Page, test } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

const TREE_MOVE_MIME = "application/x-ysm-tree-move";

async function waitForTreeDnD(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      return Boolean(treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]'));
    },
    undefined,
    { timeout: 10000, polling: 200 },
  );
}

/** 读 mock 桥包装函数的调用记录（fixture overrides 注入 window.__e2eCalls） */
async function callCount(page: Page, fn: string): Promise<number> {
  return page.evaluate((name) => {
    const rec = (window as unknown as { __e2eCalls?: Record<string, unknown[][]> }).__e2eCalls;
    return rec?.[name]?.length ?? 0;
  }, fn);
}

/** 读某次调用的实参 */
async function callArgs(page: Page, fn: string, idx: number): Promise<unknown[]> {
  return page.evaluate(
    ({ name, i }) => {
      const rec = (window as unknown as { __e2eCalls?: Record<string, unknown[][]> }).__e2eCalls;
      return rec?.[name]?.[i] ?? [];
    },
    { name: fn, i: idx },
  );
}

interface DragFileOpts {
  /** MIME 列表（双通道分流的核心操纵面） */
  types: string[];
  /** 自定义 type 的载荷（TREE_MOVE_MIME 时给 JSON 串） */
  data?: Record<string, string>;
  /** 派发的事件序列：dragover / drop（默认只 dragover） */
  drop?: boolean;
  /** 目标 CSS 选择器（app-tree shadow 内；缺省 = #tree 容器根目标） */
  targetSel?: string;
}

/** 在 app-tree shadow 内派发带自定义 dataTransfer 的拖拽事件序列 */
async function dispatchDrag(
  page: Page,
  { types, data = {}, drop = false, targetSel = '[data-testid="tree-root"]' }: DragFileOpts,
): Promise<void> {
  await page.evaluate(
    ({ types: t, data: d, drop: doDrop, targetSel: sel }) => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const target = root?.querySelector(sel);
      if (!target) throw new Error(`拖拽目标未就绪: ${sel}`);
      const dt = new DataTransfer();
      for (const ty of t) dt.setData(ty, d[ty] ?? "");
      const fire = (type: string, to: Element): void => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
        to.dispatchEvent(ev);
      };
      fire("dragover", target);
      if (doDrop) fire("drop", target);
    },
    { types: types, data: data, drop: drop, targetSel: targetSel },
  );
}

test.describe("树内拖拽移动（ADR-336）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await waitForTreeDnD(page);
  });

  test("拖文件行到文件夹行 drop → MoveModelFile 被调（src + dstDir）+ 选中清空", async ({
    page,
  }) => {
    // mock 树含 subdir/subdir-model.ysm（folder 行 data-dir=subdir）+ 顶层行
    // 先展开文件夹行再拖顶层文件进去
    const payload = JSON.stringify({ paths: ["/e2e/repo/a.ysm"], anchor: "/e2e/repo/a.ysm" });
    await dispatchDrag(page, {
      types: [TREE_MOVE_MIME],
      data: { [TREE_MOVE_MIME]: payload },
      drop: true,
      targetSel: '[data-testid="tree-dir"]',
    });
    await expect
      .poll(() => callCount(page, "MoveModelFile"), { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);
    const [src, dstDir] = await callArgs(page, "MoveModelFile", 0);
    expect(src).toBe("/e2e/repo/a.ysm");
    expect(dstDir).toBe("/e2e/repo/subdir");
    // 移动后选中态清空（底栏 data-count=0）
    const count = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const tree = content?.shadowRoot?.querySelector("app-tree");
      const el = tree?.shadowRoot?.querySelector('[data-testid="tree-ftr-stat"]');
      return el?.getAttribute("data-count") ?? "";
    });
    expect(parseInt(count, 10) || 0).toBe(0);
  });

  test("双通道互斥：tree-move 拖源 → 导入链零调用（ImportModelFile 未被调）", async ({ page }) => {
    const before = await callCount(page, "ImportModelFile");
    const payload = JSON.stringify({ paths: ["/e2e/repo/a.ysm"], anchor: "/e2e/repo/a.ysm" });
    await dispatchDrag(page, {
      types: [TREE_MOVE_MIME],
      data: { [TREE_MOVE_MIME]: payload },
      drop: true,
      targetSel: '[data-testid="tree-dir"]',
    });
    await expect
      .poll(() => callCount(page, "MoveModelFile"), { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);
    expect(await callCount(page, "ImportModelFile")).toBe(before); // 导入链未被触碰
  });

  test("双通道互斥：Files 拖源悬停文件夹行 → 不加 drop-target（移动链不接手）", async ({
    page,
  }) => {
    // ⚠️ Files 类型 = dataTransfer 真含 File 才出现（空 DataTransfer 的 types 为空）——
    // 构造 Files 拖源必须 add File（与 dnd.spec dispatchFileDragOnTree 同款）
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const dir = root?.querySelector('[data-testid="tree-dir"]');
      if (!dir) throw new Error("tree-dir 未就绪");
      const dt = new DataTransfer();
      dt.items.add(new File(["e2e"], "model-a.ysm", { type: "" })); // types → ["Files"]
      const fire = (type: string): void => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
        dir.dispatchEvent(ev);
      };
      fire("dragover");
    });
    const hasDropTarget = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const dir = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-dir"]');
      return Boolean(dir?.classList.contains("drop-target"));
    });
    expect(hasDropTarget).toBe(false);
    // 导入链侧 hint 正常出现（原有行为不回归）
    const hintVisible = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const hint = treeHost?.shadowRoot?.querySelector<HTMLElement>(".tree-drop-hint");
      return Boolean(hint && hint.style.display === "flex");
    });
    expect(hintVisible).toBe(true);
  });

  test("drop-target 视觉态：dragover 文件夹行加类 / drop 后摘除", async ({ page }) => {
    const payload = JSON.stringify({ paths: ["/e2e/repo/a.ysm"], anchor: "/e2e/repo/a.ysm" });
    await dispatchDrag(page, {
      types: [TREE_MOVE_MIME],
      data: { [TREE_MOVE_MIME]: payload },
      targetSel: '[data-testid="tree-dir"]',
    });
    const hasDuring = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const dir = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-dir"]');
      return Boolean(dir?.classList.contains("drop-target"));
    });
    expect(hasDuring).toBe(true);
    // drop → 摘除（视觉收口纪律）
    await dispatchDrag(page, {
      types: [TREE_MOVE_MIME],
      data: { [TREE_MOVE_MIME]: payload },
      drop: true,
      targetSel: '[data-testid="tree-dir"]',
    });
    await expect
      .poll(() => callCount(page, "MoveModelFile"), { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);
    const hasAfter = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const dir = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-dir"]');
      return Boolean(dir?.classList.contains("drop-target"));
    });
    expect(hasAfter).toBe(false);
  });

  test("dragstart → 拖源行加 .dragging 降透明（数据渲染）/ dragend 摘除（视觉三态之三）", async ({
    page,
  }) => {
    // dragstart 是行委托监听：从文件行元素派发（shadow 内），先选中建立键空间
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const row = root?.querySelector<HTMLElement>('[data-testid="tree-file"]');
      if (!row) throw new Error("tree-file 未就绪");
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
      );
    });
    // ⚠️ 断言必须**重新查询行节点**：setDragging → _renderTree 同步重渲会替换行元素，
    // 旧引用（dragstart 派发者）指向已丢弃节点，其 classList 永远不含新类
    // （探针实证：旧 row 引用恒 false、重新查询恒 "fl selected dragging"）
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const row = root?.querySelector<HTMLElement>('[data-testid="tree-file"]');
      if (!row) throw new Error("tree-file 未就绪");
      const dt = new DataTransfer();
      const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
      row.dispatchEvent(ev);
    });
    const dragResult = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const row = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-file"]');
      return {
        rowDragging: row?.classList.contains("dragging") ?? false,
        rowCls: row?.className ?? "",
      };
    });
    expect(dragResult.rowDragging).toBe(true);
    expect(dragResult.rowCls).toContain("dragging");
    // dragend → 摘除（会话结束兜底：drop 未触发的取消场景）
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      treeHost?.shadowRoot
        ?.querySelector('[data-testid="tree-file"]')
        ?.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
    });
    const stillDragging = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const row = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-file"]');
      return Boolean(row?.classList.contains("dragging"));
    });
    expect(stillDragging).toBe(false);
  });

  test("自反过滤：拖文件到自己所在目录 → MoveModelFile 不被调（静默 no-op）", async ({ page }) => {
    // mock 里 subdir-model.ysm 在 subdir 内；把它拖到 subdir = 自反
    const payload = JSON.stringify({
      paths: ["/e2e/repo/subdir/subdir-model.ysm"],
      anchor: "/e2e/repo/subdir/subdir-model.ysm",
    });
    await dispatchDrag(page, {
      types: [TREE_MOVE_MIME],
      data: { [TREE_MOVE_MIME]: payload },
      drop: true,
      targetSel: '[data-testid="tree-dir"]',
    });
    await page.waitForTimeout(600); // 给执行链一个宏任务窗口
    expect(await callCount(page, "MoveModelFile")).toBe(0);
  });
});
