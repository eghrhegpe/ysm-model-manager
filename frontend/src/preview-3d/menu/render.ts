// ===== 声明式菜单通用渲染器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 「单一渲染器吃树数据」：将 PreviewMenuNode[] 递归渲染进容器。
//  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
//  - panel / action → 行（经 makeRow + navigate / run）
//  - divider / sectionTitle → 轻量分隔/标题行
//  - visibleWhen → 条件守卫（返回 false 不渲染）
// 新增/迁移菜单项时写 PreviewMenuNode 数据即可，渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。

import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { tr } from "../../core/i18n/tr.ts";
import type { PreviewMenuNode, PreviewActionMenuCtx } from "./node-types.ts";
import { previewSnapshot, setStateValue, isPathAvailable, KNOWN_PATHS } from "../state/preview-state.ts";
import { getSchema } from "../adapters/schema-registry.ts";
import { renderCapControls } from "./cap-controls.ts";

// i18n 取值统一走共享 tr()（core/i18n/tr.ts，支持缺失键兜底 + params 插值）

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
  /**
   * custom 节点渲染语义（双轨归一，2026-09）：
   * - false（默认，列表行语义）：custom 走 makeRow 行壳——过渡行为，仅剩测试锁定；
   * - true（面板内容语义）：custom 直接调 renderCustom(list) 填充容器——
   *   schema 面板（settings/env/camera 等）内容经此渲染。
   * 两轨语义曾分裂于 renderPreviewSchemaContent（直接填充）vs renderMenu（行壳），
   * 现由本开关归一：schema 路径传 true，列表路径保持默认。
   */
  renderCustomDirect?: boolean;
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

/** select 当前值解析：bind 模式取 snapshot[bind]（状态层路径），闭包模式取 get(undefined)——
 *  9a65f796 review P12：嵌套三元改单层（bind 优先分支），行为等价 */
function rmSelectCurrent(
  spec: { bind?: string; get?: (v?: unknown) => unknown },
  snapshot: Record<string, unknown>,
): string {
  if (spec.bind) return spec.get ? String(spec.get(snapshot[spec.bind])) : String(snapshot[spec.bind]);
  return spec.get ? String(spec.get(undefined)) : "";
}

/** [子函数 5/6] select：下拉选择控件（bind 到 PreviewStatePath，走状态层读写）——
 *  [doc:adr-126-p5-c] 受控化：组件选择等交互控件不再手写 DOM 闭包，声明为节点 + control.bind */
function rmAppendSelect(
  container: HTMLElement,
  node: PreviewMenuNode,
  snapshot: Record<string, unknown>,
  menu?: SlideMenuHandle,
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
  // [doc:adr-126-p5-收尾] select 支持两种模式：bind（状态层路径，play/morph 之外用）或
  // 闭包 get/set（非状态层来源，如 MmdPlayBridge 动作 select）——与 toggle 分支同构。
  const cur = rmSelectCurrent(spec, snapshot);
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
    if (spec.bind) {
      // bind 模式：写状态层（未落地路径守卫，P5-A review P3）
      // 收窄断言（非 as never）：spec.bind 是 PreviewStatePath 全集，isPathAvailable/
      // setStateValue 只接受已落地的 KNOWN_PATHS 子集——守卫在前保证安全，同时保留
      // 窄类型检查（KNOWN_PATHS 与 PreviewStatePath 漂移时编译期报错）
      const path = spec.bind as typeof KNOWN_PATHS[number];
      if (!isPathAvailable(path)) return;
      setStateValue(path, v);
    }
    spec.onChange?.(v);
    // [doc:adr-126-p5] refreshOnChange：面板内容随绑定状态变化（组件 select 切档后
    // stats/纹理行按新快照重建）——menu.refresh() 重渲染当前面板，schema builder 重新执行
    if (spec.refreshOnChange) menu?.refresh();
  };
  wrap.appendChild(sel);
  container.appendChild(wrap);
}

/** [子函数 5.5/6] toggle：label + 开关行（[doc:adr-126-p5] A 层控件分支——
 *  ADR-125 §3.3 预留的「确有面板需要时再补」场景，perception 面板首用）。
 *  control.get/set 闭包读写（perception state 非状态层路径，不走 bind） */
