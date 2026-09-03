// ===== 模型重命名对话框（类型化版 — ADR-014 P3 dialogs）=====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../../utils/dom/display.ts";
import { esc } from "../../utils/dom/html.ts";
import { closeDlg, registerDlg } from "./modal.ts";
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { buildRenameName, validateRenameFields, type RenameFields } from "./rename-format.ts";
import { t } from "../../core/i18n/t.ts";

type DgRnCloseFn = (v: string | null) => void;
type DgRnReadFn = () => RenameFields;
type DgRnGetExtFn = () => string;
type DgRnUpdateFn = () => void;

function dgRnCreateOverlay(
  resolve: (v: string | null) => void,
  box: HTMLDivElement,
): { overlay: HTMLDivElement; close: DgRnCloseFn } {
  const overlay = document.createElement("div");
  overlay.tabIndex = 0;
  overlay.className = "dlg-overlay";
  const close: DgRnCloseFn = (v) => closeDlg(overlay, resolve, v);
  overlay.onclick = (e: MouseEvent): void => {
    if (e.target === overlay) close(null);
  };
  overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") close(null);
    else if (
      e.key === "Enter" &&
      !(e.target instanceof HTMLButtonElement) &&
      !e.isComposing
    ) {
      e.preventDefault();
      (box.querySelector("#rn-ok") as HTMLElement | null)?.click();
    }
  });
  return { overlay, close };
}

function dgRnBuildDialogBox(
  parsed: ReturnType<typeof parseModelName>,
  currentName: string,
): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "dlg-box dlg-pad dlg-gap";
  box.innerHTML = `
      <div class="dlg-title">
        <span>✂️ ${t("dialog.renameModel")}</span>
        <button id="rn-from-header" class="dlg-btn-sm" title="${t("dialog.readHeaderTitle")}">📖 ${t("dialog.readHeader")}</button>
      </div>
      <div class="dlg-sub">${esc(currentName)}</div>
      <div class="dlg-row">
        <input id="rn-author" class="dlg-input-bg" style="flex:2" placeholder="${t("import.author")}" value="${esc(parsed.author)}">
        <input id="rn-work" class="dlg-input-bg" style="flex:2" placeholder="${t("import.brand")}" value="${esc(parsed.work === "未知" ? "" : parsed.work)}">
        <input id="rn-chara" class="dlg-input-bg" style="flex:2" placeholder="${t("dialog.chara")}" value="${esc(parsed.chara)}">
        <input id="rn-variant" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="${t("import.variant")}">
        <input id="rn-date" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="${t("import.date")}" value="${esc(parsed.date)}">
      </div>
      <div id="rn-tips" class="dlg-tips"></div>
      <div class="dlg-preview-box">
        <span class="dlg-preview-old">${esc(currentName)}</span> → <span id="rn-preview" class="dlg-preview-new">-</span>
      </div>
      <div class="dlg-footer" style="margin-top:2px">
        <button id="rn-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="rn-ok" class="dlg-btn dlg-btn-primary">✂️ ${t("dialog.renameEnter")}</button>
      </div>
      <div id="rn-err" class="dlg-err"></div>
    `;
  return box;
}

function dgRnBindReadHeaderBtn(
  filePath: string | null,
  overlay: HTMLDivElement,
  box: HTMLDivElement,
  update: DgRnUpdateFn,
): void {
  (box.querySelector("#rn-from-header") as HTMLElement).onclick =
    async (): Promise<void> => {
      if (!filePath) {
        const tipsEl = box.querySelector("#rn-tips") as HTMLElement;
        tipsEl.textContent = "⚠️ " + t("dialog.notImported");
        tipsEl.style.display = "block";
        return;
      }
      try {
        const btn = box.querySelector("#rn-from-header") as HTMLButtonElement;
        btn.textContent = "⏳ " + t("dialog.reading");
        btn.disabled = true;
        const App = await getApp();
        const header = await App.ExtractYSMHeader(filePath);
        if (!overlay.isConnected) return;
        if (header?.isYsm) {
          const authorEl = box.querySelector("#rn-author") as HTMLInputElement;
          const tipsEl = box.querySelector("#rn-tips") as HTMLElement;
          if (header.authorName && !authorEl.value.trim()) {
            authorEl.value = header.authorName;
          }
          if (header.tips) {
            tipsEl.textContent = "📝 " + header.tips;
            tipsEl.style.display = "block";
          } else {
            tipsEl.style.display = "none";
          }
          update();
        }
      } catch (_) {
        const tipsEl = box.querySelector("#rn-tips") as HTMLElement | null;
        if (tipsEl) {
          tipsEl.textContent = "⚠️ " + t("dialog.readFailed");
          tipsEl.style.display = "block";
        }
      } finally {
        const btn = box.querySelector("#rn-from-header") as HTMLButtonElement | null;
        if (btn) {
          btn.textContent = "📖 " + t("dialog.readHeader");
          btn.disabled = false;
        }
      }
    };
}

