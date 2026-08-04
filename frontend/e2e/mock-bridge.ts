// ===== E2E 测试 mock Wails bridge =====
// 在 vite dev 纯前端模式下，注入 mock 替换 window.go.main.App 等 Wails 绑定。
// 与 vitest 的 vi.mock 模式保持一致，但运行在真实浏览器中。
// 使用方式：在测试中调用 `await page.evaluate(mockWailsBridge)` 或通过 fixture 自动注入。

/** 默认 mock 绑定的返回值 */
export const DEFAULT_MOCKS = {
  GetAppVersion: "v1.0.0-e2e",
  GetRepoRoot: "/e2e/repo",
  LoadAppConfig: JSON.stringify({ mcRoot: "/e2e/mc" }),
  ScanModelEntries: JSON.stringify([
    { Name: "model-a.ysm", Path: "/e2e/repo/model-a.ysm" },
    { Name: "model-b.ysm", Path: "/e2e/repo/model-b.ysm" },
  ]),
  ListVersionInstances: JSON.stringify([
    { Name: "1.20.1-Fabric", VersionDir: "/e2e/mc/1.20.1-Fabric" },
  ]),
  GetInstanceSyncStatus: JSON.stringify([
    { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
    { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
  ]),
  LoadResourceTypes: JSON.stringify({
    resourceTypes: [
      { id: "ysm", name: "YSM 模型", icon: "💎" },
      { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
    ],
  }),
  ToggleModelEnable: JSON.stringify(true),
  SaveAppConfig: JSON.stringify(undefined),
  DetectResourceType: "ysm",
};

/**
 * 注入 mock Wails bridge 到页面。
 * 在 page.addInitScript 或 page.evaluate 中调用。
 * @param overrides 自定义覆盖默认 mock
 */
export function mockWailsBridge(overrides: Record<string, unknown> = {}): void {
  const mocks = { ...DEFAULT_MOCKS, ...overrides };

  // 创建 window.go.main.App 命名空间，每个绑定返回 Promise
  const app: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [key, value] of Object.entries(mocks)) {
    app[key] = async (..._args: unknown[]) => JSON.parse(JSON.stringify(value));
  }

  Object.defineProperty(window, "go", {
    value: {
      main: {
        App: app,
      },
    },
    writable: false,
    configurable: true,
  });

  // 模拟 Wails runtime Events
  Object.defineProperty(window, "runtime", {
    value: {
      Events: {
        On: () => () => {},
        Off: () => {},
        Emit: () => {},
      },
    },
    writable: false,
    configurable: true,
  });
}