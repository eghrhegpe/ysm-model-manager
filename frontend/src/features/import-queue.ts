// ===== 导入队列 + 拖拽 + 重命名流程（类型化版 — ADR-014 P3 features 收官）=====
import { bus } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { parseModelName, renderDisplayName } from "../utils/dom/display.ts";
import { renderFormattedText } from "../utils/format/mc-format.ts";
import { modalConfirm } from "../views/dialogs/modal.ts";
import { getApp } from "../wails/app.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { isImportableFile, shouldEnterForm, groupCollected } from "./dnd-shared.ts";
import {
  ImportHistory,
  directImport as execDirectImport,
  importFolder as execImportFolder,
} from "./import-executor.ts";
import { showRenameDialog } from "../views/dialogs/rename.ts";

const extsStr = ALL_EXTS.join(" ");

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
type ImportFile = File & { _relPath?: string };

/** app-content 组件实例（initImportQueue 依赖的成员） */
export interface ImportQueueHost {
  _root: ShadowRoot;
  _esc: (s: string) => string;
}

/** 初始化导入队列，返回清理函数 */
export function initImportQueue(app: ImportQueueHost): () => void {
  const root = app._root;
  const esc = (s: string): string => app._esc(s);
  const dropZone = root.getElementById("dl-drop") as HTMLElement;
  const fileInput = root.getElementById("dl-file-input") as HTMLInputElement;
  const folderInput = root.getElementById("dl-folder-input") as HTMLInputElement;
  const importedList = root.getElementById("dl-imported-list") as HTMLElement;
  const dlCount = root.getElementById("dl-count") as HTMLElement | null;
  const dlQueueCount = root.getElementById(
    "dl-queue-count",
  ) as HTMLElement | null;
  // 存储当前文件信息
  let currentFile: ImportFile | null = null;
  let currentBase64: string | null = null;
  let currentFileName: string | null = null;
  let currentRelPath = ""; // 文件夹导入时的相对路径
  // 并发守卫：导入/重命名在途时拦截连点（同 preview-skeleton _saving 模式）
  let _importing = false;
  // 资源管理：统一收集 addEventListener，cleanup 时成对 remove（防 tab 切换监听悬挂）
  const cleanups: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
  ): void => {
    el.addEventListener(type, handler as EventListener);
    cleanups.push(() => el.removeEventListener(type, handler as EventListener));
  };
  const fileQueue: Array<{
    file: ImportFile;
    base64: string;
    name: string;
    size: number;
    relPath: string;
  }> = []; // { file, base64, name, size }
  // 读文件并分流（表单/直导）+ 可选完成回调
  const readAndRouteFile = (file: ImportFile, onDone?: () => void): void => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(",")[1] || "";
        if (await shouldEnterForm(file.name, base64)) {
          enqueueFile(file, base64);
        } else {
          // 直导：执行器内部自行读 base64（历史/去重/toast 单点）
          await directImport(file);
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e),
          duration: 5000,
          type: "error",
        });
      } finally {
        onDone?.();
      }
    };
    reader.onerror = () => onDone?.();
    reader.readAsDataURL(file);
  };
  // 队列推进：成功/覆盖后前进到下一项或关闭表单
  const advanceQueue = (): void => {
    if (fileQueue.length > 0) {
      showForm(fileQueue[0].file, fileQueue[0].base64);
    } else {
      toggleForm(false);
    }
  };

  // 切换拖拽区 ↔ 表单（简单 display 切换）
  const toggleForm = (visible: boolean): void => {
    const form = root.getElementById("dl-form") as HTMLElement | null;
    if (visible) {
      dropZone.style.display = "none";
      if (form) form.style.display = "flex";
    } else {
      dropZone.style.display = "flex";
      if (form) form.style.display = "none";
    }
  };

  const showForm = (file: ImportFile, base64: string): void => {
    currentFile = file;
    currentBase64 = base64;
    currentFileName = file.name;
    currentRelPath = file._relPath || "";

    const parsed = parseModelName(file.name);

    (root.getElementById("dl-author") as HTMLInputElement).value =
      parsed.author || "";
    (root.getElementById("dl-work") as HTMLInputElement).value =
      parsed.work || "";
    (root.getElementById("dl-chara") as HTMLInputElement).value =
      parsed.chara || "";
    (root.getElementById("dl-variant") as HTMLInputElement).value = "";
    (root.getElementById("dl-date") as HTMLInputElement).value =
      parsed.date || "";
    updatePreview();

    toggleForm(true);

    // 存临时文件供右侧预览面板读取
    (async () => {
      try {
        const { SavePreviewTempFile } = await getApp();
        const tmpPath = await SavePreviewTempFile(base64);
        if (tmpPath) {
          bus.emit("model:select", { path: tmpPath });
        }
      } catch (_) {}
    })();

    // "读取作者"已勾选时，自动为新文件读取 YSM 头部
    setTimeout(async () => {
      try {
        if (
          (root.getElementById("dl-from-header") as HTMLInputElement | null)
            ?.checked
        ) {
          await loadHeaderFromBase64();
        }
      } catch (err) {
        console.warn("[import-queue] 自动读取头部失败:", err);
      }
    }, 0);
  };

  // 检查文件是否已存在（防抖）
  let conflictTimer: ReturnType<typeof setTimeout> | null = null;
  const checkConflictDebounced = (name: string): void => {
    if (conflictTimer) clearTimeout(conflictTimer);
    conflictTimer = setTimeout(async () => {
      try {
        const { CheckFileExists, GetRepoRoot } = await getApp();
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const fullPath = (repoRoot || "") + "/" + name;
        const exists = await CheckFileExists(fullPath);
        const el = root.getElementById("dl-conflict") as HTMLElement | null;
        if (el) el.style.display = exists ? "" : "none";
      } catch {}
    }, 400);
  };

  const updatePreview = (): void => {
    const a = (root.getElementById("dl-author") as HTMLInputElement).value.trim();
    const w = (root.getElementById("dl-work") as HTMLInputElement).value.trim();
    const c = (root.getElementById("dl-chara") as HTMLInputElement).value.trim();
    const v = (root.getElementById("dl-variant") as HTMLInputElement).value.trim();
    const manualDate = (
      root.getElementById("dl-date") as HTMLInputElement
    ).value.trim();
    const autoOn = (root.getElementById("dl-date-auto") as HTMLInputElement)
      .checked;
    const autoDate =
      new Date().getFullYear() +
      "-" +
      String(new Date().getMonth() + 1).padStart(2, "0");
    const d = manualDate || (autoOn ? autoDate : "");
    const parts: string[] = [];
    if (a) parts.push("[" + a + "]");
    parts.push("【" + (w || "未知") + "】");
    parts.push(c || "?");
    if (v) parts.push("-" + v);
    if (d) parts.push(" (" + d + ")");
    const ext = currentFileName?.split(".").pop() || RESOURCE_TYPES.YSM;
    const preview = parts.join("") + "." + ext;
    (root.getElementById("dl-preview") as HTMLElement).textContent = preview;

    // 检查冲突（防抖）
    checkConflictDebounced(preview);
  };

  // 从 Go 端解析 base64 头部元数据（复用 header.go 的完整解析逻辑）
  const loadHeaderFromBase64 = async (): Promise<void> => {
    if (!currentBase64) return;
    try {
      const { ExtractYSMHeaderFromBase64 } = await getApp();
      const header = await ExtractYSMHeaderFromBase64(currentBase64);
      if (header.authorName) {
        const authorEl = root.getElementById("dl-author") as HTMLInputElement;
        if (!authorEl.value.trim()) {
          authorEl.value = header.authorName;
          authorEl.style.background =
            "color-mix(in srgb,var(--accent) 10%,var(--surf))";
          authorEl.style.borderColor =
            "color-mix(in srgb,var(--accent) 30%,var(--bd))";
        }
      }
      if (header.tips) {
        const tipsEl = root.getElementById("dl-tips") as HTMLElement | null;
        if (tipsEl) {
          tipsEl.innerHTML =
            '<div style="font-weight:600;font-size:9px;color:var(--accent);margin-bottom:2px">📝 头部信息</div><div>' +
            esc(header.tips) +
            "</div>";
          tipsEl.style.display = "block";
        }
      }
      updatePreview();
    } catch (_) {}
  };

  const fromHeaderChk = root.getElementById(
    "dl-from-header",
  ) as HTMLInputElement | null;
  if (fromHeaderChk) {
    on(fromHeaderChk, "change", async () => {
      if (fromHeaderChk.checked) {
        await loadHeaderFromBase64();
      } else {
        // 取消勾选时隐藏 tips，不清空已填入的作者（用户可能想保留）
        const tipsEl = root.getElementById("dl-tips") as HTMLElement | null;
        if (tipsEl) tipsEl.style.display = "none";
      }
    });
  }

  ["dl-author", "dl-work", "dl-chara", "dl-variant", "dl-date"].forEach(
    (id) => {
      const el = root.getElementById(id);
      if (el) on(el, "input", updatePreview);
    },
  );
  const dateAutoEl = root.getElementById("dl-date-auto");
  if (dateAutoEl) on(dateAutoEl, "change", updatePreview);

  // 拖拽事件 — 区域内独立处理，阻止冒泡到全局 handler
  on(dropZone, "dragover", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = "var(--accent)";
  });
  on(dropZone, "dragleave", (e: DragEvent) => {
    e.stopPropagation();
    dropZone.style.borderColor = "";
  });
  on(dropZone, "drop", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = "";
    const items = e.dataTransfer?.items;
    if (items?.length) {
      processDropItems(items);
    } else {
      // 回退到 files
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      let ok = 0;
      let skip = 0;
      Array.from(files).forEach((file) => {
        if (!isImportableFile(file.name)) {
          skip++;
          return;
        }
        ok++;
        readAndRouteFile(file);
      });
      if (ok === 0 && skip > 0) {
        bus.emit("toast:show", {
          msg: "⚠️ 不支持的格式，仅支持 " + extsStr,
          duration: 4000,
          type: "warn",
        });
      }
      updateQueueCount();
    }
  });

  // 点击：普通点击选文件，Ctrl+点击选文件夹
  let clickLocked = false;
  on(dropZone, "click", (e: MouseEvent) => {
    if (clickLocked) return;
    clickLocked = true;
    setTimeout(() => {
      clickLocked = false;
    }, 500);
    if (e.ctrlKey || e.metaKey) {
      folderInput.click();
    } else {
      fileInput.click();
    }
  });
  on(fileInput, "change", () => {
    const files = fileInput.files;
    if (!files || !files.length) return;
    let ok = 0;
    let skip = 0;
    Array.from(files).forEach((file) => {
      if (!isImportableFile(file.name)) {
        skip++;
        return;
      }
      ok++;
      readAndRouteFile(file);
    });
    updateQueueCount();
    if (ok === 0 && skip > 0) {
      bus.emit("toast:show", {
        msg: "⚠️ 不支持的格式，仅支持 " + extsStr,
        duration: 4000,
        type: "warn",
      });
    }
    fileInput.value = "";
  });
  on(folderInput, "change", () => {
    const files = folderInput.files;
    if (!files || !files.length) return;
    // webkitdirectory 的 File 带 webkitRelativePath（保留层级），构造 relPath 后走统一路由
    const byRel = Array.from(files).map((file) => ({
      file: file as ImportFile,
      relPath: (file as File & { webkitRelativePath?: string })
        .webkitRelativePath || file.name,
    }));
    void routeCollected(byRel).then(() => {
      updateQueueCount();
      if (fileQueue.length > 0) {
        bus.emit("toast:show", {
          msg: `📁 已加入队列: ${fileQueue.length} 个模型文件`,
          duration: 2000,
          type: "success",
        });
      }
    });
    folderInput.value = "";
  });

  // 导入按钮
  const importBtn = root.getElementById("dl-import");
  if (importBtn)
    on(importBtn, "click", async () => {
      if (_importing) return; // 并发守卫：防连点弹出多个重命名对话框/重复导入
      _importing = true;
    try {
    const a = (root.getElementById("dl-author") as HTMLInputElement).value.trim();
    const w = (root.getElementById("dl-work") as HTMLInputElement).value.trim();
    const c = (root.getElementById("dl-chara") as HTMLInputElement).value.trim();
    const v = (root.getElementById("dl-variant") as HTMLInputElement).value.trim();
    const d = (root.getElementById("dl-date") as HTMLInputElement).value.trim();
    const ext = currentFileName?.split(".").pop() || RESOURCE_TYPES.YSM;

    let newName: string;
    if (c) {
      const parts: string[] = [];
      if (a) parts.push("[" + a + "]");
      parts.push("【" + (w || "未知") + "】");
      parts.push(c);
      if (v) parts.push("-" + v);
      if (d) parts.push(" (" + d + ")");
      newName = parts.join("") + "." + ext;
    } else {
      // 未填写角色名 → 使用原文件名
      newName = currentFileName || "untitled." + ext;
    }

    // 覆盖分支（catch 内）也要用 finalName，提升到 try 外声明
    let finalName = "";
    try {
      const { LoadAppConfig, ImportModelFileTo } = await getApp();
      const cfg = await LoadAppConfig();
      if (!cfg.filesRoot) {
        bus.emit("toast:show", {
          msg: "请先配置存储路径",
          duration: 4000,
          type: "warn",
        });
        return;
      }
      // 从 relPath 提取子目录，如 "folder/sub/model.ysm" → "folder/sub"
      const subpath = currentRelPath
        ? currentRelPath.substring(0, currentRelPath.lastIndexOf("/"))
        : "";
      // 先弹出重命名确认对话框，确认后再导入
      const renameTo = await showRenameDialog(null, newName);
      if (!renameTo) {
        bus.emit("toast:show", {
          msg: "已取消导入",
          duration: 2000,
          type: "info",
        });
        return;
      }
      finalName = renameTo;

      await ImportModelFileTo(finalName, subpath, currentBase64 || "");
      bus.emit("stats:refresh");
      bus.emit("tree:reload");

      bus.emit("toast:show", {
        msg: "✅ 已导入: " + finalName,
        duration: 3000,
        type: "success",
      });
      // 刷新 repo 文件缓存
      repoFiles = null;
      loadRepoFiles();

      // 加入已导入列表（全局历史）
      ImportHistory.push({
        name: finalName,
        time: new Date().toLocaleTimeString(),
        isYsm: true,
      });
      // 从队列中移除已导入的文件
      const importedIdx = fileQueue.findIndex((fq) => fq.file === currentFile);
      if (importedIdx >= 0) fileQueue.splice(importedIdx, 1);
      renderImportedList();

      // 重置表单 → 队列中还有文件则继续
      currentFile = null;
      currentBase64 = null;
      currentFileName = null;
      currentRelPath = "";
      advanceQueue();
    } catch (e) {
      const errMsg = String(e);
      if (errMsg.includes("FILE_EXISTS") || errMsg.includes("文件已存在")) {
        const confirmed = await modalConfirm({
          title: "文件已存在",
          icon: "📦",
          message: `"${finalName}" 已存在，是否覆盖？`,
          okText: "覆盖",
          danger: true,
        });
        if (confirmed) {
          try {
            const { ImportModelFileOverwriteTo } = await getApp();
            const subpath2 = currentRelPath
              ? currentRelPath.substring(0, currentRelPath.lastIndexOf("/"))
              : "";
            await ImportModelFileOverwriteTo(finalName, subpath2, currentBase64 || "");
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
            bus.emit("toast:show", {
              msg: "✅ 已覆盖: " + finalName,
              duration: 2000,
              type: "success",
            });
            // 刷新 repo 文件缓存
            repoFiles = null;
            loadRepoFiles();
            // 继续正常流程（全局历史）
            ImportHistory.push({
              name: finalName,
              time: new Date().toLocaleTimeString(),
              isYsm: true,
            });
            const importedIdx = fileQueue.findIndex(
              (fq) => fq.file === currentFile,
            );
            if (importedIdx >= 0) fileQueue.splice(importedIdx, 1);
            renderImportedList();
            currentFile = null;
            currentBase64 = null;
            currentFileName = null;
            currentRelPath = "";
            advanceQueue();
            return;
          } catch (e2) {
            bus.emit("toast:show", {
              msg: "❌ 覆盖失败: " + String(e2),
              duration: 4000,
              type: "error",
            });
            return;
          }
        }
      }
      bus.emit("toast:show", {
        msg: "❌ 导入失败: " + errMsg,
        duration: 5000,
        type: "error",
      });
    }
    } finally {
      _importing = false;
    }
  });

  // 取消按钮：关闭表单，回到拖拽区，正在编辑的项回到队列
  const cancelBtn = root.getElementById("dl-cancel");
  if (cancelBtn)
    on(cancelBtn, "click", () => {
      currentFile = null;
      currentBase64 = null;
      currentFileName = null;
      toggleForm(false);
      renderImportedList();
    });

  // 添加文件到导入队列
  let repoFiles: Set<string> | null = null; // 仓库文件名缓存
  const loadRepoFiles = async (): Promise<void> => {
    try {
      const { ScanModelEntries, GetRepoRoot } = await getApp();
      const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
      if (!repoRoot) return;
      const entries = (await ScanModelEntries(repoRoot)) || [];
      repoFiles = new Set(entries.map((e) => e.Name.replace(/\.ban$/i, "")));
    } catch {
      repoFiles = new Set();
    }
  };

  const enqueueFile = (file: ImportFile, base64: string): void => {
    // 检查文件名是否已在队列或已导入列表中（renamed 字段已废弃，i.name 即当前磁盘文件名）
    const dup =
      fileQueue.some((fq) => fq.name === file.name) ||
      ImportHistory.records.some((i) => i.name === file.name);
    if (dup) return;
    fileQueue.push({
      file,
      base64,
      name: file.name,
      size: file.size,
      relPath: file._relPath || "",
    });
    if (!currentFile) {
      showForm(file, base64);
    }
    renderImportedList();
    // 首次添加文件时加载仓库文件列表
    if (!repoFiles) loadRepoFiles();
  };

  // 递归收集文件夹内的所有文件（不过滤，交由 routeCollected 路由：
  // 含 ysm.json 的文件夹 → 整组导入；否则逐文件现有流程）
  const collectEntry = (
    entry: FileSystemEntry,
    basePath: string,
  ): Promise<Array<{ file: ImportFile; relPath: string }>> => {
    return new Promise((resolve) => {
      try {
        if (entry.isFile) {
          // entry.file 是 callback API，Promise 化后再路由（失败如 .lnk 快捷方式 → 跳过）
          // 注意：executor 内同步异常会被 Promise 构造器转成 rejection（不传播到外层
          // try/catch），必须补 rejection handler 恢复 fail-soft，否则 collectEntry 永不 resolve。
          new Promise<File | null>((resolve) => {
            (entry as FileSystemFileEntry).file(
              (f) => resolve(f),
              () => resolve(null), // entry.file 回调失败（如 .lnk 快捷方式）→ 跳过
            );
          }).then(
            (file) => {
              if (file) {
                const relPath = basePath
                  ? basePath + "/" + file.name
                  : file.name;
                resolve([{ file: file as ImportFile, relPath }]);
              } else {
                resolve([]);
              }
            },
            () => resolve([]), // executor 同步异常 → 不阻塞整个导入
          );
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          const subPath = basePath
            ? basePath + "/" + entry.name
            : entry.name;
          const collected: Array<{ file: ImportFile; relPath: string }> = [];
          // readEntries 单次最多返回 100 条（浏览器 API 契约），循环读取直到返回空数组
          const readAll = (): void => {
            dirReader.readEntries(
              (entries) => {
                if (!entries || !entries.length) {
                  resolve(collected);
                  return;
                }
                Promise.all(
                  Array.from(entries).map((e) => collectEntry(e, subPath)),
                ).then((groups) => {
                  for (const g of groups) collected.push(...g);
                  readAll();
                });
              },
              () => resolve(collected), // readEntries 失败 → 返回已收集
            );
          };
          readAll();
        } else {
          resolve([]);
        }
      } catch {
        resolve([]); // 任何异常不阻塞整个导入
      }
    });
  };

  // 文件夹整组导入：转发全局执行器（历史/去重/toast 单点，ADR-038 关联）
  const importModelFolder = async (
    dirRel: string,
    files: Array<{ file: ImportFile; relPath: string }>,
  ): Promise<void> => {
    await execImportFolder(dirRel, files);
  };

  // 路由一组收集到的文件：文件夹 → 整组导入（含 ysm.json 与普通文件夹一视同仁，
  // 组内至少 1 个支持文件）；散落单文件 → 直接导入
  const routeCollected = async (
    collected: Array<{ file: ImportFile; relPath: string }>,
  ): Promise<void> => {
    const { folders, singles } = groupCollected(collected);
    for (const g of folders) {
      await importModelFolder(
        g.dir,
        g.files as Array<{ file: ImportFile; relPath: string }>,
      );
    }
    for (const c of singles) {
      (c.file as ImportFile)._relPath = c.relPath;
      await directImport(c.file);
    }
  };

  // 处理拖入的 items（支持文件和文件夹）
  const processDropItems = (items: DataTransferItemList): void => {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (!entries.length) {
      // 回退：webkitGetAsEntry 不可用时直接用 getAsFile
      let ok = 0;
      let skip = 0;
      for (let i = 0; i < items.length; i++) {
        const file = items[i].getAsFile?.();
        if (!file || !isImportableFile(file.name)) {
          skip++;
          continue;
        }
        ok++;
        readAndRouteFile(file);
      }
      updateQueueCount();
      if (ok > 0) {
        bus.emit("toast:show", {
          msg: `📥 已加入队列: ${ok} 个文件`,
          duration: 2000,
          type: "success",
        });
      }
      return;
    }
    Promise.all(entries.map((entry) => collectEntry(entry, "")))
      .then(async (groups) => {
        const all = groups.flat();
        await routeCollected(all);
        updateQueueCount();
        if (fileQueue.length > 0) {
          bus.emit("toast:show", {
            msg: `📥 已加入队列: ${fileQueue.length} 个文件`,
            duration: 2000,
            type: "success",
          });
        }
      })
      .catch((err) => {
        console.warn("[import-queue] 读取拖入项失败:", err);
        bus.emit("toast:show", {
          msg: "❌ 读取拖入文件失败",
          duration: 3000,
          type: "error",
        });
      });
  };

  // 非 YSM 文件直接导入（跳过命名表单）：转发全局执行器（历史/去重/toast 单点）
  const directImport = async (file: ImportFile): Promise<void> => {
    await execDirectImport(file);
  };

  // 渲染已导入列表（含队列）：数据源为全局 ImportHistory（拖拽直导与手动导入统一）
  const renderImportedList = (): void => {
    let html = "";
    ImportHistory.records.forEach((item) => {
      html +=
        '<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;font-size:10px;border:1px solid var(--bd)">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
        renderFormattedText(item.name) +
        "</span>" +
        '<span style="font-size:9px;color:var(--muted);flex-shrink:0">' +
        (item.time || "") +
        "</span>" +
        (item.isYsm !== false
          ? '<button class="dl-reimport" data-name="' +
            esc(item.name) +
            '" style="padding:1px 5px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">✂️</button>'
          : "") +
        "</div>";
    });
    fileQueue.forEach((fq, qi) => {
      const isEditing = currentFile === fq.file;
      html +=
        '<div class="dl-q-item" data-idx="' +
        qi +
        '" style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;font-size:10px;border:1px ' +
        (isEditing ? "solid" : "dashed") +
        " var(--bd);background:" +
        (isEditing ? "var(--hover)" : "var(--surf)") +
        ';cursor:pointer">' +
        '<span style="color:var(--muted);font-size:9px">' +
        (isEditing
          ? "✏️"
          : repoFiles?.has(fq.name.replace(/\.\w+$/, ""))
            ? "⚠️"
            : "⏳") +
        "</span>" +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
        renderFormattedText(fq.name) +
        "</span>" +
        '<button class="dl-remove-q" data-idx="' +
        qi +
        '" style="padding:1px 6px;border-radius:3px;border:1px solid #e5534b44;background:transparent;color:#e5534b;cursor:pointer;font-size:9px;flex-shrink:0">移除</button>' +
        "</div>";
    });
    if (!html)
      html =
        '<div style="font-size:var(--fs-sm);color:var(--muted);padding:4px">暂无文件</div>';
    importedList.innerHTML = html;
    updateQueueCount();

    // 已导入的重命名按钮
    importedList.querySelectorAll(".dl-reimport").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (_importing) return; // 并发守卫：与 dl-import 共用槽位
        _importing = true;
        try {
        const name = (btn as HTMLElement).dataset.name || "";
        const { RenameFile, LoadAppConfig, GetRepoRoot } = await getApp();
        void LoadAppConfig;
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const fullPath = repoRoot + "/" + name;
        const newName = await showRenameDialog(fullPath, name);
        if (!newName) return;
        try {
          await RenameFile(fullPath, newName);
          ImportHistory.rename(name, newName);
          renderImportedList();
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 3000,
            type: "error",
          });
        }
        } finally {
          _importing = false;
        }
      });
    });

    // 队列行点击 → 设置为当前编辑项
    importedList.querySelectorAll(".dl-q-item").forEach((rowEl) => {
      const row = rowEl as HTMLElement;
      row.addEventListener("click", (e: MouseEvent) => {
        if ((e.target as Element).closest(".dl-remove-q")) return;
        const qi = parseInt((row as HTMLElement).dataset.idx || "", 10);
        const fq = fileQueue[qi];
        if (!fq) return;
        showForm(fq.file, fq.base64);
        renderImportedList();
      });
    });

    // 队列移除
    importedList.querySelectorAll(".dl-remove-q").forEach((btnEl) => {
      const btn = btnEl as HTMLElement;
      btn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        const qi = parseInt((btn as HTMLElement).dataset.idx || "", 10);
        fileQueue.splice(qi, 1);
        if (fileQueue.length === 0) {
          // 队列空了 → 回到拖拽区
          currentFile = null;
          currentBase64 = null;
          currentFileName = null;
          toggleForm(false);
        } else if (
          currentFile &&
          fileQueue.every((fq) => fq.file !== currentFile)
        ) {
          // 当前编辑的文件被移除 → 自动切到队列第一个
          showForm(fileQueue[0].file, fileQueue[0].base64);
        }
        renderImportedList();
      });
    });
  };

  const updateQueueCount = (): void => {
    if (dlQueueCount) dlQueueCount.textContent = String(fileQueue.length);
    if (dlCount)
      dlCount.textContent =
        ImportHistory.records.length +
        " 个已导入" +
        (fileQueue.length ? " · " + fileQueue.length + " 个待处理" : "");
  };

  // 清空列表（清全局导入历史）
  const clearListBtn = root.getElementById("dl-clear-list");
  if (clearListBtn)
    on(clearListBtn, "click", () => {
      ImportHistory.clear();
      renderImportedList();
    });

  renderImportedList();

  // 全局导入历史变化 → 刷新已导入列表（拖拽直导走 import-executor，本 tab 需同步）
  const historyUnsub = bus.on("import:history-changed", () => {
    renderImportedList();
  });

  // 返回清理函数
  return () => {
    if (conflictTimer) clearTimeout(conflictTimer);
    cleanups.forEach((fn) => fn());
    historyUnsub();
  };
}
