// ===== 统一模态弹窗 — 核心脚手架（modal.ts 拆分 — ADR-187 D2）=====
// 原 modal.ts（ADR-014 P3 dialogs 类型化弹窗）拆为 modal-core + 5 个 builder：
// modal-prompt / modal-select / modal-confirm / modal-progress / modal-picker。
// 本文件收敛公共骨架：overlay 构建、活动弹窗单例槽位、焦点陷阱、退场动画结算。
// 业务调用方请 import 对应 modalXxx（如 modal-confirm.ts 的 modalConfirm），
// 勿直接依赖本文件内部 API；createDialog 为内部脚手架（供同目录 builder 使用），
// 导出仅为兄弟文件协作，非对外契约。

import { resolveIcon } from "@/utils/icon/resolve.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { rememberTrigger, returnFocus } from "./focus-restore.ts";
import { trapFocusAcrossShadow } from "./trap-focus-across-shadow.ts";

/**
 * modal 家族文案覆盖（可选注入；未提供时由各 builder 回退 @/core/i18n 默认文案）。
 * 用途：①跨产品复用（换 i18n 源）；②测试解耦——i18n 文案调整不令文案敏感断言无罪挂红。
 * 优先级：显式专参（okText/cancelText）> labels 键 > t() 默认文案。
 */
export interface ModalLabels {
  /** 确认按钮文案（modalConfirm/modalSelect/modalPrompt 的 ok 按钮） */
  ok?: string;
  /** 取消按钮文案（含 Esc 提示，如 "取消 (Esc)"） */
  cancel?: string;
  /** modalPrompt 空输入错误提示 */
  fieldRequired?: string;
  /** modalProgress 总大小未知态前缀（如 "已下载"） */
  downloaded?: string;
}

/** ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
 * 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。 */
export const VIEW_TESTIDS: readonly string[] = [
  "dlg-overlay",
  "dlg-input",
  "dlg-select",
  "dlg-cancel",
  "dlg-ok",
];

/** 关闭动画中标记（closeDlg 防重复触发）；WeakSet 随元素 GC 回收，不污染 HTMLElement 全局类型 */
const _closingOverlays = new WeakSet<HTMLElement>();

/** 退场动画待结算定时器（WeakMap 随元素 GC 回收；测试重置钩子取消，防幽灵 resolve 泄入后续用例） */
const _closingTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * 焦点陷阱：Tab 键在弹窗内可聚焦元素间循环，防止焦点逃逸到背后页面
 * @param overlay 弹窗 overlay 元素
 * @returns cleanup 函数（移除 keydown 监听器）
 *
 * ⚠️ 2026-10-14 收敛：本函数曾是手写的**残缺版**（只循环 first↔last 两个分支，
 * 读 `document.activeElement` 判当前焦点），与仓内既有的
 * `trap-focus-across-shadow.ts|trapFocusAcrossShadow`（深焦解析 + 焦点在overlay 外
 * 一律收拢 + tabbable 缓存 + MutationObserver 刷新）**并存成两套**，而模态家族的
 * 全部弹窗走的都是这份残缺版：
 * ① 读 `document.activeElement` 对 **shadow 内**元素恒失效（retargeting 返回 host），
 *    Set/等值比对恒假 → Tab 退化成 first/last 乒乓，陷阱在跨 shadow 场景**完全失效**；
 * ② 焦点在 overlay **之外**（body/背景页）时两个分支都不命中 → Tab 自由走到背后页面，
 *    正是焦点陷阱要防的逃逸。`site/events.ts` 的浮层（P0-3 修复）当年正是因此
 *    才另接 trapFocusAcrossShadow，本文件却一直没跟上——同仓两套陷阱原语、
 *    强弱两份能力。
 * 现统一委派 `trapFocusAcrossShadow`：导出名与签名不变（batch-rename.ts /
 * modal.test.ts 等消费方零改动），强弱两份能力合一。
 */
export function trapFocus(overlay: HTMLElement): () => void {
  return trapFocusAcrossShadow(overlay);
}

/**
 * 带退场动画关闭对话框
 * @param overlay 对话框 overlay 元素
 * @param resolve Promise resolve 函数
 * @param value 要 resolve 的值
 * @param delay 退场动画时长 (ms)
 */
