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
  // 精确匹配（单个元素，如 data-testid="nav-item"）
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
  // P2 修复：前缀匹配限定「精确 testid 或 testid + '-' 序号后缀」——
  // 裸 `^=` 会把兄弟角色也扫进来（tree-dir 匹配到 tree-dir-toggle，row-tpl.ts:43-44），
  // 且空串会匹配全部 testid。复合选择器既支持 tree-file-1/2 编号实例，
  // 又排除 tree-dir-toggle 这类「testid 是其前缀」的其他角色。
  return Array.from(
    scope(container).querySelectorAll(
      `[data-testid="${testid}"], [data-testid^="${testid}-"]`,
    ),
  );
}
