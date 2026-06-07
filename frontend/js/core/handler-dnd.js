// ===== 全局拖拽导入 =====
import { bus } from "../bus.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 50;
let dropOverlay = null;
let dropLeaveTimer = null;

const showDropOverlay = (hasModel) => {
  if (!dropOverlay || !document.body.contains(dropOverlay)) {
    if (dropOverlay) dropOverlay.remove();
    dropOverlay = document.createElement("div");
    dropOverlay.id = "global-drop-overlay";
    dropOverlay.style.cssText =
      "position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center;pointer-events:none;transition:opacity .12s";
    dropOverlay.innerHTML =
      '<div style="background:var(--surf,#1a1b2e);border:2px dashed var(--accent,#66d9ef);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent,#66d9ef)">放开以导入模型</div><div style="font-size:11px;color:var(--muted,#888);margin-top:4px">支持 .ysm / .zip / .7z 文件</div></div>';
    document.body.appendChild(dropOverlay);
  }
  if (hasModel === false) {
    const inner = dropOverlay.firstElementChild;
    if (inner) {
      inner.style.borderColor = "#f38ba8";
      inner.style.background = "color-mix(in srgb, #f38ba8 8%, var(--surf,#1a1b2e))";
      const msg = inner.querySelector("div:nth-child(3)");
      if (msg) msg.textContent = "⛔ 未检测到模型文件";
    }
  }
  dropOverlay.style.display = "flex";
  dropOverlay.style.opacity = "1";
};
const hideDropOverlay = () => {
  if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
  if (!dropOverlay) return;
  dropOverlay.style.display = "none";
  dropOverlay.style.opacity = "0";
};

const isEditable = (el) =>
  el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

const onDragOver = (e) => {
  if (!e.dataTransfer?.items?.length) return;
  if (isEditable(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  const hasModel = Array.from(e.dataTransfer.items).some(
    (item) => item.kind === "file",
  );
  showDropOverlay(hasModel);
};
const onDragLeave = (e) => {
  if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
  if (!e.relatedTarget) { hideDropOverlay(); return; }
  dropLeaveTimer = setTimeout(() => {
    if (!e.currentTarget.contains(e.relatedTarget)) hideDropOverlay();
  }, 100);
};
const onDrop = async (e) => {
  hideDropOverlay();
  e.preventDefault();
  if (isEditable(e.target)) return;
  if (window.__YSMPendingLock) return;

  console.log("[DnD] drop fired", {
    filesLen: e.dataTransfer?.files?.length || 0,
    itemsLen: e.dataTransfer?.items?.length || 0,
    types: e.dataTransfer?.types || [],
  });

  const getFileFromEntry = (entry) =>
    new Promise((resolve, reject) => { entry.file(resolve, reject); });

  const collectFiles = async (items, isEntryArray) => {
    const result = [];
    for (const item of items) {
      if (!isEntryArray && item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.() || (isEntryArray ? item : null);
      if (entry?.isDirectory) {
        const reader = entry.createReader();
        const readAll = async () => {
          const batch = await new Promise((r) => reader.readEntries(r));
          if (!batch.length) return [];
          const deeper = await collectFiles(batch, true);
          const next = await readAll();
          return [...deeper, ...next];
        };
        result.push(...(await readAll()));
      } else if (entry?.isFile) {
        if (/\.(ysm|zip|7z)$/i.test(entry.name)) {
          try { result.push(await getFileFromEntry(entry)); } catch (_) {}
        }
      } else {
        const f = item.getAsFile?.();
        if (f && /\.(ysm|zip|7z)$/i.test(f.name)) result.push(f);
      }
    }
    return result;
  };

  let allFiles = [];
  const items = Array.from(e.dataTransfer?.items || []);
  if (items.length > 0) allFiles = await collectFiles(items, false);
  if (allFiles.length === 0) {
    const direct = Array.from(e.dataTransfer?.files || []);
    allFiles = direct.filter((f) => /\.(ysm|zip|7z)$/i.test(f.name));
  }
  console.log("[DnD] collected:", allFiles.length, allFiles.map((f) => f.name));

  if (allFiles.length === 0) {
    bus.emit("toast:show", {
      msg: "📂 未检测到模型文件（.ysm / .zip / .7z）",
      duration: 3000, type: "info",
    });
    return;
  }
  if (allFiles.length > MAX_FILE_COUNT) {
    bus.emit("toast:show", {
      msg: `⚠️ 单次导入文件过多（${allFiles.length} 个），请分批处理`,
      duration: 5000, type: "warn",
    });
    return;
  }
  const oversized = allFiles.filter((f) => f.size > MAX_FILE_SIZE);
  if (oversized.length > 0) {
    bus.emit("toast:show", {
      msg: `⚠️ ${oversized[0].name} 超过 10MB，请直接放入仓库文件夹`,
      duration: 5000, type: "warn",
    });
    return;
  }

  window.__pendingImport = allFiles.map((f) => ({ name: f.name, file: f }));
  if (window.__currentPage === "downloads") {
    bus.emit("import:pending-files");
  } else {
    bus.emit("nav:change", { page: "downloads" });
  }
};

export function registerDnD(unsubs) {
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  unsubs.push(() => document.removeEventListener("dragover", onDragOver));
  unsubs.push(() => document.removeEventListener("dragleave", onDragLeave));
  unsubs.push(() => document.removeEventListener("drop", onDrop));
  unsubs.push(() => { if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; } });

  // 页面跟踪
  bus.on("nav:changed", ({ page }) => { window.__currentPage = page; });
}
