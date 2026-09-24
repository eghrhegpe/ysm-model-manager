// ===== render.ts 的叶节点渲染原语拆分（2026-10 组织性重构，零行为变更）=====
// 「声明式菜单」唯一渲染器 render.ts 混着四类关注点，本文件只承接第 ② 类：
// kind 分派器消费的**不递归叶原语**——行壳（rmMakeRowBase）/ 字段行 / 按钮行 / 动态行 /
// 材质行 / 装饰行 / 叶节点，以及控件投影适配 nodeControlToView 与其渲染器映射表。
// ① kind 分派器（MENU_HANDLERS）③ 递归容器（folder/card）④ 逃生舱生命周期仍留 render.ts。
// ⚠️ rmAppendFolder / rmAppendCard 因内部递归调用 renderMenu（留在 render.ts）而**必须**留在
//    render.ts：若搬来本文件即形成 rows.ts → render.ts → rows.ts 循环依赖。
// 本文件不得 import render.ts（防环）；对外符号 nodeControlToView 由 render.ts 转发，
// 消费者 import 路径（@/preview-3d/menu/render/render.ts）保持不变。
// 溯源注释随函数逐字搬迁——注释是资料，未删改语义。

import { t, tOf } from "@/core/i18n/t.ts";
import type {
  NodeFor,
  PreviewActionMenuCtx,
  PreviewMenuNode,
} from "@/preview-3d/menu/schema/node-types.ts";
import { createHeaderToggle } from "@/preview-3d/menu/shell/header-toggle.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/preview-3d/menu/shell/slide-menu.ts";
import { resolveLabel } from "@/utils/base/pure/label.ts";
import { applyIcon } from "@/utils/icon/resolve.ts";
import {
  type CapControlView,
  renderCapColor,
  renderCapSelect,
  renderCapSlider,
  renderCapToggle,
} from "./cap-controls.ts";

// 控件原语（select/slider/toggle/color）渲染器映射表（ADR-195 刀 2.5 投影反转：
// 节点控件经 nodeControlToView 适配为 CapControlView 后，由各自 renderCap* 渲染器输出）。
// 表驱动取代 switch 内四段三元链——遗漏某种 kind 在编译期即报错，且消除嵌套三元。
export const CAP_CONTROL_RENDERERS: Record<
  "select" | "slider" | "toggle" | "color",
  (container: HTMLElement, view: CapControlView) => void
> = {
  select: renderCapSelect,
  slider: renderCapSlider,
  toggle: renderCapToggle,
  color: renderCapColor,
};

