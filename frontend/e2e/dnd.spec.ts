// ===== E2E 测试：拖拽导入（DnD，ADR-037 动机之一）=====
// jsdom 无法模拟 DragEvent/DataTransfer（ADR-037 引入 e2e 的理由），
// 这里在真实浏览器构造 DataTransfer + File，走 app-tree shadow root 内
// #tree 容器上的 dragover/drop 组件级监听（features/dnd/import-dnd.ts bindTreeDnD），
// 断言：
//   1. dragover 文件 → 组件级 tree-drop-hint 出现 + #tree 加 .droppable 可放置态
//   2. drop → tree-drop-hint 收起 + .droppable 摘除 + 导入链路触发（mock ImportModelFile 被调）
//   3. 非文件 dataTransfer → tree-drop-hint 不出现、.droppable 不加
//   4. dragout（dragleave relatedTarget 树外）→ .droppable 摘除（滞留回归锁）
//
// 注意（Chromium 陷阱）：`new DragEvent(type, { dataTransfer })` 构造器会忽略
// dataTransfer（只读属性，构造后为 null）→ onDragOver 的 types 检查失败、
// onDrop 读到空 files 发 noSupportedFiles 误报。必须用 Object.defineProperty
// 强制注入 dataTransfer（业界标准绕过只读属性的方案）。
import { expect, type Page, test } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

/** 等待 app-tree 的树容器已挂载（DnD 绑定在 connectedCallback 内同步完成） */
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

/** 在 app-tree shadow root 内的 #tree 容器上构造 DataTransfer + File，dispatch 拖拽事件 */
async function dispatchFileDragOnTree(
  page: Page,
  fileName: string,
  dragoverOnly = false,
): Promise<void> {
  await page.evaluate(
    async ({ name, only }: { name: string; only: boolean }) => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const tree = root?.querySelector('[data-testid="tree-root"]');
      if (!tree) throw new Error("app-tree tree-root 未就绪，无法派发组件级 DnD");
      const dt = new DataTransfer();
      dt.items.add(new File(["e2e-content"], name, { type: "" }));
      const fire = (type: string): void => {
        const ev = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        // Chromium 构造器忽略 dataTransfer → 只读属性强制注入
        Object.defineProperty(ev, "dataTransfer", {
          value: dt,
          configurable: true,
        });
        tree.dispatchEvent(ev);
      };
      fire("dragover");
      if (only) return;
      fire("drop");
      fire("dragend");
    },
    { name: fileName, only: dragoverOnly },
  );
}

/** 查询 app-tree shadow root 内 tree-drop-hint 是否可见 */
async function isTreeDropHintVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const content = document.querySelector("app-content");
    const treeHost = content?.shadowRoot?.querySelector("app-tree");
    const hint = treeHost?.shadowRoot?.querySelector<HTMLElement>(".tree-drop-hint");
    return Boolean(hint && hint.style.display === "flex");
  });
}

/** 查询 #tree 容器是否带 .droppable 可放置态（视觉反馈 P2 断言通道） */
async function isTreeDroppable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const content = document.querySelector("app-content");
    const treeHost = content?.shadowRoot?.querySelector("app-tree");
    const tree = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-root"]');
    return Boolean(tree?.classList.contains("droppable"));
  });
}

test.describe("拖拽导入（DnD）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await waitForTreeDnD(page);
  });

  test("仓库页 tree dragover 文件 → tree-drop-hint 出现", async ({ page }) => {
    await dispatchFileDragOnTree(page, "a.ysm", true);
    expect(await isTreeDropHintVisible(page)).toBe(true);
  });

  test("dragover 文件 → #tree 加 .droppable 可放置态（视觉反馈）", async ({ page }) => {
    await dispatchFileDragOnTree(page, "a.ysm", true);
    expect(await isTreeDroppable(page)).toBe(true);
    // CSS 侧同时验证：droppable 态带 accent 虚线 outline（样式接线不断）
    const outline = await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const tree = treeHost?.shadowRoot?.querySelector<HTMLElement>('[data-testid="tree-root"]');
      return tree ? getComputedStyle(tree).outlineStyle : "";
    });
    expect(outline).toBe("dashed");
  });

  test("drop 文件 → tree-drop-hint 收起 + .droppable 摘除 + toast 反馈", async ({ page }) => {
    await dispatchFileDragOnTree(page, "model-a.ysm");
    // drop 后提示条应隐藏（bindTreeDnD 的 onDrop 隐藏 + 导入处理）
    expect(await isTreeDropHintVisible(page)).toBe(false);
    expect(await isTreeDroppable(page)).toBe(false);
    // 导入链路触发证据（8a7cc71e7 quiet 批导入收拢：逐文件成功 toast 被摘要替代，
    // 汇总「📂 导入成功: N」不含文件名，63a5d33d4 的文件名过滤断言自此静默失真）：
    // ① mock 桥调用记录器收 1 次 ImportModelFile 且 args[0] = 拖入文件名（locale 无关）
    await page.waitForFunction(
      () => {
        const rec = (window as unknown as { __e2eCalls?: Record<string, unknown[][]> }).__e2eCalls;
        const calls = rec?.["ImportModelFile"] ?? [];
        return calls.length === 1 && calls[0][0] === "model-a.ysm";
      },
      undefined,
      { timeout: 5000 },
    );
    // ② 汇总 toast 可见（emoji 前缀 locale 无关；原「任一 toast」假绿顾虑由 ① 的精确
    // 链路证据替代——① 既证成功，📂 前缀 toast 即汇总成功提示）
    await expect(page.locator('[data-testid="toast"]').filter({ hasText: /📂/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test("无文件 dataTransfer → tree-drop-hint 不出现、.droppable 不加", async ({ page }) => {
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const root = treeHost?.shadowRoot;
      const tree = root?.querySelector('[data-testid="tree-root"]');
      if (!tree) throw new Error("app-tree tree-root 未就绪");
      const dt = new DataTransfer(); // 无 items
      const ev = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperty(ev, "dataTransfer", {
        value: dt,
        configurable: true,
      });
      tree.dispatchEvent(ev);
    });
    expect(await isTreeDropHintVisible(page)).toBe(false);
    expect(await isTreeDroppable(page)).toBe(false);
  });

  test("dragleave 离开树 → .droppable 摘除（滞留回归锁：2026-09 收债同型）", async ({ page }) => {
    await dispatchFileDragOnTree(page, "a.ysm", true);
    expect(await isTreeDroppable(page)).toBe(true);
    // relatedTarget=null（拖出窗口）→ hideHint 收口 → 类必须同步摘除
    await page.evaluate(() => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      const tree = treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]');
      const ev = new DragEvent("dragleave", { bubbles: true, composed: true });
      Object.defineProperty(ev, "relatedTarget", { value: null, configurable: true });
      tree?.dispatchEvent(ev);
    });
    expect(await isTreeDroppable(page)).toBe(false);
    expect(await isTreeDropHintVisible(page)).toBe(false);
  });
});
