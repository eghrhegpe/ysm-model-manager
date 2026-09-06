// ===== 声明式菜单通用渲染器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 「单一渲染器吃树数据」：将 PreviewMenuNode[] 递归渲染进容器。
//  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
//  - panel / action → 行（经 makeRow + navigate / run）
//  - divider / sectionTitle → 轻量分隔/标题行
//  - visibleWhen → 条件守卫（返回 false 不渲染）
// 新增/迁移菜单项时写 PreviewMenuNode 数据即可，渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。

import { tr } from "../../core/i18n/tr.ts";
import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { getSchema } from "../adapters/schema-registry.ts";
import type { MenuControlDef, MenuControlKind } from "../caps/scene-capability.ts";
import { onOverlayStyleTargetReset, overlayStyleRoot } from "../overlay-style-bridge.ts";
import {
  isPathAvailable,
  type KNOWN_PATHS,
  previewSnapshot,
  setStateValue,
} from "../state/preview-state.ts";
import { renderCapControls } from "./cap-controls.ts";
import type { PreviewActionMenuCtx, PreviewMenuNode } from "./node-types.ts";

// i18n 取值统一走共享 tr()（core/i18n/tr.ts，支持缺失键兜底 + params 插值）

/**
 * 幂等注入 renderMenu 用的 CSS 类规则（仅注入一次，重复调用 no-op）。
 * 把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串。
 */
