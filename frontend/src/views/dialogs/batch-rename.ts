// ===== 批量重命名对话框（类型化版 — ADR-014 P3 dialogs 收官）=====
// 复用 parseModelName 解析
import { bus } from "../../bus.ts";
import { parseModelName, type ParsedModelName } from "../../utils/dom/display.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { registerDlg } from "./modal.ts";
import { esc } from "../../utils/dom/html.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

/** 批量条目（ModelEntry 子集） */
interface BatchEntry {
  Name: string;
  Path?: string;
  [key: string]: unknown;
}

/** 应用变更载荷 */
export interface BatchRenameChange {
  oldPath?: string;
  oldName: string;
  newName: string;
}

/** 内部条目（含解析结果与编辑状态） */
interface BatchItem {
  p: ParsedModelName;
  _author: string;
  _work: string;
  newName: string;
  selected: boolean;
  changed?: boolean;
  Name: string;
  Path?: string;
}

let dialogEl: HTMLElement | null = null;
let _pendingResolve: (() => void) | null = null;

/**
 * 弹出批量重命名对话框
 * @param dir 所在目录
 * @param entries 文件条目
 * @param onApply 应用回调（收到变更列表）
 * @returns Promise，对话框真正关闭（应用完成/取消/Esc）后才 resolve；
 *          重复打开时先结算上一个 Promise，调用方 await 不会永远悬挂
 */
export function showBatchRenameDialog(
  dir: string,
  entries: BatchEntry[],
  onApply: (changes: BatchRenameChange[]) => Promise<void>,
): Promise<void> {
  if (dialogEl) close();
  let resolvePending!: () => void;
  const pending = new Promise<void>((r) => (resolvePending = r));
  _pendingResolve = resolvePending;

  // 解析每个文件的 [作者]【作品】角色(日期)
  const items: BatchItem[] = entries.map((e) => {
    const p = parseModelName(e.Name);
    return {
      ...e,
      p,
      _author: "",
      _work: "",
      newName: e.Name,
      selected: true,
    };
  });

  const updateAll = (): void => {
    items.forEach((it) => {
      const a = it._author || it.p.author;
      const w = it._work || it.p.work;
      const c = it.p.chara || it.Name.replace(/\.\w+$/, "");
      const d = it.p.date || "";
      const ext = it.Name.match(/\.(\w+)$/)?.[1] || RESOURCE_TYPES.YSM;
      const parts: string[] = [];
      if (a) parts.push("[" + a + "]");
      if (w) parts.push("【" + w + "】");
      parts.push(c);
      if (d) parts.push(" (" + d + ")");
      it.newName = parts.join("") + "." + ext;
      it.changed = it.newName !== it.Name;
    });
  };

  const applyReplace = (findText: string, replaceText: string, isRegex: boolean): void => {
    // 重置正则错误标志，允许每次调用都提示
    const cnt = document.getElementById("br-changed");
    if (cnt) delete cnt.dataset.regexErr;
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
        // 正则无效时保持原名，提示用户
        const cnt2 = document.getElementById("br-changed");
        if (cnt2 && !cnt2.dataset.regexErr) {
          cnt2.dataset.regexErr = "1";
          bus.emit("toast:show", {
            msg: "⚠️ 正则表达式无效，已保持原名",
            duration: 3000,
            type: "warn",
          });
        }
      }
    });
  };

  dialogEl = document.createElement("div");
  dialogEl.tabIndex = 0;
  dialogEl.className = "dlg-overlay";
  dialogEl.style.background = "rgba(0,0,0,.55)";
  dialogEl.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  });
  dialogEl.innerHTML = genHTML(dir, items);
  document.body.appendChild(dialogEl);
  registerDlg(dialogEl, () => close());
  dialogEl.focus();

  // 批量修改作者/作品
  const batchAuthor = dialogEl.querySelector("#br-batch-author") as HTMLInputElement | null;
  const batchWork = dialogEl.querySelector("#br-batch-work") as HTMLInputElement | null;
  const previewEl = dialogEl.querySelector("#br-preview") as HTMLElement | null;

  const updateCount = (): void => {
    const sel = items.filter((it) => it.selected && it.changed).length;
    const cnt = document.getElementById("br-changed");
    if (cnt) cnt.textContent = String(sel);
  };

  const applyBatch = (): void => {
    const ba = batchAuthor ? batchAuthor.value.trim() : "";
    const bw = batchWork ? batchWork.value.trim() : "";
    items.forEach((it) => {
      if (ba) it._author = ba;
      if (bw) it._work = bw;
    });
    updateAll();
    renderPreview(previewEl, items);
    // 恢复 checkbox 状态
    items.forEach((it, i) => {
      const cb = previewEl?.querySelector(`[data-ci="${i}"]`) as HTMLInputElement | null;
      if (cb) cb.checked = it.selected;
    });
    updateCount();
  };
  // 输入防抖 200ms
  let brTimer: ReturnType<typeof setTimeout> | null = null;
  const applyBatchDebounced = (): void => {
    if (brTimer) clearTimeout(brTimer);
    brTimer = setTimeout(applyBatch, 200);
  };
  batchAuthor?.addEventListener("input", applyBatchDebounced);
  batchWork?.addEventListener("input", applyBatchDebounced);

  // 复选框事件委托（全选 + 单个）
  previewEl?.addEventListener("change", (e: Event): void => {
    const cb = e.target as HTMLInputElement;
    if (cb.classList.contains("br-file-cb")) {
      const idx = parseInt(cb.dataset.ci || "", 10);
      if (!isNaN(idx) && items[idx]) items[idx].selected = cb.checked;
      updateCount();
    }
  });

  updateAll();
  // 预填首文件作者/作品
  if (items[0]) {
    if (batchAuthor) batchAuthor.value = items[0].p.author;
    if (batchWork) batchWork.value = items[0].p.work;
  }
  renderPreview(previewEl, items);
  updateCount();

  // 模式切换
  const modeSelect = dialogEl.querySelector("#br-mode") as HTMLSelectElement | null;
  const parseModeEl = dialogEl.querySelector("#br-parse-mode") as HTMLElement | null;
  const replaceModeEl = dialogEl.querySelector("#br-replace-mode") as HTMLElement | null;
  const findInput = dialogEl.querySelector("#br-find") as HTMLInputElement | null;
  const replaceInput = dialogEl.querySelector("#br-replace") as HTMLInputElement | null;
  const regexCb = dialogEl.querySelector("#br-regex") as HTMLInputElement | null;

  modeSelect?.addEventListener("change", (): void => {
    const isReplace = modeSelect.value === "replace";
    if (parseModeEl) parseModeEl.style.display = isReplace ? "none" : "flex";
    if (replaceModeEl) replaceModeEl.style.display = isReplace ? "flex" : "none";
    if (isReplace) {
      applyReplace(findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      renderPreview(previewEl, items);
    } else {
      // 切回解析模式时重置
      items.forEach((it) => {
        it._author = "";
        it._work = "";
      });
      updateAll();
      renderPreview(previewEl, items);
    }
    updateCount();
  });

  // 替换输入防抖
  let replaceTimer: ReturnType<typeof setTimeout> | null = null;
  const applyReplaceDebounced = (): void => {
    if (replaceTimer) clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      applyReplace(findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      renderPreview(previewEl, items);
      updateCount();
    }, 200);
  };
  findInput?.addEventListener("input", applyReplaceDebounced);
  replaceInput?.addEventListener("input", applyReplaceDebounced);
  regexCb?.addEventListener("change", applyReplaceDebounced);

  // 预设切换（行内展开/收起）
  const presetsBtn = dialogEl.querySelector("#br-presets") as HTMLElement | null;
  const presetsMenu = dialogEl.querySelector("#br-presets-menu") as HTMLElement | null;
  presetsBtn?.addEventListener("click", (): void => {
    const show = presetsMenu?.style.display !== "flex";
    if (presetsMenu) presetsMenu.style.display = show ? "flex" : "none";
    presetsBtn.textContent = show ? "📋 收起预设" : "📋 预设";
  });
  presetsMenu?.querySelectorAll(".br-preset").forEach((el) => {
    el.addEventListener("click", (): void => {
      const btn = el as HTMLElement;
      if (findInput) findInput.value = btn.dataset.find || "";
      if (replaceInput) replaceInput.value = btn.dataset.replace || "";
      if (regexCb) regexCb.checked = btn.dataset.regex === "1";
      if (presetsMenu) presetsMenu.style.display = "none";
      applyReplace(findInput?.value || "", replaceInput?.value || "", regexCb?.checked || false);
      renderPreview(previewEl, items);
      updateCount();
    });
  });

  dialogEl.querySelector("#br-cancel")?.addEventListener("click", close);
  dialogEl.addEventListener("click", (e: MouseEvent): void => {
    if (e.target === dialogEl) close();
  });

  dialogEl.querySelector("#br-apply")?.addEventListener("click", async (): Promise<void> => {
    const changed = items.filter((it) => it.selected && it.changed);
    if (!changed.length) {
      bus.emit("toast:show", {
        msg: "没有需要重命名的文件",
        duration: 2000,
        type: "info",
      });
      return;
    }
    const btn = dialogEl!.querySelector("#br-apply") as HTMLButtonElement;
    btn.textContent = "⏳ 执行中...";
    btn.disabled = true;
    try {
      await onApply(
        changed.map((it) => ({
          oldPath: it.Path,
          oldName: it.Name,
          newName: it.newName,
        })),
      );
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 批量重命名失败: " + (e instanceof Error ? e.message : String(e)),
        duration: 4000,
        type: "error",
      });
    } finally {
      // 意外 throw 也必须恢复按钮 + 关弹窗（陷阱 #3：按钮卡死根因）
      btn.textContent = "📝 执行重命名";
      btn.disabled = false;
      close();
    }
  });

  return pending;
}

