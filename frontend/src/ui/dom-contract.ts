// 🥉 ui-helpers 组件库 — DOM 契约单源（零依赖叶子）。
// 自 MikuMikuAR dom-contract.ts 迁移，仅保留 🥉 组件实际引用的常量。
// 渲染函数产出 role/class 时统一引用此处，禁止手写字符串。

/** 渲染层 role 常量 */
export const ROLE = {
  slider: "slider",
  switch: "switch",
  listbox: "listbox",
  button: "button",
  dialog: "dialog",
  status: "status",
  alert: "alert",
} as const;

/** aria 属性名常量 */
export const ARIA_ATTR = {
  valuemin: "aria-valuemin",
  valuemax: "aria-valuemax",
  valuenow: "aria-valuenow",
  checked: "aria-checked",
  label: "aria-label",
  labelledby: "aria-labelledby",
  live: "aria-live",
  atomic: "aria-atomic",
} as const;

/** 滑动条本体 class（cap 栈 renderCapSlider 自绘 .cs-bar，经 uiComponentsStyleSheet 消费） */
export const SLIDER_BAR_CLASS = "cs-bar";
