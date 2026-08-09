// ===== 全局拖拽导入（类型化版 — ADR-014 P3）=====
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { PageStore } from "../core/page-store.ts";
import { getApp } from "../wails/app.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { executeCollected } from "./import-executor.ts";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB（MMD/VRC 大文件可达 50MB+）

let dropOverlay: HTMLElement | null = null;
// 深度计数器：dragenter 进入子元素 +1、dragleave 离开子元素 -1；归零即真正离开窗口。
// 这是窗口级拖拽遮罩「显示/隐藏」唯一可靠的状态来源（单独依赖 dragleave 易误判/漏触发）。
let dragDepth = 0;
// P3 修复（审核发现）：drop 级并发守卫——连续两次快速 drop 会并发跑两套
// collectFiles + executeCollected；执行器内 _inFlight 仅按文件名/目录名短暂守护，
// 异名文件可并行，drop 入口需整体互斥
let _dropBusy = false;
const DROP_EXTS_STR = ALL_EXTS.join(" ");

const showDropOverlay = (hasModel?: boolean): void => {
  if (!dropOverlay || !document.body.contains(dropOverlay)) {
    if (dropOverlay) dropOverlay.remove();
    dropOverlay = document.createElement("div");
    dropOverlay.id = "global-drop-overlay";
    dropOverlay.style.cssText =
      "position:fixed;inset:0;z-index:var(--z-fullscreen);display:none;align-items:center;justify-content:center;pointer-events:none;transition:opacity var(--tr-fast)";
    dropOverlay.innerHTML =
      '<div style="background:var(--surf,#1a1b2e);border:2px dashed var(--accent,#66d9ef);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent,#66d9ef)">' + t("import.dropHint2") + '</div><div style="font-size:11px;color:var(--muted,#888);margin-top:4px">' + t("import.supportedFiles") + ' ' +
      DROP_EXTS_STR +
      ' ' + t("import.files") + "</div></div>";
    document.body.appendChild(dropOverlay);
  }
  if (hasModel === false) {
    const inner = dropOverlay.firstElementChild as HTMLElement | null;
    if (inner) {
      inner.style.borderColor = "#f38ba8";
      inner.style.background =
        "color-mix(in srgb, #f38ba8 8%, var(--surf,#1a1b2e))";
      const msg = inner.querySelector("div:nth-child(3)");
      if (msg) msg.textContent = t("import.noModelDetected");
    }
  }
  dropOverlay.style.display = "flex";
  dropOverlay.style.opacity = "1";
};

const hideDropOverlay = (): void => {
  if (!dropOverlay) return;
  dropOverlay.style.display = "none";
  dropOverlay.style.opacity = "0";
};

const detectHasModel = (e: DragEvent): boolean =>
  Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === "file");

const isEditable = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return Boolean(
    node &&
      (node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable),
  );
};