/** renderMenu 依赖接口（deps 形参类型提级，避免主函数里重复写 8 行参数表） */
export interface RenderMenuDeps {
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

// i18n 取值统一走共享 t()（core/i18n/t.ts，内置 current → en → key 多级回退）

/** 统一 label 取值：委托 pure 层唯一决策 `resolveLabel`（utils/base/pure/label.ts）——
 *  labelKey→tOf（i18n 三级回退）；无 labelKey → valueOverride → node.label（明文）→ node.id。
 *  回退标准唯一 = resolveLabel；node.label 只装动态数据明文，非 i18n 回退概念（ADR-207 D3）。 */
// ⚠️ 须导出：留守 render.ts 的 rmAppendFolder / rmAppendCard 亦消费本函数（单一回退出口）。
export function rmLabel(node: PreviewMenuNode, valueOverride?: unknown): string {
  return resolveLabel(
    { labelKey: node.labelKey, plain: node.label ?? node.id },
    tOf,
    valueOverride,
  );
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

/** [子函数 2/6] field：键值对行（统计/信息展示） */
export function rmAppendField(container: HTMLElement, node: NodeFor<"field">): void {
  const row = document.createElement("div");
  row.className = "slide-item field-row";
  row.dataset.testid = `preview-${node.id}`;
  const k = document.createElement("span");
  k.className = "field-label";
  // field 行文案与显示值同口径——统一走 rmLabel（唯一回退出口），勿再手搬三元式
  k.textContent = rmLabel(node);
  const displayed = node.value ?? rmLabel(node);
  const v = document.createElement("span");
  v.className = "field-value";
  v.textContent = String(displayed);
  row.append(k, v);
  container.appendChild(row);
}

/** [模式⑥·提纯] button/row 共用行骨架：slide-item 行 + testid + 可选图标 + 空标签（jscpd 去重）
 *  [ADR-302 走法丙刀2] 形参收窄为「会读 rowDensity 的两个 kind」——正是共用本壳的 button/row。 */
function rmMakeRowBase(node: NodeFor<"button"> | NodeFor<"row">): {
  row: HTMLDivElement;
  lb: HTMLSpanElement;
} {
  const row = document.createElement("div");
  row.className = node.rowDensity === "compact" ? "slide-item rm-row-compact" : "slide-item";
  row.dataset.testid = `preview-${node.id}`;
  if (node.icon) {
    const ic = document.createElement("span");
    ic.className = "slide-icon";
    // 语义名 → SVG；未迁的旧字形 → 文本兜底（统一入口见 utils/icon/resolve.ts）
    applyIcon(ic, node.icon);
    row.appendChild(ic);
  }
  const lb = document.createElement("span");
  lb.className = "slide-label";
  row.appendChild(lb);
  return { row, lb };
}

/** [子函数 3/6] button：操作按钮行。
 *  两形态（锐评修复 2026-09-20）：control 携按钮语义（action/variant/getHint/disabled）
 *  时渲染行内真按钮（对齐 cap 栈 renderCapButton 视觉：cc-btn + 动态 hint + 异步禁用）；
 *  无 control 保持整行 action（导航钮形态，历史行为）。旧接线下节点 button 不承载
 *  variant/getHint，迫使地面贴图按钮绕道 controls 通道——此臂补齐后绕道退役。 */
export function rmAppendButton(
  container: HTMLElement,
  node: NodeFor<"button">,
  actionCtx: PreviewActionMenuCtx,
): void {
  const { row, lb } = rmMakeRowBase(node);
  lb.textContent = rmLabel(node);
  const spec = node.control;
  if (spec && (spec.action || spec.variant || spec.getHint || spec.disabled)) {
    const btn = document.createElement("button");
    btn.className = spec.variant === "primary" ? "cc-btn cc-btn-primary" : "cc-btn cc-btn-ghost";
    btn.textContent = spec.text ? tOf(spec.text) : rmLabel(node);
    const hint = document.createElement("span");
    hint.className = "cc-hint cc-hint-45";
    const syncHint = (): void => {
      hint.textContent = spec.getHint?.() ?? (spec.hintKey ? tOf(spec.hintKey) : "");
    };
    syncHint();
    const applyDisabled = (): void => {
      const d = spec.disabled?.() ?? false;
      btn.disabled = d;
      btn.style.opacity = d ? "0.5" : "1";
    };
    applyDisabled();
    btn.onclick = async (): Promise<void> => {
      if (!spec.action || btn.disabled) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";
      try {
        await spec.action();
      } finally {
        applyDisabled();
        syncHint();
      }
    };
    row.append(btn, hint);
  } else {
    rmBindActionClick(row, node.action, actionCtx);
  }
  container.appendChild(row);
}

/** [子函数 4/6] row：动态列表行（纹理/材质/bone 等动态列表；ADR-193 第四刀起支持
 *  行首 radio（焦点钮）与行尾 badge（次级动作钮）槽位——roles 角色行/switch 候选行；
 *  环境面板 cap 行复用：headerToggle（能力开关）+ 行尾 chevron（无 badge 且有 action 时显示，
 *  表「整行点击下钻」） */
export function rmAppendDynamicRow(
  container: HTMLElement,
  node: NodeFor<"row">,
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
    // 无 labelKey（动态内容如角色名/候选文件名）→ resolveLabel ③级 plain 回退（node.label ?? node.id）；
    // 显式明文行（动态名）+ value = 附加信息 → 副标签照旧展示（「名称 + 声明/面数」类行：
    // 纹理短名 + 引用面数、组件名 + 纹理声明）；value 与行文案相同则不加，避免重复
    lb.textContent = rmLabel(node);
    if (typeof node.value === "string" && node.value && node.value !== lb.textContent) {
      const meta = document.createElement("span");
      meta.className = "slide-sublabel";
      meta.textContent = node.value;
      row.appendChild(meta);
    }
  }
  if (node.radio) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.dataset.testid = "row-radio";
    // 语义名图标（ADR-238：UI chrome 走 SVG，不靠字形）：off 单环 / on 环+圆心
    applyIcon(radio, node.radio.active ? "radioOn" : "radioOff");
    radio.title = node.radio.title;
    radio.className = `rm-radio-btn${node.radio.active ? " row-radio-active" : ""}`;
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
    });
    if (!node.badge && !node.action) tg.classList.add("rm-ml-auto");
    row.appendChild(tg);
  }
  if (node.badge) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.dataset.testid = "row-badge";
    applyIcon(badge, node.badge.icon);
    badge.title = node.badge.title;
    badge.className = "cc-btn cc-btn-ghost rm-inline-btn rm-ml-auto";
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
    chev.className = "cm-row-chev rm-ml-auto";
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
 *   - get() → getValue()（闭包读，感知类无状态路径控件用 get/set 直读写）
 *   - set(v) → setValue(v)（spec.set → spec.onChange）
 *   - refreshOnChange → onChange 内触发 menu.refresh()
 *   - numeric/slider.unit/onCommit → view.slider 透传
 */
