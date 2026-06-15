// ===== 全局拖拽导入 =====
import { bus } from "../bus.js";
import { ALL_EXTS, extBelongsTo } from "../utils/extensions.js";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB（MMD/VRC 大文件可达 50MB+）
const MAX_FILE_COUNT = 50;
const getExt = (name) => "." + (name.split(".").pop() || "").toLowerCase();
const isSupportedFile = (name) => ALL_EXTS.includes(getExt(name));
const isYsmFile = (name) => {
  const ext = getExt(name);
  // 只有 .ysm 和 ysm.json 确定是 YSM；.zip/.7z 交给 Go 端 detectZipType 内容判定
  if (ext === ".ysm") return true;
  if (ext === ".json" && name.toLowerCase() === "ysm.json") return true;
  return false;
};
const readFileAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
let dropOverlay = null;
let dropLeaveTimer = null;
const DROP_EXTS_STR = ALL_EXTS.join(" ");

const showDropOverlay = (hasModel) => {
  if (!dropOverlay || !document.body.contains(dropOverlay)) {
    if (dropOverlay) dropOverlay.remove();
    dropOverlay = document.createElement("div");
    dropOverlay.id = "global-drop-overlay";
    dropOverlay.style.cssText =
      "position:fixed;inset:0;z-index:var(--z-fullscreen);display:none;align-items:center;justify-content:center;pointer-events:none;transition:opacity .12s";
    dropOverlay.innerHTML =
      '<div style="background:var(--surf,#1a1b2e);border:2px dashed var(--accent,#66d9ef);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent,#66d9ef)">放开以导入模型</div><div style="font-size:11px;color:var(--muted,#888);margin-top:4px">支持 ' +
      DROP_EXTS_STR +
      " 文件</div></div>";
    document.body.appendChild(dropOverlay);
  }
  if (hasModel === false) {
    const inner = dropOverlay.firstElementChild;
    if (inner) {
      inner.style.borderColor = "#f38ba8";
      inner.style.background =
        "color-mix(in srgb, #f38ba8 8%, var(--surf,#1a1b2e))";
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
  el &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

const onDragOver = (e) => {
  // 只在仓库页面显示拖拽遮罩
  if (window.__currentPage !== "repository") return;
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
  if (window.__currentPage !== "repository") return;
  if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
  if (!e.relatedTarget) {
    hideDropOverlay();
    return;
  }
  dropLeaveTimer = setTimeout(() => {
    if (!e.currentTarget.contains(e.relatedTarget)) hideDropOverlay();
  }, 100);
};
const onDrop = async (e) => {
  hideDropOverlay();
  e.preventDefault();
  if (isEditable(e.target)) return;
  if (window.__YSMPendingLock) return;

  // 非仓库页面不处理 DnD
  if (window.__currentPage !== "repository") return;

  console.log("[DnD] drop fired", {
    filesLen: e.dataTransfer?.files?.length || 0,
    itemsLen: e.dataTransfer?.items?.length || 0,
    types: e.dataTransfer?.types || [],
  });

  const getFileFromEntry = (entry) =>
    new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });

  const collectFiles = async (items, isEntryArray) => {
    const result = [];
    for (const item of items) {
      if (!isEntryArray && item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.() || (isEntryArray ? item : null);
      if (entry?.isDirectory) {
        const reader = entry.createReader();
        const readAll = async (depth = 0) => {
          if (depth > 10) return []; // 防止深层递归导致卡顿
          const batch = await new Promise((r) => reader.readEntries(r));
          if (!batch.length) return [];
          const deeper = await collectFiles(batch, true);
          const next = await readAll(depth + 1);
          return [...deeper, ...next];
        };
        result.push(...(await readAll()));
      } else if (entry?.isFile) {
        if (isSupportedFile(entry.name)) {
          try {
            result.push(await getFileFromEntry(entry));
          } catch (_) {}
        }
      } else if (item.getAsFile) {
        // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile
        const f = item.getAsFile();
        if (f && isSupportedFile(f.name)) result.push(f);
      }
    }
    return result;
  };

  let allFiles = [];
  const items = Array.from(e.dataTransfer?.items || []);
  if (items.length > 0) allFiles = await collectFiles(items, false);
  if (allFiles.length === 0) {
    const direct = Array.from(e.dataTransfer?.files || []);
    allFiles = direct.filter((f) => isSupportedFile(f.name));
  }
  console.log(
    "[DnD] collected:",
    allFiles.length,
    allFiles.map((f) => f.name),
  );

  if (allFiles.length === 0) {
    bus.emit("toast:show", {
      msg: "📂 未检测到支持的资源文件" + "（" + DROP_EXTS_STR + "）",
      duration: 3000,
      type: "info",
    });
    return;
  }
  if (allFiles.length > MAX_FILE_COUNT) {
    bus.emit("toast:show", {
      msg: `⚠️ 单次导入文件过多（${allFiles.length} 个），请分批处理`,
      duration: 5000,
      type: "warn",
    });
    return;
  }
  const oversized = allFiles.filter((f) => f.size > MAX_FILE_SIZE);
  if (oversized.length > 0) {
    bus.emit("toast:show", {
      msg: `⚠️ ${oversized[0].name} 超过 10MB，请直接放入仓库文件夹`,
      duration: 5000,
      type: "warn",
    });
    return;
  }

  // 分类：YSM 进命名队列，非 YSM 直接导入
  const ysmFiles = [];
  const nonYsmFiles = [];
  for (const f of allFiles) {
    if (isYsmFile(f.name)) {
      ysmFiles.push(f);
    } else {
      nonYsmFiles.push(f);
    }
  }

  // 非 YSM 文件直接导入（Go 端 ImportModelFile 已内置 ExtBelongsTo 路由）
  if (nonYsmFiles.length > 0) {
    const { ImportModelFile } = await import("../../wailsjs/go/main/App.js");
    let imported = 0;
    for (const f of nonYsmFiles) {
      try {
        const base64 = await readFileAsBase64(f);
        await ImportModelFile(f.name, base64);
        imported++;
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 导入失败: ${f.name} — ${String(e)}`,
          duration: 4000,
          type: "error",
        });
      }
    }
    if (imported > 0) {
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
      bus.emit("toast:show", {
        msg: `✅ 已导入 ${imported} 个文件`,
        duration: 3000,
        type: "success",
      });
    }
  }

  // YSM 文件走原有命名表单流程
  if (ysmFiles.length > 0) {
    const pendingFiles = ysmFiles.map((f) => ({ name: f.name, file: f }));
    window.__ysmPendingImport = pendingFiles;
    if (window.__currentPage === "repository") {
      bus.emit("import:pending-files", pendingFiles);
      bus.emit("repo:switch-tab", { tab: "import" });
    } else {
      bus.emit("nav:change", { page: "repository" });
      const unsub = bus.on("nav:changed", ({ page }) => {
        if (page === "repository") {
          unsub();
          requestAnimationFrame(() =>
            bus.emit("repo:switch-tab", { tab: "import" }),
          );
        }
      });
    }
  }
};

export function registerDnD(unsubs) {
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  unsubs.push(() => document.removeEventListener("dragover", onDragOver));
  unsubs.push(() => document.removeEventListener("dragleave", onDragLeave));
  unsubs.push(() => document.removeEventListener("drop", onDrop));
  unsubs.push(() => {
    if (dropOverlay) {
      dropOverlay.remove();
      dropOverlay = null;
    }
  });

  // 页面跟踪（加入 unsubs 以便清理）
  const navUnsub = bus.on("nav:changed", ({ page }) => {
    window.__currentPage = page;
  });
  unsubs.push(navUnsub);
}
