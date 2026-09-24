// ===== 声明式菜单通用渲染器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 「单一渲染器吃树数据」：将 PreviewMenuNode[] 递归渲染进容器。
//  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
//  - panel / action → 行（经 makeRow + navigate / run）
//  - divider / sectionTitle → 轻量分隔/标题行
//  - visibleWhen → 条件守卫（返回 false 不渲染）
// 新增/迁移菜单项时写 PreviewMenuNode 数据即可，渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。

import { installOnceStyles } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { getSchema } from "@/preview-3d/infra/schema-registry.ts";
import {
  isPreviewFolderNode,
  type NodeFor,
  type PreviewActionMenuCtx,
  type PreviewMenuNode,
  type PreviewMenuNodeKind,
} from "@/preview-3d/menu/schema/node-types.ts";
import { createHeaderToggle } from "@/preview-3d/menu/shell/header-toggle.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/preview-3d/menu/shell/slide-menu.ts";
import {
  MENU_BTN_CSS,
  MENU_CARD_CSS,
  MENU_DIVIDER_CSS,
  MENU_ROW_DENSITY_CSS,
  MENU_SECTION_CSS,
} from "@/preview-3d/menu/style/menu-styles.ts";
import { previewSnapshot } from "@/preview-3d/state/preview-state.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { renderCapControls } from "./cap-controls.ts";
import {
  CAP_CONTROL_RENDERERS,
  nodeControlToView,
  type RenderMenuDeps,
  rmAppendButton,
  rmAppendDecor,
  rmAppendDynamicRow,
  rmAppendField,
  rmAppendLeaf,
  rmAppendMaterialRow,
  rmLabel,
} from "./rows.ts";

// 对外公开面转发（ADR-146 精确同目录相对路径）：nodeControlToView 实现已迁 ./rows.ts，
// 消费者 import 路径不变（@/preview-3d/menu/render/render.ts）。
export { nodeControlToView } from "./rows.ts";

/**
 * 幂等注入 renderMenu 用的 CSS 类规则（仅注入一次，重复调用 no-op）。
 * 把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串。
 */
/**
 * 幂等注入 renderMenu 用的 CSS 类规则（仅注入一次；目标切换经 installOnceStyles 内置
 * onOverlayStyleTargetReset 钩子自动清零重注，ADR-175 M1 行为不变）。
 * 把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串。
 */
function ensureMenuStyles(): void {
  installOnceStyles(
    "menu",
    `
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
${MENU_CARD_CSS}
.slide-item.rm-control-row {
   display: flex;
   align-items: center;
   gap: 8px;
   padding:var(--btn-padding-std);
}
.slide-label.rm-label-sm {
   font-size:var(--fs-base);
}
.slide-label.rm-label-ellipsis {
   flex: 1 1 auto;
   overflow: hidden;
   text-overflow: ellipsis;
   white-space: nowrap;
   min-width: 0;
   font-size:var(--fs-base);
   color: rgba(255,255,255,0.85);
}
.rm-range-num {
   flex: 0 0 auto;
   width: 52px;
   font-size:var(--fs-sm);
   padding: 1px 3px;
   border-radius:var(--radius-sm);
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
   font-size:var(--fs-lg);
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
/* 焦点钮激活态：外环+圆心染 accent——双类锚定（0,2,0）压过 .rm-radio-btn 的默认白，
 * 不依赖样式书写顺序（同为单类时后者胜，曾把激活色吃掉） */
.rm-radio-btn.row-radio-active { color: var(--accent, #7c83ff); }
.rm-inline-btn { flex-shrink: 0; padding: 1px 5px; font-size:var(--fs-base); line-height: 1.2; }
/* 行尾元素右对齐公共类（P1 抽类收尾：headerToggle/badge/chevron 三处 marginLeft:auto 归一）*/
.rm-ml-auto { margin-left: auto; }
/* [行内按钮归属] .cc-btn 族由 menu-styles|MENU_BTN_CSS 单源引入（radio/badge 也用），
 * 不再只搭 cap 栈 ensureCapStyles 便车——纯 row 面板（roles 角色列表）此前拿不到规则，
 * <button> 回落 UA 默认：不透明白底 + 2px 黑框（实测 background=rgb(240,240,240)）。 */
${MENU_BTN_CSS}
/* 行首焦点钮（radio 语义）：正圆图标钮——外环/环+圆心由 SVG 图标给，按钮本体不画边框底。
 * 几何固定（18px 正圆 + 居中），不随字体字形漂移（旧实现用 ○/● 字形 + 圆角矩形边框）。 */
.rm-radio-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  margin-right: 6px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgba(255,255,255,0.6);
  font-size: var(--fs-md);
  cursor: pointer;
  transition: var(--tr-fast);
}
.rm-radio-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }`,
  );
}

