// ===== 批量重命名对话框（类型化版 — ADR-014 P3 dialogs 收官）=====
// 复用 parseModelName 解析。结构（ADR-208 D2 ≤400 行收敛 + ADR-190 D1a 模板外移）：
// - 本文件 = 公共 API + 弹窗壳（overlay/focus/close）+ 类型契约
// - DOM 模板经 BatchRenameTpl 注入（views/app-tree/tpl-batch-rename.ts，features 不自渲染）
// - 表单接线（状态更新/预览渲染/五组事件绑定）→ ./batch-rename-form.ts

import { type ParsedModelName, parseModelName } from "@/utils/model-name/display.ts";
import { bindBatchRenameForm } from "./batch-rename-form.ts";
import { closeDlg, registerDlg, trapFocus } from "./modal-core.ts";

/** 批量条目（ModelEntry 子集） */
export interface BatchEntry {
  Name: string;
  Path?: string;
  [key: string]: unknown;
}

/** 应用变更载荷 */
export interface BatchRenameChange {
  oldPath?: string | undefined;
  oldName: string;
  newName: string;
}

/** 内部条目（含解析结果与编辑状态） */
export interface BatchItem {
  p: ParsedModelName;
  _author: string;
  _work: string;
  newName: string;
  selected: boolean;
  changed?: boolean;
  Name: string;
  Path?: string;
}

/** 预览行视图数据（features → views 单向投影：模板只吃纯数据，不透传内部结构） */
export interface BrRowView {
  name: string;
  newName: string;
  selected: boolean;
  changed: boolean;
}

/**
 * DOM 模板注入契约（ADR-190 D1a：DOM 模板归 views，组合根注入；
 * 先例 RecycleDeps.renderListHtml）。views/app-tree/tpl-batch-rename.ts 提供实现。
 */
export interface BatchRenameTpl {
  /** 主表单（header + 模式 + parse/replace 分区 + footer） */
  formHTML: (dir: string, total: number, changed: number) => string;
  /** 预览区（全选 header + 行） */
  previewHTML: (rows: BrRowView[]) => string;
}

export interface DgBrShell {
  items: BatchItem[];
  overlay: HTMLElement;
  pendingResolve: (() => void) | null;
  closed: boolean;
  brTimers: Array<ReturnType<typeof setTimeout> | null>;
  /** DOM 模板（buildOverlay 创建 shell 时写入；表单接线函数经 shell 读取） */
  tpl: BatchRenameTpl;
  batchAuthor: HTMLInputElement | null;
  batchWork: HTMLInputElement | null;
  previewEl: HTMLElement | null;
  modeSelect: HTMLSelectElement | null;
  parseModeEl: HTMLElement | null;
  replaceModeEl: HTMLElement | null;
  findInput: HTMLInputElement | null;
  replaceInput: HTMLInputElement | null;
  regexCb: HTMLInputElement | null;
  presetsBtn: HTMLElement | null;
  presetsMenu: HTMLElement | null;
}

// 弹窗状态（dialogEl / pendingResolve / closed）已收进 DgBrShell 实例；
// 单例由 modal.ts registerDlg 槽位统一保证，不再用模块级全局（修复 #1 并发覆盖风险）。

function dgBrParseItems(entries: BatchEntry[]): BatchItem[] {
  return entries.map((e) => {
    const p = parseModelName(e.Name);
    return {
      ...e,
      p,
      _author: "",
      _work: "",
      newName: e.Name,
      selected: true,
    };
  });
}

function dgBrClose(shell: DgBrShell): void {
  if (shell.closed) return;
  shell.closed = true;
  const timers = shell.brTimers;
  // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
  if (timers) timers.forEach((t) => t && clearTimeout(t));
  const res = shell.pendingResolve;
  shell.pendingResolve = null;
  closeDlg(shell.overlay, () => res?.(), undefined);
}

function dgBrBuildOverlay(
  dir: string,
  items: BatchItem[],
  pendingResolve: () => void,
  tpl: BatchRenameTpl,
): {
  shell: DgBrShell;
  overlay: HTMLElement;
  closeFn: () => void;
} {
  const el = document.createElement("div");
  el.tabIndex = 0;
  el.className = "dlg-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  // 遮罩背景不再内联硬编码：由 .dlg-overlay CSS 类统一提供（#4 / R5 样式令牌红线）
  let shell: DgBrShell;
  const closeFn = (): void => dgBrClose(shell);
  el.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeFn();
    if (e.key === "Enter") {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || e.isComposing)) return;
      const applyBtn = el.querySelector("#br-apply") as HTMLButtonElement | null;
      if (applyBtn && !applyBtn.disabled) applyBtn.click();
    }
  });
  const changed = items.filter((it) => it.changed).length;
  el.innerHTML = tpl.formHTML(dir, items.length, changed);
  document.body.appendChild(el);
  const brTimers: Array<ReturnType<typeof setTimeout> | null> = [null, null];

  shell = {
    items,
    overlay: el,
    pendingResolve,
    closed: false,
    brTimers,
    tpl,
    batchAuthor: el.querySelector("#br-batch-author") as HTMLInputElement | null,
    batchWork: el.querySelector("#br-batch-work") as HTMLInputElement | null,
    previewEl: el.querySelector("#br-preview") as HTMLElement | null,
    modeSelect: el.querySelector("#br-mode") as HTMLSelectElement | null,
    parseModeEl: el.querySelector("#br-parse-mode") as HTMLElement | null,
    replaceModeEl: el.querySelector("#br-replace-mode") as HTMLElement | null,
    findInput: el.querySelector("#br-find") as HTMLInputElement | null,
    replaceInput: el.querySelector("#br-replace") as HTMLInputElement | null,
    regexCb: el.querySelector("#br-regex") as HTMLInputElement | null,
    presetsBtn: el.querySelector("#br-presets") as HTMLElement | null,
    presetsMenu: el.querySelector("#br-presets-menu") as HTMLElement | null,
  };

  // 单例由 registerDlg 槽位保证（与 modal.ts 四个标准弹窗一致）；cancelClose 走身份守卫防重复结算
  registerDlg(el, () => {
    if (!shell.closed) closeFn();
  });
  trapFocus(el); // #3 等价：Tab 焦点锁在弹窗内（修复陷阱 #14 变体）
  el.focus();

  return { shell, overlay: el, closeFn };
}

/**
 * 批量重命名对话框（Promise resolve on close）。
 * tpl = DOM 模板注入（ADR-190 D1a）：生产调用传 views/app-tree/tpl-batch-rename.ts 的
 * batchRenameTpl，缺失即编译期 fail-loud（与 RecycleDeps.renderListHtml 同款先例）。
 */
export function showBatchRenameDialog(
  dir: string,
  entries: BatchEntry[],
  onApply: (changes: BatchRenameChange[]) => Promise<void>,
  tpl: BatchRenameTpl,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const items = dgBrParseItems(entries);
    const { shell, closeFn } = dgBrBuildOverlay(dir, items, resolve, tpl);

    bindBatchRenameForm(shell, tpl, onApply, closeFn);
  });
}
