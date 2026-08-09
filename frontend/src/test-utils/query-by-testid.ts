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
  // P2 修复：前缀匹配限定「精确 testid 或 testid + '-' + 纯数字序号」——
  // 裸 `^=` 会把兄弟角色也扫进来（tree-dir 匹配到 tree-dir-toggle，row-tpl.ts:43-44），
  // 且空串会匹配全部 testid。CSS `^=` 无法表达「- 后跟数字」，故查询后 JS 过滤：
  // 仅保留 testid 精确匹配，或 `X-<数字>` 编号实例（tree-file-1/2 约定，Design.md §19.1）
  const prefix = `${testid}-`;
  const els = Array.from(
    scope(container).querySelectorAll(
      `[data-testid="${testid}"], [data-testid^="${testid}-"]`,
    ),
  );
  return els.filter((el) => {
    const id = el.getAttribute("data-testid") ?? "";
    if (id === testid) return true;
    // code_review：CSS `[data-testid^="${testid}-"]` 已保证此处 id 以 prefix 开头，
    // 无需重复 startsWith 守卫；仅数字后缀正则做实际过滤（tree-dir-toggle 后缀非数字 → 排除）
    const suffix = id.slice(prefix.length);
    return /^\d+$/.test(suffix); // 仅编号实例（tree-file-1/2 约定，Design.md §19.1）
  });
}