export function closeDlg<T>(
  overlay: HTMLElement,
  resolve: (value: T) => void,
  value: T,
  delay = 120,
): void {
  if (!overlay || _closingOverlays.has(overlay)) return;
  _closingOverlays.add(overlay);
  overlay.classList.add("dlg-closing");
  const timer = setTimeout(() => {
    overlay.remove();
    // 焦点归还信号（2026-10-14）：退场动画结算= 节点真正移除的时刻，此刻把焦点还给
    // 触发元素。派发在remove 之后（触发元素可能已被宿主同步重绘/替换，跳过已离文档者）。
    overlay.dispatchEvent(new CustomEvent("dlg:closed"));
    if (_slot.overlay === overlay) {
      _slot.overlay = null;
      _slot.closeActive = null;
      _slot.closable = true;
    }
    _closingTimers.delete(overlay);
    resolve(value);
  }, delay);
  _closingTimers.set(overlay, timer);
}

/**
 * 活动弹窗单例槽位（收敛体）：
 * 状态与操作同域（overlay/closeActive/closable 与读写操作共址），reset 供测试清理，
 * 未来演进（弹窗栈）有落点；导出函数签名不变，外部（modalXxx/android back/测试）零改动。
 */
interface ModalSlotState {
  overlay: HTMLElement | null;
  closeActive: (() => void) | null;
  closable: boolean;
}

function createModalSlot(): ModalSlotState {
  return { overlay: null, closeActive: null, closable: true };
}

/** 活动弹窗单例槽位（模块级单例；__resetModalStateForTest 仅供测试清理） */
const _slot: ModalSlotState = createModalSlot();

/** 测试钩子：重置活动弹窗单例槽位（isolate:false 共享模块图下，兄弟文件残留的
 *  _slot.overlay 会让「无活动弹窗」断言失真；web-store.__resetWebLogStateForTest 同款）。
 *  同时取消当前弹窗退场动画的待结算定时器——防其 120ms 后仍 resolve 泄入后续用例
 *  （resolve 幂等、槽位守卫不变量不受影响，取消纯粹是让测试重置确定性收口）。 */
export function __resetModalStateForTest(): void {
  if (_slot.overlay) {
    const timer = _closingTimers.get(_slot.overlay);
    if (timer !== undefined) clearTimeout(timer);
    _closingTimers.delete(_slot.overlay);
  }
  _slot.overlay = null;
  _slot.closeActive = null;
  _slot.closable = true;
}

/** 弹窗 append 到 body 后调用，登记为当前活动弹窗 */
export function registerDlg(overlay: HTMLElement, cancelClose: () => void, closable = true): void {
  if (_slot.overlay && _slot.closeActive) _slot.closeActive();
  _slot.overlay = overlay;
  _slot.closeActive = cancelClose;
  _slot.closable = closable;
}

/**
 * 关闭当前活动弹窗（按取消值结算）。返回是否关闭了弹窗。
 * ADR-047：android:back 先关弹窗再退出——弹窗只听 Esc，触屏无 Esc 键，
 * 由 back 事件桥接；进度弹窗（closable=false）不强关。
 */
export function closeActiveDialog(): boolean {
  if (!_slot.overlay || !_slot.closeActive || !_slot.closable) return false;
  const close = _slot.closeActive;
  _slot.closeActive = null;
  _slot.overlay = null;
  _slot.closable = true;
  close();
  return true;
}

function buildOverlay<T>(
  tabIndex: number,
  closable: boolean,
  cancelValue: T,
  resolve: (value: T) => void,
  onClose?: (value: T) => void,
): { overlay: HTMLDivElement; close: (value: T) => void } {
  const overlay = document.createElement("div");
  overlay.tabIndex = tabIndex;
  overlay.className = "dlg-overlay";
  overlay.dataset.testid = "dlg-overlay";
  // WCAG 2.1 A 级：对话框语义。业务弹窗统一走 createDialog 后自动继承这两条属性。
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const close = (value: T): void => {
    closeDlg(overlay, resolve, value);
    onClose?.(value);
  };
  overlay.onclick = (e: MouseEvent): void => {
    if (e.target === overlay && closable) close(cancelValue);
  };
  overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape" && closable) close(cancelValue);
  });
  return { overlay, close };
}

function appendDialogBox(
  overlay: HTMLElement,
  width: string | undefined,
  buildBox: (box: HTMLElement) => void,
  boxClass?: string,
): HTMLDivElement {
  const box = document.createElement("div");
  box.className = boxClass || "dlg-box dlg-pad dlg-gap-lg";
  if (width) box.style.width = width;
  buildBox(box);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return box;
}

