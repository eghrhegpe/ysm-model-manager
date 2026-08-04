// ===== Playwright E2E 配置（ADR-037）=====
// 在 vite dev 纯前端模式下运行，mock Wails bridge 阻断后端依赖。
// 使用 data-testid 稳定钩子定位元素（Design.md §19.1）。
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  workers: 1, // 串行，避免 vite dev 端口冲突
  reporter: [["list"], ["html", { outputFolder: "e2e-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // 全局 setup：启动 vite dev + 等待就绪
  globalSetup: require.resolve("./e2e/global-setup.ts"),
  // 全局 teardown：关闭 vite dev
  globalTeardown: require.resolve("./e2e/global-teardown.ts"),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});