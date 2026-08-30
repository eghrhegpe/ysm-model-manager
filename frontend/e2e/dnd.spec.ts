// ===== E2E 测试：拖拽导入（DnD，ADR-037 动机之一）=====
// jsdom 无法模拟 DragEvent/DataTransfer（ADR-037 引入 e2e 的理由），
// 这里在真实浏览器构造 DataTransfer + File，走 app-tree shadow root 内
// #tree 容器上的 dragover/drop 组件级监听（features/import-dnd.ts bindTreeDnD），
// 断言：
//   1. dragover 文件 → 组件级 tree-drop-hint 出现
//   2. drop → tree-drop-hint 收起 + 导入链路触发（mock ImportModelFile 被调）
//   3. 非文件 dataTransfer → tree-drop-hint 不出现
//
// 注意（Chromium 陷阱）：`new DragEvent(type, { dataTransfer })` 构造器会忽略
// dataTransfer（只读属性，构造后为 null）→ onDragOver 的 types 检查失败、
// onDrop 读到空 files 发 noSupportedFiles 误报。必须用 Object.defineProperty
// 强制注入 dataTransfer（业界标准绕过只读属性的方案）。
import { test, expect, type Page } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

/** 等待 app-tree 的树容器已挂载（DnD 绑定在 connectedCallback 内同步完成） */
async function waitForTreeDnD(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const content = document.querySelector("app-content");
      const treeHost = content?.shadowRoot?.querySelector("app-tree");
      return Boolean(
        treeHost?.shadowRoot?.querySelector('[data-testid="tree-root"]'),
      );
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

test.describe("拖拽导入（DnD）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await waitForTreeDnD(page);
  });

  test("仓库页 tree dragover 文件 → tree-drop-hint 出现", async ({ page }) => {
    await dispatchFileDragOnTree(page, "a.ysm", true);
    expect(await isTreeDropHintVisible(page)).toBe(true);
  });

  test("drop 文件 → tree-drop-hint 收起 + toast 反馈", async ({ page }) => {
    await dispatchFileDragOnTree(page, "model-a.ysm");
    // drop 后提示条应隐藏（bindTreeDnD 的 onDrop 隐藏 + 导入处理）
    expect(await isTreeDropHintVisible(page)).toBe(false);
    // 导入链路触发 → toast 反馈：directImport 成功 toast 含文件名
    // （原「任一 toast 可见」会被 index.html 欢迎 toast 假绿）
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "model-a.ysm" });
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });

  test("无文件 dataTransfer → tree-drop-hint 不出现", async ({ page }) => {
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
  });
});
