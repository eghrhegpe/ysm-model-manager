// ===== 声明式菜单通用渲染器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 「单一渲染器吃树数据」：将 PreviewMenuNode[] 递归渲染进容器。
//  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
//  - panel / action → 行（经 makeRow + navigate / run）
//  - divider / sectionTitle → 轻量分隔/标题行
//  - visibleWhen → 条件守卫（返回 false 不渲染）
// 新增/迁移菜单项时写 PreviewMenuNode 数据即可，渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。

import type { SlideMenuHandle, SlideMenuView } from "../../../ui/ui-slide-menu.ts";
import { t } from "../../../core/i18n/t.ts";
import type { PreviewMenuNode, PreviewActionMenuCtx } from "./preview-menu-node-types.ts";
import { previewSnapshot, setStateValue } from "../state/preview-state.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

/**
 * 幂等注入 renderMenu 用的 CSS 类规则（仅注入一次，重复调用 no-op）。
 * 把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串。
 */
let _menuStylesInjected = false;
function ensureMenuStyles(): void {
  if (_menuStylesInjected) return;
  const style = document.createElement("style");
  style.textContent = `
.cap-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  min-height: 32px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.cap-section-arrow {
  font-size: 10px;
  display: inline-block;
}
.menu-divider {
  height: 1px;
  background: rgba(255,255,255,0.1);
  margin: 6px 10px;
}
`;
  document.head.appendChild(style);
  _menuStylesInjected = true;
}

// ===================================================================
// renderMenu — 子函数（8 kind 分派拆 6 子，2 段 onclick 模式⑥提纯）
// ===================================================================

/** renderMenu 依赖接口（deps 形参类型提级，避免主函数里重复写 8 行参数表） */
interface RenderMenuDeps {
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
  makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  menu: SlideMenuHandle;
  actionCtx: PreviewActionMenuCtx;
}

/** 统一 label 取值：labelKey→tr(fallback)；无 labelKey 直接用 node.id */
function rmLabel(node: PreviewMenuNode, valueOverride?: unknown): string {
  if (node.labelKey) return tr(node.labelKey, node.fallback ?? (valueOverride !== undefined ? String(valueOverride) : node.id));
  return valueOverride !== undefined ? String(valueOverride) : node.id;
}

/** [模式⑥·提纯 1/2] 通用 action click：ev.stopPropagation + void action?(actionCtx)，button/row 两段同构共用 */
function rmBindActionClick(
  el: HTMLElement,
  action: ((ctx: PreviewActionMenuCtx) => unknown) | undefined,
  actionCtx: PreviewActionMenuCtx,
): void {
  el.addEventListener("click", (ev: MouseEvent): void => {
    ev.stopPropagation();
    if (action) void action(actionCtx);
  });
}

/** [模式⑥·提纯 2/2] 叶节点 click：panel navigate / action 执行，共用 stopPropagation */
function rmBindLeafClick(
  row: HTMLElement,
  node: PreviewMenuNode,
  deps: RenderMenuDeps,
): void {
  row.onclick = (ev: MouseEvent): void => {
    ev.stopPropagation();
    if (node.kind === "panel") {
      deps.menu.navigate(deps.makePanelView(node));
    } else if (node.action) {
      node.action(deps.actionCtx);
    }
  };
}

/** [子函数 1/6] folder：可折叠 section，递归 renderMenu 渲染 children */
function rmAppendFolder(
  container: HTMLElement,
  node: PreviewMenuNode,
  deps: RenderMenuDeps,
): void {
  const children = node.children ?? [];
  if (children.length === 0) return;
  const section = document.createElement("div");
  section.dataset.testid = node.id;
  const header = document.createElement("div");
  header.className = "cap-section-header";
  const collapsed = node.defaultOpen === false;
  const arrow = document.createElement("span");
  arrow.textContent = collapsed ? "▸" : "▾";
  arrow.className = "cap-section-arrow";
  const title = document.createElement("span");
  title.textContent = rmLabel(node);
  header.append(arrow, title);
  const body = document.createElement("div");
  body.dataset.testid = node.id + "-body";
  body.style.cssText = "display:" + (collapsed ? "none" : "block");
  header.addEventListener("click", (ev: MouseEvent): void => {
    ev.stopPropagation();
    const nowCollapsed = body.style.display === "none";
    body.style.display = nowCollapsed ? "block" : "none";
    arrow.textContent = nowCollapsed ? "▾" : "▸";
  });
  renderMenu(body, children, deps);
  section.append(header, body);
  container.appendChild(section);
}

/** [子函数 2/6] field：键值对行（统计/信息展示） */
function rmAppendField(container: HTMLElement, node: PreviewMenuNode): void {
  const row = document.createElement("div");
  row.className = "slide-item field-row";
  row.dataset.testid = "preview-" + node.id;
  const k = document.createElement("span");
  k.className = "field-label";
  k.textContent = node.labelKey ? tr(node.labelKey, node.id) : node.id;
  const displayed = node.value ?? (node.labelKey ? tr(node.labelKey, node.id) : node.id);
  const v = document.createElement("span");
  v.className = "field-value";
  v.textContent = String(displayed);
  row.append(k, v);
  container.appendChild(row);
}

