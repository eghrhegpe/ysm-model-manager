// ===== Playwright E2E 配置（ADR-037）=====
// 在 vite dev 纯前端模式下运行，mock Wails bridge 阻断后端依赖。
// 内置 webServer 自动管理 vite dev 生命周期。
// 使用 data-testid 稳定钩子定位元素（Design.md §19.1）。
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "e2e-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // 内置 webServer：自动启动/关闭 vite dev
  webServer: {
    command: "npx vite --port 5173 --host 127.0.0.1",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});