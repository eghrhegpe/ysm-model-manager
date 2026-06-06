// ===== 模型重命名对话框 =====
// 用法: showRenameDialog(filePath, currentName) → 确认后调用 RenameFile
import { parseModelName } from "../utils/display.js";

export async function showRenameDialog(filePath, currentName) {
  return new Promise((resolve) => {
    const parsed = parseModelName(currentName);

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };

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
        <button id="rn-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
        <button id="rn-ok" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">✂️ 重命名</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

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
        box.querySelector("#" + id)?.addEventListener("input", update);
      },
    );
    update();

    box.querySelector("#rn-cancel").onclick = () => {
      overlay.remove();
      resolve(null);
    };
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
        alert("作者、品牌、角色名不能为空");
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
      overlay.remove();
      resolve(newName);
    };
  });
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
