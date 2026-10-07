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
  // 2026-10 扩限 + 2026-10-08 再扩：SwiftShader 软渲染（CI headless 无 GPU）逐例成本高于本地
  // GPU 机。5min 曾留余量，但加载偏慢的 runner 上 20 例实测 5.0~5.5min——globalTimeout 5min
  // 顶满会把最后一个用例（web-ysm-3d）掐掉，报「1 did not run + 2 errors not a part of any test」
  // （2026-10-08 实证：19 passed 仍 exit 1）。扩到 7min，与主配置 playwright.config.ts 同口径；
  // 本地 GPU 机更快不受影响。
  globalTimeout: 7 * 60 * 1000,
  maxFailures: 2,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    // retries: 0 下 on-first-retry 永不触发（主配置 2026-08 同病已修，web 配置漏跟）→
    // 失败即留 trace，与主配置 retain-on-failure 纪律对齐
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    // WebGL 软渲染统一（2026-10）：CI headless 无 GPU，SwiftShader 参数原仅三个 spec 级
    // 钉住（postprocessing / menu-3d-session / water-wave-evidence），web-preview / web-smoke
    // 无参裸跑 → CI 上 WebGL2 可用性不稳。project 级统一钉住；spec 级 test.use 的
    // launchOptions 深合并优先（executablePath 硬钉不受影响）。跨环境确定性：软渲染伪影
    // 不作美术判据（e2e-visual-feedback 卡纪律）。
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
  },
  webServer: {
    command: "npx vite --mode web --port 5199 --host 127.0.0.1",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
    // 与主配置同纪律：CI（ubuntu runner）冷启动放宽到 120s（vite web 模式首启含依赖预构建）
    timeout: 120000,
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
