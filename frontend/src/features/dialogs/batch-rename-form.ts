// ===== 批量重命名弹窗 — 表单接线层（ADR-040 ≤400 行红线拆分，ADR-208 D2）=====
// 自 batch-rename.ts 拆出：解析/替换模式的状态更新 + 预览渲染 + 五组事件绑定（DOM 胶水）。
// HTML 模板经 BatchRenameTpl 注入（views/app-tree/tpl-batch-rename.ts，ADR-190 D1a），
// 本模块不产 HTML；#br-changed 等查询改走 shell.overlay（不再 document 全局 id）。
// 方向：batch-rename.ts（公共 API + 壳）单向 import 本模块；本模块对核心文件仅 type-only 依赖。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type {
  BatchItem,
  BatchRenameChange,
  BatchRenameTpl,
  BrRowView,
  DgBrShell,
} from "./batch-rename.ts";
import { applyReplaceToName, rebuildParsedName } from "./batch-rename-util.ts";

/** 全量应用解析字段（作者/作品）重算每行 newName */
function dgBrUpdateAll(items: BatchItem[]): void {
  items.forEach((it) => {
    it.newName = rebuildNames(it);
    it.changed = it.newName !== it.Name;
  });
}

/** 重建解析名（薄委托：保留 rebuildParsedName 单一事实源） */
function rebuildNames(it: BatchItem): string {
  return rebuildParsedName(it.Name, it.p, { author: it._author, work: it._work });
}