export function nodeControlToView(node: PreviewMenuNode, menu?: SlideMenuHandle): CapControlView {
  const spec = node.control;
  const labelKey = node.labelKey ?? "";
  const fallback = node.label ?? node.id;

  // 固定传 undefined：生产 spec 的 get 全是无参闭包（如 () => getStateValue(...)），
  // undefined 不进入任何读取逻辑——保留 unknown 形参兼容 PreviewControlSpec 签名，
  // 调用方无感知（旧 signature 的 snapshot 形参已拆除，见 4f7ca6b25）
  const getValue = (): unknown => (spec?.get ? spec.get(undefined) : null);

  const setValue = (v: number | string | boolean): void => {
    if (!spec) return;
    spec.set?.(v);
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
export function rmAppendMaterialRow(container: HTMLElement, node: NodeFor<"material-row">): void {
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
    eye.title = v ? t("preview.eyeHide") : t("preview.eyeShow");
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
export function rmAppendDecor(
  container: HTMLElement,
  node: NodeFor<"divider"> | NodeFor<"sectionTitle">,
): void {
  if (node.kind === "divider") {
    const hr = document.createElement("div");
    hr.dataset.testid = node.id;
    hr.className = "menu-divider";
    container.appendChild(hr);
    return;
  }
  // sectionTitle（无 labelKey → 明文直出，同 rmAppendDynamicRow 口径，统一走 rmLabel）
  const st = document.createElement("div");
  st.dataset.testid = node.id;
  st.textContent = rmLabel(node);
  st.className = "section-title";
  container.appendChild(st);
}

/** [2026-10 菜单收口] note：脚注/辅助文案行（小号弱色，无分隔线——与 sectionTitle 的
 *  「分节标题」语义分离，原设置页脚注穿 sectionTitle 衣服的问题根治）。
 *  渲染口径同 rmAppendDecor：无 labelKey 时明文直出，统一走 rmLabel。 */
export function rmAppendNote(container: HTMLElement, node: NodeFor<"note">): void {
  const st = document.createElement("div");
  st.dataset.testid = node.id;
  st.textContent = rmLabel(node);
  st.className = "menu-note";
  container.appendChild(st);
}

/** [子函数 6/6] 叶节点：panel / action / custom —— 直接走 makeRow + navigate/action */
export function rmAppendLeaf(
  container: HTMLElement,
  node: PreviewMenuNode,
  deps: RenderMenuDeps,
): void {
  const row = deps.makeRow(node, { chevron: node.kind === "panel" });
  rmBindLeafClick(row, node, deps);
  container.appendChild(row);
}
