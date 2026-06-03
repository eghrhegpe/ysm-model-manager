// 拖拽导入
const dropOverlay = document.createElement("div");
dropOverlay.style.cssText =
  "position:fixed;inset:0;z-index:99998;background:rgba(124,131,255,.15);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;pointer-events:none";
dropOverlay.innerHTML =
  '<div style="background:var(--surf);border:2px dashed var(--accent);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent)">放开以导入模型</div><div style="font-size:11px;color:var(--muted);margin-top:4px">支持 .ysm / .zip / .7z 文件</div></div>';
document.body.appendChild(dropOverlay);

let dropTimer = null;
document.addEventListener("dragover", (e) => {
  // 树内拖拽时不显示导入弹窗
  if (isTreeDrag || (e.target && e.target.closest && e.target.closest("#tree"))) {
    e.dataTransfer.dropEffect = "move";
    return;
  }
  e.preventDefault();
  dropOverlay.style.display = "flex";
  clearTimeout(dropTimer);
});
document.addEventListener("dragleave", (e) => {
  if (
    e.clientX <= 0 ||
    e.clientY <= 0 ||
    e.clientX >= window.innerWidth ||
    e.clientY >= window.innerHeight
  ) {
    dropTimer = setTimeout(() => {
      dropOverlay.style.display = "none";
    }, 200);
  }
});
document.addEventListener("drop", async (e) => {
  // 树内拖拽移动不触发导入
  if (isTreeDrag) { isTreeDrag = false; return; }
  e.preventDefault();
  dropOverlay.style.display = "none";
  if (!repoRoot) {
    showToast("请先选择仓库目录");
    return;
  }

  const items = Array.from(e.dataTransfer.items);
  const files = [];

  async function getFiles(entry, basePath) {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      const lower = file.name.toLowerCase();
      if (
        lower.endsWith(".ysm") ||
        lower.endsWith(".zip") ||
        lower.endsWith(".7z")
      ) {
        file._relPath = basePath ? basePath + "/" + file.name : file.name;
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve) =>
        reader.readEntries(resolve),
      );
      for (const en of entries)
        await getFiles(en, basePath ? basePath + "/" + entry.name : entry.name);
    }
  }

  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) await getFiles(entry, "");
    else if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        const lower = file.name.toLowerCase();
        if (
          lower.endsWith(".ysm") ||
          lower.endsWith(".zip") ||
          lower.endsWith(".7z")
        ) {
          file._relPath = file.name;
          files.push(file);
        }
      }
    }
  }

  if (!files.length) {
    showToast("没有找到支持的模型文件");
    return;
  }

  st.textContent = "⏳ 导入中 (" + files.length + " 个)...";
  let ok = 0,
    fail = 0;
  const detailList = [];

  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const binary = String.fromCharCode.apply(null, bytes);
      const base64 = btoa(binary);

      await window.go.main.App.ImportModelFile(file.name, base64);
      ok++;
      detailList.push({ name: file._relPath, type: "success" });
    } catch (err) {
      fail++;
      detailList.push({ name: file._relPath, type: "fail" });
      console.error("导入失败:", file._relPath, err);
    }
  }

  // 自动刷新仓库树和整合包列表
  entries = await window.go.main.App.ScanModelEntries(repoRoot);
  buildTree();
  if (mcRoot) await refreshAll();
  updateVersionStats(instances, statuses, entries);

  showSummaryDialog("📥 导入完成", ok, 0, fail, null, detailList);
  st.textContent = ok > 0 ? "✅ 导入 " + ok + " 个" : "❌ 导入失败";
});

// ===== 仓库树内部拖拽移动 =====
let dragSrcTi = null;
// 标记：是否正在树内拖拽
let isTreeDrag = false;

document.addEventListener("dragstart", (e) => {
  const ti = e.target.closest(".ti");
  if (!ti) return;
  // 只允许文件节点（不含 .ar 箭头的是文件）
  if (ti.querySelector(".ar")) {
    e.preventDefault();
    return;
  }
  dragSrcTi = ti;
  isTreeDrag = true; // 标记树内拖拽
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", ti.dataset.path || "");
  ti.style.opacity = "0.5";
});
document.addEventListener("dragend", (e) => {
  if (dragSrcTi) {
    dragSrcTi.style.opacity = "";
    dragSrcTi = null;
  }
  // 拖拽结束后清除标记
  isTreeDrag = false;
});
// 仓库树文件夹作为放置目标
tree.addEventListener("dragover", (e) => {
  const ti = e.target.closest(".ti");
  const folderTi = ti && ti.querySelector(".ar") ? ti : null;
  if (!folderTi) {
    e.dataTransfer.dropEffect = "none";
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  folderTi.style.background = "var(--act)";
});
tree.addEventListener("dragleave", (e) => {
  const ti = e.target.closest(".ti");
  if (ti) ti.style.background = "";
});
tree.addEventListener("drop", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  // 重置所有高亮
  tree.querySelectorAll(".ti").forEach((t) => (t.style.background = ""));
  isTreeDrag = false; // 清除标记，避免全局 drop 再处理
  if (!dragSrcTi) return;
  const ti = e.target.closest(".ti");
  const folderTi = ti && ti.querySelector(".ar") ? ti : null;
  if (!folderTi) {
    showToast("❌ 请拖拽到文件夹上");
    return;
  }
  const srcPath = dragSrcTi.dataset.path;
  if (!srcPath) {
    showToast("❌ 无法获取源文件路径");
    return;
  }
  // 计算目标文件夹路径
  const firstFile =
    folderTi.nextElementSibling?.querySelector(".ti[data-path]");
  let dstDir = "";
  if (firstFile) {
    const p = firstFile.dataset.path;
    if (p && repoRoot && p.startsWith(repoRoot)) {
      dstDir = p.substring(0, p.lastIndexOf("\\"));
    }
  } else {
    // 空文件夹，从仓库根路径推算
    const folderName =
      folderTi.querySelector(".nm")?.textContent?.replace(/^📁\s*/, "") || "";
    let ancestorParts = [folderName];
    let parent = folderTi.closest(".ch");
    while (parent) {
      const prevTi = parent.previousElementSibling;
      if (
        prevTi &&
        prevTi.classList.contains("ti") &&
        prevTi.querySelector(".ar")
      ) {
        const ancestorName =
          prevTi.querySelector(".nm")?.textContent?.replace(/^📁\s*/, "") || "";
        ancestorParts.unshift(ancestorName);
      }
      parent = parent.parentElement?.closest(".ch");
    }
    dstDir = repoRoot + "\\" + ancestorParts.join("\\");
  }
  try {
    await window.go.main.App.MoveModelFile(srcPath, dstDir);
    showToast("✅ 已移动: " + dragSrcTi.querySelector(".nm")?.textContent);
    // 刷新树
    entries = await window.go.main.App.ScanModelEntries(repoRoot);
    buildTree();
    // 展开目标文件夹
    if (folderTi && !folderTi.classList.contains("open")) {
      folderTi.click();
    }
  } catch (err) {
    showToast("❌ 移动失败: " + (err.message || err));
  }
});
