// ===== E2E 测试 fixture（ADR-037）=====
// 扩展 Playwright 的 test 对象，注入 mock Wails bridge 和自定义 fixture。
// mock 数据源统一来自 ./mock-data.ts（vitest 与 E2E 共用，防双源漂移）。
//
// 诊断改进（2026-08-10）：
//   1. 转发页面 console/pageerror 到测试 stdout——此前失败时浏览器端日志
//      （如 bus.ts 的 console.error）被 Playwright 默认吞掉，只能靠
//      trace/screenshot 猜原因；现按「仅失败时输出」转发，定位不刷屏。
//   2. 失败时 dump 遮罩状态（残留 .dlg-overlay 数量/可见性/文本），
//      遮罩类失败（弹窗没关干净、单例被占）一眼可辨，无需开 trace。
import { test as base, type Page } from "@playwright/test";
import { generateMockBridgeScript } from "./mock-data.ts";

/** 转发页面 console/pageerror 到 stdout（仅 level error/warning，避免刷屏） */
function forwardPageLogs(page: Page): void {
  page.on("console", (msg) => {
    const level = msg.type();
    if (level !== "error" && level !== "warning") return;
    // Wails runtime 在纯浏览器（vite dev / e2e mock bridge）环境打印的预期提示：
    // 探测不到 window.chrome.webview / webkit / wails.invoke 时必现，e2e 场景无害，
    // 过滤掉避免每次测试刷屏（真实桌面/Android 不会触发）。
    // P4 修正：原 `includes("Browser Environment Detected")` 单子串可能误吞未来含
    // 同短语的真实错误——改双短语组合匹配（两个特征同时出现才算 Wails 环境提示，
    // 真实错误几乎不可能同时包含两者）。
    const text = msg.text();
    if (text.includes("Browser Environment Detected") && text.includes("Only UI previews")) {
      return;
    }
    console.log(`[page:${level}] ${text}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[page:pageerror] ${err.message}\n${err.stack ?? ""}`);
  });
}

/** 失败时 dump 残留遮罩状态（页面可能已关，全部兜底） */
async function dumpDlgState(page: Page | null): Promise<void> {
  // page fixture 初始化失败时 afterEach 会收到 null——必须先守卫，
  // 否则同步 TypeError 会掩盖原始测试错误（.catch 只兜 Promise reject）
  if (!page) {
    console.log("[e2e:dlg] page 不可用，跳过遮罩 dump");
    return;
  }
  const info = await page
    .evaluate(() => {
      const overlays = Array.from(document.querySelectorAll(".dlg-overlay"));
      return {
        count: overlays.length,
        overlays: overlays.map((el) => ({
          testid: el.getAttribute("data-testid") ?? "",
          visible: getComputedStyle(el).display !== "none",
          text: (el.textContent ?? "").trim().slice(0, 120),
        })),
      };
    })
    .catch(() => null);
  if (!info) {
    console.log("[e2e:dlg] 页面不可达，跳过遮罩 dump");
    return;
  }
  if (info.count === 0) {
    console.log("[e2e:dlg] 失败时无残留遮罩（dlg-overlay=0）");
  } else {
    console.log(
      `[e2e:dlg] 失败时残留 ${info.count} 个遮罩:\n` +
        info.overlays
          .map((o) => `  - testid=${o.testid || "(无)"} visible=${o.visible} text="${o.text}"`)
          .join("\n"),
    );
  }
}

/**
 * 创建已注入 mock Wails bridge 的页面。
 * 在 page.addInitScript 中注入，确保页面加载前 go/runtime 已就位。
 * mock 数据来自共享 mock-data.ts，改 Go Binding 签名时只改那一处。
 */
export const test = base.extend({
  page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
    // 从共享数据源生成注入脚本
    const script = generateMockBridgeScript();
    await page.addInitScript(script);
    forwardPageLogs(page);
    await use(page);
  },
});

// 失败/超时后 dump 遮罩状态（仅非通过时，避免刷屏）
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed") return;
  await dumpDlgState(page);
});

export type { Page } from "@playwright/test";
export { expect } from "@playwright/test";
