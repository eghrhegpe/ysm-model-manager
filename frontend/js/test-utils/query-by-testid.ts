// ===== 测试查询层（test-utils/query-by-testid）=====
// 基于 data-testid 属性的 DOM 查询封装，与契约注册表 testid 体系对齐。
// 命名对齐 Testing Library 习惯，降低迁移成本：
//   - queryByTestId    — 返回 Element | null（不抛）
//   - getByTestId      — 返回 Element（找不到抛）
//   - queryAllByTestId — 返回 Element[]（不抛）
//   - getAllByTestId   — 返回 Element[]（0 个抛）
//
// 支持 Shadow DOM：container.shadowRoot 优先，否则 container 自身。

export type QueryContainer = Element | Document | ShadowRoot;

/** 查询目标：ShadowRoot（如有），否则容器自身 */
function scope(container: QueryContainer): QueryContainer {
  if ("shadowRoot" in container && container.shadowRoot) return container.shadowRoot;
  return container;
}

export function queryByTestId(
  container: QueryContainer,
  testid: string,
): Element | null {
  return scope(container).querySelector(`[data-testid="${testid}"]`);
}

export function getByTestId(
  container: QueryContainer,
  testid: string,
): Element {
  const el = queryByTestId(container, testid);
  if (!el) throw new Error(`Unable to find an element by testid: "${testid}"`);
  return el;
}

export function getAllByTestId(
  container: QueryContainer,
  testid: string,
): Element[] {
  const els = queryAllByTestId(container, testid);
  if (els.length === 0) throw new Error(`Unable to find an element by testid: "${testid}"`);
  return els;
}

export function queryAllByTestId(
  container: QueryContainer,
  testid: string,
): Element[] {
  return Array.from(scope(container).querySelectorAll(`[data-testid="${testid}"]`));
}
