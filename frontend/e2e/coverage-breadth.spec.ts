// ===== E2E 覆盖广度采集（ADR-035 G-4）=====
// 走核心交互路径（导航/树/预览/设置），用 page.coverage 采集 V8 precise coverage，
// 输出到 frontend/e2e-coverage/coverage.json 供 scripts/e2e-coverage-report.mjs 分析。
//
// 边界（ADR-035 G-4 原文）：
//   - 不并入 vitest 覆盖率门禁、不做 CI 红线——仅人工观察面；
//   - 行覆盖按帧采样易抖动，报告只问「源文件是否被真实交互走到」。
//
// 运行：cd frontend && npx playwright test coverage-breadth
// （playwright.config.ts 默认 testDir ./e2e，本文件按文件名被扫描——日常 e2e 不跑它，
//   仅按需执行；采集产物不入 git，.gitignore 已含 frontend/e2e-coverage/ 可选加）
import { test, expect } from "./fixture.ts";
import { gotoApp, navItem, waitForTreeCount, clickTreeFile } from "./helpers.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT_DIR = path.resolve(__dirname, "..", "e2e-coverage");
const OUT_FILE = path.join(OUT_DIR, "coverage.json");

test.describe("E2E 覆盖广度采集（G-4）", () => {
  test("核心交互路径 → 采集 V8 coverage", async ({ page }) => {
    // P2 修复（子代理审计）：采集器从不启动——原只调 stopJSCoverage() 从未
    // startJSCoverage()，JSCoverage.stop 在未 start 时返回空数组不抛错 →
    // coverage.json 恒为 [] 假绿。导航前必须先启动采集。
    await page.coverage.startJSCoverage();

    // ① 导航全切换
    await gotoApp(page);
    const navItems = page.locator('[data-testid="nav-item"]');
    const navCount = await navItems.count();
    for (let i = 0; i < navCount; i++) {
      await navItems.nth(i).click();
      await expect(navItems.nth(i)).toHaveClass(/active/, { timeout: 5000 });
    }

    // ② 文件树交互（展开/点击）
    await navItem(page, "repository").click(); // 回到仓库页（语义定位，原 nth(0) 依赖首项顺序）
    await expect(page.locator('[data-testid="tree-file"]').first()).toBeVisible({ timeout: 5000 });
    // P2 修复（子代理审计）：原 `waitForTreeCount(page, 1)` 参数错位——第一参数应为
    // testid 字符串（"tree-file"），传数字 1 会白等 8s 返回 0，后续 clickTreeFile 空操作
    await waitForTreeCount(page, "tree-file");
    await clickTreeFile(page, 0);

    // ③ 弹窗/菜单路径（modal 单例）
    await page.keyboard.press("Escape");

    // 采集 V8 coverage（page.coverage 为 Chromium 专属，playwright.config 已固定 chromium）
    const coverage = await page.coverage.stopJSCoverage();
    // 防假绿：采集到 0 条目即为失败，避免空报告静默通过
    expect(coverage.length).toBeGreaterThan(0);
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(coverage, null, 2));
    console.log(`[e2e-coverage] 已采集 ${coverage.length} 个条目 → ${path.relative(process.cwd(), OUT_FILE)}`);
  });
});
