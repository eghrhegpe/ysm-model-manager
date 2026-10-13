// ===== 深焦解析：document.activeElement → 真实聚焦元素（跨 Shadow 边界）=====
//
// 为什么需要：本仓 UI 几乎全是 Shadow DOM 组件（app-content / app-preview / 3D 菜单…）。
// 浏览器对 `document.activeElement` 施加 **retargeting**——shadow 树内元素聚焦时，
// 它返回的是 **shadow host**，而非真实获得焦点的内层元素。于是：
//
//   const cur = document.activeElement;          // ← shadow host，不是卡片
//   cards.indexOf(cur);                          // ← 恒 -1，下游逻辑全线早退
//
// 这是**已经踩过多次**的坑，本仓已有三处各写一遍同样的下钻循环：
//   - utils/dom/trap-focus-across-shadow.ts（浮层 Tab 收拢）
//   - views/context-menu/index.ts（菜单项定位）
//   - （历史第三处已随重构收敛）
// 每处各抄一遍 = 迟早漂移。本模块是该范式的**单源出口**，新增消费方一律引这里。
//
// ⚠️ 与 happy-dom 的关系：测试环境同样把 shadow 内焦点停在 host（见
// utils/dom/focus-restore.test.ts:383 的实证注释），故单测必须读 `deepActiveElement()`
// 或 `root.activeElement`，**不能**直接断言 `document.activeElement === shadow 内元素`
// ——那不是生产 bug，是测试环境的模拟口径。

/**
 * 深焦解析：返回**真实**获得焦点的元素，沿 `shadowRoot.activeElement` 逐层下钻。
 *
 * - light DOM 内聚焦 → 与 `document.activeElement` 等价（不改变原语义）
 * - shadow 内聚焦 → 返回内层真实元素（修复 retargeting）
 * - 无焦点 → 返回 `document.activeElement` 原值（DOM 规范下是 `<body>`，非 null）
 *
 * @param start 起点（默认 `document.activeElement`）；传宿主元素可显式指定下钻起点
 */
export function deepActiveElement(start?: Element | null): Element | null {
  let active: Element | null = start ?? (document.activeElement as Element | null);
  // 下钻：host.shadowRoot.activeElement 若非空则说明焦点确实在其 shadow 树内，继续向内层解析。
  // 逐层 while 而非单层 if——支持嵌套 shadow（本仓 app-content 内的组件亦自有 shadow）。
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * 深焦解析（HTMLElement 收窄版）——判定「当前焦点是否在 items 内」「定位当前项」等场景用它。
 * 返回 null 表示焦点不在文档内或落在非 HTMLElement 节点上（如 SVG 根）。
 */
export function deepActiveElementOf<E extends Element>(
  items: readonly E[],
  start?: Element | null,
): E | null {
  const active = deepActiveElement(start);
  if (!active) return null;
  return items.find((it) => it === active) ?? null;
}
