// ===== Playwright E2E 配置（ADR-037）=====
// 在 vite dev 纯前端模式下运行，mock Wails bridge 阻断后端依赖。
// 内置 webServer 自动管理 vite dev 生命周期。
// 使用 data-testid 稳定钩子定位元素（Design.md §19.1）。
import { defineConfig, devices } from "@playwright/test";
import { localChromiumUse } from "./e2e/browser-path.ts";

export default defineConfig({
  testDir: "./e2e",
  // ADR-035 G-4：覆盖广度采集 spec 按需执行（npx playwright test coverage-breadth），
  // 不纳入日常 e2e 套件（采集会拖慢且产物仅人工观察面）
  testIgnore: ["**/coverage-breadth.spec.ts"],
  // 每项限 15 秒（用户侧验收标准）；总套件限 7 分钟；2 次失败立即停——避免「改个菜单空跑 N 个 15s 超时」
  timeout: 15000,
  globalTimeout: 7 * 60 * 1000,
  maxFailures: 2,
  // retries: 0 —— 失败即真红，不靠重试掩盖竞态（子代理审核 P2）。
  // 已知环境性缺口（vite 冷启动）已由 fixture 的 app-content shadowRoot
  // 轮询等待根治；条件性 test.skip 保留（mock 未渲染时优雅跳过，有原因注释）。
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "e2e-report" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    // retries:0 下 on-first-retry 永不触发 → 失败即留 trace（batch1 审核 P3-2）
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 显式固定语言环境：settings.spec 断言 "Path updated" 等英文文案依赖 en-US，
    // 若不固定，CI 系统语言/locale 变化即翻车（context-menu 已踩过 Copy File Path）
    locale: "en-US",
  },
  // 内置 webServer：自动启动/关闭 vite dev
  webServer: {
    command: "npx vite --config vite.e2e.config.ts --port 5173 --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
    // 显式 --host 127.0.0.1 与 url 保持一致：CI 上 vite 默认绑定 localhost（可能解析为 ::1），
    // 而探测用 127.0.0.1 会一直连不上导致超时。CI（ubuntu runner）冷启动放宽到 120s。
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      // 浏览器探测（e2e/browser-path.ts）：受限网络下 ms-playwright 里实际存在的
      // chromium 版本可能与 @playwright/test 期望不符 → 默认解析 "Executable doesn't
      // exist"。探测到即钉住其 launchOptions.executablePath；探测不到展开 {}，
      // 行为与改造前完全一致（CI 正常装了浏览器的场景正是这条路）。
      use: { ...devices["Desktop Chrome"], ...localChromiumUse() },
    },
  ],
});
