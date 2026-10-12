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
  /** role 属性名（值域见 ROLE；`setAttribute(ARIA_ATTR.role, ROLE.x)` 成对用法） */
  role: "role",
  valuemin: "aria-valuemin",
  valuemax: "aria-valuemax",
  valuenow: "aria-valuenow",
  checked: "aria-checked",
  label: "aria-label",
  labelledby: "aria-labelledby",
  live: "aria-live",
  atomic: "aria-atomic",
  /** 控件禁用态：自绘控件（cs-bar）与行容器无原生 disabled 属性，
   *  须显式标注无障碍态（原生 select/input 另有 disabled 属性，两者并用）。 */
  disabled: "aria-disabled",
  /** 折叠披露态（D8 disclosure）：可折叠 header 的展开/收起播报 */
  expanded: "aria-expanded",
  /** 披露触发器 → 受控面板 id 绑定（D8 disclosure，与 expanded 成对） */
  controls: "aria-controls",
  /** 模态语义（overlay `aria-modal="true"`，焦点陷阱据此收敛） */
  modal: "aria-modal",
} as const;

/** 滑动条本体 class（cap 栈 renderCapSlider 自绘 .cs-bar，经 uiComponentsStyleSheet 消费） */
export const SLIDER_BAR_CLASS = "cs-bar";
