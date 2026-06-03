// 构建仓库树（含搜索高亮和筛选）
function buildTree() {
  if (!tree) {
    console.error("tree element not found");
    return;
  }
  tree.innerHTML = "";
  if (!entries || !entries.length) {
    tree.innerHTML =
      '<div style="color:var(--muted);font-size:12px;text-align:center;padding:30px 0">仓库为空</div>';
    return;
  }

  const query = (searchInput.value || "").trim().toLowerCase();
  const sortMode = sortSelect ? sortSelect.value : "name";
  const root = { name: "", children: {} };

  // 根据排序模式对 entries 排序
  const sortedEntries = [...entries].sort((a, b) => {
    if (sortMode === "name") {
      return a.Name.localeCompare(b.Name);
    } else if (sortMode === "size") {
      const sizeA = a.Size !== undefined && a.Size !== null ? a.Size : 0;
      const sizeB = b.Size !== undefined && b.Size !== null ? b.Size : 0;
      return sizeB - sizeA; // 大→小
    } else if (sortMode === "date") {
      const dateA = a.ModTime || 0;
      const dateB = b.ModTime || 0;
      return dateB - dateA; // 新→旧
    }
    return 0;
  });

  sortedEntries.forEach((e) => {
    if (!e || !e.Path) return;
    let relPath;
    if (repoRoot && e.Path.startsWith(repoRoot)) {
      relPath = e.Path.substring(repoRoot.length).replace(/^[\\\/]/, "");
    } else {
      relPath = e.Name || e.Path;
    }
    if (!relPath) return;
    // 搜索过滤：文件名不匹配则不显示
    if (query && !relPath.toLowerCase().includes(query)) return;
    const parts = relPath.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i]) continue;
      if (!node.children[parts[i]])
        node.children[parts[i]] = { name: parts[i], children: {} };
      node = node.children[parts[i]];
    }
    const fileName = parts[parts.length - 1];
    if (fileName && !node.children[fileName]) {
      node.children[fileName] = { name: fileName, entry: e };
    }
  });

  renderTree(tree, root, 0, query);
  if (!tree.children.length) {
    tree.innerHTML =
      '<div style="color:var(--muted);font-size:12px;text-align:center;padding:30px 0">仓库为空</div>';
  }
}

// 高亮文本：将匹配部分用 <mark> 包裹
function highlightText(text, query) {
  if (!query) return esc(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return esc(text);
  const before = esc(text.substring(0, idx));
  const match = esc(text.substring(idx, idx + query.length));
  const after = esc(text.substring(idx + query.length));
  return before + "<mark>" + match + "</mark>" + after;
}

function renderTree(parent, node, depth, query) {
  const hasQuery = !!(query && query.length > 0);
  const sortMode = sortSelect ? sortSelect.value : "name";
  // 计算完整祖先路径，用于文件夹展开/折叠持久化
  const parentTi = parent.previousElementSibling;
  const prefixPath =
    parentTi &&
    parentTi.classList.contains("ti") &&
    parentTi.querySelector(".ar")
      ? parentTi._dirFullPath || ""
      : repoRoot || "";
  const keys = Object.keys(node.children).sort((a, b) => {
    const aIsDir = node.children[a].entry === undefined;
    const bIsDir = node.children[b].entry === undefined;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    // 文件夹：始终按名称排序
    if (aIsDir && bIsDir) return a.localeCompare(b);
    // 文件：根据全局排序模式
    const entryA = node.children[a].entry;
    const entryB = node.children[b].entry;
    if (sortMode === "size") {
      return (entryB.Size || 0) - (entryA.Size || 0); // 大→小
    } else if (sortMode === "date") {
      return (entryB.ModTime || 0) - (entryA.ModTime || 0); // 新→旧
    }
    return a.localeCompare(b); // 名称模式
  });
  keys.forEach((key) => {
    const child = node.children[key];
    const isDir = child.entry === undefined;
    const ti = document.createElement("div");
    ti.className = "ti";
    if (isDir) {
      const ar = document.createElement("span");
      ar.className = "ar";
      ar.textContent = "▶";
      ti.appendChild(ar);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.innerHTML = "📁 " + highlightText(child.name, query);
      ti.appendChild(nm);

      // 从持久化状态恢复展开/折叠
      const dirFullPath = prefixPath
        ? prefixPath + "/" + child.name
        : child.name;
      ti._dirFullPath = dirFullPath;
      const shouldOpen = hasQuery || expandedDirs.has(dirFullPath);
      if (shouldOpen) {
        ti.classList.add("open");
        ar.textContent = "▼";
      }

      ti.addEventListener("click", (e) => {
        e.stopPropagation();
        ti.classList.toggle("open");
        ar.textContent = ti.classList.contains("open") ? "▼" : "▶";
        const ch = ti.nextElementSibling;
        if (ch && ch.classList.contains("ch"))
          ch.style.display = ti.classList.contains("open") ? "block" : "none";
        // 持久化展开状态（使用完整路径）
        if (ti.classList.contains("open")) {
          expandedDirs.add(dirFullPath);
        } else {
          expandedDirs.delete(dirFullPath);
        }
        localStorage.setItem(
          "expandedFolders",
          JSON.stringify([...expandedDirs]),
        );
      });
      parent.appendChild(ti);
      const ch = document.createElement("div");
      ch.className = "ch";
      ch.style.display = shouldOpen ? "block" : "none";
      parent.appendChild(ch);
      renderTree(ch, child, depth + 1, query);
    } else {
      ti.dataset.path = child.entry.Path;
      ti.draggable = true;
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.innerHTML = "📄 " + highlightText(child.name, query);
      ti.appendChild(nm);
      // 大小
      const sz = document.createElement("span");
      sz.className = "sz";
      if (child.entry.Size !== undefined && child.entry.Size !== null) {
        sz.textContent = fmt(child.entry.Size);
      } else {
        sz.textContent = "";
      }
      // 修改日期（使用当日/年显示风格）
      if (child.entry.ModTime) {
        const d = new Date(child.entry.ModTime);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const dateStr = isToday
          ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : d.toLocaleDateString([], { month: "short", day: "numeric" });
        sz.textContent += "  " + dateStr;
      }
      ti.appendChild(sz);
      parent.appendChild(ti);
    }
  });
}
