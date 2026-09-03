// ===== 模型标签编辑弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 读取/写入模型标签，支持输入新标签和选择已有标签
import { esc } from "../../utils/dom/html.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { closeDlg, registerDlg } from "./modal.ts";
import { getApp } from "../../backend/app.ts";
import { addTagToSet } from "./tag-set.ts";
import { t } from "../../core/i18n/t.ts";

interface DgTeShell {
  overlay: HTMLDivElement;
  box: HTMLDivElement;
  errEl: HTMLElement;
  tagsEl: HTMLElement;
  inputEl: HTMLInputElement;
  suggestEl: HTMLElement;
  tags: string[];
  loading: boolean;
  loadFailed: boolean;
  disposed: boolean;
  close: (result: string[] | null) => void;
}

function dgTeRenderTags(shell: DgTeShell): void {
  shell.tagsEl.innerHTML = shell.tags
    .map(
      (tag) =>
        '<span class="te-tag">' +
        esc(tag) +
        '<button class="te-tag-del" data-tag="' +
        esc(tag) +
        '">✕</button>' +
        "</span>",
    )
    .join("");
  shell.tagsEl.querySelectorAll(".te-tag-del").forEach((btn) => {
    (btn as HTMLElement).onclick = (): void => {
      const tag = (btn as HTMLElement).dataset.tag;
      shell.tags = shell.tags.filter((x) => x !== tag);
      dgTeRenderTags(shell);
    };
  });
}

function dgTeRenderSuggestions(shell: DgTeShell, allTags: string[]): void {
  const unused = allTags.filter((tag) => !shell.tags.includes(tag));
  shell.suggestEl.innerHTML = unused.length
    ? unused
        .map(
          (tag) =>
            '<button class="te-sug-btn" data-tag="' +
            esc(tag) +
            '">+' +
            esc(tag) +
            "</button>",
        )
        .join("")
    : '<span style="color:var(--muted)">' + t("dialog.noOtherTags") + "</span>";
  shell.suggestEl.querySelectorAll(".te-sug-btn").forEach((btn) => {
    (btn as HTMLElement).onclick = (): void => {
      const tag = (btn as HTMLElement).dataset.tag;
      if (tag && !shell.tags.includes(tag)) {
        shell.tags = [...shell.tags, tag].sort();
        dgTeRenderTags(shell);
      }
    };
  });
}

function dgTeAddTag(shell: DgTeShell, raw: string): void {
  if (!raw.trim()) return;
  const r = addTagToSet(shell.tags, raw);
  if (r.error) {
    shell.errEl.textContent = r.error;
    return;
  }
  shell.tags = r.tags;
  shell.errEl.textContent = "";
  dgTeRenderTags(shell);
  shell.inputEl.value = "";
}

