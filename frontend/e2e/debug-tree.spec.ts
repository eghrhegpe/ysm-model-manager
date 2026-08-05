// ===== E2E 调试：app-tree 渲染诊断 =====
import { test, expect } from "./fixture.ts";

test.describe("app-tree 渲染诊断", () => {
  test("检查 app-tree 在 DOM 中的状态", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    const navItems = page.locator('[data-testid="nav-item"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });

    // 等待所有组件加载完成
    await page.waitForTimeout(3000);

    const diag = await page.evaluate(() => {
      const result: Record<string, unknown> = {};

      // 1. window.go 是否存在
      result["window.go exists"] = !!(window as unknown as Record<string, unknown>).go;
      const go = (window as unknown as Record<string, unknown>).go as Record<string, unknown> | undefined;
      const app = (go?.main as Record<string, unknown> | undefined)?.App as Record<string, unknown> | undefined;
      result["window.go.main.App exists"] = !!app;
      if (app) {
        result["App keys"] = Object.keys(app).slice(0, 10);
        // 测试 GetRepoRoot 是否可调用
        const getRepoRoot = app.GetRepoRoot as ((...args: unknown[]) => Promise<unknown>) | undefined;
        if (typeof getRepoRoot === "function") {
          getRepoRoot("ysm").then((v) => { result["GetRepoRoot result"] = v; }).catch(() => { result["GetRepoRoot error"] = true; });
        } else {
          result["GetRepoRoot type"] = typeof getRepoRoot;
        }
      }

      // 2. app-content shadowRoot
      const content = document.querySelector("app-content") as HTMLElement & { _root?: ShadowRoot; _current?: string };
      result["app-content exists"] = !!content;
      if (content) {
        result["app-content has shadowRoot"] = !!content.shadowRoot;
        result["app-content _current"] = content._current || "";
        if (content.shadowRoot) {
          const sr = content.shadowRoot;
          result["shadow innerHTML (first 800)"] = sr.innerHTML.substring(0, 800);
          // 在 Shadow DOM 中查找 app-tree
          const treesInShadow = sr.querySelectorAll("app-tree");
          result["app-tree in shadow"] = treesInShadow.length;
          if (treesInShadow.length > 0) {
            const tree = treesInShadow[0] as HTMLElement & { _entries?: unknown[]; _repoRoot?: string };
            result["tree shadowRoot"] = !!tree.shadowRoot;
            result["tree _entries count"] = tree._entries?.length || 0;
            result["tree _repoRoot"] = tree._repoRoot || "";
            if (tree.shadowRoot) {
              result["tree-file count"] = tree.shadowRoot.querySelectorAll('[data-testid="tree-file"]').length;
              result["tree-dir count"] = tree.shadowRoot.querySelectorAll('[data-testid="tree-dir"]').length;
            }
          }
          // 检查 repo-tab-tree 内容
          const tabTree = sr.getElementById("repo-tab-tree");
          result["repo-tab-tree exists"] = !!tabTree;
          if (tabTree) {
            result["repo-tab-tree innerHTML (first 500)"] = tabTree.innerHTML.substring(0, 500);
          }
        }
      }

      // 3. window.bus
      result["window.bus exists"] = !!(window as unknown as Record<string, unknown>).bus;
      result["window.bus.emit is function"] = typeof (window as unknown as Record<string, unknown>).bus?.emit === "function";

      return result;
    });

    console.log("=== app-tree 诊断结果 ===");
    for (const [key, value] of Object.entries(diag)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }

    if (errors.length > 0) {
      console.log("=== 控制台错误 ===");
      for (const e of errors) {
        console.log(`  ${e}`);
      }
    }

    // 不强制断言，收集诊断信息后用
    expect(true).toBe(true);
  });
});