function dgRnReadFields(box: HTMLDivElement): RenameFields {
  return {
    author: (box.querySelector("#rn-author") as HTMLInputElement).value.trim(),
    work: (box.querySelector("#rn-work") as HTMLInputElement).value.trim(),
    chara: (box.querySelector("#rn-chara") as HTMLInputElement).value.trim(),
    variant: (box.querySelector("#rn-variant") as HTMLInputElement).value.trim(),
    date: (box.querySelector("#rn-date") as HTMLInputElement).value.trim(),
  };
}

function dgRnMakeExtCtx(
  currentName: string,
): { disableTail: string; getExt: DgRnGetExtFn } {
  const disableMatch = currentName.match(/\.(disabled|ban)$/i);
  const isBanned = !!disableMatch;
  const disableTail = isBanned ? disableMatch![0] : "";
  const getExt: DgRnGetExtFn = () => {
    const clean = currentName.replace(/\.(disabled|ban)$/i, "");
    const ext = clean.includes(".")
      ? clean.split(".").pop() || ""
      : "";
    return ext || RESOURCE_TYPES.YSM;
  };
  return { disableTail, getExt };
}

function dgRnUpdatePreview(
  box: HTMLDivElement,
  readFn: DgRnReadFn,
  getExt: DgRnGetExtFn,
  disableTail: string,
): void {
  (box.querySelector("#rn-preview") as HTMLElement).textContent =
    buildRenameName(readFn(), getExt()) + disableTail;
}

function dgRnBindFieldInputs(
  box: HTMLDivElement,
  update: DgRnUpdateFn,
): void {
  ["rn-author", "rn-work", "rn-chara", "rn-variant", "rn-date"].forEach(
    (id) => {
      const el = box.querySelector("#" + id) as HTMLInputElement | null;
      el?.addEventListener("input", update);
      el?.addEventListener("input", (): void => {
        const errEl = box.querySelector("#rn-err") as HTMLElement | null;
        if (errEl) errEl.textContent = "";
      });
    },
  );
}

function dgRnBindOkCancel(
  close: DgRnCloseFn,
  box: HTMLDivElement,
  readFn: DgRnReadFn,
  getExt: DgRnGetExtFn,
  disableTail: string,
): void {
  (box.querySelector("#rn-cancel") as HTMLElement).onclick = (): void =>
    close(null);
  (box.querySelector("#rn-ok") as HTMLElement).onclick = async (): Promise<void> => {
    const f = readFn();
    const ext = getExt();
    const err = validateRenameFields(f, ext);
    if (err) {
      const errEl = box.querySelector("#rn-err") as HTMLElement | null;
      if (errEl) errEl.textContent = err;
      if (!f.author || !f.chara) {
        const focusEl = box.querySelector(
          !f.author ? "#rn-author" : "#rn-chara",
        ) as HTMLElement | null;
        focusEl?.focus();
      }
      return;
    }
    close(buildRenameName(f, ext) + disableTail);
  };
}

/**
 * 弹出重命名对话框
 * @param filePath 模型文件路径
 * @param currentName 当前文件名
 * @returns 新文件名，取消返回 null
 */
export async function showRenameDialog(
  filePath: string | null,
  currentName: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const parsed = parseModelName(currentName);
    const box = dgRnBuildDialogBox(parsed, currentName);
    const { overlay, close } = dgRnCreateOverlay(resolve, box);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));
    overlay.focus();

    const { disableTail, getExt } = dgRnMakeExtCtx(currentName);
    const readFn: DgRnReadFn = () => dgRnReadFields(box);
    const update: DgRnUpdateFn = () =>
      dgRnUpdatePreview(box, readFn, getExt, disableTail);

    dgRnBindReadHeaderBtn(filePath, overlay, box, update);
    dgRnBindFieldInputs(box, update);
    dgRnBindOkCancel(close, box, readFn, getExt, disableTail);
    update();
  });
}