const onDragEnter = (e: DragEvent): void => {
  // 只在仓库页面显示拖拽遮罩
  if (PageStore.currentPage !== "repository") return;
  // 检测是否拖拽的是文件（items 在 dragover 阶段可能为空，用 types 更可靠）
  if (!e.dataTransfer?.types?.includes("Files")) return;
  if (isEditable(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  dragDepth++;
  showDropOverlay(detectHasModel(e));
};

const onDragOver = (e: DragEvent): void => {
  // 只在仓库页面显示拖拽遮罩
  if (PageStore.currentPage !== "repository") return;
  // 检测是否拖拽的是文件（items 在 dragover 阶段可能为空，用 types 更可靠）
  if (!e.dataTransfer?.types?.includes("Files")) return;
  if (isEditable(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  // 仅维持 drop 允许 + 刷新内容；遮罩隐藏完全由 leave/exit 决定，不再管理定时器
  showDropOverlay(detectHasModel(e));
};

const onDragLeave = (e: DragEvent): void => {
  if (PageStore.currentPage !== "repository") return;
  // 真正离开浏览器视口：relatedTarget 为 null（光标离开文档），
  // 或坐标落在视口边界外（带 2px 小负阈值，避免光标停在窗口四角坐标≈0 时误判）。
  // 这是 OS 文件拖出窗口后松手（dragend 不触发）仍能收起遮罩的关键；
  // WebView2 下 relatedTarget 可能非 null，坐标兜底是防遮罩卡屏的必要保险。
  const leftWindow =
    e.relatedTarget === null ||
    e.clientX < -2 ||
    e.clientY < -2 ||
    e.clientX > window.innerWidth + 2 ||
    e.clientY > window.innerHeight + 2;
  if (leftWindow) {
    dragDepth = 0;
    hideDropOverlay();
    return;
  }
  // 子元素间穿梭：enter/leave 配对，用计数器保持遮罩稳定，不再误触隐藏
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) hideDropOverlay();
};

const onDrop = async (e: DragEvent): Promise<void> => {
  dragDepth = 0;
  hideDropOverlay();
  e.preventDefault();
  if (isEditable(e.target)) return;

  // 非仓库页面不处理 DnD
  if (PageStore.currentPage !== "repository") return;

  // P3 修复（审核发现）：drop 级互斥——上一次 drop 仍在收集/导入时忽略新 drop。
  // busy 命中不能静默吞掉用户手势（preventDefault 已抑制 OS 默认打开），toast 提示稍候
  if (_dropBusy) {
    bus.emit("toast:show", {
      msg: "⏳ " + t("import.busyImporting"),
      duration: 2000,
      type: "info",
    });
    return;
  }
  _dropBusy = true;
  try {

  const getFileFromEntry = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("getFileFromEntry timeout"));
      }, 5000);
      entry.file(
        (f) => { clearTimeout(timer); resolve(f); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });

  // 收集模式：不过滤扩展名，保留 relPath（子目录层级），交由导入页统一路由
  // （含 ysm.json 的目录 → 整组导入；单文件 → isImportableFile 过滤）
  const collectFiles = async (
    items: DataTransferItem[] | FileSystemEntry[],
    isEntryArray: boolean,
    basePath = "",
  ): Promise<Array<{ file: File; relPath: string }>> => {
    const result: Array<{ file: File; relPath: string }> = [];
    for (const item of items) {
      if (!isEntryArray && (item as DataTransferItem).kind !== "file") continue;
      const entry =
        (item as DataTransferItem).webkitGetAsEntry?.() ||
        (isEntryArray ? (item as FileSystemEntry) : null);
      if (entry?.isDirectory) {
        const subPath = basePath ? basePath + "/" + entry.name : entry.name;
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const readAll = async (
          depth = 0,
        ): Promise<Array<{ file: File; relPath: string }>> => {
          if (depth > 10) return []; // 防止深层递归导致卡顿
          // WebView2 对部分目录 readEntries 会触发 error（安全策略/权限）：
          // 必须带错误回调 + 超时兜底，否则 Promise 永不 resolve → onDrop 挂起（拖拽失效）
          const batch = await new Promise<FileSystemEntry[]>((resolve) => {
            let settled = false;
            const done = (v: FileSystemEntry[]): void => {
              if (settled) return;
              settled = true;
              resolve(v);
            };
            reader.readEntries(
              (entries) => done(entries || []),
              () => {
                // P3 修复（审核发现）：目录读取失败静默 done([]) 整目录无声跳过——
                // 保持 WebView2 兼容的空数组兜底，但记录原因便于排查
                console.warn("[dnd] 目录读取失败，跳过:", entry.name);
                done([]);
              },
            );
            setTimeout(() => done([]), 3000);
          });
          if (!batch.length) return [];
          const deeper = await collectFiles(batch, true, subPath);
          const next = await readAll(depth + 1);
          return [...deeper, ...next];
        };
        result.push(...(await readAll()));
      } else if (entry?.isFile) {
        const relPath = basePath
          ? basePath + "/" + entry.name
          : entry.name;
        try {
          result.push({
            file: await getFileFromEntry(entry as FileSystemFileEntry),
            relPath,
          });
        } catch (e) {
          // P2 修复（审核发现）：原 catch (_) {} 静默吞错——单文件读取失败/超时
          // 无声丢弃，无日志无提示；记录原因便于排查（与 import-executor 的 console.warn 对齐）
          console.warn("[dnd] 单文件读取失败，已跳过:", relPath, e);
        }
      } else if ((item as DataTransferItem).getAsFile) {
        // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile
        const f = (item as DataTransferItem).getAsFile();
        if (f) result.push({ file: f, relPath: f.name });
      }
    }
    return result;
  };

  let collected: Array<{ file: File; relPath: string }> = [];
  const items = Array.from(e.dataTransfer?.items || []);
  if (items.length > 0) collected = await collectFiles(items, false);
  // WebView2 全局 drop 可能只暴露 dataTransfer.files（webkitGetAsEntry 受限）：
  // 合并 files 兜底，保留 webkitRelativePath 层级（无则用文件名）
  const seen = new Set(collected.map((c) => c.file));
  for (const f of Array.from(e.dataTransfer?.files || [])) {
    if (seen.has(f)) continue;
    seen.add(f);
    collected.push({
      file: f,
      relPath:
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name,
    });
  }
  if (collected.length === 0) {
    collected = Array.from(e.dataTransfer?.files || []).map((f) => ({
      file: f,
      relPath: f.name,
    }));
  }
  if (collected.length === 0) {
    bus.emit("toast:show", {
      msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
      duration: 3000,
      type: "info",
    });
    return;
  }
  const oversized = collected.filter((c) => c.file.size > MAX_FILE_SIZE);
  if (oversized.length > 0) {
    bus.emit("toast:show", {
      msg: `⚠️ ${oversized[0].file.name} ${t("import.fileTooLarge")}`,
      duration: 5000,
      type: "warn",
    });
    return;
  }

  // 静默导入：全局执行器直接入仓（不切导入 tab、不弹表单）。
  // 历史/结果由 import-executor 维护，导入 tab 挂载时从 ImportHistory 渲染。
  // await 让 rejection 向上传递，由 onDropSafe 的 catch 统一兜底（避免 void 切断 Promise 链）
  const total = collected.length;
  const r = await executeCollected(
    collected as Array<{ file: File; relPath: string }>,
  );
  if (r.folders === 0 && r.singles === 0 && total > 0) {
    bus.emit("toast:show", {
      msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
      duration: 3000,
      type: "info",
    });
  }
  } finally {
    // 任何出口（含异常）都释放 drop 互斥，防连点后永久锁死
    _dropBusy = false;
  }
};

