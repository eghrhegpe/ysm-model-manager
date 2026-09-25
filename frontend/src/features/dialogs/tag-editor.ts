// ===== 模型标签编辑弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 读取/写入模型标签，支持输入新标签和选择已有标签
// ADR-190 D2 注入真化 + ADR-208 D1（R5 门禁）：生产默认 getApp 经 backend-deps seam 单出口

import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { createDialog } from "@/utils/dom/modal-core.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { dialogsGetApp } from "./dialogs-deps.ts";
import { addTagToSet } from "./tag-set.ts";

type GetAppFn = typeof dialogsGetApp;

interface DgTeShell {
  overlay: HTMLElement;
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
        '">' +
        UI_ICONS.close + // ADR-238 §1.4：结构槽图标位走 SVG（原字面 glyph "✕"）
        "</button>" +
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
        .map((tag) => `<button class="te-sug-btn" data-tag="${esc(tag)}">+${esc(tag)}</button>`)
        .join("")
    : `<span class="te-suggest-empty">${t("dialog.noOtherTags")}</span>`;
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

/** 弹窗内容区 HTML（标题行由 createDialog 统一渲染 — ADR-190 D3；样式全部走 components.css） */
function dgTeBuildBoxHTML(modelPath: string): string {
  return `
    <div class="te-path">${esc(modelPath)}</div>

    <div id="te-tags" class="te-tags"></div>

    <div class="te-input-row">
      <input id="te-input" class="te-input" maxlength="20" placeholder="${t("dialog.tagInputHint")}">
      <button id="te-add" class="dlg-btn dlg-btn-primary te-add-btn">+ ${t("dialog.add")}</button>
    </div>

    <details class="te-suggest-details">
      <summary class="te-suggest-summary">${UI_ICONS.tag} ${t("dialog.existingTags")}</summary>
      <div id="te-suggest" class="te-suggest-wrap"></div>
    </details>

    <div id="te-err" class="dlg-err"></div>

    <div class="dlg-footer te-footer">
      <button id="te-cancel" class="dlg-btn">${t("common.cancel")}</button>
      <button id="te-save" class="dlg-btn dlg-btn-primary">${UI_ICONS.save} ${t("common.save")}</button>
    </div>
  `;
}

function dgTeBuildShell(modelPath: string, resolve: (value: string[] | null) => void): DgTeShell {
  let shell!: DgTeShell;
  const {
    overlay,
    box,
    close: settleClose,
  } = createDialog<string[] | null>({
    title: t("dialog.editTags"),
    titleIcon: "tag",
    boxClass: "dlg-box dlg-pad te-box", // 语义类保留,补充布局在 .te-box
    tabIndex: 0,
    cancelValue: null,
    resolve,
    // Esc / 遮罩关闭也须同步置 disposed，防异步链继续写已卸载 DOM（与按钮路径同规）
    onClose: () => {
      shell.disposed = true;
    },
    buildBox: (el) => {
      el.innerHTML = dgTeBuildBoxHTML(modelPath);
    },
  });

  shell = {
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
    close: (result: string[] | null): void => settleClose(result),
  };

  return shell;
}

function dgTeLoadData(shell: DgTeShell, modelPath: string, getApp: GetAppFn): void {
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
      shell.errEl.textContent = `⚠️ ${t("dialog.tagsLoadFailed")}: ${friendlyError(e)}`;
    } finally {
      shell.loading = false;
      // biome-ignore lint/correctness/noUnsafeFinally: shell 已销毁时提前返回，跳过按钮恢复（有意守卫）
      if (shell.disposed) return;
      shell.inputEl.disabled = false;
      if (addBtn) addBtn.disabled = false;
      if (!shell.loadFailed && saveBtn) saveBtn.disabled = false;
      shell.inputEl.focus();
    }
  })();
}

function dgTeBindEvents(shell: DgTeShell, modelPath: string, getApp: GetAppFn): void {
  shell.inputEl.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      dgTeAddTag(shell, shell.inputEl.value);
    }
  });
  (shell.box.querySelector("#te-add") as HTMLElement).onclick = (): void =>
    dgTeAddTag(shell, shell.inputEl.value);

  (shell.box.querySelector("#te-cancel") as HTMLElement).onclick = (): void => shell.close(null);

  (shell.box.querySelector("#te-save") as HTMLElement).onclick = async (): Promise<void> => {
    if (shell.loadFailed) {
      shell.errEl.textContent = `⚠️ ${t("dialog.tagsLoadRetry")}`;
      return;
    }
    try {
      const App = await getApp();
      if (shell.disposed) return;
      await App.SetModelTags(modelPath, shell.tags);
      if (shell.disposed) return;
      shell.close(shell.tags);
    } catch (e) {
      shell.errEl.textContent = `⚠️ ${t("dialog.tagsSaveFailed")}: ${friendlyError(e)}`;
    }
  };
}

/**
 * 弹出标签编辑弹窗
 * @param modelPath 模型文件路径
 * @returns 保存后的标签列表，取消返回 null
 */
export function modalTagEditor(
  modelPath: string,
  /** 依赖注入（ADR-190 D2）：测试可注入 getApp 替身，缺省走生产实现 */
  deps?: { getApp?: GetAppFn },
): Promise<string[] | null> {
  const getAppFn = deps?.getApp || dialogsGetApp;
  return new Promise((resolve) => {
    const shell = dgTeBuildShell(modelPath, resolve);
    dgTeLoadData(shell, modelPath, getAppFn);
    dgTeBindEvents(shell, modelPath, getAppFn);
  });
}
