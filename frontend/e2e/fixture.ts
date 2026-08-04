// ===== E2E 测试 fixture（ADR-037）=====
// 扩展 Playwright 的 test 对象，注入 mock Wails bridge 和自定义 fixture。
import { test as base, type Page } from "@playwright/test";
import { mockWailsBridge } from "./mock-bridge.ts";

/**
 * 创建已注入 mock Wails bridge 的页面。
 * 在 page.addInitScript 中注入，确保页面加载前 go/runtime 已就位。
 */
export const test = base.extend({
  page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
    // 在页面加载任何脚本前注入 mock Wails bridge
    await page.addInitScript(() => {
      // 使用 Function 形式注入，避免 TypeScript 编译问题
      const code = `
        window.go = {
          main: {
            App: {
              GetAppVersion: async () => "v1.0.0-e2e",
              GetRepoRoot: async () => "/e2e/repo",
              LoadAppConfig: async () => JSON.stringify({ mcRoot: "/e2e/mc" }),
              ScanModelEntries: async () => JSON.stringify([
                { Name: "model-a.ysm", Path: "/e2e/repo/model-a.ysm" },
                { Name: "model-b.ysm", Path: "/e2e/repo/model-b.ysm" },
              ]),
              ListVersionInstances: async () => JSON.stringify([
                { Name: "1.20.1-Fabric", VersionDir: "/e2e/mc/1.20.1-Fabric" },
              ]),
              GetInstanceSyncStatus: async () => JSON.stringify([
                { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
                { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
              ]),
              LoadResourceTypes: async () => JSON.stringify({
                resourceTypes: [
                  { id: "ysm", name: "YSM 模型", icon: "💎" },
                  { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
                ],
              }),
            },
          },
        };
        window.runtime = {
          Events: { On: () => () => {}, Off: () => {}, Emit: () => {} },
        };
      `;
      (0, eval)(code);
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";