// document listener 顶层兜底：onDrop 内部异常面均已 try/catch，
// 此处防未来新增代码路径漏包产生 unhandled rejection
const onDropSafe = (e: DragEvent): void => {
  onDrop(e).catch((err) => {
    console.error("[dnd] 拖放处理失败:", err);
    bus.emit("toast:show", {
      msg: `❌ ${t("import.processError")}`,
      duration: 4000,
      type: "error",
    });
  });
};

const onDragEnd = (): void => {
  // 兜底：拖拽被取消 / 在窗口内松手但未触发 drop 时收起遮罩
  dragDepth = 0;
  hideDropOverlay();
};

/** 注册 DnD 全局事件，push 返回的取消订阅函数到 unsubs */
export function registerDnD(unsubs: Array<() => void>): void {
  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDropSafe);
  // 兜底：拖拽被取消 / 在窗口外松手（OS 文件拖拽未必触发 dragend）时收起遮罩
  document.addEventListener("dragend", onDragEnd);
  unsubs.push(() => document.removeEventListener("dragenter", onDragEnter));
  unsubs.push(() => document.removeEventListener("dragover", onDragOver));
  unsubs.push(() => document.removeEventListener("dragleave", onDragLeave));
  unsubs.push(() => document.removeEventListener("drop", onDropSafe));
  unsubs.push(() => document.removeEventListener("dragend", onDragEnd));
  unsubs.push(() => {
    if (dropOverlay) {
      dropOverlay.remove();
      dropOverlay = null;
    }
  });
}