function dgTeBuildShell(
  modelPath: string,
  resolve: (value: string[] | null) => void,
): DgTeShell {
  const overlay = document.createElement("div");
  overlay.className = "dlg-overlay";

  const box = document.createElement("div");
  box.className = "dlg-box dlg-pad";
  box.style.cssText =
    "gap:10px;width:380px;max-height:80vh;display:flex;flex-direction:column";

  box.innerHTML = `
    <div class="dlg-title" style="margin:0">🏷️ ${t("dialog.editTags")}</div>
    <div style="font-size:10px;color:var(--muted);word-break:break-all">${esc(modelPath)}</div>

    <div id="te-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;padding:4px;border:1px solid var(--bd);border-radius:5px;background:var(--bg);align-content:flex-start"></div>

    <div style="display:flex;gap:4px">
      <input id="te-input" maxlength="20" placeholder="${t("dialog.tagInputHint")}" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
      <button id="te-add" class="dlg-btn dlg-btn-primary" style="padding:4px 10px">+ ${t("dialog.add")}</button>
    </div>

    <details style="font-size:10px">
      <summary style="cursor:pointer;color:var(--muted)">📋 ${t("dialog.existingTags")}</summary>
      <div id="te-suggest" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 0"></div>
    </details>

    <div id="te-err" class="dlg-err"></div>

    <div class="dlg-footer" style="padding:0;display:flex;gap:6px">
      <button id="te-cancel" class="dlg-btn">${t("common.cancel")}</button>
      <button id="te-save" class="dlg-btn dlg-btn-primary">💾 ${t("common.save")}</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const shell: DgTeShell = {
    overlay,
    box,
    errEl: box.querySelector("#te-err") as HTMLElement,
    tagsEl: box.querySelector("#te-tags") as HTMLElement,
    inputEl: box.querySelector("#te-input") as HTMLInputElement,
    suggestEl: box.querySelector("#te-suggest") as HTMLElement,
    tags: [],
    loading: true,
    loadFailed: false,
    disposed: false,
    close: () => {},
  };

  shell.close = (result: string[] | null): void => {
    shell.disposed = true;
    closeDlg(overlay, resolve, result);
  };

  overlay.onclick = (e: MouseEvent): void => {
    if (e.target === overlay) shell.close(null);
  };
  overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") shell.close(null);
  });

  registerDlg(overlay, () => closeDlg(overlay, resolve, null));

  return shell;
}

function dgTeLoadData(shell: DgTeShell, modelPath: string): void {
  (async () => {
    const addBtn = shell.box.querySelector("#te-add") as HTMLButtonElement | null;
    const saveBtn = shell.box.querySelector("#te-save") as HTMLButtonElement | null;
    shell.inputEl.disabled = true;
    if (addBtn) addBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const App = await getApp();
      if (shell.disposed) return;
      shell.tags = (await App.GetModelTags(modelPath)) || [];
      if (shell.disposed) return;
      dgTeRenderTags(shell);
      const allTags = (await App.AllTags()) || [];
      if (shell.disposed) return;
      dgTeRenderSuggestions(shell, allTags);
    } catch (e) {
      shell.loadFailed = true;
      shell.errEl.textContent =
        "⚠️ " + t("dialog.tagsLoadFailed") + ": " + friendlyError(e);
    } finally {
      shell.loading = false;
      if (shell.disposed) return;
      shell.inputEl.disabled = false;
      if (addBtn) addBtn.disabled = false;
      if (!shell.loadFailed && saveBtn) saveBtn.disabled = false;
      shell.inputEl.focus();
    }
  })();
}

function dgTeBindEvents(shell: DgTeShell, modelPath: string): void {
  shell.inputEl.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      dgTeAddTag(shell, shell.inputEl.value);
    }
  });
  (shell.box.querySelector("#te-add") as HTMLElement).onclick = (): void =>
    dgTeAddTag(shell, shell.inputEl.value);

  (shell.box.querySelector("#te-cancel") as HTMLElement).onclick = (): void =>
    shell.close(null);

  (shell.box.querySelector("#te-save") as HTMLElement).onclick =
    async (): Promise<void> => {
      if (shell.loadFailed) {
        shell.errEl.textContent = "⚠️ " + t("dialog.tagsLoadRetry");
        return;
      }
      try {
        const App = await getApp();
        if (shell.disposed) return;
        await App.SetModelTags(modelPath, shell.tags);
        if (shell.disposed) return;
        shell.close(shell.tags);
      } catch (e) {
        shell.errEl.textContent =
          "⚠️ " + t("dialog.tagsSaveFailed") + ": " + friendlyError(e);
      }
    };
}

/**
 * 弹出标签编辑弹窗
 * @param modelPath 模型文件路径
 * @returns 保存后的标签列表，取消返回 null
 */
export function modalTagEditor(modelPath: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const shell = dgTeBuildShell(modelPath, resolve);
    dgTeLoadData(shell, modelPath);
    dgTeBindEvents(shell, modelPath);
  });
}
