// ===== Playwright Web 版 E2E 配置（ADR-049 Phase 3）=====
// 与 playwright.config.ts（桌面 mock 模式，端口 5173）隔离：
// vite dev --mode web → import.meta.env.MODE="web" → browserAdapter 真链路
// （IndexedDB 模型库，零 Wails 壳依赖）。跑法：
//   npx playwright test --config playwright.web.config.ts
import { defineConfig, devices } from "@playwright/test";
import { localChromiumUse } from "./e2e/browser-path.ts";

export default defineConfig({
  testDir: "./e2e-web",
  timeout: 20000,
  globalTimeout: 3 * 60 * 1000,
  maxFailures: 2,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  webServer: {
    command: "npx vite --mode web --port 5199 --host 127.0.0.1",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      // 浏览器探测（e2e/browser-path.ts，与主配置同一机制）：web 链路是 WebGL 主战场，
      // 默认 headless 解析走 headless shell（GPU 栈弱）——探测到期望修订的 full 时钉住。
      // postprocessing.spec 的 spec 级 test.use 硬钉全版本（spec 级覆盖 project 级），
      // 其「环境缺失即启动失败」的有意语义不受本接线影响；未设 spec 级 use 的
      // web-preview / web-smoke 走本 project 级探测，探测不到则展开 {} 走默认解析。
      use: { ...devices["Desktop Chrome"], ...localChromiumUse() },
    },
  ],
});