// ===================================================================
// renderMenu — 子函数（8 kind 分派拆 6 子，2 段 onclick 模式⑥提纯）
// ===================================================================

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

/** [ADR-240 收敛] 折叠内容判定：panel 带 renderCustom（无 children）也进可折叠卡，
 *  与「带 children 的 panel 被折叠」同一语义（面板内容内联展示），消除
 *  「靠隐式 children 决定渲染形态 → rendercustom 面板退化成单行」的形态分裂。 */
function hasFoldedBody(node: PreviewMenuNode): boolean {
  return node.kind === "panel" && !node.children && !!node.renderCustom;
}

/** [子函数 1/6] folder：可折叠 section，递归 renderMenu 渲染 children */
function rmAppendFolder(container: HTMLElement, node: PreviewMenuNode, deps: RenderMenuDeps): void {
  const children = node.children ?? [];
  const isCustomBody = !node.children && !!node.renderCustom && node.kind === "panel";
  if (children.length === 0 && !isCustomBody) return;
  // 渲染 header 前预筛 visibleWhen（与 renderMenu 顶层
  // 循环同口径）——全隐组不再渲染空 folder 头。回归场景：water 水池组四控件全门控
  // `env.waterMode === "pool"`，film 模式下旧 renderCapControls 全隐组不建节头，
  // 桥接后 folder 无条件建 → 空「水池」folder 行误导用户。
  const snapshot = previewSnapshot();
  // [B 收敛] custom body（panel+renderCustom 折叠卡）无 children 可预筛——跳过
  // children-based visibleWhen 过滤与空筛 return，卡壳恒渲染（renderCustom 内容本身由逃生舱自洽）。
  const visible = isCustomBody
    ? children
    : snapshot
      ? children.filter((ch) => !ch.visibleWhen || ch.visibleWhen(snapshot))
      : children;
  if (!isCustomBody && visible.length === 0) return;
  const section = document.createElement("div");
  section.className = "cap-folder"; // [盒式折叠统一] folder 包裹同款盒框，视觉对齐折叠卡
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
  // createHeaderToggle 内置 stopPropagation → 开关点击不触发 header 折叠。
  // 菜单打开期间 cap 变化回写 UI：经 menu.refresh() 重建式渲染承担
  // （每次重渲染重建 toggle、初始 value 即最新态；bind 自更新链路 2026-09 随 control-registry 拔除，见 ADR-085）。
  if (node.headerToggle) {
    const ht = node.headerToggle;
    const tg = createHeaderToggle({
      value: ht.value,
      onChange: (v: boolean) => ht.onChange(v),
    });
    header.appendChild(tg);
  }
  const body = document.createElement("div");
  body.className = "cap-section-body";
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
  if (isCustomBody) {
    // [B 收敛] panel+renderCustom 折叠卡：body 内 runCustomMount 渲染内容（逃生舱
    // cleanup 生命周期走 render.ts 注册表；replace 后同容器重渲染先清旧）
    // biome-ignore lint/style/noNonNullAssertion: isCustomBody 已守卫 renderCustom 非空
    runCustomMount(body, node.renderCustom!);
  } else {
    renderMenu(body, children, deps);
  }
  section.append(header, body);
  container.appendChild(section);
}

/**
 * [子函数 1b/6] card：卡牌分组容器——顶行标题 + 分隔线 + 内容区。
 * 缺省：经典不可折叠卡壳（ADR-195 语义，同级行语义聚拢）。
 * collapsible:true：变为可折叠卡——header 整条点击收放内容区，箭头 + 折叠态记忆
 * 复用 folder 同一套（folderCollapsedState / defaultOpen），统一「盒式折叠」视觉。
 */
