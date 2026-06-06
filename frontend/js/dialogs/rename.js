// ===== 模型重命名对话框 =====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../utils/display.js";

export async function showRenameDialog(filePath, currentName) {
  return new Promise((resolve) => {
    const parsed = parseModelName(currentName);

    const overlay = document.createElement("div");
    overlay.tabIndex = 0;
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
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
    box.style.cssText =
      "background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:14px;width:640px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:6px";

    box.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">✂️ 重命名模型</div>
      <div style="font-size:10px;color:var(--muted)">${esc(currentName)}</div>
      <div style="display:flex;gap:4px">
        <input id="rn-author" placeholder="作者" value="${esc(parsed.author)}" style="flex:2;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <input id="rn-work" placeholder="品牌" value="${esc(parsed.work)}" style="flex:2;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <input id="rn-chara" placeholder="角色" value="${esc(parsed.chara)}" style="flex:2;min-width:60px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <input id="rn-variant" placeholder="变体" style="flex:1;min-width:50px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
        <input id="rn-date" placeholder="年月" value="${esc(parsed.date)}" style="flex:1;min-width:50px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">
      </div>
      <div style="font-size:11px;padding:4px 6px;border-radius:4px;background:var(--bg)">
        <span style="color:var(--muted)">${esc(currentName)}</span> → <span id="rn-preview" style="font-weight:500">-</span>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:2px">
        <button id="rn-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消 (Esc)</button>
        <button id="rn-ok" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">✂️ 重命名 (Enter)</button>
      </div>
      <div id="rn-err" style="font-size:10px;color:#f38ba8;min-height:0;transition:min-height .15s;overflow:hidden"></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.focus();

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