/** 替换模式：按查找/替换（可正则）改写每行 newName；正则错误在 #br-changed 上打标 + toast（仅一次） */
function dgBrApplyReplace(
  items: BatchItem[],
  overlay: HTMLElement | null,
  findText: string,
  replaceText: string,
  isRegex: boolean,
): void {
  if (!findText) return;
  const cnt = overlay?.querySelector("#br-changed") as HTMLElement | null;
  if (cnt) delete cnt.dataset.regexErr;
  items.forEach((it) => {
    const r = applyReplaceToName(it.Name, findText, replaceText, isRegex);
    if (!r.ok) {
      const cnt2 = overlay?.querySelector("#br-changed") as HTMLElement | null;
      if (cnt2 && !cnt2.dataset.regexErr) {
        cnt2.dataset.regexErr = "1";
        bus.emit("toast:show", {
          msg: `${t("dialog.regexInvalid")}`,
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

/** 更新 #br-changed 计数（选中且变更的行数） */
function dgBrUpdateCount(items: BatchItem[], overlay: HTMLElement | null): void {
  const sel = items.filter((it) => it.selected && it.changed).length;
  const cnt = overlay?.querySelector("#br-changed") as HTMLElement | null;
  if (cnt) cnt.textContent = String(sel);
}

/** 渲染预览区（模板经 tpl.previewHTML 注入，features 不自渲染 — ADR-190 D1a） */
function dgBrRenderPreview(
  el: HTMLElement | null,
  items: BatchItem[],
  overlay: HTMLElement | null,
  tpl: BatchRenameTpl,
): void {
  if (!el) return;
  const changed = items.filter((it) => it.changed).length;
  const cnt = overlay?.querySelector("#br-changed") as HTMLElement | null;
  if (cnt) cnt.textContent = String(changed);
  const rows: BrRowView[] = items.map((it) => ({
    name: it.Name,
    newName: it.newName,
    selected: it.selected,
    changed: Boolean(it.changed),
  }));
  el.innerHTML = tpl.previewHTML(rows);

  const selectAll = el.querySelector("#br-select-all") as HTMLInputElement | null;
  if (selectAll) {
    selectAll.addEventListener("change", (): void => {
      const checked = selectAll.checked;
      // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
      items.forEach((it) => (it.selected = checked));
      // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
      el.querySelectorAll(".br-file-cb").forEach(
        (cb) => ((cb as HTMLInputElement).checked = checked),
      );
      const sel = items.filter((it) => it.selected && it.changed).length;
      const cnt2 = overlay?.querySelector("#br-changed") as HTMLElement | null;
      if (cnt2) cnt2.textContent = String(sel);
    });
  }
}

/** 批量应用（作者/作品 输入防抖 200ms）+ 行复选框 change → 计数刷新 */
function dgBrBindParseTab(shell: DgBrShell): void {
  const { items, batchAuthor, batchWork, previewEl, brTimers, overlay } = shell;
  const applyBatch = (): void => {
    const ba = batchAuthor ? batchAuthor.value.trim() : "";
    const bw = batchWork ? batchWork.value.trim() : "";
    items.forEach((it) => {
      if (ba) it._author = ba;
      if (bw) it._work = bw;
    });
    dgBrUpdateAll(items);
    dgBrRenderPreview(previewEl, items, overlay, shell.tpl);
    items.forEach((it, i) => {
      const cb = previewEl?.querySelector(`[data-ci="${i}"]`) as HTMLInputElement | null;
      if (cb) cb.checked = it.selected;
    });
    dgBrUpdateCount(items, overlay);
  };
  let brTimer: ReturnType<typeof setTimeout> | null = null;
  const applyBatchDebounced = (): void => {
    if (brTimer) clearTimeout(brTimer);
    brTimer = setTimeout(applyBatch, 200);
    brTimers[0] = brTimer;
  };
  batchAuthor?.addEventListener("input", applyBatchDebounced);
  batchWork?.addEventListener("input", applyBatchDebounced);

  previewEl?.addEventListener("change", (e: Event): void => {
    const cb = e.target as HTMLInputElement;
    if (cb.classList.contains("br-file-cb")) {
      const idx = parseInt(cb.dataset.ci || "", 10);
      if (!Number.isNaN(idx) && items[idx]) items[idx].selected = cb.checked;
      dgBrUpdateCount(items, overlay);
    }
  });
}

/** 替换模式：查找/替换/正则 输入防抖 + 预设菜单（点击预设直接应用） */
function dgBrBindReplaceTab(shell: DgBrShell): void {
  const {
    items,
    findInput,
    replaceInput,
    regexCb,
    presetsBtn,
    presetsMenu,
    previewEl,
    brTimers,
    overlay,
    tpl,
  } = shell;
  let replaceTimer: ReturnType<typeof setTimeout> | null = null;
  const applyReplaceDebounced = (): void => {
    if (replaceTimer) clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      dgBrApplyReplace(
        items,
        overlay,
        findInput?.value || "",
        replaceInput?.value || "",
        regexCb?.checked || false,
      );
      dgBrRenderPreview(previewEl, items, overlay, tpl);
      dgBrUpdateCount(items, overlay);
    }, 200);
    brTimers[1] = replaceTimer;
  };
  findInput?.addEventListener("input", applyReplaceDebounced);
  replaceInput?.addEventListener("input", applyReplaceDebounced);
  regexCb?.addEventListener("change", applyReplaceDebounced);

  presetsBtn?.addEventListener("click", (): void => {
    const show = presetsMenu?.style.display !== "flex";
    if (presetsMenu) presetsMenu.style.display = show ? "flex" : "none";
    presetsBtn.innerHTML = `${UI_ICONS.clipboard} ${show ? t("dialog.collapse") : t("dialog.presets")}`;
  });
  presetsMenu?.querySelectorAll(".br-preset").forEach((el) => {
    el.addEventListener("click", (): void => {
      const btn = el as HTMLElement;
      if (findInput) findInput.value = btn.dataset.find || "";
      if (replaceInput) replaceInput.value = btn.dataset.replace || "";
      if (regexCb) regexCb.checked = btn.dataset.regex === "1";
      if (presetsMenu) presetsMenu.style.display = "none";
      dgBrApplyReplace(
        items,
        overlay,
        findInput?.value || "",
        replaceInput?.value || "",
        regexCb?.checked || false,
      );
      dgBrRenderPreview(previewEl, items, overlay, tpl);
      dgBrUpdateCount(items, overlay);
    });
  });
}

/** 模式切换（parse/replace）：切 replace 即应用替换；切回 parse 清空作者/作品并重算 */
function dgBrBindModeSwitch(shell: DgBrShell): void {
  const {
    items,
    modeSelect,
    parseModeEl,
    replaceModeEl,
    findInput,
    replaceInput,
    regexCb,
    previewEl,
    overlay,
    tpl,
  } = shell;
  modeSelect?.addEventListener("change", (): void => {
    const isReplace = modeSelect.value === "replace";
    if (parseModeEl) parseModeEl.style.display = isReplace ? "none" : "flex";
    if (replaceModeEl) replaceModeEl.style.display = isReplace ? "flex" : "none";
    if (isReplace) {
      dgBrApplyReplace(
        items,
        overlay,
        findInput?.value || "",
        replaceInput?.value || "",
        regexCb?.checked || false,
      );
      dgBrRenderPreview(previewEl, items, overlay, tpl);
    } else {
      items.forEach((it) => {
        it._author = "";
        it._work = "";
      });
      const dlgEl = overlay;
      const authorInput = dlgEl?.querySelector("#br-batch-author") as HTMLInputElement | null;
      const workInput = dlgEl?.querySelector("#br-batch-work") as HTMLInputElement | null;
      if (authorInput) authorInput.value = "";
      if (workInput) workInput.value = "";
      dgBrUpdateAll(items);
      dgBrRenderPreview(previewEl, items, overlay, tpl);
    }
    dgBrUpdateCount(items, overlay);
  });
}

/** 取消按钮 + 遮罩点击关闭（与 createDialog 等价） */
function dgBrBindCancelAndOutside(thisEl: HTMLElement, closeFn: () => void): void {
  thisEl.querySelector("#br-cancel")?.addEventListener("click", closeFn);
  thisEl.addEventListener("click", (e: MouseEvent): void => {
    if (e.target === thisEl) closeFn();
  });
}

/** 应用按钮：冲突检测 → onApply → 结算关闭（busy 全程锁按钮） */
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
        msg: `${t("dialog.renameConflict", { name: dup.newName })}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
      return;
    }
    const btn = thisEl.querySelector("#br-apply") as HTMLButtonElement;
    btn.innerHTML = `${UI_ICONS.refresh} ${t("dialog.executing")}`;
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
        msg: `${t("dialog.batchRenameFailed")}: ${friendlyError(e)}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    } finally {
      btn.innerHTML = `${UI_ICONS.edit} ${t("dialog.doRename")}`;
      btn.disabled = false;
      closeFn();
    }
  });
}

/**
 * 表单接线单一入口（公共 API 侧唯一调用点）：五组绑定 + 初始状态（全量重算 + 首行作者/作品
 * 预填 + 首次预览 + 计数）。
 */
export function bindBatchRenameForm(
  shell: DgBrShell,
  tpl: BatchRenameTpl,
  onApply: (changes: BatchRenameChange[]) => Promise<void>,
  closeFn: () => void,
): void {
  dgBrBindParseTab(shell);
  dgBrBindReplaceTab(shell);
  dgBrBindModeSwitch(shell);
  dgBrBindCancelAndOutside(shell.overlay, closeFn);
  dgBrBindApplyClick(shell, shell.overlay, onApply, closeFn);

  dgBrUpdateAll(shell.items);
  const first = shell.items[0];
  if (first) {
    if (shell.batchAuthor) shell.batchAuthor.value = first.p.author;
    if (shell.batchWork) shell.batchWork.value = first.p.work;
  }
  dgBrRenderPreview(shell.previewEl, shell.items, shell.overlay, tpl);
  dgBrUpdateCount(shell.items, shell.overlay);
}
