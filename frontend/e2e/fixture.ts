// ===== E2E 测试 fixture（ADR-037）=====
// 扩展 Playwright 的 test 对象，注入 mock Wails bridge 和自定义 fixture。
// mock 数据源统一来自 ./mock-data.ts（vitest 与 E2E 共用，防双源漂移）。
import { test as base, type Page } from "@playwright/test";
import { generateMockBridgeScript } from "./mock-data.ts";

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
    await use(page);
  },
});

export { expect } from "@playwright/test";