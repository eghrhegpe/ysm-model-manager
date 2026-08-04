// ===== 全局拖拽导入（类型化版 — ADR-014 P3）=====
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { PageStore } from "../page-store.ts";
import { DnDLock, PendingImport } from "../../features/dnd-state.ts";
import { getApp } from "../../wails/app.ts";
import { ALL_EXTS } from "../../utils/resource/extensions.ts";
import { getExt, isSupportedFile, shouldEnterForm } from "../../utils/dom/dnd-shared.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB（MMD/VRC 大文件可达 50MB+）
const MAX_FILE_COUNT = 50;

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

let dropOverlay: HTMLElement | null = null;
let dropLeaveTimer: ReturnType<typeof setTimeout> | null = null;
const DROP_EXTS_STR = ALL_EXTS.join(" ");

const showDropOverlay = (hasModel?: boolean): void => {
  if (!dropOverlay || !document.body.contains(dropOverlay)) {
    if (dropOverlay) dropOverlay.remove();
    dropOverlay = document.createElement("div");
    dropOverlay.id = "global-drop-overlay";
    dropOverlay.style.cssText =
      "position:fixed;inset:0;z-index:var(--z-fullscreen);display:none;align-items:center;justify-content:center;pointer-events:none;transition:opacity var(--tr-fast)";
    dropOverlay.innerHTML =
      '<div style="background:var(--surf,#1a1b2e);border:2px dashed var(--accent,#66d9ef);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent,#66d9ef)">放开以导入模型</div><div style="font-size:11px;color:var(--muted,#888);margin-top:4px">支持 ' +
      DROP_EXTS_STR +
      " 文件</div></div>";
    document.body.appendChild(dropOverlay);
  }
  if (hasModel === false) {
    const inner = dropOverlay.firstElementChild as HTMLElement | null;
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

const hideDropOverlay = (): void => {
  if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
  if (!dropOverlay) return;
  dropOverlay.style.display = "none";
  dropOverlay.style.opacity = "0";
};

const isEditable = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return Boolean(
    node &&
      (node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable),
  );
};

const onDragOver = (e: DragEvent): void => {
  // 只在仓库页面显示拖拽遮罩
  if (PageStore.currentPage !== "repository") return;
  // 检测是否拖拽的是文件（items 在 dragover 阶段可能为空，用 types 更可靠）
  if (!e.dataTransfer?.types?.includes("Files")) return;
  if (isEditable(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  const hasModel = Array.from(e.dataTransfer.items).some(
    (item) => item.kind === "file",
  );
  showDropOverlay(hasModel);
};

const onDragLeave = (e: DragEvent): void => {
  if (PageStore.currentPage !== "repository") return;
  if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
  // 防抖：50ms 后隐藏遮罩，若期间 dragover 重新触发则取消
  dropLeaveTimer = setTimeout(hideDropOverlay, 50);
};

const onDrop = async (e: DragEvent): Promise<void> => {
  hideDropOverlay();
  e.preventDefault();
  if (isEditable(e.target)) return;
  if (DnDLock.locked) return;

  // 非仓库页面不处理 DnD
  if (PageStore.currentPage !== "repository") return;

  const getFileFromEntry = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });

  const collectFiles = async (
    items: DataTransferItem[] | FileSystemEntry[],
    isEntryArray: boolean,
  ): Promise<File[]> => {
    const result: File[] = [];
    for (const item of items) {
      if (!isEntryArray && (item as DataTransferItem).kind !== "file") continue;
      const entry =
        (item as DataTransferItem).webkitGetAsEntry?.() ||
        (isEntryArray ? (item as FileSystemEntry) : null);
      if (entry?.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const readAll = async (depth = 0): Promise<File[]> => {
          if (depth > 10) return []; // 防止深层递归导致卡顿
          const batch = await new Promise<FileSystemEntry[]>((r) =>
            reader.readEntries(r),
          );
          if (!batch.length) return [];
          const deeper = await collectFiles(batch, true);
          const next = await readAll(depth + 1);
          return [...deeper, ...next];
        };
        result.push(...(await readAll()));
      } else if (entry?.isFile) {
        if (isSupportedFile((entry as FileSystemFileEntry).name)) {
          try {
            result.push(await getFileFromEntry(entry as FileSystemFileEntry));
          } catch (_) {}
        }
      } else if ((item as DataTransferItem).getAsFile) {
        // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile
        const f = (item as DataTransferItem).getAsFile();
        if (f && isSupportedFile(f.name)) result.push(f);
      }
    }
    return result;
  };

  let allFiles: File[] = [];
  const items = Array.from(e.dataTransfer?.items || []);
  if (items.length > 0) allFiles = await collectFiles(items, false);
  if (allFiles.length === 0) {
    const direct = Array.from(e.dataTransfer?.files || []);
    allFiles = direct.filter((f) => isSupportedFile(f.name));
  }
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
      msg: `⚠️ ${oversized[0].name} 超过 100MB，请直接放入仓库文件夹`,
      duration: 5000,
      type: "warn",
    });
    return;
  }

  // 分类：YSM 进命名队列，非 YSM 直接导入（ZIP 需调 Go 端 DetectZipType 内容判定）
  const ysmFiles: File[] = [];
  const nonYsmFiles: File[] = [];
  for (const f of allFiles) {
    const ext = getExt(f.name);
    if (ext === ".ysm") {
      ysmFiles.push(f);
    } else if (ext === ".zip" || ext === ".7z") {
      try {
        const base64 = await readFileAsBase64(f);
        if (await shouldEnterForm(f.name, base64)) {
          ysmFiles.push(f);
        } else {
          nonYsmFiles.push(f);
        }
      } catch {
        nonYsmFiles.push(f);
      }
    } else {
      nonYsmFiles.push(f);
    }
  }

  // 非 YSM 文件直接导入（Go 端 ImportModelFile 已内置 ExtBelongsTo 路由）
  if (nonYsmFiles.length > 0) {
    const { ImportModelFile } = await getApp();
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
    PendingImport.setQueue(pendingFiles);
    if (PageStore.currentPage === "repository") {
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

// document listener 顶层兜底：onDrop 内部异常面均已 try/catch，
// 此处防未来新增代码路径漏包产生 unhandled rejection
const onDropSafe = (e: DragEvent): void => {
  onDrop(e).catch((err) => {
    console.error("[dnd] 拖放处理失败:", err);
    bus.emit("toast:show", {
      msg: "❌ 导入处理出错，请重试",
      duration: 4000,
      type: "error",
    });
  });
};

/** 注册 DnD 全局事件，push 返回的取消订阅函数到 unsubs */
export function registerDnD(unsubs: Array<() => void>): void {
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDropSafe);
  // 兜底：某些场景下 dragleave/drop 不会触发时隐藏遮罩
  document.addEventListener("dragend", hideDropOverlay);
  unsubs.push(() => document.removeEventListener("dragover", onDragOver));
  unsubs.push(() => document.removeEventListener("dragleave", onDragLeave));
  unsubs.push(() => document.removeEventListener("drop", onDropSafe));
  unsubs.push(() => document.removeEventListener("dragend", hideDropOverlay));
  unsubs.push(() => {
    if (dropLeaveTimer) {
      clearTimeout(dropLeaveTimer);
      dropLeaveTimer = null;
    }
    if (dropOverlay) {
      dropOverlay.remove();
      dropOverlay = null;
    }
  });
}
