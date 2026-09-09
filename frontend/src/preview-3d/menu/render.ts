// ===== 声明式菜单通用渲染器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 「单一渲染器吃树数据」：将 PreviewMenuNode[] 递归渲染进容器。
//  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
//  - panel / action → 行（经 makeRow + navigate / run）
//  - divider / sectionTitle → 轻量分隔/标题行
//  - visibleWhen → 条件守卫（返回 false 不渲染）
// 新增/迁移菜单项时写 PreviewMenuNode 数据即可，渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。

import { tr, trDynamic } from "@/core/i18n/tr.ts";
import { getSchema } from "@/preview-3d/adapters/schema-registry.ts";
import { onOverlayStyleTargetReset, overlayStyleRoot } from "@/preview-3d/overlay-style-bridge.ts";
import {
  isPathAvailable,
  type KNOWN_PATHS,
  previewSnapshot,
  setStateValue,
} from "@/preview-3d/state/preview-state.ts";
import { createHeaderToggle } from "@/ui/ui-header-toggle.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/ui/ui-slide-menu.ts";
import {
  type CapControlView,
  renderCapColor,
  renderCapControls,
  renderCapSelect,
  renderCapSlider,
  renderCapToggle,
} from "./cap-controls.ts";
import { MENU_DIVIDER_CSS, MENU_ROW_DENSITY_CSS, MENU_SECTION_CSS } from "./menu-styles.ts";
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
/* [菜单共享样式] .cap-section-header/.cap-section-arrow 自 menu-styles.ts 引入——
 *  rmAppendFolder 消费的 section 头原无本地定义（搭 cap-controls 注入便车），
 *  现消费方自足，单源共享（cap-controls 拼同一常量）。*/
${MENU_SECTION_CSS}
${MENU_ROW_DENSITY_CSS}
${MENU_DIVIDER_CSS}
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

