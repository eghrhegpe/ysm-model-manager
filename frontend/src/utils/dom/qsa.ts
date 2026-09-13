/**
 * qsa.ts — 类型安全 DOM 查询助手（泛型直通 querySelectorAll/querySelector）。
 *
 * 背景（2026-09 锐评 P1）：views 层 129 处 `as HTMLElement` 断言，大头是
 * `root.querySelectorAll(sel)` 返回 `NodeListOf<Element>` 后逐元素
 * `(el as HTMLElement).dataset` 强转。lib.dom 的 querySelector* 本身带泛型
 * `<T extends Element>`，本助手只是把泛型用法变顺手，消掉逐元素断言。
 *
 * 增量策略（ADR 待立，先按此执行）：新代码必用；存量代码「随触随迁」——
 * 改到哪段就迁哪段，不做一次性全量替换。
 */

/** 查询全部：`qsa<HTMLInputElement>(root, "input[data-idx]")` → `HTMLInputElement[]` */
export function qsa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** 查询单个：命中返回 `T`，未命中返回 `null`（保留调用方判空责任，不吞选择器错误） */
export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}
