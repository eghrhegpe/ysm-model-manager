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

  const applyReplace = (findText, replaceText, isRegex) => {
    items.forEach((it) => {
      try {
        // 分离扩展名，只对文件名主体做替换
        const extMatch = it.Name.match(/(\.[^.]+)$/);
        const ext = extMatch ? extMatch[1] : "";
        const body = extMatch ? it.Name.slice(0, -ext.length) : it.Name;
        const newBody = isRegex
          ? body.replace(new RegExp(findText, "g"), replaceText)
          : body.replaceAll(findText, replaceText);
        it.newName = (newBody || body) + ext;
        it.changed = it.newName !== it.Name;
      } catch {
        // 正则无效时保持原名
      }
    });
  };

  dialogEl = document.createElement("div");
  dialogEl.tabIndex = 0;
  dialogEl.className = "dlg-overlay";
  dialogEl.style.background = "rgba(0,0,0,.55)";
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

  // 模式切换
  const modeSelect = dialogEl.querySelector("#br-mode");
  const parseModeEl = dialogEl.querySelector("#br-parse-mode");
  const replaceModeEl = dialogEl.querySelector("#br-replace-mode");
  const findInput = dialogEl.querySelector("#br-find");
  const replaceInput = dialogEl.querySelector("#br-replace");
  const regexCb = dialogEl.querySelector("#br-regex");

  modeSelect?.addEventListener("change", () => {
    const isReplace = modeSelect.value === "replace";
    parseModeEl.style.display = isReplace ? "none" : "flex";
    replaceModeEl.style.display = isReplace ? "flex" : "none";
    if (isReplace) {
      applyReplace(findInput.value, replaceInput.value, regexCb.checked);
      renderPreview(previewEl, items);
    } else {
      // 切回解析模式时重置
      items.forEach((it) => { it._author = ""; it._work = ""; });
      updateAll();
      renderPreview(previewEl, items);
    }
    updateCount();
  });

  // 替换输入防抖
  let replaceTimer = null;
  const applyReplaceDebounced = () => {
    if (replaceTimer) clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      applyReplace(findInput.value, replaceInput.value, regexCb.checked);
      renderPreview(previewEl, items);
      updateCount();
    }, 200);
  };
  findInput?.addEventListener("input", applyReplaceDebounced);
  replaceInput?.addEventListener("input", applyReplaceDebounced);
  regexCb?.addEventListener("change", applyReplaceDebounced);

  // 预设切换（行内展开/收起）
  const presetsBtn = dialogEl.querySelector("#br-presets");
  const presetsMenu = dialogEl.querySelector("#br-presets-menu");
  presetsBtn?.addEventListener("click", () => {
    const show = presetsMenu.style.display !== "flex";
    presetsMenu.style.display = show ? "flex" : "none";
    presetsBtn.textContent = show ? "📋 收起预设" : "📋 预设";
  });
  presetsMenu?.querySelectorAll(".br-preset").forEach((el) => {
    el.addEventListener("click", () => {
      findInput.value = el.dataset.find || "";
      replaceInput.value = el.dataset.replace || "";
      regexCb.checked = el.dataset.regex === "1";
      presetsMenu.style.display = "none";
      applyReplace(findInput.value, replaceInput.value, regexCb.checked);
      renderPreview(previewEl, items);
      updateCount();
    });
  });

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
  return `<div class="dlg-box">
<div class="dlg-header">
  <span class="dlg-header-title">📝 批量重命名</span>
  <span class="dlg-header-path">${esc(dir)}</span>
  <span class="dlg-header-count">${items.length} 个文件 · <span id="br-changed">${changed}</span> 个变更</span>
</div>
<div class="dlg-section">
  <span class="dlg-section-label">模式：</span>
  <select id="br-mode" class="dlg-input">
    <option value="parse">📋 解析格式</option>
    <option value="replace">🔍 查找替换</option>
  </select>
</div>
<div id="br-parse-mode" class="dlg-section">
  <span class="dlg-section-label">统一作者：</span>
  <input id="br-batch-author" class="dlg-input-sm" placeholder="留空不变">
  <span class="dlg-section-label">作品：</span>
  <input id="br-batch-work" class="dlg-input-sm" placeholder="留空不变">
  <span class="dlg-header-count" style="font-size:9px">回车生效</span>
</div>
<div id="br-replace-mode" class="dlg-section" style="display:none">
  <span class="dlg-section-label">查找：</span>
  <input id="br-find" class="dlg-input-flex" placeholder="输入要查找的内容">
  <span class="dlg-section-label">替换为：</span>
  <input id="br-replace" class="dlg-input-flex" placeholder="留空为删除">
  <label class="dlg-label-check">
    <input type="checkbox" id="br-regex"> 正则
  </label>
  <button id="br-presets" class="dlg-btn-accent">📋 预设</button>
  <div id="br-presets-menu" class="dlg-presets-menu">
    <div class="br-preset dlg-preset-chip" data-find="\(\d{4}-\d{2}\)" data-replace="" data-regex="1">❌ 去除年份 (2025-08)</div>
    <div class="br-preset dlg-preset-chip" data-find="-v\d+(?=\.)" data-replace="" data-regex="1">❌ 去除版本 -v2</div>
    <div class="br-preset dlg-preset-chip" data-find="【(.+?)】" data-replace="[$1]" data-regex="1">【】→ [] 括号</div>
    <div class="br-preset dlg-preset-chip" data-find="\[(.+?)\]【(.+?)】" data-replace="$1-$2" data-regex="1">📛 拍平为 作者-作品</div>
    <div class="br-preset dlg-preset-chip" data-find="\s+" data-replace="_" data-regex="1">🔗 空格 → 下划线</div>
  </div>
</div>
<div id="br-preview" class="dlg-preview"></div>
<div class="dlg-footer">
  <button id="br-cancel" class="dlg-btn">取消 (Esc)</button>
  <button id="br-apply" class="dlg-btn dlg-btn-primary">✅ 应用重命名 (Enter)</button>
</div>
</div>`;
}

function renderPreview(el, items) {
  if (!el) return;
  const changed = items.filter((it) => it.changed).length;
  const cnt = document.getElementById("br-changed");
  if (cnt) cnt.textContent = changed;
  el.innerHTML =
    `<div class="br-header">
  <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
    <input type="checkbox" id="br-select-all" checked class="br-cb"> 全选
  </label>
  <span style="flex:1;text-align:center">原名</span>
  <span class="br-spacer"></span>
  <span style="flex:1;text-align:center">新名</span>
</div>` +
    items
      .map(
        (it, i) =>
          `<div class="br-row">
  <input type="checkbox" class="br-file-cb br-cb" data-ci="${i}" ${it.selected ? "checked" : ""}>
  ${
    it.selected && it.changed
      ? `<span class="br-name br-name-old" title="${esc(it.Name)}">${esc(it.Name)}</span>
  <span class="br-arrow">→</span>
  <span class="br-name br-name-new" title="${esc(it.newName)}">${esc(it.newName)}</span>`
      : `<span class="br-name-plain" style="opacity:${it.selected ? 1 : 0.5}">${esc(it.Name)}</span>`
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