function genHTML(dir: string, items: BatchItem[]): string {
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
    <div class="br-preset dlg-preset-chip" data-find="\(\d{4}-\d{2}\)" data-replace="" data-regex="1">❌ 去除年份</div>
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

function renderPreview(el: HTMLElement | null, items: BatchItem[]): void {
  if (!el) return;
  const changed = items.filter((it) => it.changed).length;
  const cnt = document.getElementById("br-changed");
  if (cnt) cnt.textContent = String(changed);
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
          `<div class="br-row" style="animation-delay:${stagger(i, 15, 300)}ms">
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
  const selectAll = el.querySelector("#br-select-all") as HTMLInputElement | null;
  if (selectAll) {
    selectAll.addEventListener("change", (): void => {
      const checked = selectAll.checked;
      items.forEach((it) => (it.selected = checked));
      el.querySelectorAll(".br-file-cb").forEach(
        (cb) => ((cb as HTMLInputElement).checked = checked),
      );
      const sel = items.filter((it) => it.selected && it.changed).length;
      const cnt2 = document.getElementById("br-changed");
      if (cnt2) cnt2.textContent = String(sel);
    });
  }
}

function close(): void {
  if (dialogEl) {
    dialogEl.classList.add("dlg-closing");
    const el = dialogEl;
    dialogEl = null;
    const res = _pendingResolve;
    _pendingResolve = null;
    if (res) res(); // 结算调用方 await：对话框已关闭
    setTimeout(() => el.remove(), 120);
  }
}