/**
 * 统一标题行（ADR-190 D3：抽象抽全——原 5 个 builder 各自重复渲染）。
 * titleIcon 空时省略图标与空格（与旧实现「空 titleIcon 留前导空格」的视觉差异可忽略）。
 * titleIcon 传**语义名**（UI_ICONS 的 key，ADR-238），经 resolveIcon 渲染内联 SVG；
 * 标题文本走 createTextNode（比 esc 更彻底，XSS 免疫由文本节点天然保证）。
 * titleExtra 追加为行内子节点（如 rename 的「读取头部」按钮），保持在标题行右侧。
 */
function buildTitleRow(
  title: string,
  titleIcon: UiIconName | undefined,
  titleExtra?: HTMLElement,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "dlg-title dlg-title-flush";
  // 图标只喂 resolveIcon 产物（内部常量 SVG），永不是用户数据；标题走文本节点。
  const iconSvg = titleIcon ? resolveIcon(titleIcon) : "";
  if (iconSvg) {
    const ico = document.createElement("span");
    ico.innerHTML = iconSvg;
    el.appendChild(ico);
    el.append(" ");
  }
  el.appendChild(document.createTextNode(title));
  if (titleExtra) el.appendChild(titleExtra);
  return el;
}

function registerDialogLife<T>(
  overlay: HTMLElement,
  closable: boolean,
  cancelValue: T,
  close: (value: T) => void,
): void {
  registerDlg(overlay, () => close(cancelValue), closable);
  // 焦点归还（2026-10-14）：弹窗把焦点抢进 overlay，关闭时若不还，键盘用户每开一次
  // 弹窗就永久失去原位置（焦点落 body，下一次 Tab 从页面顶部重来）。preview-3d 的
  // mount/finishSession 早已用 rememberTrigger/returnFocus 配对，本模态家族却一直没有
  // ——同一仓两处「模态要归还焦点」一半有实现一半没有。
  // 记在 closeDlg 的退场动画结算点（真正移除节点的时刻）而非调用处：任何关闭路径
  //（按钮/Esc/遮罩/closeActiveDialog）都经close → closeDlg，单点覆盖不漏路径。
  rememberTrigger();
  overlay.focus();
  trapFocus(overlay);
  overlay.addEventListener(
    "dlg:closed",
    () => {
      returnFocus();
    },
    { once: true },
  );
}

/**
 * 弹窗脚手架工厂：创建 overlay + box，绑定遮罩点击 / Esc 关闭（closable 门控）、
 * registerDlg 单例登记、焦点陷阱。收敛 modalPrompt / modalSelect / modalConfirm /
 * modalProgress 四份重复脚手架（索引 4.8）——各弹窗只提供 buildBox 内容与
 * cancelValue 结算值，关闭路径（closeDlg 退场动画）统一。
 * @returns { overlay, box, close } — close(value) 带退场动画结算（resolve）
 */
export function createDialog<T>(opts: {
  title: string;
  titleIcon?: UiIconName | undefined;
  /** 标题行内追加的自定义节点（如操作按钮），保持行内布局 */
  titleExtra?: HTMLElement;
  width?: string | undefined;
  /** box class 覆盖（默认 "dlg-box dlg-pad dlg-gap-lg"；业务弹窗可传自有布局类） */
  boxClass?: string;
  tabIndex?: number;
  cancelValue: T;
  resolve: (value: T) => void;
  closable?: boolean;
  /** 关闭生命周期钩子（Esc/遮罩/按钮任一 close 路径均同步触发；resolve 在退场动画后异步结算） */
  onClose?: (value: T) => void;
  buildBox: (box: HTMLElement) => void;
}): { overlay: HTMLDivElement; box: HTMLDivElement; close: (value: T) => void } {
  const {
    title,
    titleIcon,
    titleExtra,
    width,
    boxClass,
    tabIndex = 0,
    cancelValue,
    resolve,
    closable = true,
    onClose,
    buildBox,
  } = opts;
  const { overlay, close } = buildOverlay(tabIndex, closable, cancelValue, resolve, onClose);
  const box = appendDialogBox(overlay, width, buildBox, boxClass);
  // 标题行由脚手架统一 prepend（buildBox 内的 innerHTML 赋值先行完成，互不覆盖）
  box.prepend(buildTitleRow(title, titleIcon, titleExtra));
  registerDialogLife(overlay, closable, cancelValue, close);
  return { overlay, box, close };
}
