// ===== 批量重命名对话框（复用 parseModelName 解析） =====
import { bus } from "../bus.js";
import { parseModelName } from "../utils/display.js";

let dialogEl = null;

export async function showBatchRenameDialog(dir, entries, onApply) {
  if (dialogEl) dialogEl.remove();

  // 解析每个文件的 [作者]【作品】角色(日期)
  const items = entries.map((e) => {
    const p = parseModelName(e.Name);
    return { ...e, p, _author: "", _work: "", newName: e.Name, selected: true };
  });

  const updateAll = () => {
    items.forEach((it) => {
      const a = it._author || it.p.author;
      const w = it._work || it.p.work;
      const c = it.p.chara || it.Name.replace(/\.\w+$/, "");
      const d = it.p.date || "";
      const ext = it.Name.match(/\.(\w+)$/)?.[1] || "ysm";
      const parts = [];
      if (a) parts.push("[" + a + "]");
      if (w) parts.push("【" + w + "】");
      parts.push(c);
      if (d) parts.push("(" + d + ")");
      it.newName = parts.join("") + "." + ext;
      it.changed = it.newName !== it.Name;
    });
  };

  dialogEl = document.createElement("div");
  dialogEl.tabIndex = 0;
  dialogEl.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif";
  dialogEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  dialogEl.innerHTML = genHTML(dir, items);
  document.body.appendChild(dialogEl);
  dialogEl.focus();

  // 批量修改作者/作品
  const batchAuthor = dialogEl.querySelector("#br-batch-author");
  const batchWork = dialogEl.querySelector("#br-batch-work");
  const previewEl = dialogEl.querySelector("#br-preview");

  const updateCount = () => {
    const sel = items.filter((it) => it.selected && it.changed).length;
    const cnt = document.getElementById("br-changed");
    if (cnt) cnt.textContent = sel;
  };

  const applyBatch = () => {
    const ba = batchAuthor.value.trim();
    const bw = batchWork.value.trim();
    items.forEach((it) => {
      if (ba) it._author = ba;
      if (bw) it._work = bw;
    });
    updateAll();
    renderPreview(previewEl, items);
    // 恢复 checkbox 状态
    items.forEach((it, i) => {
      const cb = previewEl?.querySelector(`[data-ci="${i}"]`);
      if (cb) cb.checked = it.selected;
    });
    updateCount();
  };
  // 输入防抖 200ms
  let brTimer = null;
  const applyBatchDebounced = () => {
    if (brTimer) clearTimeout(brTimer);
    brTimer = setTimeout(applyBatch, 200);
  };
  batchAuthor?.addEventListener("input", applyBatchDebounced);
  batchWork?.addEventListener("input", applyBatchDebounced);

  // 复选框事件委托（全选 + 单个）
  previewEl?.addEventListener("change", (e) => {
    const cb = e.target;
    if (cb.classList.contains("br-file-cb")) {
      const idx = parseInt(cb.dataset.ci, 10);
      if (!isNaN(idx) && items[idx]) items[idx].selected = cb.checked;
      updateCount();
    }
  });

  updateAll();
  // 预填首文件作者/作品
  if (items[0]) {
    batchAuthor.value = items[0].p.author;
    batchWork.value = items[0].p.work;
  }
  renderPreview(previewEl, items);
  updateCount();

  dialogEl.querySelector("#br-cancel")?.addEventListener("click", close);
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) close();
  });

  dialogEl.querySelector("#br-apply")?.addEventListener("click", async () => {
    const changed = items.filter((it) => it.selected && it.changed);
    if (!changed.length) {
      bus.emit("toast:show", {
        msg: "没有需要重命名的文件",
        duration: 2000,
        type: "info",
      });
      return;
    }
    const btn = dialogEl.querySelector("#br-apply");
    btn.textContent = "⏳ 执行中...";
    btn.disabled = true;
    await onApply(
      changed.map((it) => ({
        oldPath: it.Path,
        oldName: it.Name,
        newName: it.newName,
      })),
    );
    close();
  });
}

function genHTML(dir, items) {
  const changed = items.filter((it) => it.changed).length;
  return `<div style="background:var(--surf);border:1px solid var(--bd);border-radius:10px;width:640px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.5)">
<div style="padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:6px">
  <span style="font-size:13px;font-weight:600;color:var(--txt)">📝 批量重命名</span>
  <span style="font-size:10px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dir)}</span>
  <span style="font-size:9px;color:var(--muted)">${items.length} 个文件 · <span id="br-changed">${changed}</span> 个变更</span>
</div>
<div style="padding:8px 12px;display:flex;gap:6px;align-items:center;border-bottom:1px solid var(--bd);flex-wrap:wrap;background:var(--bg)">
  <span style="font-size:10px;color:var(--muted)">统一作者：</span>
  <input id="br-batch-author" placeholder="留空不变" style="width:100px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
  <span style="font-size:10px;color:var(--muted)">作品：</span>
  <input id="br-batch-work" placeholder="留空不变" style="width:100px;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
  <span style="font-size:9px;color:var(--muted)">回车生效</span>
</div>
<div id="br-preview" style="flex:1;overflow-y:auto;padding:4px 6px;min-height:100px;font-size:10px;color:var(--txt)"></div>
<div style="padding:8px 12px;border-top:1px solid var(--bd);display:flex;gap:6px;justify-content:flex-end">
  <button id="br-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消 (Esc)</button>
  <button id="br-apply" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">✅ 应用重命名 (Enter)</button>
</div>
</div>`;
}

function renderPreview(el, items) {
  if (!el) return;
  const changed = items.filter((it) => it.changed).length;
  const cnt = document.getElementById("br-changed");
  if (cnt) cnt.textContent = changed;
  el.innerHTML =
    `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:9px;color:var(--muted);border-bottom:1px solid var(--bd)">
  <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
    <input type="checkbox" id="br-select-all" checked style="accent-color:var(--accent)"> 全选
  </label>
  <span style="flex:1;text-align:center">原名</span>
  <span style="width:16px;text-align:center"></span>
  <span style="flex:1;text-align:center">新名</span>
</div>` +
    items
      .map(
        (it, i) =>
          `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:10px;border-bottom:1px solid var(--bd)">
  <input type="checkbox" class="br-file-cb" data-ci="${i}" ${it.selected ? "checked" : ""} style="accent-color:var(--accent);flex-shrink:0">
  ${
    it.selected && it.changed
      ? `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" title="${esc(it.Name)}">${esc(it.Name)}</span>
  <span style="color:var(--muted);flex-shrink:0">→</span>
  <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--accent)" title="${esc(it.newName)}">${esc(it.newName)}</span>`
      : `<span style="flex:1;color:var(--muted);opacity:${it.selected ? 1 : 0.5}">${esc(it.Name)}</span>`
  }
</div>`,
      )
      .join("");

  // 全选联动
  const selectAll = el.querySelector("#br-select-all");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      const checked = selectAll.checked;
      items.forEach((it) => (it.selected = checked));
      el.querySelectorAll(".br-file-cb").forEach(
        (cb) => (cb.checked = checked),
      );
      const sel = items.filter((it) => it.selected && it.changed).length;
      const cnt2 = document.getElementById("br-changed");
      if (cnt2) cnt2.textContent = sel;
    });
  }
}

function close() {
  if (dialogEl) {
    dialogEl.remove();
    dialogEl = null;
  }
}
function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