let _menuStylesInjected = false;
onOverlayStyleTargetReset(() => {
  _menuStylesInjected = false;
}); // ADR-175 M1:目标切换重注入
function ensureMenuStyles(): void {
  if (_menuStylesInjected) return;
  const style = document.createElement("style");
  style.textContent = `
/* ===== P1 抽类迁移（render.ts 控件行，2026-09）：原内联 style.cssText 逐字搬迁 =====
 * 双类锚定（.slide-item / .slide-label 在前）压过 ui 模块单类规则，避免注入顺序依赖；
 * 控件无基类的用 rm- 单类（前缀唯一，无撞名）。
 * [控件原语归一] rm-toggle-track/knob/range/slider-label-fixed/control-row-lg/control-label/control-label-strong 已删除——
 *  cap 栈（cc-* 类）统一渲染，rm 栈三控件退役。*/
.slide-item.rm-control-row {
   display: flex;
   align-items: center;
   gap: 8px;
   padding: 4px 10px;
}
.slide-label.rm-label-sm {
   font-size: 12px;
}
.slide-label.rm-label-ellipsis {
   flex: 1 1 auto;
   overflow: hidden;
   text-overflow: ellipsis;
   white-space: nowrap;
   min-width: 0;
   font-size: 12px;
   color: rgba(255,255,255,0.85);
}
.rm-range-num {
   flex: 0 0 auto;
   width: 52px;
   font-size: 11px;
   padding: 1px 3px;
   border-radius: 4px;
   border: 1px solid rgba(255,255,255,0.2);
   background: rgba(0,0,0,0.3);
   color: rgba(255,255,255,0.8);
   text-align: center;
}
.rm-eye {
   flex: 0 0 auto;
   background: none;
   border: none;
   cursor: pointer;
   font-size: 14px;
   padding: 0;
   line-height: 1;
}
.rm-op {
   flex: 0 0 auto;
   width: 72px;
   cursor: pointer;
   accent-color: var(--accent, #7c83ff);
}
/* row 槽位样式（ADR-193 第四刀）：radio 活跃行高亮 + 行内按钮尺寸微调 */
.rm-row-active { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.row-radio-active { color: var(--accent, #7c83ff); }
.rm-inline-btn { flex-shrink: 0; padding: 1px 5px; font-size: 12px; line-height: 1.2; }`;
  overlayStyleRoot().appendChild(style);
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
  if (node.labelKey)
    return tr(
      node.labelKey,
      node.fallback ?? (valueOverride !== undefined ? String(valueOverride) : node.id),
    );
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
function rmBindLeafClick(row: HTMLElement, node: PreviewMenuNode, deps: RenderMenuDeps): void {
  row.onclick = (ev: MouseEvent): void => {
    ev.stopPropagation();
    if (node.kind === "panel") {
      deps.menu.navigate(deps.makePanelView(node));
    } else if (node.action) {
      node.action(deps.actionCtx);
    }
  };
}

/** folder 折叠态记忆（按 node.id，true=折叠）：用户交互过的折叠状态跨 menu.refresh() 重渲染保持——
 *  ADR-193 第三刀（env folder 手风琴）引入：cap 订阅驱动的 refresh 会重建 DOM，
 *  无此记忆则用户展开的分组被重置回 defaultOpen。id 集合有限（菜单节点固定）；
 *  ⚠️ code_review bc639ae0 #3：命名取「折叠态」非「开合态」——存储值 true=折叠
 *  （点击折叠存 true / 展开存 false），旧名 folderOpenState 与语义相反，易被
 *  未来维护者按名误写；#1/#2/#5：本 Map 模块级存活，菜单 dispose 时必须清空，
 *  否则跨会话泄漏（core.ts dispose 调 clearFolderCollapsedState） */
const folderCollapsedState = new Map<string, boolean>();

/** 清空 folder 折叠态记忆（core.ts 菜单 dispose 时调用——防跨会话/跨挂载状态泄漏） */
export function clearFolderCollapsedState(): void {
  folderCollapsedState.clear();
}

/** [子函数 1/6] folder：可折叠 section，递归 renderMenu 渲染 children */
function rmAppendFolder(container: HTMLElement, node: PreviewMenuNode, deps: RenderMenuDeps): void {
  const children = node.children ?? [];
  if (children.length === 0) return;
  const section = document.createElement("div");
  section.dataset.testid = node.id;
  const header = document.createElement("div");
  header.className = "cap-section-header";
  const collapsed = folderCollapsedState.get(node.id) ?? node.defaultOpen === false;
  const arrow = document.createElement("span");
  arrow.textContent = collapsed ? "▸" : "▾";
  arrow.className = "cap-section-arrow";
  const title = document.createElement("span");
  title.textContent = rmLabel(node);
  header.append(arrow, title);
  const body = document.createElement("div");
  body.dataset.testid = `${node.id}-body`;
  // 动态豁免（P1）：折叠状态读写均依赖内联 display（node-render 测试断言
  // body.style.display 初值 + 点击切换），抽类无法承载运行时状态，保留内联。
  body.style.cssText = `display:${collapsed ? "none" : "block"}`;
  header.addEventListener("click", (ev: MouseEvent): void => {
    ev.stopPropagation();
    const nowCollapsed = body.style.display === "none";
    body.style.display = nowCollapsed ? "block" : "none";
    arrow.textContent = nowCollapsed ? "▾" : "▸";
    folderCollapsedState.set(node.id, !nowCollapsed); // 仅记用户交互态（ADR-193 第三刀；true=折叠）
  });
  renderMenu(body, children, deps);
  section.append(header, body);
  container.appendChild(section);
}

/** [子函数 2/6] field：键值对行（统计/信息展示） */
function rmAppendField(container: HTMLElement, node: PreviewMenuNode): void {
  const row = document.createElement("div");
  row.className = "slide-item field-row";
  row.dataset.testid = `preview-${node.id}`;
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
  row.dataset.testid = `preview-${node.id}`;
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
function rmAppendButton(
  container: HTMLElement,
  node: PreviewMenuNode,
  actionCtx: PreviewActionMenuCtx,
): void {
  const { row, lb } = rmMakeRowBase(node);
  lb.textContent = rmLabel(node);
  rmBindActionClick(row, node.action, actionCtx);
  container.appendChild(row);
}

/** [子函数 4/6] row：动态列表行（纹理/材质/bone 等动态列表；ADR-193 第四刀起支持
 *  行首 radio（焦点钮）与行尾 badge（次级动作钮）槽位——roles 角色行/switch 候选行） */
function rmAppendDynamicRow(
  container: HTMLElement,
  node: PreviewMenuNode,
  actionCtx: PreviewActionMenuCtx,
): void {
  const { row, lb } = rmMakeRowBase(node);
  lb.classList.add("rm-label-sm");
  // 无 labelKey（动态内容如角色名/候选文件名）→ fallback 直出行文案，meta 不重复显示；
  // 有 labelKey → 旧行为（tr 求值 + value 作 sublabel meta）
  if (node.labelKey) {
    lb.textContent = rmLabel(node, node.value || node.id);
    if (node.value && typeof node.value === "string") {
      const meta = document.createElement("span");
      meta.className = "slide-sublabel";
      meta.textContent = node.value;
      row.appendChild(meta);
    }
  } else {
    lb.textContent = node.fallback ?? node.id;
  }
  if (node.radio) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.dataset.testid = "row-radio";
    radio.textContent = node.radio.active ? "●" : "○";
    radio.title = node.radio.title;
    radio.className =
      "cc-btn cc-btn-ghost rm-inline-btn" + (node.radio.active ? " row-radio-active" : "");
    radio.style.marginRight = "6px";
    radio.onclick = (ev): void => {
      ev.stopPropagation();
      node.radio?.onClick();
    };
    row.prepend(radio);
  }
  if (node.radio?.active) row.classList.add("rm-row-active");
  if (node.badge) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.dataset.testid = "row-badge";
    badge.textContent = node.badge.label;
    badge.title = node.badge.title;
    badge.className = "cc-btn cc-btn-ghost rm-inline-btn";
    badge.style.marginLeft = "auto";
    badge.onclick = (ev): void => {
      ev.stopPropagation();
      node.badge?.onClick();
    };
    row.appendChild(badge);
  }
  rmBindActionClick(row, node.action, actionCtx);
  container.appendChild(row);
}

