// 右键菜单 - 仓库树（文件夹/文件）
function showTreeContextMenu(e, ti) {
  e.preventDefault();
  closeContextMenu();
  const isFolder = !!ti.querySelector(".ar");
  contextMenu = createMenu(e.clientX, e.clientY);
  if (isFolder) {
    showFolderMenu(ti);
  } else {
    showFileMenu(ti);
  }
  document.body.appendChild(contextMenu);
}

function showFolderMenu(ti) {
  const items = [
    {
      label: "📂 展开全部",
      action: () => {
        tree
          .querySelectorAll(".ti:not(.open) > .ar")
          .forEach((ar) => ar.closest(".ti")?.click());
      },
    },
    {
      label: "📂 折叠全部",
      action: () => {
        tree
          .querySelectorAll(".ti.open > .ar")
          .forEach((ar) => ar.closest(".ti.open")?.click());
      },
    },
    {
      label: "📁 新建文件夹",
      action: async () => {
        const folderName = prompt("输入新文件夹名称：");
        if (!folderName) return;
        if (!/^[^\\\/:*?"<>|]+$/.test(folderName)) {
          showToast("❌ 文件夹名包含非法字符");
          return;
        }
        // 推算当前文件夹在仓库下的相对路径
        const firstFile =
          ti.nextElementSibling?.querySelector(".ti[data-path]");
        let relDir = "";
        if (firstFile) {
          const p = firstFile.dataset.path;
          if (p && repoRoot && p.startsWith(repoRoot)) {
            relDir = p.substring(repoRoot.length).replace(/^[\\\/]/, "");
            const idx = relDir.lastIndexOf("\\");
            if (idx >= 0) relDir = relDir.substring(0, idx);
          }
        }
        const targetPath = relDir ? relDir + "\\" + folderName : folderName;
        try {
          await window.go.main.App.CreateDir(targetPath);
          // 展开当前节点
          if (!ti.classList.contains("open")) {
            ti.click();
          }
          // 延迟刷新后新目录可见
          entries = await window.go.main.App.ScanModelEntries(repoRoot);
          buildTree();
          // 重新展开当前节点
          const newTi = tree.querySelector(`.ti .nm`); // 粗略触发刷新
          showToast("✅ 文件夹已创建: " + folderName);
        } catch (e) {
          showToast("❌ 创建失败: " + (e.message || e));
        }
      },
    },
    {
      label: "📂 在资源管理器打开",
      action: () => {
        // 文件夹路径从树节点的路径推算
        const path = ti.dataset.path || "";
        if (path) {
          window.go.main.App.OpenFolder(path);
        } else {
          // 没有 dataset.path 时，尝试遍历找到第一个文件的路径取目录
          const firstFile =
            ti.nextElementSibling?.querySelector(".ti[data-path]");
          if (firstFile) {
            const p = firstFile.dataset.path;
            const dir = p.substring(0, p.lastIndexOf("\\"));
            window.go.main.App.OpenFolder(dir);
          }
        }
      },
    },
  ];
  renderMenuItems(items);
}

function showFileMenu(ti) {
  const matchedPath = ti.dataset.path;
  const matched = matchedPath
    ? entries.find((e) => e.Path === matchedPath)
    : null;
  if (!matched) {
    contextMenu.innerHTML =
      '<div style="padding:6px 12px;font-size:10px;color:var(--muted)">未找到文件信息</div>';
    return;
  }
  const items = [];
  // 第一项：解析名称（点即复制文件名）
  items.push({
    label: "📋 复制文件名称",
    action: () => copyToClipboard(matched.Name),
  });

  // 启用/禁用切换
  const isBanned = isBannedEntry(matched);
  items.push({
    label: isBanned ? "✅ 启用" : "⛔ 禁用",
    action: async () => {
      try {
        const newState = await window.go.main.App.ToggleModelEnable(
          matched.Path,
        );
        showToast(
          newState
            ? "✅ 已启用: " + matched.Name
            : "⛔ 已禁用: " + matched.Name,
        );
        entries = await window.go.main.App.ScanModelEntries(repoRoot);
        buildTree();
        if (mcRoot) await refreshAll();
        if (window.bus && typeof window.bus.emit === "function") {
          window.bus.emit("sync:toggle-status");
        }
      } catch (e) {
        showToast("❌ 切换失败: " + (e.message || e));
      }
    },
  });

  // 哈希信息
  if (matched.Hash) {
    const duplicates = entries.filter(
      (e) => e.Hash === matched.Hash && e.Path !== matched.Path,
    );
    if (duplicates.length > 0) {
      items.push({
        label: "🔗 发现 " + duplicates.length + " 个重复文件",
        action: () => {},
      });
    } else {
      items.push({ label: "✅ 无重复文件", action: () => {} });
    }
  }

  // 文件操作
  items.push(
    {
      label: "🔑 复制文件哈希",
      action: () => copyToClipboard(matched.Hash || "无哈希"),
    },
    {
      label: "📂 打开所在文件夹",
      action: () => {
        const dir = matched.Path.substring(0, matched.Path.lastIndexOf("\\"));
        window.go.main.App.OpenFolder(dir || matched.Path);
      },
    },
  );
  renderMenuItems(items);
}