function rmAppendCard(container: HTMLElement, node: PreviewMenuNode, deps: RenderMenuDeps): void {
  const children = node.children ?? [];
  if (children.length === 0) return;
  // 与 rmAppendFolder 同口径：渲染卡壳前按 visibleWhen 预筛，全隐组不留空卡壳
  const snapshot = previewSnapshot();
  const visible = snapshot
    ? children.filter((ch) => !ch.visibleWhen || ch.visibleWhen(snapshot))
    : children;
  if (visible.length === 0) return;
  // [可折叠卡] collapsible:true → 复用 folder 折叠态记忆（按 node.id 隔离），
  // body display 内联读写（与 rmAppendFolder 同口径，测试断言 style.display）
  const collapsible = node.collapsible === true;
  const collapsed = collapsible
    ? (folderCollapsedState.get(node.id) ?? node.defaultOpen === false)
    : false;
  const card = document.createElement("div");
  card.className = "cap-card";
  card.dataset.testid = node.id;
  const header = document.createElement("div");
  header.className = collapsible
    ? "cap-card-header cap-card-header--collapsible"
    : "cap-card-header";
  let arrow: HTMLSpanElement | null = null;
  if (collapsible) {
    arrow = document.createElement("span");
    arrow.textContent = collapsed ? "▸" : "▾";
    arrow.className = "cap-card-arrow";
    header.appendChild(arrow);
  }
  header.appendChild(document.createTextNode(rmLabel(node)));
  const divider = document.createElement("div");
  divider.className = "cap-card-divider";
  const body = document.createElement("div");
  body.className = "cap-card-body";
  body.dataset.testid = `${node.id}-body`;
  // [可折叠卡] 折叠态读写依赖内联 display（与 rmAppendFolder body 同款豁免——
  // 抽类无法承载运行时状态；测试断言 body.style.display 初值 + 点击切换）
  if (collapsible) {
    body.style.display = collapsed ? "none" : "block";
    // 折叠点击：整条 header 切换（复用 folder 同款交互 + 记折叠态）
    header.addEventListener("click", (ev: MouseEvent): void => {
      ev.stopPropagation();
      const nowCollapsed = body.style.display === "none";
      body.style.display = nowCollapsed ? "block" : "none";
      if (arrow) arrow.textContent = nowCollapsed ? "▾" : "▸";
      folderCollapsedState.set(node.id, !nowCollapsed); // true=折叠
    });
  }
  renderMenu(body, visible, deps);
  card.append(header, divider, body);
  container.appendChild(card);
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
  // 先清「容器已脱离文档」的陈旧条目——面板 close→reopen
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

/** 形状前置：card / folder / 带 children / 带折叠体(renderCustom) 的节点须先于 kind 分派
 *  判定（kind 判不了「声明了 children」）。返回 true 表示已按可折叠形态渲染、调用方跳过分派。 */
function appendFoldedShape(
  container: HTMLElement,
  node: PreviewMenuNode,
  deps: RenderMenuDeps,
): boolean {
  // card 先于 folder：card 也带 children，否则被下方 folder 判定吞掉、卡牌外壳丢失。
  if (node.kind === "card") {
    rmAppendCard(container, node, deps);
    return true;
  }
  // folder 或「带 children」经 isPreviewFolderNode；panel 带 children（shot 工具面板 folder 形态，
  // roles.test.ts 三通道回归锁）与 panel 带 renderCustom 折叠体（hasFoldedBody）走此路。
  if (isPreviewFolderNode(node) || hasFoldedBody(node)) {
    rmAppendFolder(container, node, deps);
    return true;
  }
  return false;
}

/** kind → 渲染分派签名（与 renderMenu 循环共用 container/node/deps/snapshot 四入参）。
 *  [ADR-302 走法丙刀2] 按 kind 参数化：每个臂拿到的 node 是**该 kind 的窄类型**（`NodeFor<K>`）——
 *  臂内读本 kind 专有字段有类型保障，读别的 kind 的字段直接编译报错（宽接口下二者都静默可读）。 */
type MenuHandlerFor<K extends PreviewMenuNodeKind> = (
  container: HTMLElement,
  node: NodeFor<K>,
  deps: RenderMenuDeps,
  snapshot: ReturnType<typeof previewSnapshot>,
) => void;

/** 分派位点用的宽签名——仅 `dispatchMenuHandler` 消费（本文件唯一类型逃生舱的落点）。 */
type MenuHandler = (
  container: HTMLElement,
  node: PreviewMenuNode,
  deps: RenderMenuDeps,
  snapshot: ReturnType<typeof previewSnapshot>,
) => void;

// [ADR-195 复杂度收口] 表驱动分派取代 renderMenu 内 14 段 switch——认知复杂度 73→个位数。
// 映射类型令 PreviewMenuNodeKind 联合新增而此处漏写即在编译期报错（TS2741），
// 保留原 switch `default: never` 的穷尽守卫语义；同时**逐臂窄化 node**（见 MenuHandlerFor）。
// card/folder 由 appendFoldedShape 前置接管，此二臂通常不可达（include 仅为满足联合穷尽，语义仍正确）。
const MENU_HANDLERS: { [K in PreviewMenuNodeKind]: MenuHandlerFor<K> } = {
  field: (c, n) => rmAppendField(c, n),
  button: (c, n, d) => rmAppendButton(c, n, d.actionCtx),
  row: (c, n, d) => rmAppendDynamicRow(c, n, d.actionCtx),
  // [控件原语归一 · ADR-195 刀 2.5] 节点控件经 nodeControlToView 适配为 CapControlView
  // 直供 cap 栈渲染器（rmAppendSelect/Slider/Toggle 已退役）。
  select: (c, n, d) => CAP_CONTROL_RENDERERS.select(c, nodeControlToView(n, d.menu)),
  slider: (c, n, d) => CAP_CONTROL_RENDERERS.slider(c, nodeControlToView(n, d.menu)),
  toggle: (c, n, d) => CAP_CONTROL_RENDERERS.toggle(c, nodeControlToView(n, d.menu)),
  color: (c, n, d) => CAP_CONTROL_RENDERERS.color(c, nodeControlToView(n, d.menu)),
  "material-row": (c, n) => rmAppendMaterialRow(c, n),
  // 声明式节点直持 cap 控件组：委托 renderCapControls（唯一控件渲染器）。
  // 惰性：controls 为函数时每次渲染重取（cap 后创建/参数变更后重渲染可见最新全量）。
  controls: (c, n, _d, snap) => {
    const ctrls = typeof n.controls === "function" ? n.controls() : n.controls;
    if (ctrls?.length) renderCapControls(c, ctrls, snap);
  },
  divider: (c, n) => rmAppendDecor(c, n),
  sectionTitle: (c, n) => rmAppendDecor(c, n),
  custom: (c, n, d) => {
    if (d.renderCustomDirect && n.renderCustom) {
      dbg("preview-menu-render", "rendering custom node", { id: n.id });
      runCustomMount(c, n.renderCustom);
    } else {
      rmAppendLeaf(c, n, d);
    }
  },
  panel: (c, n, d) => rmAppendLeaf(c, n, d),
  action: (c, n, d) => rmAppendLeaf(c, n, d),
  card: (c, n, d) => rmAppendCard(c, n, d),
  folder: (c, n, d) => rmAppendFolder(c, n, d),
};

export function renderMenu(
  container: HTMLElement,
  nodes: PreviewMenuNode[],
  deps: RenderMenuDeps,
): void {
  ensureMenuStyles();
  dbg("preview-menu-render", "start", { nodeCount: nodes.length });
  // [doc:adr-126-p4-d] visibleWhen 吃状态层快照（previewSnapshot()）——AGENTS.md 硬约束
  const snapshot = previewSnapshot();
  for (const node of nodes) {
    if (node.visibleWhen && !node.visibleWhen(snapshot)) continue;
    dbg("preview-menu-render", "rendering node", { id: node.id, kind: node.kind });
    if (appendFoldedShape(container, node, deps)) continue;
    // 运行期 undefined 兜底：伪造 kind（as unknown as PreviewMenuNode，如 env.ts 节点）
    // 不在表内 → warn + 落叶行壳，防「拼错 kind 静默渲染成死行」，亦防 TypeError。
    // 单一类型逃生舱（本文件唯一一处）：TS 无法把 `node.kind` 与表中键关联——node 是宽类型，
    // 而表项要求「该 kind 的窄类型」（参数逆变），故此处断言一次。
    // 安全性依据两条：① 表按 kind 穷尽（映射类型强制，漏 kind 编译期报错）；
    // ② node 的字段与其 kind 相符由运行期门保证（validateAdapterItemIds warn + core/cap 两测试门）。
    const handler = MENU_HANDLERS[node.kind] as MenuHandler | undefined;
    if (handler) {
      handler(container, node, deps, snapshot);
    } else {
      console.warn(`[preview-menu] 未处理的菜单节点 kind: ${node.kind}`);
      rmAppendLeaf(container, node, deps);
    }
  }
  dbg("preview-menu-render", "complete", { totalNodes: nodes.length });
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
