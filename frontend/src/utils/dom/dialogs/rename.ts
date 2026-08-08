// ===== 模型重命名对话框（类型化版 — ADR-014 P3 dialogs）=====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../../../utils/dom/display.ts";
import { closeDlg, registerDlg, esc } from "./modal.ts";
import { getApp } from "../../../wails/app.ts";
import { RESOURCE_TYPES } from "../../../utils/resource/types.ts";

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

    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.className = "dlg-overlay";
    const close = (v: string | null): void => closeDlg(overlay, resolve, v);
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) close(null);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
      // P3 修复：Enter 键接线——按钮文案「重命名 (Enter)」但原实现只处理 Escape，
      // 键盘 Enter 无法提交（与按钮 onclick 共享同一校验/关闭路径）
      else if (e.key === "Enter") {
        e.preventDefault();
        (box.querySelector("#rn-ok") as HTMLElement | null)?.click();
      }
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad dlg-gap";

    box.innerHTML = `
      <div class="dlg-title">
        <span>✂️ 重命名模型</span>
        <button id="rn-from-header" class="dlg-btn-sm" title="从 YSM 文件头部读取作者/介绍">📖 读取头部</button>
      </div>
      <div class="dlg-sub">${esc(currentName)}</div>
      <div class="dlg-row">
        <input id="rn-author" class="dlg-input-bg" style="flex:2" placeholder="作者" value="${esc(parsed.author)}">
        <input id="rn-work" class="dlg-input-bg" style="flex:2" placeholder="品牌" value="${esc(parsed.work === "未知" ? "" : parsed.work)}">
        <input id="rn-chara" class="dlg-input-bg" style="flex:2" placeholder="角色" value="${esc(parsed.chara)}">
        <input id="rn-variant" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="变体">
        <input id="rn-date" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="年月" value="${esc(parsed.date)}">
      </div>
      <div id="rn-tips" class="dlg-tips"></div>
      <div class="dlg-preview-box">
        <span class="dlg-preview-old">${esc(currentName)}</span> → <span id="rn-preview" class="dlg-preview-new">-</span>
      </div>
      <div class="dlg-footer" style="margin-top:2px">
        <button id="rn-cancel" class="dlg-btn">取消 (Esc)</button>
        <button id="rn-ok" class="dlg-btn dlg-btn-primary">✂️ 重命名 (Enter)</button>
      </div>
      <div id="rn-err" class="dlg-err"></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));
    overlay.focus();

    // 从 YSM 文件头部读取元数据（仅填充第一位作者，展示介绍）
    (box.querySelector("#rn-from-header") as HTMLElement).onclick =
      async (): Promise<void> => {
        if (!filePath) {
          const tipsEl = box.querySelector("#rn-tips") as HTMLElement;
          tipsEl.textContent = "⚠️ 文件尚未导入，无法读取头部";
          tipsEl.style.display = "block";
          return;
        }
        try {
          const btn = box.querySelector("#rn-from-header") as HTMLButtonElement;
          btn.textContent = "⏳ 读取中...";
          btn.disabled = true;
          const App = await getApp();
          const header = await App.ExtractYSMHeader(filePath);
          if (header?.isYsm) {
            const authorEl = box.querySelector("#rn-author") as HTMLInputElement;
            const tipsEl = box.querySelector("#rn-tips") as HTMLElement;
            // 仅当作者为空时自动填入第一位作者
            if (header.authorName && !authorEl.value.trim()) {
              authorEl.value = header.authorName;
            }
            // 展示介绍（只读参考）
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
            tipsEl.textContent = "⚠️ 读取失败，文件可能不是有效 YSM";
            tipsEl.style.display = "block";
          }
        } finally {
          const btn = box.querySelector("#rn-from-header") as HTMLButtonElement | null;
          if (btn) {
            btn.textContent = "📖 读取头部";
            btn.disabled = false;
          }
        }
      };

    const update = (): void => {
      const a = (box.querySelector("#rn-author") as HTMLInputElement).value.trim();
      const w = (box.querySelector("#rn-work") as HTMLInputElement).value.trim();
      const c = (box.querySelector("#rn-chara") as HTMLInputElement).value.trim();
      const v = (box.querySelector("#rn-variant") as HTMLInputElement).value.trim();
      const d = (box.querySelector("#rn-date") as HTMLInputElement).value.trim();
      const ext = currentName.includes(".")
        ? currentName.split(".").pop()
        : RESOURCE_TYPES.YSM;
      const parts: string[] = [];
      if (a) parts.push("[" + a + "]");
      parts.push("【" + (w || "未知") + "】");
      parts.push(c || "?");
      if (v) parts.push("-" + v);
      if (d) parts.push(" (" + d + ")");
      (box.querySelector("#rn-preview") as HTMLElement).textContent =
        parts.join("") + "." + ext;
    };

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
    update();

    (box.querySelector("#rn-cancel") as HTMLElement).onclick = (): void =>
      close(null);
    (box.querySelector("#rn-ok") as HTMLElement).onclick = async (): Promise<void> => {
      const a = (box.querySelector("#rn-author") as HTMLInputElement).value.trim();
      const w = (box.querySelector("#rn-work") as HTMLInputElement).value.trim();
      const c = (box.querySelector("#rn-chara") as HTMLInputElement).value.trim();
      const v = (box.querySelector("#rn-variant") as HTMLInputElement).value.trim();
      const d = (box.querySelector("#rn-date") as HTMLInputElement).value.trim();
      const ext = currentName.includes(".")
        ? currentName.split(".").pop()
        : RESOURCE_TYPES.YSM;
      if (!a || !c) {
        const errEl = box.querySelector("#rn-err") as HTMLElement | null;
        if (errEl) errEl.textContent = "⚠️ 作者、角色名不能为空";
        const focusEl = box.querySelector(
          !a ? "#rn-author" : "#rn-chara",
        ) as HTMLElement | null;
        focusEl?.focus();
        return;
      }
      // 检查非法字符
      const illegal = /[<>:"\\|?*\/\u0000-\u001f]/;
      const allFields = [a, w, c, v, d].filter(Boolean);
      if (allFields.some((f) => illegal.test(f))) {
        const errEl = box.querySelector("#rn-err") as HTMLElement | null;
        if (errEl)
          errEl.textContent =
            '⚠️ 文件名不能包含 < > : " / \\ | ? * 等字符';
        return;
      }
      // 检查新文件名长度
      const newName =
        "[" +
        a +
        "]【" +
        (w || "未知") +
        "】" +
        c +
        (v ? "-" + v : "") +
        (d ? " (" + d + ")" : "") +
        "." +
        ext;
      if (newName.length > 255) {
        const errEl = box.querySelector("#rn-err") as HTMLElement | null;
        if (errEl)
          errEl.textContent =
            "⚠️ 文件名过长（" + newName.length + " 字符），请精简";
        return;
      }
      close(newName);
    };
  });
}
