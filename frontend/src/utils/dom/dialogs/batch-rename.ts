// ===== 批量重命名对话框（类型化版 — ADR-014 P3 dialogs 收官）=====
// 复用 parseModelName 解析
import { TOAST_MS } from "../toast-ms.ts";
import { bus } from "../../../bus.ts";
import { parseModelName, type ParsedModelName } from "../../../utils/dom/display.ts";
import { stagger } from "../../../utils/animation/stagger.ts";
import { registerDlg, closeDlg, trapFocus } from "./modal.ts";
import { esc } from "../../../utils/dom/html.ts";
import { rebuildParsedName, applyReplaceToName } from "./batch-rename-util.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { t } from "../../../core/i18n/t.ts";

/** 批量条目（ModelEntry 子集） */
interface BatchEntry {
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
interface BatchItem {
  p: ParsedModelName;
  _author: string;
  _work: string;
  newName: string;
  selected: boolean;
  changed?: boolean;
  Name: string;
  Path?: string;
}

interface DgBrShell {
  items: BatchItem[];
  overlay: HTMLElement;
  pendingResolve: (() => void) | null;
  closed: boolean;
  brTimers: Array<ReturnType<typeof setTimeout> | null>;
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

function dgBrUpdateAll(items: BatchItem[]): void {
  items.forEach((it) => {
    it.newName = rebuildParsedName(it.Name, it.p, {
      author: it._author,
      work: it._work,
    });
    it.changed = it.newName !== it.Name;
  });
}

function dgBrApplyReplace(items: BatchItem[], findText: string, replaceText: string, isRegex: boolean): void {
  if (!findText) return;
  const cnt = document.getElementById("br-changed");
  if (cnt) delete cnt.dataset.regexErr;
  items.forEach((it) => {
    const r = applyReplaceToName(it.Name, findText, replaceText, isRegex);
    if (!r.ok) {
      const cnt2 = document.getElementById("br-changed");
      if (cnt2 && !cnt2.dataset.regexErr) {
        cnt2.dataset.regexErr = "1";
        bus.emit("toast:show", {
          msg: "⚠️ " + t("dialog.regexInvalid"),
          duration: TOAST_MS.normal,
          type: "warn",
        });
      }
      return;
    }
    it.newName = r.newName;
    it.changed = it.newName !== it.Name;
  });
}

function dgBrUpdateCount(items: BatchItem[]): void {
  const sel = items.filter((it) => it.selected && it.changed).length;
  const cnt = document.getElementById("br-changed");
  if (cnt) cnt.textContent = String(sel);
}

function dgBrGenHTML(dir: string, items: BatchItem[]): string {
  const changed = items.filter((it) => it.changed).length;
  return `<div class="dlg-box">
<div class="dlg-header">
  <span class="dlg-header-title">📝 ${t("dialog.batchRenameTitle")}</span>
  <span class="dlg-header-path">${esc(dir)}</span>
  <span class="dlg-header-count">${items.length} ${t("dialog.filesUnit")} · <span id="br-changed">${changed}</span> ${t("dialog.changesUnit")}</span>
</div>
<div class="dlg-section">
  <span class="dlg-section-label">${t("dialog.pattern")}：</span>
  <select id="br-mode" class="dlg-input">
    <option value="parse">📋 ${t("dialog.parseFormat")}</option>
    <option value="replace">🔍 ${t("dialog.findReplace")}</option>
  </select>
</div>
<div id="br-parse-mode" class="dlg-section">
  <span class="dlg-section-label">${t("dialog.author")}：</span>
  <input id="br-batch-author" class="dlg-input-sm" placeholder="${t("dialog.keepEmpty")}">
  <span class="dlg-section-label">${t("dialog.work")}：</span>
  <input id="br-batch-work" class="dlg-input-sm" placeholder="${t("dialog.keepEmpty")}">
  <span class="dlg-header-count" style="font-size:9px">${t("dialog.enterToApply")}</span>
</div>
<div id="br-replace-mode" class="dlg-section" style="display:none">
  <span class="dlg-section-label">${t("dialog.find")}：</span>
  <input id="br-find" class="dlg-input-flex" placeholder="${t("dialog.findPlaceholder")}">
  <span class="dlg-section-label">${t("dialog.replace")}：</span>
  <input id="br-replace" class="dlg-input-flex" placeholder="${t("dialog.replaceEmptyDelete")}">
  <label class="dlg-label-check">
    <input type="checkbox" id="br-regex"> ${t("dialog.regex")}
  </label>
  <button id="br-presets" class="dlg-btn-accent">📋 ${t("dialog.presets")}</button>
  <div id="br-presets-menu" class="dlg-presets-menu">
    <div class="br-preset dlg-preset-chip" data-find="\(\d{4}-\d{2}\)" data-replace="" data-regex="1">❌ ${t("dialog.presetRemoveYear")}</div>
    <div class="br-preset dlg-preset-chip" data-find="-v\d+(?=\.)" data-replace="" data-regex="1">❌ ${t("dialog.presetRemoveVersion")}</div>
    <div class="br-preset dlg-preset-chip" data-find="【(.+?)】" data-replace="[$1]" data-regex="1">${t("dialog.presetBrackets")}</div>
    <div class="br-preset dlg-preset-chip" data-find="\[(.+?)\]【(.+?)】" data-replace="$1-$2" data-regex="1">📛 ${t("dialog.presetFlatten")}</div>
    <div class="br-preset dlg-preset-chip" data-find="\s+" data-replace="_" data-regex="1">🔗 ${t("dialog.presetSpaceUnderscore")}</div>
  </div>
</div>
<div id="br-preview" class="dlg-preview"></div>
<div class="dlg-footer">
  <button id="br-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
  <button id="br-apply" class="dlg-btn dlg-btn-primary">✅ ${t("dialog.applyRenameEnter")}</button>
</div>
</div>`;
}

function dgBrRenderPreview(el: HTMLElement | null, items: BatchItem[]): void {
  if (!el) return;
  const changed = items.filter((it) => it.changed).length;
  const cnt = document.getElementById("br-changed");
  if (cnt) cnt.textContent = String(changed);
  el.innerHTML =
    `<div class="br-header">
  <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
    <input type="checkbox" id="br-select-all" checked class="br-cb"> ${t("dialog.selectAll")}
  </label>
  <span style="flex:1;text-align:center">${t("dialog.oldName")}</span>
  <span class="br-spacer"></span>
  <span style="flex:1;text-align:center">${t("dialog.newName")}</span>
</div>` +
    items
      .map(
        (it, i) =>
          `<div class="br-row" style="animation-delay:${stagger(i, 15, 300)}ms">
  <input type="checkbox" class="br-file-cb br-cb" data-ci="${i}" ${it.selected ? "checked" : ""}>
  ${
    it.selected && it.changed
      ? `<span class="br-name br-name-old" title="${esc(it.Name)}">${esc(it.Name)}</span>
  <span class="br-arrow">→</span>
  <span class="br-name br-name-new" title="${esc(it.newName)}">${esc(it.newName)}</span>`
      : `<span class="br-name-plain" style="opacity:${it.selected ? 1 : 0.5}">${esc(it.Name)}</span>`
  }
</div>`,
      )
      .join("");

  const selectAll = el.querySelector("#br-select-all") as HTMLInputElement | null;
  if (selectAll) {
    selectAll.addEventListener("change", (): void => {
      const checked = selectAll.checked;
      items.forEach((it) => (it.selected = checked));
      el.querySelectorAll(".br-file-cb").forEach(
        (cb) => ((cb as HTMLInputElement).checked = checked),
      );
      const sel = items.filter((it) => it.selected && it.changed).length;
      const cnt2 = document.getElementById("br-changed");
      if (cnt2) cnt2.textContent = String(sel);
    });
  }
}

function dgBrClose(shell: DgBrShell): void {
  if (shell.closed) return;
  shell.closed = true;
  const timers = shell.brTimers;
  if (timers) timers.forEach((t) => t && clearTimeout(t));
  const res = shell.pendingResolve;
  shell.pendingResolve = null;
  closeDlg(shell.overlay, () => res?.(), undefined);
}

function dgBrBuildOverlay(dir: string, items: BatchItem[], pendingResolve: () => void): {
  shell: DgBrShell;
  overlay: HTMLElement;
  closeFn: () => void;
} {
  const el = document.createElement("div");
  el.tabIndex = 0;
  el.className = "dlg-overlay";
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
  el.innerHTML = dgBrGenHTML(dir, items);
  document.body.appendChild(el);
  const brTimers: Array<ReturnType<typeof setTimeout> | null> = [null, null];

  shell = {
    items,
    overlay: el,
    pendingResolve,
    closed: false,
    brTimers,
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

function dgBrApplyBatch(shell: DgBrShell): void {
  const { items, batchAuthor, batchWork, previewEl } = shell;
  const ba = batchAuthor ? batchAuthor.value.trim() : "";
  const bw = batchWork ? batchWork.value.trim() : "";
  items.forEach((it) => {
    if (ba) it._author = ba;
    if (bw) it._work = bw;
  });
  dgBrUpdateAll(items);
  dgBrRenderPreview(previewEl, items);
  items.forEach((it, i) => {
    const cb = previewEl?.querySelector(`[data-ci="${i}"]`) as HTMLInputElement | null;
    if (cb) cb.checked = it.selected;
  });
  dgBrUpdateCount(items);
}

function dgBrBindParseTab(shell: DgBrShell): void {
  const { items, batchAuthor, batchWork, previewEl, brTimers } = shell;
  let brTimer: ReturnType<typeof setTimeout> | null = null;
  const applyBatchDebounced = (): void => {
    if (brTimer) clearTimeout(brTimer);
    brTimer = setTimeout(() => dgBrApplyBatch(shell), 200);
    brTimers[0] = brTimer;
  };
  batchAuthor?.addEventListener("input", applyBatchDebounced);
  batchWork?.addEventListener("input", applyBatchDebounced);

  previewEl?.addEventListener("change", (e: Event): void => {
    const cb = e.target as HTMLInputElement;
    if (cb.classList.contains("br-file-cb")) {
      const idx = parseInt(cb.dataset.ci || "", 10);
      if (!isNaN(idx) && items[idx]) items[idx].selected = cb.checked;
      dgBrUpdateCount(items);
    }
  });
}

function dgBrBindReplaceTab(shell: DgBrShell): void {
  const { items, findInput, replaceInput, regexCb, presetsBtn, presetsMenu, previewEl, brTimers } = shell;
  let replaceTimer: ReturnType<typeof setTimeout> | null = null;
  const applyReplaceDebounced = (): void => {
    if (replaceTimer) clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      dgBrApplyReplace(items, findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      dgBrRenderPreview(previewEl, items);
      dgBrUpdateCount(items);
    }, 200);
    brTimers[1] = replaceTimer;
  };
  findInput?.addEventListener("input", applyReplaceDebounced);
  replaceInput?.addEventListener("input", applyReplaceDebounced);
  regexCb?.addEventListener("change", applyReplaceDebounced);

  presetsBtn?.addEventListener("click", (): void => {
    const show = presetsMenu?.style.display !== "flex";
    if (presetsMenu) presetsMenu.style.display = show ? "flex" : "none";
    presetsBtn.textContent =
      "📋 " + (show ? t("dialog.collapse") : t("dialog.presets"));
  });
  presetsMenu?.querySelectorAll(".br-preset").forEach((el) => {
    el.addEventListener("click", (): void => {
      const btn = el as HTMLElement;
      if (findInput) findInput.value = btn.dataset.find || "";
      if (replaceInput) replaceInput.value = btn.dataset.replace || "";
      if (regexCb) regexCb.checked = btn.dataset.regex === "1";
      if (presetsMenu) presetsMenu.style.display = "none";
      dgBrApplyReplace(items, findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      dgBrRenderPreview(previewEl, items);
      dgBrUpdateCount(items);
    });
  });
}

function dgBrBindModeSwitch(shell: DgBrShell): void {
  const { items, modeSelect, parseModeEl, replaceModeEl, findInput, replaceInput, regexCb, previewEl } = shell;
  modeSelect?.addEventListener("change", (): void => {
    const isReplace = modeSelect.value === "replace";
    if (parseModeEl) parseModeEl.style.display = isReplace ? "none" : "flex";
    if (replaceModeEl) replaceModeEl.style.display = isReplace ? "flex" : "none";
    if (isReplace) {
      dgBrApplyReplace(items, findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      dgBrRenderPreview(previewEl, items);
    } else {
      items.forEach((it) => {
        it._author = "";
        it._work = "";
      });
      const dlgEl = shell.overlay;
      const authorInput = dlgEl?.querySelector("#br-batch-author") as HTMLInputElement | null;
      const workInput = dlgEl?.querySelector("#br-batch-work") as HTMLInputElement | null;
      if (authorInput) authorInput.value = "";
      if (workInput) workInput.value = "";
      dgBrUpdateAll(items);
      dgBrRenderPreview(previewEl, items);
    }
    dgBrUpdateCount(items);
  });
}

function dgBrBindCancelAndOutside(_shell: DgBrShell, thisEl: HTMLElement, closeFn: () => void): void {
  // 取消按钮 → 关闭；遮罩点击关闭在此统一管理（与 createDialog 等价）
  thisEl.querySelector("#br-cancel")?.addEventListener("click", closeFn);
  thisEl.addEventListener("click", (e: MouseEvent): void => {
    if (e.target === thisEl) closeFn();
  });
}

function dgBrBindApplyClick(
  shell: DgBrShell,
  thisEl: HTMLElement,
  onApply: (changes: BatchRenameChange[]) => Promise<void>,
  closeFn: () => void,
): void {
  const { items } = shell;
  thisEl.querySelector("#br-apply")?.addEventListener("click", async (): Promise<void> => {
    const changed = items.filter((it) => it.selected && it.changed);
    if (!changed.length) {
      bus.emit("toast:show", {
        msg: t("dialog.noFilesToRename"),
        duration: TOAST_MS.success,
        type: "info",
      });
      return;
    }
    const seen = new Set<string>();
    const dup = changed.find((it) => {
      if (seen.has(it.newName)) return true;
      seen.add(it.newName);
      return false;
    });
    if (dup) {
      bus.emit("toast:show", {
        msg: "❌ " + t("dialog.renameConflict", { name: dup.newName }),
        duration: TOAST_MS.verbose,
        type: "error",
      });
      return;
    }
    const btn = thisEl.querySelector("#br-apply") as HTMLButtonElement;
    btn.textContent = "⏳ " + t("dialog.executing");
    btn.disabled = true;
    try {
      await onApply(
        changed.map((it) => ({
          oldPath: it.Path,
          oldName: it.Name,
          newName: it.newName,
        })),
      );
    } catch (e) {
      bus.emit("toast:show", {
        msg:
          "❌ " +
          t("dialog.batchRenameFailed") +
          ": " +
          friendlyError(e),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    } finally {
      btn.textContent = "📝 " + t("dialog.doRename");
      btn.disabled = false;
      closeFn();
    }
  });
}

export function showBatchRenameDialog(
  dir: string,
  entries: BatchEntry[],
  onApply: (changes: BatchRenameChange[]) => Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const items = dgBrParseItems(entries);
    const { shell, overlay, closeFn } = dgBrBuildOverlay(dir, items, resolve);

    dgBrBindParseTab(shell);
    dgBrBindReplaceTab(shell);
    dgBrBindModeSwitch(shell);
    dgBrBindCancelAndOutside(shell, overlay, closeFn);
    dgBrBindApplyClick(shell, overlay, onApply, closeFn);

    dgBrUpdateAll(items);
    if (items[0]) {
      if (shell.batchAuthor) shell.batchAuthor.value = items[0].p.author;
      if (shell.batchWork) shell.batchWork.value = items[0].p.work;
    }
    dgBrRenderPreview(shell.previewEl, items);
    dgBrUpdateCount(items);
  });
}
