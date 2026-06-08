// ===== 模型重命名对话框 =====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../utils/display.js";

export async function showRenameDialog(filePath, currentName) {
  return new Promise((resolve) => {
    const parsed = parseModelName(currentName);

    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.className = "dlg-overlay";
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
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
        <input id="rn-work" class="dlg-input-bg" style="flex:2" placeholder="品牌" value="${esc(parsed.work)}">
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
    overlay.focus();

    // 从 YSM 文件头部读取元数据（仅填充第一位作者，展示介绍）
    box.querySelector("#rn-from-header").onclick = async () => {
      try {
        const btn = box.querySelector("#rn-from-header");
        btn.textContent = "⏳ 读取中...";
        btn.disabled = true;
        const { ExtractYSMHeader } =
          await import("../../wailsjs/go/main/App.js");
        const header = await ExtractYSMHeader(filePath);
        if (header?.isYsm) {
          const authorEl = box.querySelector("#rn-author");
          const tipsEl = box.querySelector("#rn-tips");
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
        // 静默失败
      } finally {
        const btn = box.querySelector("#rn-from-header");
        if (btn) {
          btn.textContent = "📖 读取头部";
          btn.disabled = false;
        }
      }
    };

    const update = () => {
      const a = box.querySelector("#rn-author").value.trim();
      const w = box.querySelector("#rn-work").value.trim();
      const c = box.querySelector("#rn-chara").value.trim();
      const v = box.querySelector("#rn-variant").value.trim();
      const d = box.querySelector("#rn-date").value.trim();
      const ext = currentName.includes(".")
        ? currentName.split(".").pop()
        : "ysm";
      const parts = [];
      if (a) parts.push("[" + a + "]");
      if (w) parts.push("【" + w + "】");
      parts.push(c || "?");
      if (v) parts.push("-" + v);
      if (d) parts.push("(" + d + ")");
      box.querySelector("#rn-preview").textContent =
        parts.join(" ") + "." + ext;
    };

    ["rn-author", "rn-work", "rn-chara", "rn-variant", "rn-date"].forEach(
      (id) => {
        const el = box.querySelector("#" + id);
        el?.addEventListener("input", update);
        el?.addEventListener("input", () => {
          const errEl = box.querySelector("#rn-err");
          if (errEl) errEl.textContent = "";
        });
      },
    );
    update();

    box.querySelector("#rn-cancel").onclick = () => close(null);
    box.querySelector("#rn-ok").onclick = async () => {
      const a = box.querySelector("#rn-author").value.trim();
      const w = box.querySelector("#rn-work").value.trim();
      const c = box.querySelector("#rn-chara").value.trim();
      const v = box.querySelector("#rn-variant").value.trim();
      const d = box.querySelector("#rn-date").value.trim();
      const ext = currentName.includes(".")
        ? currentName.split(".").pop()
        : "ysm";
      if (!a || !w || !c) {
        const errEl = box.querySelector("#rn-err");
        if (errEl) errEl.textContent = "⚠️ 作者、品牌、角色名不能为空";
        (
          box.querySelector(
            !a ? "#rn-author" : !w ? "#rn-work" : "#rn-chara",
          ) || ""
        ).focus?.();
        return;
      }
      const newName =
        "[" +
        a +
        "]【" +
        w +
        "】" +
        c +
        (v ? "-" + v : "") +
        (d ? "(" + d + ")" : "") +
        "." +
        ext;
      close(newName);
    };
  });
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