/** [模式⑥·提纯] button/row 共用行骨架：slide-item 行 + testid + 可选图标 + 空标签（jscpd 去重） */
function rmMakeRowBase(node: PreviewMenuNode): { row: HTMLDivElement; lb: HTMLSpanElement } {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.dataset.testid = "preview-" + node.id;
  if (node.icon) {
    const ic = document.createElement("span");
    ic.className = "slide-icon";
    ic.textContent = node.icon;
    row.appendChild(ic);
  }
  const lb = document.createElement("span");
  lb.className = "slide-label";
  row.appendChild(lb);
  return { row, lb };
}

/** [子函数 3/6] button：操作按钮行 */
function rmAppendButton(container: HTMLElement, node: PreviewMenuNode, actionCtx: PreviewActionMenuCtx): void {
  const { row, lb } = rmMakeRowBase(node);
  lb.textContent = rmLabel(node);
  rmBindActionClick(row, node.action, actionCtx);
  container.appendChild(row);
}

/** [子函数 4/6] row：动态列表行（纹理/材质/bone 等） */
function rmAppendDynamicRow(container: HTMLElement, node: PreviewMenuNode, actionCtx: PreviewActionMenuCtx): void {
  const { row, lb } = rmMakeRowBase(node);
  lb.style.cssText = "font-size:12px";
  lb.textContent = rmLabel(node, node.value || node.id);
  if (node.value && typeof node.value === "string") {
    const meta = document.createElement("span");
    meta.className = "slide-sublabel";
    meta.textContent = node.value;
    row.appendChild(meta);
  }
  rmBindActionClick(row, node.action, actionCtx);
  container.appendChild(row);
}

/** [子函数 5/6] select：下拉选择控件（bind 到 PreviewStatePath，走状态层读写）——
 *  [doc:adr-126-p5-c] 受控化：组件选择等交互控件不再手写 DOM 闭包，声明为节点 + control.bind */
function rmAppendSelect(
  container: HTMLElement,
  node: PreviewMenuNode,
  snapshot: Record<string, unknown>,
): void {
  const spec = node.control;
  if (!spec?.options?.length) return;
  const wrap = document.createElement("div");
  wrap.className = "slide-item";
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 10px";
  const lb = document.createElement("span");
  lb.className = "slide-label";
  lb.style.cssText = "flex:1;min-width:0;font-size:12px;color:rgba(255,255,255,0.7)";
  lb.textContent = rmLabel(node);
  wrap.appendChild(lb);
  const sel = document.createElement("select");
  sel.className = "setting-select";
  sel.dataset.testid = "preview-" + node.id;
  const cur = spec.get ? spec.get(snapshot[spec.bind]) : snapshot[spec.bind];
  for (const opt of spec.options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    o.selected = String(cur) === opt.value;
    sel.appendChild(o);
  }
  sel.onchange = (): void => {
    const raw = sel.value;
    const v = spec.set ? spec.set(raw) : raw;
    // [doc:adr-126-p5-c] control.bind 是声明式路径（编译期经 PreviewStatePath 守卫）；
    // 运行期收窄到 KNOWN_PATHS 窄联合——未落地路径写前应先用 isPathAvailable 判（本层不管）
    setStateValue(spec.bind as never, v);
    spec.onChange?.(v);
  };
  wrap.appendChild(sel);
  container.appendChild(wrap);
}

/** [子函数 5/6] divider + sectionTitle：两个轻量节点共用 tiny 子函数 */
function rmAppendDecor(container: HTMLElement, node: PreviewMenuNode): void {
  if (node.kind === "divider") {
    const hr = document.createElement("div");
    hr.dataset.testid = node.id;
    hr.className = "menu-divider";
    container.appendChild(hr);
    return;
  }
  // sectionTitle
  const st = document.createElement("div");
  st.dataset.testid = node.id;
  st.textContent = rmLabel(node);
  st.className = "section-title";
  container.appendChild(st);
}

/** [子函数 6/6] 叶节点：panel / action / custom —— 直接走 makeRow + navigate/action */
function rmAppendLeaf(container: HTMLElement, node: PreviewMenuNode, deps: RenderMenuDeps): void {
  const row = deps.makeRow(node, { chevron: node.kind === "panel" });
  rmBindLeafClick(row, node, deps);
  container.appendChild(row);
}

// ===================================================================
// renderMenu — 主函数（分派器，≤25 行）
// ===================================================================

export function renderMenu(container: HTMLElement, nodes: PreviewMenuNode[], deps: RenderMenuDeps): void {
  ensureMenuStyles();
  // [doc:adr-126-p4-d] visibleWhen 吃状态层快照（previewSnapshot()）——AGENTS.md 硬约束
  const snapshot = previewSnapshot();
  for (const node of nodes) {
    if (node.visibleWhen && !node.visibleWhen(snapshot)) continue;
    if (node.kind === "folder" || Array.isArray(node.children)) {
      rmAppendFolder(container, node, deps);
    } else if (node.kind === "field") {
      rmAppendField(container, node);
    } else if (node.kind === "button") {
      rmAppendButton(container, node, deps.actionCtx);
    } else if (node.kind === "row") {
      rmAppendDynamicRow(container, node, deps.actionCtx);
    } else if (node.kind === "select") {
      rmAppendSelect(container, node, snapshot);
    } else if (node.kind === "divider" || node.kind === "sectionTitle") {
      rmAppendDecor(container, node);
    } else {
      rmAppendLeaf(container, node, deps);
    }
  }
}
