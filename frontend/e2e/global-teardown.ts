// ===== Playwright 全局 teardown — 关闭 vite dev 服务器 =====
// global-setup 返回的 teardown 函数由 Playwright 自动调用。
// 此处仅打印关闭信息，实际关闭在 global-setup 的返回函数中执行。
export default async function globalTeardown(): Promise<void> {
  console.log("[e2e] 全局 teardown 完成");
}