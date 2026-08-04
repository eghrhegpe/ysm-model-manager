// ===== 测试工具（G-1 抗脆弱测试基础设施 — ADR-035 / Design.md §19.1）=====
// 组件测试统一走本 helper：查询走 data-testid（稳定钩子，不绑定 CSS 类/文案），
// 等待走轮询（替代固定 sleep）。UI 结构变化只改本文件一处。

/** 按 data-testid 精确查询（root 可为 document / ShadowRoot / 元素） */
export function getByTestId(root: ParentNode, testid: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
}

/** 按 data-testid 前缀查询全部（同域多实例，如 tree-file） */
export function getAllByTestId(root: ParentNode, prefix: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(`[data-testid^="${prefix}"]`)) as HTMLElement[];
}

/** 轮询等待条件成立（替代固定 sleep；超时抛错） */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeout = 3000,
  interval = 50,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor 超时（${timeout}ms）`);
}