/** 统一 label 取值：labelKey→trDynamic(fallback)；无 labelKey 直接用 node.id（labelKey 为数据字段 string，ADR-207 D3） */
function rmLabel(node: PreviewMenuNode, valueOverride?: unknown): string {
  if (node.labelKey)
    return trDynamic(
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
  // code_review ADR-195 #4/#5：渲染 header 前预筛 visibleWhen（与 renderMenu 顶层
  // 循环同口径）——全隐组不再渲染空 folder 头。回归场景：water 水池组四控件全门控
  // `env.waterMode === "pool"`，film 模式下旧 renderCapControls 全隐组不建节头，
  // 桥接后 folder 无条件建 → 空「水池」folder 行误导用户。
  const snapshot = previewSnapshot();
  const visible = snapshot
    ? children.filter((ch) => !ch.visibleWhen || ch.visibleWhen(snapshot))
    : children;
  if (visible.length === 0) return;
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
  // [对齐 MikuMikuAR PopupRow.headerToggle] folder 功能总开关：嵌在 header（label 与箭头间）。
  // createHeaderToggle 内置 stopPropagation → 开关点击不触发 header 折叠；bind 自更新
  // 经 control-registry 在 menu.refresh() 重渲染时同步 checked。
  if (node.headerToggle) {
    const ht = node.headerToggle;
    const tg = createHeaderToggle({
      value: ht.value,
      onChange: (v: boolean) => ht.onChange(v),
      ...(ht.bind ? { bind: ht.bind } : {}),
    });
    header.appendChild(tg);
  }
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
  k.textContent = node.labelKey ? trDynamic(node.labelKey, node.id) : node.id;
  const displayed = node.value ?? (node.labelKey ? trDynamic(node.labelKey, node.id) : node.id);
  const v = document.createElement("span");
  v.className = "field-value";
  v.textContent = String(displayed);
  row.append(k, v);
  container.appendChild(row);
}

/** [模式⑥·提纯] button/row 共用行骨架：slide-item 行 + testid + 可选图标 + 空标签（jscpd 去重） */
function rmMakeRowBase(node: PreviewMenuNode): { row: HTMLDivElement; lb: HTMLSpanElement } {
  const row = document.createElement("div");
  row.className = node.rowDensity === "compact" ? "slide-item rm-row-compact" : "slide-item";
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
 *  行首 radio（焦点钮）与行尾 badge（次级动作钮）槽位——roles 角色行/switch 候选行；
 *  环境面板 cap 行复用：headerToggle（能力开关）+ 行尾 chevron（无 badge 且有 action 时显示，
 *  表「整行点击下钻」） */
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
    radio.className = `cc-btn cc-btn-ghost rm-inline-btn${node.radio.active ? " row-radio-active" : ""}`;
    radio.style.marginRight = "6px";
    radio.onclick = (ev): void => {
      ev.stopPropagation();
      node.radio?.onClick();
    };
    row.prepend(radio);
  }
  if (node.radio?.active) row.classList.add("rm-row-active");
  if (node.headerToggle) {
    // 行内能力开关（对齐 MikuMikuAR PopupRow.headerToggle / folder headerToggle）：
    // createHeaderToggle 内置 stopPropagation，开关点击不触发整行 action（下钻）。
    // 紧跟 label 后；行尾对齐交给 badge/chevron（env cap 行 = toggle + ›）。
    const ht = node.headerToggle;
    const tg = createHeaderToggle({
      value: ht.value,
      onChange: (v: boolean) => ht.onChange(v),
      ...(ht.bind ? { bind: ht.bind } : {}),
    });
    if (!node.badge && !node.action) tg.style.marginLeft = "auto";
    row.appendChild(tg);
  }
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
  if (node.action && !node.badge) {
    // 行尾 chevron：有 action（下钻/执行）且无 badge → 显示 › 提示可点（env cap 行 /
    // roles 无 badge 行）。headerToggle 与 chevron 可同存（MikuMikuAR folder 行同款：
    // 开关在 label 右、箭头行尾）。badge 是行尾次级钮，有它则不叠加箭头。
    const chev = document.createElement("span");
    chev.textContent = ">";
    chev.dataset.testid = "row-chevron";
    chev.className = "cm-row-chev";
    chev.style.marginLeft = "auto";
    row.appendChild(chev);
  }
  rmBindActionClick(row, node.action, actionCtx);
  container.appendChild(row);
}

/**
 * [控件原语归一 · ADR-195 刀 2.5 投影反转] 将 PreviewMenuNode.control（PreviewControlSpec）
 * 适配为 CapControlView 供 cap 栈简单控件渲染器（renderCapToggle/Slider/Select/Color/
 * Divider）直吃——不再构造控件中间对象（该类型刀 3 已退役）。
 *
 * 语义保留（对齐旧 nodeControlToCapControl 全行为）：
 *   - get(v?) → getValue()（bind 优先：取 snapshot[bind] 经 get 衍生）
 *   - set(v) → setValue(v)（spec.set → bind 写状态层 → spec.onChange）
 *   - refreshOnChange → onChange 内触发 menu.refresh()
 *   - numeric/slider.unit/onCommit → view.slider 透传
 */
