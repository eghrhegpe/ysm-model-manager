// ===== 模型标签编辑弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 读取/写入模型标签，支持输入新标签和选择已有标签
import { esc } from "../../../utils/dom/html.ts";
import { closeDlg, registerDlg } from "./modal.ts";
import { getApp } from "../../../wails/app.ts";
import { addTagToSet } from "./tag-set.ts";
import { t } from "../../../core/i18n/t.ts";

/**
 * 弹出标签编辑弹窗
 * @param modelPath 模型文件路径
 * @returns 保存后的标签列表，取消返回 null
 */
export function modalTagEditor(modelPath: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) close(null);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.cssText =
      "gap:10px;width:380px;max-height:80vh;display:flex;flex-direction:column";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">🏷️ ${t("dialog.editTags")}</div>
      <div style="font-size:10px;color:var(--muted);word-break:break-all">${esc(modelPath)}</div>

      <div id="te-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:28px;padding:4px;border:1px solid var(--bd);border-radius:5px;background:var(--bg);align-content:flex-start"></div>

      <div style="display:flex;gap:4px">
        <input id="te-input" maxlength="20" placeholder="输入标签后按 Enter" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <button id="te-add" class="dlg-btn dlg-btn-primary" style="padding:4px 10px">+ 添加</button>
      </div>

      <details style="font-size:10px">
        <summary style="cursor:pointer;color:var(--muted)">📋 已有标签（点击添加）</summary>
        <div id="te-suggest" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 0"></div>
      </details>

      <div id="te-err" class="dlg-err"></div>

      <div class="dlg-footer" style="padding:0;display:flex;gap:6px">
        <button id="te-cancel" class="dlg-btn">取消</button>
        <button id="te-save" class="dlg-btn dlg-btn-primary">💾 保存</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));

    const errEl = box.querySelector("#te-err") as HTMLElement;
    const tagsEl = box.querySelector("#te-tags") as HTMLElement;
    const inputEl = box.querySelector("#te-input") as HTMLInputElement;
    const suggestEl = box.querySelector("#te-suggest") as HTMLElement;

    let tags: string[] = [];
    // P2 修复（code_review）：loading 标志——保存按钮在加载完成前禁用，
    // 否则 tags 仍为初始 [] 时点保存会 SetModelTags(path, [])，
    // 后端把空列表当「删除条目」→ 该模型全部标签被永久清除（数据丢失）
    let loading = true;
    // P2 修复：加载失败标志——GetModelTags/AllTags 抛错后 tags 仍是 []，
    // 若此时恢复保存按钮，点保存同样 SetModelTags(path, []) 清空标签（数据丢失）。
    // 失败路径必须保持保存禁用，直到重新打开对话框。
    let loadFailed = false;

    // === 加载 ===
    (async () => {
      const addBtn = box.querySelector("#te-add") as HTMLButtonElement | null;
      const saveBtn = box.querySelector("#te-save") as HTMLButtonElement | null;
      // P3 修复：加载期间禁用输入/添加/保存——GetModelTags 异步返回晚于用户输入时
      // `tags = [...]` 会覆写用户已编辑内容（竞态）；加载完成后再启用
      inputEl.disabled = true;
      if (addBtn) addBtn.disabled = true;
      if (saveBtn) saveBtn.disabled = true;
      try {
        const App = await getApp();
        tags = (await App.GetModelTags(modelPath)) || [];
        renderTags();
        const allTags = (await App.AllTags()) || [];
        renderSuggestions(allTags);
      } catch (e) {
        loadFailed = true;
        errEl.textContent = "⚠️ " + t("dialog.tagsLoadFailed") + ": " + (e as Error).message;
      } finally {
        loading = false;
        inputEl.disabled = false;
        if (addBtn) addBtn.disabled = false;
        // P2：加载失败不恢复保存按钮——空 tags 保存 = 清空该模型标签
        if (!loadFailed && saveBtn) saveBtn.disabled = false;
        inputEl.focus();
      }
    })();

    function renderTags(): void {
      tagsEl.innerHTML = tags
        .map(
          (t) =>
            '<span class="te-tag">' +
            esc(t) +
            '<button class="te-tag-del" data-tag="' +
            esc(t) +
            '">✕</button>' +
            "</span>",
        )
        .join("");
      tagsEl.querySelectorAll(".te-tag-del").forEach((btn) => {
        (btn as HTMLElement).onclick = (): void => {
          const t = (btn as HTMLElement).dataset.tag;
          tags = tags.filter((x) => x !== t);
          renderTags();
        };
      });
    }

    function renderSuggestions(allTags: string[]): void {
      const unused = allTags.filter((t) => !tags.includes(t));
      suggestEl.innerHTML = unused.length
        ? unused
            .map(
              (t) =>
                '<button class="te-sug-btn" data-tag="' +
                esc(t) +
                '">+' +
                esc(t) +
                "</button>",
            )
            .join("")
        : '<span style="color:var(--muted)">暂无其他标签</span>';
      suggestEl.querySelectorAll(".te-sug-btn").forEach((btn) => {
        (btn as HTMLElement).onclick = (): void => {
          const t = (btn as HTMLElement).dataset.tag;
          if (t && !tags.includes(t)) {
            tags = [...tags, t].sort();
            renderTags();
          }
        };
      });
    }

    function addTag(raw: string): void {
      if (!raw.trim()) return; // 空输入静默（原实现行为）
      const r = addTagToSet(tags, raw);
      if (r.error) {
        errEl.textContent = r.error;
        return;
      }
      tags = r.tags;
      errEl.textContent = "";
      renderTags();
      inputEl.value = "";
    }

    inputEl.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        addTag(inputEl.value);
      }
    });
    (box.querySelector("#te-add") as HTMLElement).onclick = (): void =>
      addTag(inputEl.value);

    const close = (result: string[] | null): void =>
      closeDlg(overlay, resolve, result);

    (box.querySelector("#te-cancel") as HTMLElement).onclick = (): void =>
      close(null);
    (box.querySelector("#te-save") as HTMLElement).onclick = async (): Promise<void> => {
      // P2 双保险：即使按钮状态被绕过，加载失败也拒绝保存（空列表写回 = 清空标签）
      if (loadFailed) {
        errEl.textContent = "⚠️ 标签加载失败，请重新打开对话框再保存";
        return;
      }
      try {
        const App = await getApp();
        await App.SetModelTags(modelPath, tags);
        close(tags);
      } catch (e) {
        errEl.textContent = "⚠️ " + t("dialog.tagsSaveFailed") + ": " + (e as Error).message;
      }
    };
  });
}
