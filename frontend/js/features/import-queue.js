// ===== 导入队列 + 拖拽 + 重命名流程 =====
import { bus } from "../bus.js";
import { parseModelName, renderDisplayName } from "../utils/display.js";
import { modalConfirm } from "../dialogs/modal.js";

export function initImportQueue(app) {
  const root = app._root;
  const esc = (s) => app._esc(s);
  const dropZone = root.getElementById("dl-drop");
  const fileInput = root.getElementById("dl-file-input");
  const folderInput = root.getElementById("dl-folder-input");
  const importedList = root.getElementById("dl-imported-list");
  const dlCount = root.getElementById("dl-count");
  // 存储当前文件信息
  let currentFile = null;
  let currentBase64 = null;
  let currentFileName = null;
  let currentRelPath = ""; // 文件夹导入时的相对路径
  const imported = []; // { name, base64, renamed, time }
  const fileQueue = []; // { file, base64, name, size }

  // 切换拖拽区 ↔ 表单（简单 display 切换）
  const toggleForm = (visible) => {
    const form = root.getElementById("dl-form");
    if (visible) {
      dropZone.style.display = "none";
      if (form) form.style.display = "flex";
    } else {
      dropZone.style.display = "flex";
      if (form) form.style.display = "none";
    }
  };

  const showForm = (file, base64) => {
    currentFile = file;
    currentBase64 = base64;
    currentFileName = file.name;
    currentRelPath = file._relPath || "";

    const parsed = parseModelName(file.name);

    root.getElementById("dl-author").value = parsed.author || "";
    root.getElementById("dl-work").value = parsed.work || "";
    root.getElementById("dl-chara").value = parsed.chara || "";
    root.getElementById("dl-variant").value = "";
    root.getElementById("dl-date").value = parsed.date || "";
    updatePreview();

    toggleForm(true);

    // 存临时文件供右侧预览面板读取
    (async () => {
      try {
        const { SavePreviewTempFile } =
          await import("../../wailsjs/go/main/App.js");
        const tmpPath = await SavePreviewTempFile(base64);
        if (tmpPath) {
          bus.emit("model:select", { path: tmpPath });
        }
      } catch (_) {}
    })();
  };

  // 检查文件是否已存在（防抖）
  let conflictTimer = null;
  const checkConflictDebounced = (name) => {
    if (conflictTimer) clearTimeout(conflictTimer);
    conflictTimer = setTimeout(async () => {
      try {
        const { CheckFileExists, LoadAppConfig } =
          await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const fullPath = (cfg.repoRoot || "") + "\\" + name;
        const exists = await CheckFileExists(fullPath);
        const el = root.getElementById("dl-conflict");
        if (el) el.style.display = exists ? "" : "none";
      } catch {}
    }, 400);
  };

  const updatePreview = () => {
    const a = root.getElementById("dl-author").value.trim();
    const w = root.getElementById("dl-work").value.trim();
    const c = root.getElementById("dl-chara").value.trim();
    const v = root.getElementById("dl-variant").value.trim();
    const manualDate = root.getElementById("dl-date").value.trim();
    const autoOn = root.getElementById("dl-date-auto").checked;
    const autoDate =
      new Date().getFullYear() +
      "-" +
      String(new Date().getMonth() + 1).padStart(2, "0");
    const d = manualDate || (autoOn ? autoDate : "");
    const parts = [];
    if (a) parts.push("[" + a + "]");
    if (w) parts.push("【" + w + "】");
    parts.push(c || "?");
    if (v) parts.push("-" + v);
    if (d) parts.push("(" + d + ")");
    const ext = currentFileName?.split(".").pop() || "ysm";
    const preview = parts.join(" ") + "." + ext;
    root.getElementById("dl-preview").textContent = preview;

    // 检查冲突（防抖）
    checkConflictDebounced(preview);
  };

  // 从 Go 端解析 base64 头部元数据（复用 header.go 的完整解析逻辑）
  const loadHeaderFromBase64 = async () => {
    if (!currentBase64) return;
    try {
      const { ExtractYSMHeaderFromBase64 } =
        await import("../../wailsjs/go/main/App.js");
      const header = await ExtractYSMHeaderFromBase64(currentBase64);
      if (header.authorName) {
        const authorEl = root.getElementById("dl-author");
        if (!authorEl.value.trim()) {
          authorEl.value = header.authorName;
          authorEl.style.background =
            "color-mix(in srgb,var(--accent) 10%,var(--surf))";
          authorEl.style.borderColor =
            "color-mix(in srgb,var(--accent) 30%,var(--bd))";
        }
      }
      if (header.tips) {
        const tipsEl = root.getElementById("dl-tips");
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

  const fromHeaderChk = root.getElementById("dl-from-header");
  if (fromHeaderChk) {
    fromHeaderChk.addEventListener("change", async () => {
      if (fromHeaderChk.checked) {
        await loadHeaderFromBase64();
      } else {
        // 取消勾选时隐藏 tips，不清空已填入的作者（用户可能想保留）
        const tipsEl = root.getElementById("dl-tips");
        if (tipsEl) tipsEl.style.display = "none";
      }
    });
  }

  ["dl-author", "dl-work", "dl-chara", "dl-variant", "dl-date"].forEach(
    (id) => {
      root.getElementById(id)?.addEventListener("input", updatePreview);
    },
  );
  root
    .getElementById("dl-date-auto")
    ?.addEventListener("change", updatePreview);

  // 拖拽事件
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--accent)";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "";
    const items = e.dataTransfer.items;
    if (items?.length) {
      processDropItems(items);
    } else {
      // 回退到 files
      const files = e.dataTransfer.files;
      if (!files?.length) return;
      let ok = 0,
        skip = 0;
      Array.from(files).forEach((file) => {
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["ysm", "zip", "7z"].includes(ext)) {
          skip++;
          return;
        }
        ok++;
        const reader = new FileReader();
        reader.onload = () => enqueueFile(file, reader.result.split(",")[1]);
        reader.readAsDataURL(file);
      });
      if (ok === 0 && skip > 0) {
        bus.emit("toast:show", {
          msg: "⚠️ 仅支持 .ysm / .zip / .7z 格式，或拖入包含这些文件的整个文件夹",
          duration: 3000,
          type: "warn",
        });
      }
      updateQueueCount();
    }
  });

  // 点击：普通点击选文件，Ctrl+点击选文件夹
  let clickLocked = false;
  dropZone.addEventListener("click", (e) => {
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
  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (!files.length) return;
    let ok = 0;
    Array.from(files).forEach((file) => {
      ok++;
      const reader = new FileReader();
      reader.onload = () => enqueueFile(file, reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });
    updateQueueCount();
    fileInput.value = "";
  });
  folderInput.addEventListener("change", () => {
    const files = folderInput.files;
    if (!files.length) return;
    let ok = 0;
    Array.from(files).forEach((file) => {
      const ext = file.name.split(".").pop().toLowerCase();
      if (!["ysm", "zip", "7z"].includes(ext)) return;
      ok++;
      const reader = new FileReader();
      reader.onload = () => enqueueFile(file, reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });
    updateQueueCount();
    if (ok > 0) {
      bus.emit("toast:show", {
        msg: `📁 已加入队列: ${ok} 个模型文件`,
        duration: 2000,
        type: "success",
      });
    }
    folderInput.value = "";
  });

  // 导入按钮
  root.getElementById("dl-import")?.addEventListener("click", async () => {
    const a = root.getElementById("dl-author").value.trim();
    const w = root.getElementById("dl-work").value.trim();
    const c = root.getElementById("dl-chara").value.trim();
    const v = root.getElementById("dl-variant").value.trim();
    const d = root.getElementById("dl-date").value.trim();
    const ext = currentFileName?.split(".").pop() || "ysm";

    let newName;
    if (a || w || c) {
      newName =
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
    } else {
      // 未填写命名规范 → 使用原文件名
      newName = currentFileName || "untitled." + ext;
    }

    try {
      const { LoadAppConfig, ImportModelFileTo } =
        await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        bus.emit("toast:show", {
          msg: "请先在设置中配置仓库目录",
          duration: 4000,
          type: "warn",
        });
        return;
      }
      // 从 relPath 提取子目录，如 "folder/sub/model.ysm" → "folder/sub"
      const subpath = currentRelPath
        ? currentRelPath.substring(0, currentRelPath.lastIndexOf("/"))
        : "";
      await ImportModelFileTo(newName, subpath, currentBase64);
      bus.emit("stats:refresh");
      bus.emit("tree:reload");

      // 自动弹出重命名对话框
      try {
        const { showRenameDialog } = await import("../dialogs/rename.js");
        const { RenameFile } = await import("../../wailsjs/go/main/App.js");
        const renameTo = await showRenameDialog(
          (cfg.repoRoot || "") + "\\" + newName,
          newName,
        );
        if (renameTo && renameTo !== newName) {
          const fullImportPath =
            (cfg.repoRoot || "") +
            "\\" +
            (currentRelPath ? currentRelPath.replace(/\//g, "\\") + "\\" : "") +
            newName;
          await RenameFile(fullImportPath, renameTo);
          newName = renameTo;
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        }
      } catch (_) {
        /* 重命名失败不阻塞流程 */
      }

      bus.emit("toast:show", {
        msg: "✅ 已导入: " + newName,
        duration: 3000,
        type: "success",
      });

      // 加入已导入列表
      imported.unshift({
        name: newName,
        time: new Date().toLocaleTimeString(),
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
      if (fileQueue.length > 0) {
        const nextFq = fileQueue[0];
        showForm(nextFq.file, nextFq.base64);
      } else {
        toggleForm(false);
      }
    } catch (e) {
      const errMsg = String(e);
      if (errMsg.includes("FILE_EXISTS") || errMsg.includes("文件已存在")) {
        const confirmed = await modalConfirm({
          title: "文件已存在",
          icon: "📦",
          message: `"${newName}" 已存在，是否覆盖？`,
          okText: "覆盖",
          danger: true,
        });
        if (confirmed) {
          try {
            const { ImportModelFileOverwriteTo } =
              await import("../../wailsjs/go/main/App.js");
            const subpath2 = currentRelPath
              ? currentRelPath.substring(0, currentRelPath.lastIndexOf("/"))
              : "";
            await ImportModelFileOverwriteTo(newName, subpath2, currentBase64);
            bus.emit("toast:show", {
              msg: "✅ 已覆盖: " + newName,
              duration: 2000,
              type: "success",
            });
            // 继续正常流程
            imported.unshift({
              name: newName,
              time: new Date().toLocaleTimeString(),
            });
            const importedIdx = fileQueue.findIndex(
              (fq) => fq.file === currentFile,
            );
            if (importedIdx >= 0) fileQueue.splice(importedIdx, 1);
            renderImportedList();
            currentFile = null;
            currentBase64 = null;
            currentFileName = null;
            if (fileQueue.length > 0) {
              showForm(fileQueue[0].file, fileQueue[0].base64);
              renderImportedList();
            } else {
              toggleForm(false);
            }
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
  });

  // 取消按钮：关闭表单，回到拖拽区，正在编辑的项回到队列
  root.getElementById("dl-cancel")?.addEventListener("click", () => {
    currentFile = null;
    currentBase64 = null;
    currentFileName = null;
    toggleForm(false);
    renderImportedList();
  });

  // 添加文件到导入队列
  let repoFiles = null; // 仓库文件名缓存
  const loadRepoFiles = async () => {
    try {
      const { ScanModelEntries, LoadAppConfig } =
        await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      if (!cfg.repoRoot) return;
      const entries = await ScanModelEntries(cfg.repoRoot);
      repoFiles = new Set(entries.map((e) => e.Name.replace(/\.ban$/i, "")));
    } catch {
      repoFiles = new Set();
    }
  };

  const enqueueFile = (file, base64) => {
    // 检查文件名是否已在队列中
    const dup =
      fileQueue.some((fq) => fq.name === file.name) ||
      imported.some(
        (i) => i.name === file.name || (i.renamed || i.name) === file.name,
      );
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

  // 递归读取文件夹内的模型文件
  const readEntry = (entry, basePath) => {
    return new Promise((resolve) => {
      try {
        if (entry.isFile) {
          entry.file(
            (file) => {
              const ext = file.name.split(".").pop().toLowerCase();
              if (["ysm", "zip", "7z"].includes(ext)) {
                file._relPath = basePath
                  ? basePath + "/" + file.name
                  : file.name;
                const reader = new FileReader();
                reader.onload = () => {
                  enqueueFile(file, reader.result.split(",")[1]);
                  resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsDataURL(file);
              } else {
                resolve();
              }
            },
            () => resolve(), // entry.file 回调失败（如 .lnk 快捷方式）→ 直接跳过
          );
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          dirReader.readEntries(
            (entries) => {
              const subPath = basePath
                ? basePath + "/" + entry.name
                : entry.name;
              Promise.all(
                Array.from(entries).map((e) => readEntry(e, subPath)),
              ).then(() => resolve());
            },
            () => resolve(), // readEntries 失败时直接跳过
          );
        } else {
          resolve();
        }
      } catch {
        resolve(); // 任何异常不阻塞整个导入
      }
    });
  };

  // 处理拖入的 items（支持文件和文件夹）
  const processDropItems = (items) => {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (!entries.length) return;
    Promise.all(entries.map((entry) => readEntry(entry, ""))).then(() => {
      updateQueueCount();
      if (fileQueue.length > 0) {
        bus.emit("toast:show", {
          msg: `📥 已加入队列: ${fileQueue.length} 个文件`,
          duration: 2000,
          type: "success",
        });
      }
    });
  };

  // 渲染已导入列表（含队列）
  const renderImportedList = () => {
    let html = "";
    imported.forEach((item) => {
      html +=
        '<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;font-size:10px;border:1px solid var(--bd)">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
        esc(item.renamed || item.name) +
        "</span>" +
        '<span style="font-size:9px;color:var(--muted);flex-shrink:0">' +
        (item.time || "") +
        "</span>" +
        '<button class="dl-reimport" data-name="' +
        esc(item.name) +
        '" style="padding:1px 5px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">✂️</button>' +
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
        esc(fq.name) +
        "</span>" +
        '<button class="dl-remove-q" data-idx="' +
        qi +
        '" style="padding:1px 6px;border-radius:3px;border:1px solid #e5534b44;background:transparent;color:#e5534b;cursor:pointer;font-size:9px;flex-shrink:0">移除</button>' +
        "</div>";
    });
    if (!html)
      html =
        '<div style="font-size:9px;color:var(--muted);padding:4px">暂无文件</div>';
    importedList.innerHTML = html;
    updateQueueCount();

    // 已导入的重命名按钮
    importedList.querySelectorAll(".dl-reimport").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        const { showRenameDialog } = await import("../dialogs/rename.js");
        const { RenameFile, LoadAppConfig } =
          await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        const fullPath = repoRoot + "\\" + name;
        const newName = await showRenameDialog(fullPath, name);
        if (!newName) return;
        try {
          await RenameFile(fullPath, newName);
          const idx = imported.findIndex((it) => it.name === name);
          if (idx >= 0) imported[idx].name = newName;
          renderImportedList();
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + String(e),
            duration: 3000,
            type: "error",
          });
        }
      });
    });

    // 队列行点击 → 设置为当前编辑项
    importedList.querySelectorAll(".dl-q-item").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".dl-remove-q")) return;
        const qi = parseInt(row.dataset.idx, 10);
        const fq = fileQueue[qi];
        if (!fq) return;
        showForm(fq.file, fq.base64);
        renderImportedList();
      });
    });

    // 队列移除
    importedList.querySelectorAll(".dl-remove-q").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const qi = parseInt(btn.dataset.idx, 10);
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

  const updateQueueCount = () => {
    if (dlCount)
      dlCount.textContent =
        imported.length +
        " 个已导入" +
        (fileQueue.length ? " · " + fileQueue.length + " 个待处理" : "");
  };

  // 清空列表
  root.getElementById("dl-clear-list")?.addEventListener("click", () => {
    imported.length = 0;
    renderImportedList();
  });

  renderImportedList();

  // 处理待导入文件的通用函数
  const processPendingImport = () => {
    const list = window.__pendingImport;
    if (!list || list.length === 0) return;
    window.__pendingImport = null;
    window.__YSMPendingLock = true;
    let readCount = 0;
    list.forEach((item) => {
      if (!item.file) { readCount++; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        if (base64) enqueueFile(item.file, base64);
        readCount++;
        if (readCount === list.length) {
          renderImportedList();
          setTimeout(() => { window.__YSMPendingLock = false; }, 1000);
        }
      };
      reader.onerror = () => { readCount++; if (readCount === list.length) { renderImportedList(); window.__YSMPendingLock = false; } };
      reader.readAsDataURL(item.file);
    });
  };

  // 已在导入页时处理拖入文件
  bus.on("import:pending-files", processPendingImport);

  // 首次渲染时检查待导入文件（从其他页面跳转来的）
  processPendingImport();
}