function rmAppendToggle(container: HTMLElement, node: PreviewMenuNode): void {
  const spec = node.control;
  const wrap = document.createElement("div");
  wrap.className = "slide-item";
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  wrap.dataset.testid = "preview-" + node.id;
  const lb = document.createElement("span");
  lb.className = "slide-label";
  lb.style.cssText = "flex:1;font-size:12px;color:rgba(255,255,255,0.85)";
  lb.textContent = rmLabel(node);
  wrap.appendChild(lb);
  const btn = document.createElement("button");
  btn.style.cssText = "width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;position:relative;transition:background .2s";
  const knob = document.createElement("span");
  knob.style.cssText = "position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s";
  const apply = (v: boolean): void => {
    btn.style.background = v ? "var(--accent,#7c83ff)" : "rgba(255,255,255,0.2)";
    knob.style.left = v ? "18px" : "2px";
  };
  apply(Boolean(spec?.get?.(undefined)));
  btn.appendChild(knob);
  btn.onclick = (): void => {
    const next = !Boolean(spec?.get?.(undefined));
    spec?.set?.(next);
    apply(next);
  };
  wrap.appendChild(btn);
  container.appendChild(wrap);
}

/** [子函数 5.6/6] slider：label(可选) + range（+numeric 时旁挂 number 联动）行——
 *  通用渲染器的 slider 分支补齐（caps 专属 slider 走 preview-menu-cap-controls 另一通道，
 *  此处分派的是 PreviewMenuNode 数据）。control.get/set 闭包读写（同 toggle 范式） */
function rmAppendSlider(container: HTMLElement, node: PreviewMenuNode): void {
  const spec = node.control;
  const wrap = document.createElement("div");
  wrap.className = "slide-item";
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 10px";
  wrap.dataset.testid = "preview-" + node.id;
  const min = spec?.min ?? 0;
  const max = spec?.max ?? 100;
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(spec?.step ?? 1);
  const initial = Number(spec?.get?.(undefined) ?? min);
  range.value = String(initial);
  range.style.cssText = "flex:1;min-width:0;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  let num: HTMLInputElement | null = null;
  if (spec?.numeric) {
    num = document.createElement("input");
    num.type = "number";
    num.min = range.min;
    num.max = range.max;
    num.step = range.step;
    num.value = String(initial);
    num.style.cssText = "flex:0 0 auto;width:52px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);text-align:center";
  }
  const commit = (v: number): void => {
    spec?.set?.(v);
    spec?.onChange?.(v);
  };
  range.oninput = (): void => {
    const v = Number(range.value);
    if (num) num.value = String(v);
    commit(v);
  };
  if (num) {
    num.onchange = (): void => {
      const n = Number(num!.value);
      const v = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : Number(range.value);
      range.value = String(v);
      num!.value = String(v);
      commit(v);
    };
  }
  if (node.labelKey) {
    const lb = document.createElement("span");
    lb.className = "slide-label";
    lb.style.cssText = "flex:0 0 auto;font-size:12px;color:rgba(255,255,255,0.7)";
    lb.textContent = rmLabel(node);
    wrap.appendChild(lb);
  }
  wrap.append(range);
  if (num) wrap.append(num);
  container.appendChild(wrap);
}

/** [子函数 5.75/6] material-row：组合控件行（label + eye 显隐 + opacity 滑条）——
 *  [doc:adr-126-p5] 审计 #3 组合行增强；eye/opacity 闭包经 bridge 下沉（对齐旧
 *  buildMaterialControls 语义：点击翻转显隐、滑条改透明度） */
function rmAppendMaterialRow(container: HTMLElement, node: PreviewMenuNode): void {
  const wrap = document.createElement("div");
  wrap.className = "slide-item";
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 10px";
  wrap.dataset.testid = "preview-" + node.id;
  // 整行可点翻转显隐（对齐旧 buildMaterialControls 的 role/tabIndex/row.onclick——249bc6d0 review P3）
  wrap.setAttribute("role", "button");
  wrap.tabIndex = 0;
  const eye = document.createElement("button");
  eye.type = "button";
  eye.style.cssText = "flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1";
  const eyeApply = (v: boolean): void => {
    eye.textContent = v ? "👁" : "🚫";
    eye.title = v ? tr("preview.eyeHide", "Hide") : tr("preview.eyeShow", "Show");
  };
  const toggleEye = (): void => {
    const next = !node.eye?.get();
    node.eye?.set(next);
    eyeApply(next);
  };
  eyeApply(node.eye?.get() ?? true);
  eye.onclick = (e: MouseEvent): void => {
    e.stopPropagation();
    toggleEye();
  };
  wrap.onclick = (): void => toggleEye();
  wrap.appendChild(eye);
  const lb = document.createElement("span");
  lb.className = "slide-label";
  lb.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:12px;color:rgba(255,255,255,0.85)";
  lb.textContent = rmLabel(node);
  wrap.appendChild(lb);
  const op = document.createElement("input");
  op.type = "range";
  op.min = "0";
  op.max = "100";
  op.value = String(node.opacity?.get() ?? 100);
  op.style.cssText = "flex:0 0 auto;width:72px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  op.oninput = (): void => {
    node.opacity?.set(Number(op.value));
  };
  // 拖动滑条不触发整行翻转（对齐旧 op.onclick stopPropagation）
  op.onclick = (e: MouseEvent): void => e.stopPropagation();
  wrap.appendChild(op);
  container.appendChild(wrap);
}