export function nodeControlToView(
  node: PreviewMenuNode,
  snapshot: Record<string, unknown>,
  menu?: SlideMenuHandle,
): CapControlView {
  const spec = node.control;
  const labelKey = node.labelKey ?? "";
  const fallback = node.fallback ?? node.id;

  const getValue = (): unknown => {
    if (!spec) return null;
    if (spec.bind) {
      const raw = snapshot[spec.bind];
      return spec.get ? spec.get(raw) : raw;
    }
    return spec.get ? spec.get(undefined) : null;
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
    if (spec.refreshOnChange) menu?.refresh();
  };

  const view: CapControlView = {
    id: node.id,
    labelKey,
    fallback,
    getValue,
    setValue,
    ...(spec?.onChange || spec?.refreshOnChange ? { onChange: setValue } : {}),
  };
  if (node.hintKey) view.hintKey = node.hintKey;

  if (node.kind === "slider" && spec) {
    const slider: NonNullable<CapControlView["slider"]> = {
      min: spec.min ?? 0,
      max: spec.max ?? 100,
      step: spec.step ?? 1,
    };
    if (spec.numeric !== undefined) slider.numeric = spec.numeric;
    if (spec.unit !== undefined) slider.unit = spec.unit;
    if (spec.onCommit) slider.onCommit = spec.onCommit;
    view.slider = slider;
  }
  if (node.kind === "select" && spec?.options) view.select = spec.options;
  return view;
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

// ===================================================================
// renderCustom 逃生舱 cleanup 注册表（生命周期收编，2026-09）
// ===================================================================
// 背景：node-types.ts 声明 renderCustom 可返回 cleanup（(() => void) | void），但渲染器此前
// 两处调用都丢弃返回值——逃生舱语义残缺。收编：渲染器按容器持有 cleanup，重渲染前先清旧、
// 菜单 dispose 时全清。任何 renderCustom 逃生舱自动获得正确生命周期，无需各自手搓。
// 注：这是「面板级」生命周期，与「模型级」兜底（bones 的 cleanupRef，见 bones-panel-node.ts）
// 并列——两者持同一 cleanup，renderer 实现幂等，双清无害。
const customCleanups = new Map<HTMLElement, () => void>();

/** 逃生舱挂载：容器已有旧 cleanup → 先调（重入清理）；renderCustom 返回新 cleanup → 持有。 */
function runCustomMount(
  container: HTMLElement,
  // biome-ignore lint/suspicious/noConfusingVoidType: 与 node-types.ts renderCustom 同契约（void 表「cleanup 或空」），改 undefined 会连锁破坏全部实现点
  render: (el: HTMLElement, close?: () => void) => (() => void) | void,
  closePopup?: () => void,
): void {
  // code_review 4ac2b4f72 #1/#3：先清「容器已脱离文档」的陈旧条目——面板 close→reopen
  // 每次导航建新 list 容器，旧容器已 disconnect，原 get(container) 键控永远 miss，
  // 旧 cleanup（骨骼面板 viewContainer raycaster listener）永不摘除、模块表残项
  // （废弃元素 + 闭包）驻留到会话 dispose。此扫清同时天然会话隔离：并行挂载会话
  // 仍存活的面板容器 isConnected=true，不会被本会话误清（render.ts 注释 L482-485 的
  // 防御场景）。cleanup 幂等，对已摘过的 cleanup 双调无害。
  for (const [c, cfn] of customCleanups) {
    if (c === container || c.isConnected) continue;
    try {
      cfn();
    } catch (e) {
      // 单条 cleanup 抛错不阻断其余清理/挂载（对齐 vrm/fbx adapter dispose 的 try/catch 惯例）
      console.warn("[preview-menu] stale custom cleanup failed:", e);
    }
    customCleanups.delete(c);
  }
  const prev = customCleanups.get(container);
  if (prev) {
    try {
      prev();
    } catch (e) {
      // 同容器重入清理抛错不阻断新挂载
      console.warn("[preview-menu] custom cleanup failed on remount:", e);
    }
    customCleanups.delete(container);
  }
  const cleanup = render(container, closePopup);
  if (typeof cleanup === "function") customCleanups.set(container, cleanup);
}

/**
 * 全清挂载中 cleanup（菜单 dispose 由 core.ts 调用）。cleanup 幂等，重复调用无害。
 *
 * 刻意**不**挂 onOverlayStyleTargetReset：该钩子每次 mount 都会触发（见 mount-preview-core.ts
 * 的 setOverlayStyleTarget），而本表是模块级共享——全清会误伤并行挂载会话中仍存活的骨骼面板
 * （listener 被摘而面板 DOM 仍在 → 点击拾取静默失效，需重开面板才恢复）。
 * dispose 才是唯一明确的「这个菜单没了」信号，只在该时机全清。
 *
 * code_review 4ac2b4f72 #2/#4/#5：仅清「容器已脱离文档」的条目（isConnected=false）——
 * core.ts 在 dock.remove()/popup.remove() 之后调用，届时本会话面板容器均已离文档，
 * 命中全清；并行挂载会话仍存活的面板容器 isConnected=true 不受影响（互杀根治，
 * 与上方 onOverlayStyleTargetReset 同理——per-session dispose 不得误伤并行会话）。
 */
export function disposeCustomCleanups(): void {
  for (const [c, cfn] of customCleanups) {
    if (c.isConnected) continue; // 仍在文档：并行会话的活面板，不归本会话 dispose 管
    try {
      cfn();
    } catch (e) {
      console.warn("[preview-menu] custom cleanup failed on dispose:", e);
    }
  }
  // 只清离文档条目；活面板条目留给其所属会话 dispose
  for (const c of [...customCleanups.keys()]) {
    if (!c.isConnected) customCleanups.delete(c);
  }
}

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
    // 形状前置（2026-09 分派穷举化保留）：folder 或「带 children 的节点」都按可折叠 section
    // 渲染——panel 带 children（如 shot 工具面板在 modelDetailView 里的 folder 形态，
    // roles.test.ts 三通道回归锁）走此路。kind 判不了「声明了 children」，故先于 switch。
    if (node.kind === "folder" || Array.isArray(node.children)) {
      rmAppendFolder(container, node, deps);
      continue;
    }
    switch (node.kind) {
      case "field":
        rmAppendField(container, node);
        break;
      case "button":
        rmAppendButton(container, node, deps.actionCtx);
        break;
      case "row":
        rmAppendDynamicRow(container, node, deps.actionCtx);
        break;
      case "select":
      case "slider":
      case "toggle":
      case "color": {
        // [控件原语归一 · ADR-195 刀 2.5 投影反转] 节点控件经 nodeControlToView 适配为
        // CapControlView 直供 cap 栈渲染器（renderCapToggle/Slider/Select/Color）——
        // 不再构造控件中间对象（rmAppendSelect/Slider/Toggle 已退役）。
        const view = nodeControlToView(node, snapshot, deps.menu);
        const renderer =
          node.kind === "toggle"
            ? renderCapToggle
            : node.kind === "slider"
              ? renderCapSlider
              : node.kind === "select"
                ? renderCapSelect
                : renderCapColor;
        renderer(container, view);
        break;
      }
      case "material-row":
        rmAppendMaterialRow(container, node);
        break;
      case "controls": {
        // 声明式节点直持 cap 控件组：委托 renderCapControls（唯一控件渲染器）。
        // 惰性：controls 为函数时每次渲染重取（cap 后创建/参数变更后重渲染可见最新全量）。
        const ctrls = typeof node.controls === "function" ? node.controls() : node.controls;
        if (ctrls?.length) renderCapControls(container, ctrls, snapshot);
        break;
      }
      case "divider":
      case "sectionTitle":
        rmAppendDecor(container, node);
        break;
      case "custom":
        if (deps.renderCustomDirect && node.renderCustom) {
          // 面板内容语义：直接调 renderCustom(container) 填充（schema 面板路径；
          // closePopup 可选，MikuMikuAR 单参用法兼容）。cleanup 由注册表持有——
          // 重渲染前先清旧（runCustomMount），取代逃生舱自搓 cleanupRef。
          runCustomMount(container, node.renderCustom);
        } else {
          rmAppendLeaf(container, node, deps);
        }
        break;
      case "panel":
      case "action":
        rmAppendLeaf(container, node, deps);
        break;
      default: {
        // 穷举兜底：kind 联合新增未在此处理 → 编译期 never 报错（对照 cap-controls.ts
        // renderCapControls 同款纪律）；运行期 warn 防「拼错 kind 静默渲染成死行」。
        const _unhandled: never = node.kind;
        console.warn(`[preview-menu] 未处理的菜单节点 kind: ${_unhandled as string}`);
        rmAppendLeaf(container, node, deps);
      }
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
    // cleanup 由注册表持有（生命周期收编：重渲染前先清旧、dispose 全清——取代 adapter 手动 cleanupRef）
    runCustomMount(list, node.renderCustom, deps.hideMenu);
    return true;
  }
  return false;
}