/**
 * [控件原语归一] 将 PreviewMenuNode 的 PreviewControlSpec 投影为 MenuControlDef，
 *  供 renderCapControls 复用 cap 栈渲染。数据契约不动——只转换渲染层，
 *  6 个适配器工厂产出结构零改动。
 *
 * 语义保留（对齐 rmAppendSelect/Slider/Toggle 全行为）：
 *   - get(v?) → getValue()（bind 优先：取 snapshot[bind] 经 get 衍生）
 *   - set(v) → setValue(v)（spec.set → bind 写状态层 → spec.onChange）
 *   - onChange(v) → onChange(v)（refreshOnChange 时 menu.refresh）
 *   - numeric → slider.numeric（cap 渲染端已支持双向联动 + clamp）
 *   - bind（全仓零消费者，死代码；保留映射能力但不新增消费者）
 */
export function nodeControlToCapControl(
  node: PreviewMenuNode,
  snapshot: Record<string, unknown>,
  menu?: SlideMenuHandle,
): MenuControlDef {
  const spec = node.control;
  const kind = node.kind as MenuControlKind;
  const labelKey = node.labelKey ?? "";
  const fallback = node.fallback ?? node.id;

  const getValue = (): number | string | boolean | null | number[] => {
    if (!spec) return null;
    if (spec.bind) {
      const raw = snapshot[spec.bind];
      return spec.get
        ? (spec.get(raw) as number | string | boolean | null | number[])
        : (raw as number | string | boolean | null | number[]);
    }
    return spec.get ? (spec.get(undefined) as number | string | boolean | null | number[]) : null;
  };

  const setValue = (v: number | string | boolean): void => {
    if (!spec) return;
    spec.set?.(v);
    if (spec.bind) {
      const path = spec.bind as (typeof KNOWN_PATHS)[number];
      if (isPathAvailable(path)) {
        setStateValue(path, v);
      }
    }
    spec.onChange?.(v);
  };

  const onChange = (): void => {
    if (spec?.refreshOnChange) menu?.refresh();
  };

  const base: MenuControlDef = {
    id: node.id,
    kind,
    labelKey,
    fallback,
    getValue,
    setValue,
    onChange,
  };

  if (kind === "slider" && spec) {
    const sliderDef: NonNullable<MenuControlDef["slider"]> = {
      min: spec.min ?? 0,
      max: spec.max ?? 100,
      step: spec.step ?? 1,
    };
    if (spec.numeric !== undefined) sliderDef.numeric = spec.numeric;
    base.slider = sliderDef;
  }

  if (kind === "select" && spec?.options) {
    base.select = spec.options;
  }

  return base;
}

/** [子函数 5.75/6] material-row：组合控件行（label + eye 显隐 + opacity 滑条）——
 *  [doc:adr-126-p5] 审计 #3 组合行增强；eye/opacity 闭包经 bridge 下沉（对齐旧
 *  buildMaterialControls 语义：点击翻转显隐、滑条改透明度） */
function rmAppendMaterialRow(container: HTMLElement, node: PreviewMenuNode): void {
  const wrap = document.createElement("div");
  wrap.className = "slide-item rm-control-row";
  wrap.dataset.testid = `preview-${node.id}`;
  // 整行可点翻转显隐（对齐旧 buildMaterialControls 的 role/tabIndex/row.onclick——249bc6d0 review P3）
  wrap.setAttribute("role", "button");
  wrap.tabIndex = 0;
  const eye = document.createElement("button");
  eye.type = "button";
  eye.className = "rm-eye";
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
  lb.className = "slide-label rm-label-ellipsis";
  lb.textContent = rmLabel(node);
  wrap.appendChild(lb);
  const op = document.createElement("input");
  op.type = "range";
  op.min = "0";
  op.max = "100";
  op.value = String(node.opacity?.get() ?? 100);
  op.className = "rm-op";
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
  // sectionTitle（无 labelKey → fallback 直出，同 rmAppendDynamicRow 口径）
  const st = document.createElement("div");
  st.dataset.testid = node.id;
  st.textContent = node.labelKey ? rmLabel(node) : (node.fallback ?? node.id);
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

export function renderMenu(
  container: HTMLElement,
  nodes: PreviewMenuNode[],
  deps: RenderMenuDeps,
): void {
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
    } else if (node.kind === "select" || node.kind === "slider" || node.kind === "toggle") {
      // [控件原语归一] 三类节点控件统一经 nodeControlToCapControl 投影到 MenuControlDef，
      //  委托 renderCapControls（cap 栈）渲染——rmAppendSelect/Slider/Toggle 已退役。
      const def = nodeControlToCapControl(node, snapshot, deps.menu);
      renderCapControls(container, [def], snapshot);
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
      console.warn(
        `[preview-menu] "${node.id}" 声明 schemaId="${node.schemaId}" 但未注册——走 renderCustom 逃生舱`,
      );
    }
    node.renderCustom(list, deps.hideMenu);
    return true;
  }
  return false;
}
