// ===== 模型重命名对话框（类型化版 — ADR-014 P3 dialogs）=====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../../../utils/dom/display.ts";
import { closeDlg, registerDlg, esc } from "./modal.ts";
import { getApp } from "../../../wails/app.ts";
import { RESOURCE_TYPES } from "../../../utils/resource/types.ts";
import { buildRenameName, validateRenameFields, type RenameFields } from "./rename-format.ts";
import { t } from "../../../core/i18n/t.ts";

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
      // 键盘 Enter 无法提交（与按钮 onclick 共享同一校验/关闭路径）。
      // P2 修复（code_review）：仅当焦点不在按钮上时才转发 Enter 到 #rn-ok——
      // 聚焦在「取消 (Esc)」/「📖 读取头部」按钮时 Enter 是原生激活方式，
      // 若一律 preventDefault + 转发会把「Tab 到取消按 Enter」变成意外重命名
      else if (
        e.key === "Enter" &&
        !(e.target instanceof HTMLButtonElement) &&
        !e.isComposing
      ) {
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
          btn.textContent = "⏳ " + t("dialog.reading");
          btn.disabled = true;
          const App = await getApp();
          const header = await App.ExtractYSMHeader(filePath);
          // P2 修复（审核发现）：await 后无代际校验——弹窗在读头期间被 Esc/单例替换
          // 关闭后，结果写入已脱离 DOM 的节点（ADR-044 ①「await 后落 DOM 前必校验」）
          if (!overlay.isConnected) return;
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
            btn.textContent = "📖 " + t("dialog.readHeader");
            btn.disabled = false;
          }
        }
      };

    /** 读取五个输入框字段（update 与提交共用，避免 jscpd 重复） */
    const readFields = (): RenameFields => ({
      author: (box.querySelector("#rn-author") as HTMLInputElement).value.trim(),
      work: (box.querySelector("#rn-work") as HTMLInputElement).value.trim(),
      chara: (box.querySelector("#rn-chara") as HTMLInputElement).value.trim(),
      variant: (box.querySelector("#rn-variant") as HTMLInputElement).value.trim(),
      date: (box.querySelector("#rn-date") as HTMLInputElement).value.trim(),
    });

    /** 从当前文件名推导扩展名（无扩展名用默认资源类型） */
    const isBanned = /\.ban$/i.test(currentName);
    // P2 修复：先剥 .ban 尾缀再取扩展名——banned 文件 foo.ysm.ban 应得 "ysm" 而非 "ban"；
    // 空扩展名（如 "foo."）回退默认资源类型
    const getExt = (): string => {
      const clean = currentName.replace(/\.ban$/i, "");
      const ext = clean.includes(".")
        ? clean.split(".").pop() || ""
        : "";
      return ext || RESOURCE_TYPES.YSM;
    };

    const update = (): void => {
      (box.querySelector("#rn-preview") as HTMLElement).textContent =
        buildRenameName(readFields(), getExt()) + (isBanned ? ".ban" : "");
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
      const f = readFields();
      const ext = getExt();
      const err = validateRenameFields(f, ext);
      if (err) {
        const errEl = box.querySelector("#rn-err") as HTMLElement | null;
        if (errEl) errEl.textContent = err;
        // 仅必填缺失时聚焦对应输入框（与原实现行为一致）
        if (!f.author || !f.chara) {
          const focusEl = box.querySelector(
            !f.author ? "#rn-author" : "#rn-chara",
          ) as HTMLElement | null;
          focusEl?.focus();
        }
        return;
      }
      // P2 修复：banned 文件保留 .ban 尾缀（Go RenameFile 直接 os.Rename，不会自动补）
      close(buildRenameName(f, ext) + (isBanned ? ".ban" : ""));
    };
  });
}