/** [子函数 6/6] divider + sectionTitle：两个轻量节点共用 tiny 子函数 */
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
      rmAppendSelect(container, node, snapshot, deps.menu);
    } else if (node.kind === "slider") {
      rmAppendSlider(container, node);
    } else if (node.kind === "toggle") {
      rmAppendToggle(container, node);
    } else if (node.kind === "material-row") {
      rmAppendMaterialRow(container, node);
    } else if (node.kind === "controls") {
      // 声明式节点直持 cap 控件组：委托 renderCapControls（唯一控件渲染器）。
      // 惰性：controls 为函数时每次渲染重取（cap 后创建/参数变更后重渲染可见最新全量）。
      const ctrls = typeof node.controls === "function" ? node.controls() : node.controls;
      if (ctrls?.length) renderCapControls(container, ctrls, snapshot);
    } else if (node.kind === "divider" || node.kind === "sectionTitle") {
      rmAppendDecor(container, node);
    } else if (node.kind === "custom" && deps.renderCustomDirect && node.renderCustom) {
      // 面板内容语义：直接调 renderCustom(container) 填充（schema 面板路径；
      // closePopup 可选，MikuMikuAR 单参用法兼容）。
      node.renderCustom(container);
    } else {
      rmAppendLeaf(container, node, deps);
    }
  }
}

// ===================================================================
// renderAdapterPanelContent — adapter 面板内容三通道衰退（P5 roles 回归同源化）
// ===================================================================

/**
 * adapter 面板内容渲染：schema-registry(schemaId) → children → renderCustom 三通道，
 * 命中其一即渲染并返回 true。`renderPreviewPanel`（⚙ 根菜单面板）与 `modelDetailView`
 * （roles 详情模型信息本体直渲）共用本实现——两条组装路径永不再分叉。
 *
 * 背景（P5 事故）：modelDetailView 旧直渲门只认 renderCustom，四类适配器模型面板迁离
 * renderCustom（ysm/maid→schemaId、mmd/vrm→children）后统计/纹理/组件 select 在 roles
 * 详情集体消失。教训：面板组装路径必须复用同一条通道衰退链，不允许各自手拼。
 */
export function renderAdapterPanelContent(
  list: HTMLElement,
  node: PreviewMenuNode,
  deps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
    menu: SlideMenuHandle;
    actionCtx: PreviewActionMenuCtx;
    /** renderCustom 逃生舱的 closePopup（兼容 MikuMikuAR 双参用法） */
    hideMenu: () => void;
  },
): boolean {
  // [doc:adr-126-p5-a] 受控 builder 注册优先：面板内容由 schema-registry 产出（吃状态层快照）。
  // schemaId 必显式（P5 复盘：撤 `?? node.id` 隐式兜底——panel id 静默充当 schema key 与
  // per-scene 显式 key 约定冲突，id 撞注册键时会渲染错误内容且无告警）
  const builder = node.schemaId ? getSchema(node.schemaId) : undefined;
  if (builder) {
    renderMenu(list, builder(previewSnapshot()), deps);
    return true;
  }
  // [doc:adr-126-p4-b-1] 面板内容声明式通道：panel 节点带 children → 递归 renderMenu
  if (node.children?.length) {
    renderMenu(list, node.children, deps);
    return true;
  }
  if (node.renderCustom) {
    // [doc:adr-126-p5-收口] renderCustom 是末段逃生舱。若声明了 schemaId 走到这里
    // 说明注册缺失，console.warn 提示（防静默 fallback 掩盖）
    if (node.schemaId && !getSchema(node.schemaId)) {
      console.warn(`[preview-menu] "${node.id}" 声明 schemaId="${node.schemaId}" 但未注册——走 renderCustom 逃生舱`);
    }
    node.renderCustom(list, deps.hideMenu);
    return true;
  }
  return false;
}
