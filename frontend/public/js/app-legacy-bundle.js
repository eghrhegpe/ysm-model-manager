// ===== 存储工具 =====
const C = {
  _k: (k) => "ysm." + k,
  get(k) {
    try {
      return localStorage.getItem(this._k(k)) || "";
    } catch {
      return "";
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(this._k(k), v || "");
    } catch {}
  },
};

// ===== DOM 快捷选择 =====
const $ = (s) => document.querySelector(s);

// ===== DOM 元素引用 =====
const searchInput = $("#search-input");
const st = $("#st");
const tree = $("#tree");
const vg = $("#vg");
const sRepo = $("#s-repo");
const sVer = $("#s-ver");
const sOk = $("#s-ok");
const sTot = $("#s-tot");
const verSearch = $("#ver-search");
const sortSelect = $("#sort-select");
const ysmOnly = $("#ysm-only");

// ===== 全局状态 =====
const expandedDirs = new Set(
  JSON.parse(localStorage.getItem("expandedFolders") || "[]"),
);
let repoRoot = "";
let mcRoot = "";
let entries = [];
let instances = [];
let statuses = [];
let syncing = false;
let openName = "";
// 解析模型文件名
function parseModelName(name) {
  const result = { author: "", work: "", chara: "", date: "" };
  // [作者]【作品】角色 (日期).ext
  let m = name.match(
    /^\[([^\]]+)\]\s*【([^】]+)】\s*([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/,
  );
  if (m) {
    result.author = m[1];
    result.work = m[2];
    result.chara = m[3].trim();
    result.date = m[4] || "";
    return result;
  }
  // [作者]角色 (日期).ext
  m = name.match(
    /^\[([^\]]+)\]\s*([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/,
  );
  if (m) {
    result.author = m[1];
    result.chara = m[2].trim();
    result.date = m[3] || "";
    return result;
  }
  // 角色 (日期).ext
  m = name.match(/^([^(]+?)(?:\s*\((\d{4}(?:[\.\/-]\d{1,2})?)\))?\.[^.]+$/);
  if (m) {
    result.chara = m[1].trim();
    result.date = m[2] || "";
    return result;
  }
  return result;
}
// HTML 转义
function esc(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// 文件大小格式化
function fmt(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

// 判断文件是否被禁用（.ban 后缀）
function isBannedEntry(entry) {
  return entry && (entry.Name.endsWith(".ban") || entry.Path.endsWith(".ban"));
}

// 去掉 .ban 后缀
function stripBan(name) {
  return name.endsWith(".ban") ? name.slice(0, -4) : name;
}

// 统一异步调用包装（超时 + 错误处理）
const CALL_TIMEOUT = 15000; // 15 秒超时

async function safeCall(fn, ...args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT);
  try {
    const result = await Promise.race([
      fn(...args),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`操作超时（${CALL_TIMEOUT / 1000}秒）`));
        });
      }),
    ]);
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
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

// ===== 共享工具函数（供 buttons.js 和 directories.js 共用）=====
const $id = (id) => document.getElementById(id);
const $btn = (id) => {
  const el = $id(id);
  return el ? el : { addEventListener: () => {} };
};

// ===== buttons.js =====

// ===== 按钮事件绑定（带判空保护）=====
// $id/$btn already defined above

$btn("btn-enable-all").addEventListener("click", () => {
  tree
    ?.querySelectorAll(".ti:not(.open) > .ar")
    .forEach((ar) => ar.closest(".ti")?.click());
});
$btn("btn-disable-all").addEventListener("click", () => {
  tree
    ?.querySelectorAll(".ti.open > .ar")
    .forEach((ar) => ar.closest(".ti.open")?.click());
});

$btn("btn-sync-all").addEventListener("click", async () => {
  if (!mcRoot || !repoRoot) {
    showToast?.("请先选择仓库和游戏目录");
    return;
  }
  const totalMissing = (statuses || [])
    .filter((x) => x.HasYSM)
    .reduce((s, x) => s + (x.Missing ? x.Missing.length : 0), 0);
  if (totalMissing > 0) {
    await doSyncMissing?.();
  } else {
    await doSyncAll?.();
  }
});

$btn("btn-recycle").addEventListener("click", () => openRecycleDialog?.());
$btn("btn-logs").addEventListener("click", () => openLogDialog?.());
$btn("btn-settings").addEventListener("click", () => openSettingsDialog?.());
$btn("btn-refresh").addEventListener("click", () => loadAll?.());
$btn("btn-dedup").addEventListener("click", () => doDeduplicate?.());
$btn("btn-sync-toggle").addEventListener("click", async () => {
  if (!mcRoot || !repoRoot) {
    showToast?.("请先选择仓库和游戏目录");
    return;
  }
  st.textContent = "⏳ 同步状态中...";
  try {
    statuses = await window.go.main.App.GetInstanceStatus(mcRoot, repoRoot);
    renderVersions?.();
    updateInstallBtn?.();
    st.textContent = "就绪";
    showToast?.("✅ 同步状态已刷新");
  } catch (e) {
    showToast?.("同步状态刷新失败: " + (e.message || e));
    st.textContent = "❌ 失败";
  }
});

$btn("btn-upload").addEventListener("click", async () => {
  if (!mcRoot || !repoRoot) {
    showToast?.("请先选择仓库和游戏目录");
    return;
  }
  const repoNames = new Set((entries || []).map((e) => e.Name));
  const pendingList = [];
  (statuses || []).forEach((s) => {
    if (s.Extra) {
      s.Extra.forEach((name) => {
        if (!repoNames.has(name)) {
          const ins = (instances || []).find((x) => x.Name === s.Name);
          pendingList.push({ name, customDir: ins ? ins.CustomDir : "" });
        }
      });
    }
  });
  if (!pendingList.length) {
    showToast?.("没有待上传的模型，请先同步");
    return;
  }
  if (
    !(await showConfirm?.(
      "将 " + pendingList.length + " 个待上传模型上传到仓库？",
    ))
  )
    return;
  st.textContent = "⏳ 上传中...";
  let ok = 0,
    fail = 0;
  const detailList = [];
  for (const item of pendingList) {
    if (!item.customDir) {
      fail++;
      detailList.push({ name: item.name, type: "fail" });
      continue;
    }
    try {
      const n = await window.go.main.App.SyncCustomToRepo(
        item.customDir,
        repoRoot,
      );
      if (n > 0) {
        ok++;
        detailList.push({ name: item.name, type: "success" });
      } else {
        fail++;
        detailList.push({
          name: item.name,
          type: "fail",
          detail: "仓库已有同名文件",
        });
      }
    } catch (e) {
      fail++;
      detailList.push({
        name: item.name,
        type: "fail",
        detail: e.message || "未知错误",
      });
    }
  }
  showSummaryDialog?.("📤 上传完成", ok, 0, fail, null, detailList);
  entries = await window.go.main.App.ScanModelEntries(repoRoot);
  buildTree?.();
  if (mcRoot) await refreshAll?.();
});

$btn("ver-search").addEventListener("input", () => renderVersions?.());
$btn("ysm-only").addEventListener("change", () => renderVersions?.());

// 仓库搜索（全局变量 searchInput/sortSelect 在新版可能未定义）
if (typeof searchInput !== "undefined" && searchInput) {
  searchInput.addEventListener("input", () => buildTree?.());
}
if (typeof sortSelect !== "undefined" && sortSelect) {
  sortSelect.addEventListener("change", () => buildTree?.());
}

// ===== directories.js =====

// ===== 目录选择 =====
// $id/$btn already defined above

$btn("btn-repo").addEventListener("click", async () => {
  const dir = await window.go.main.App.SelectDirectory();
  if (!dir) return;
  repoRoot = dir;
  window.go.main.App.SetRepoRoot(dir);
  localStorage.setItem("repoRoot", dir);
  const btn = $id("btn-repo");
  if (btn) btn.textContent = "📁 " + dir;
  await saveConfig();
  await loadAll();
});

$btn("btn-mc").addEventListener("click", async () => {
  const dir = await window.go.main.App.SelectDirectory();
  if (!dir) return;
  mcRoot = dir;
  localStorage.setItem("mcRoot", dir);
  const btn = $id("btn-mc");
  if (btn) btn.textContent = "🎮 " + dir;
  await saveConfig();
  if (repoRoot) await loadAll();
});

// ===== 配置持久化到磁盘 =====
async function saveConfig() {
  const linkMode = localStorage.getItem("linkMode") || "";
  try {
    const theme = localStorage.getItem("theme") || "dark";
    await window.go.main.App.SaveAppConfig(repoRoot, mcRoot, linkMode, theme);
  } catch (e) {
    console.error("配置保存失败:", e);
  }
}

// ===== remaing files =====

// ===== 主题切换 =====
function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "light") {
    document.body.classList.add("light");
    var _btnTheme = document.getElementById("btn-theme");
    if (_btnTheme) _btnTheme.textContent = "☀️ 亮色";
  }
}

var _btnTheme = document.getElementById("btn-theme");
if (_btnTheme)
  _btnTheme.addEventListener("click", () => {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    var _b = document.getElementById("btn-theme");
    if (_b) _b.textContent = isLight ? "☀️ 亮色" : "🌙 暗色";
    localStorage.setItem("theme", isLight ? "light" : "dark");
  });

// 渲染单个版本卡片
function renderVersionCard(ins, status, counts, repoRoot, openInstance) {
  const card = document.createElement("div");
  card.className = "vc";

  // 头部（名称 + 统计）
  const head = renderVersionHead(ins, status, counts, openInstance);
  card.appendChild(head);

  // 身体（折叠内容）
  const body = renderVersionBody(ins, status, counts, repoRoot, openInstance);
  card.appendChild(body);

  return card;
}

// 渲染版本头部
function renderVersionHead(ins, status, counts, openInstance) {
  const head = document.createElement("div");
  head.className = "vh";
  head.dataset.insName = ins.Name;
  head.dataset.open = (openInstance === ins.Name).toString();

  // 状态颜色
  let statusColor = "#a6e3a1";
  if (counts.missing > 0 && counts.synced > 0) statusColor = "#f9a826";
  else if (counts.missing > 0 && counts.synced === 0) statusColor = "#f38ba8";
  else if (counts.disabled > 0 || counts.extra > 0) statusColor = "#f9a826";

  // 统计 HTML
  const statsHtml = status.HasYSM
    ? renderVersionStats(status, counts)
    : "❌ YSM";
  const vsColor = status.HasYSM ? statusColor : "var(--muted)";
  head.innerHTML = `
        <span class="vn">📦 ${esc(ins.Name)}</span>
        <span class="vs" style="color:${vsColor}">${statsHtml}</span>
    `;
  return head;
}

// 渲染版本身体（折叠内容）
function renderVersionBody(ins, status, counts, repoRoot, openInstance) {
  const body = document.createElement("div");
  body.className = "vb";
  body.style.display = openInstance === ins.Name ? "block" : "none";

  // 构建文件名→链接类型映射
  const linkMap = {};
  if (status.Files) {
    status.Files.forEach((f) => {
      linkMap[f.Name] = f.LinkType;
    });
  }

  // 模型搜索输入框
  const searchBar = document.createElement("div");
  searchBar.style.cssText = "padding:4px 8px;margin-bottom:4px";
  searchBar.innerHTML =
    '<input type="text" class="model-search-input" placeholder="🔍 筛选模型..." style="width:100%;padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:10px;outline:none">';
  const modelFilterInput = searchBar.querySelector("input");
  body.appendChild(searchBar);

  // 容器：所有区块包裹在 model-list-container 内，以便筛选时切换显示
  const listContainer = document.createElement("div");
  listContainer.className = "model-list-container";

  // 已同步列表
  if (counts.syncedRows.length) {
    listContainer.appendChild(
      createSection("✅ 已同步", counts.syncedRows, "synced", "", linkMap),
    );
  }
  // 禁用列表
  if (counts.disabledRows.length) {
    listContainer.appendChild(
      createSection(
        "⚠️ 仓库禁用",
        counts.disabledRows,
        "disabled",
        "",
        linkMap,
      ),
    );
  }
  // 缺失列表
  if (counts.missingRows.length) {
    listContainer.appendChild(
      createSection(
        "⬇️ 未安装",
        counts.missingRows,
        "missing",
        ins.CustomDir,
        linkMap,
      ),
    );
  }
  // 额外列表
  if (counts.extraRows.length) {
    listContainer.appendChild(
      createSection("📤 非仓库模型", counts.extraRows, "extra", "", linkMap),
    );
  }
  body.appendChild(listContainer);

  // 模型搜索筛选逻辑
  modelFilterInput.addEventListener("input", () => {
    const kw = modelFilterInput.value.trim().toLowerCase();
    listContainer.querySelectorAll(".sec").forEach((sec) => {
      let visibleCount = 0;
      const listDiv = sec.querySelector(".sec-list");
      if (!listDiv) return;
      listDiv.querySelectorAll(".row").forEach((row) => {
        const nameEl = row.querySelector(".rn");
        const name = (nameEl?.textContent || "").toLowerCase();
        const match = !kw || name.includes(kw);
        row.style.display = match ? "" : "none";
        if (match) visibleCount++;
      });
      // 更新区块标题中的数量
      const titleEl = sec.querySelector(".sec-title");
      if (titleEl) {
        const titleText = titleEl.textContent.replace(/\(\d+\)$/, "").trim();
        titleEl.textContent = `${titleText} (${visibleCount})`;
      }
      sec.style.display = visibleCount > 0 ? "" : "none";
    });
  });

  return body;
}

// 链接类型图标映射
const LINK_ICONS = {
  copy: "📄",
  hardlink: "🔗",
  symlink: "🔗",
  unknown: "",
};

// 辅助：创建区块（如"已同步""缺失"）
function createSection(title, rows, type, customDir = "", linkMap = {}) {
  const sec = document.createElement("div");
  sec.className = "sec";
  const titleSpan = document.createElement("span");
  titleSpan.className = "sec-title";
  titleSpan.textContent = `${title} (${rows.length})`;
  sec.appendChild(titleSpan);
  const listDiv = document.createElement("div");
  listDiv.className = "sec-list";
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    // 已同步的模型名用主文字色，未安装的用 muted 色
    const nameColor = type === "synced" ? "var(--txt)" : "var(--muted)";
    // 链接类型图标
    const linkIcon = LINK_ICONS[linkMap[row.name]] || "";
    if (type === "missing") {
      rowEl.innerHTML = `
                <span class="rn" title="${esc(row.rel)}" style="color:${nameColor}">${esc(row.name)}</span>
                <button data-path="${esc(row.entry.Path)}" data-custom-dir="${customDir}">安装</button>
            `;
    } else {
      rowEl.innerHTML = `<span class="rn" title="${esc(row.rel)}" style="color:${nameColor}">${esc(row.name)}</span>${linkIcon ? `<span class="link-icon" title="${linkTypeTitle(linkMap[row.name])}">${linkIcon}</span>` : ""}`;
    }
    listDiv.appendChild(rowEl);
  });
  sec.appendChild(listDiv);
  return sec;
}

// 链接类型中文描述
function linkTypeTitle(linkType) {
  switch (linkType) {
    case "copy":
      return "已复制";
    case "hardlink":
      return "硬链接";
    case "symlink":
      return "符号链接";
    default:
      return "";
  }
}
// ===== 版本列表渲染 =====
// 注意：此文件不使用 ES Module import/export，
// 而是依赖 HTML 中 <script> 标签的顺序加载。
// 子模块函数直接定义在全局作用域中。

// 主渲染函数（仅协调模块）
async function renderVersions() {
  vg.innerHTML = "";
  if (!instances.length) {
    vg.innerHTML =
      '<div style="color:var(--muted);font-size:12px;text-align:center;padding:30px 0">请指定 .minecraft 目录</div>';
    return;
  }

  // 1. 数据处理
  const verSearch = document.getElementById("ver-search");
  const ysmOnly = document.getElementById("ysm-only");
  const filtered = filterInstances(
    instances,
    verSearch?.value,
    ysmOnly?.checked,
  );
  const sorted = sortInstances(filtered, statuses);
  const openInstance = localStorage.getItem("openInstance");

  // 2. 渲染每个版本卡片
  sorted.forEach((ins) => {
    const status = statuses.find((s) => s.Name === ins.Name) || {
      Missing: [],
      Extra: [],
      Disabled: [],
    };
    const counts = calcVersionCounts(entries, status, repoRoot);
    const card = renderVersionCard(ins, status, counts, repoRoot, openInstance);
    bindVersionEvents(card, ins, status, repoRoot, refreshAll);
    vg.appendChild(card);
  });

  // 3. 更新统计
  updateVersionStats(instances, statuses, entries);
  if (typeof updateInstallBtn === "function") updateInstallBtn();
}

// 保留原 refreshAll（仅调用 renderVersions）
async function refreshAll() {
  if (!mcRoot || !repoRoot) return;
  try {
    instances = await window.go.main.App.ListVersionInstances(mcRoot);
    statuses = await window.go.main.App.GetInstanceStatus(mcRoot, repoRoot);
  } catch (e) {
    console.error("refreshAll error:", e);
    statuses = [];
  }
  renderVersions();
}
// 过滤实例（搜索 + YSM 筛选）
function filterInstances(instances, verKeyword, ysmOnlyChecked) {
  let result = instances;
  if (verKeyword) {
    const kw = verKeyword.toLowerCase();
    result = result.filter((ins) => ins.Name.toLowerCase().includes(kw));
  }
  if (ysmOnlyChecked) {
    result = result.filter((_, idx) => {
      // 注意：这里用 result[idx] 而不是 instances[idx]，因为 result 可能已被搜索过滤
      const sts = statuses.find((s) => s.Name === result[idx].Name);
      return sts && sts.HasYSM;
    });
  }
  return result;
}

// 排序实例（YSM 优先 → 缺失数升序）
function sortInstances(instances, statuses) {
  return [...instances].sort((a, b) => {
    const stsA = statuses.find((s) => s.Name === a.Name) || { Missing: [] };
    const stsB = statuses.find((s) => s.Name === b.Name) || { Missing: [] };
    if (stsA.HasYSM && !stsB.HasYSM) return -1;
    if (!stsA.HasYSM && stsB.HasYSM) return 1;
    return (stsA.Missing?.length || 0) - (stsB.Missing?.length || 0);
  });
}

// 计算版本状态计数（同步/禁用/缺失/额外）
function calcVersionCounts(entries, status, repoRoot) {
  let synced = 0,
    disabled = 0,
    missing = 0,
    extra = 0;
  const syncedRows = [],
    disabledRows = [],
    missingRows = [],
    extraRows = [];

  entries.forEach((e) => {
    const rel = repoRoot
      ? e.Path.substring(repoRoot.length).replace(/^[\\\/]/, "")
      : e.Name;
    const baseName = stripBan(e.Name);
    const isBanned = isBannedEntry(e);

    if (isBanned) {
      if (status.Disabled.includes(baseName)) {
        disabled++;
        disabledRows.push({ rel, entry: e, name: baseName });
      }
      return;
    }

    const isInstalled = status.Missing.indexOf(e.Name) === -1;
    if (isInstalled) {
      synced++;
      syncedRows.push({ rel, entry: e, name: baseName });
    } else {
      missing++;
      missingRows.push({ rel, entry: e, name: baseName });
    }
  });

  status.Extra.forEach((name) => {
    extra++;
    extraRows.push({ name });
  });

  return {
    synced,
    disabled,
    missing,
    extra,
    syncedRows,
    disabledRows,
    missingRows,
    extraRows,
  };
}
// 处理安装
async function handleInstall(srcPath, customDir, insName, refreshAll) {
  const status = statuses.find((s) => s.Name === insName);
  if (status && !status.HasYSM) {
    if (localStorage.getItem("skipYSMWarn") !== "true") {
      const skip = await showConfirm(
        "该整合包没有安装 YSM 模组，安装模型也无法使用。\n确定要继续安装吗？\n\n[勾选确定可不再提示]",
      );
      if (!skip) return;
      localStorage.setItem("skipYSMWarn", "true");
    }
  }
  st.textContent = "⏳ 安装中...";
  try {
    await window.go.main.App.InstallModelTo(srcPath, customDir);
    const shortName = (
      srcPath.split("\\").pop() ||
      srcPath.split("/").pop() ||
      srcPath
    ).substring(0, 30);
    st.textContent = "✅ 已安装: " + shortName;
    await refreshAll();
  } catch (err) {
    await window.go.main.App.AddImportLog(
      srcPath.split("/").pop(),
      srcPath,
      customDir,
      0,
      "failed",
      err.message || "安装失败",
    );
    showToast("❌ 安装失败，请查看 📋 导入日志");
  }
}

// 处理上传新模型到仓库
async function handleSyncBack(ins, repoRoot, refreshAll) {
  if (!ins || !repoRoot) {
    showToast("请先选择仓库目录");
    return;
  }
  if (!(await showConfirm(`确定将 ${ins.Name} 中的新模型导入仓库吗？`))) return;
  st.textContent = "⏳ 上传新模型到仓库中...";
  try {
    const n = await window.go.main.App.SyncCustomToRepo(
      ins.CustomDir,
      repoRoot,
    );
    showSummaryDialog("✅ 上传新模型到仓库完成", n, 0, 0);
    entries = await window.go.main.App.ScanModelEntries(repoRoot);
    buildTree();
    await refreshAll();
  } catch (e) {
    showToast("上传新模型到仓库失败: " + (e.message || e));
  }
}
// 绑定版本卡片事件（展开/收起、反向同步、安装）
function bindVersionEvents(card, ins, status, repoRoot, refreshAll) {
  const head = card.querySelector(".vh");
  const body = card.querySelector(".vb");

  // 展开/收起
  head.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    toggleVersionCard(head, body, ins.Name);
  });

  // 反向同步按钮
  const syncBackBtn = card.querySelector(".sync-back-btn");
  syncBackBtn?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await handleSyncBack(ins, repoRoot, refreshAll);
  });

  // 安装按钮
  const installBtns = card.querySelectorAll("button[data-path]");
  installBtns.forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await handleInstall(
        ev.target.dataset.path,
        ev.target.dataset.customDir,
        ins.Name,
        refreshAll,
      );
    });
  });
}

// 切换版本卡片展开状态
function toggleVersionCard(head, body, insName) {
  const isOpen = head.dataset.open === "true";
  if (isOpen) {
    head.dataset.open = "false";
    body.style.display = "none";
    localStorage.removeItem("openInstance");
  } else {
    // 关闭其他卡片
    document.querySelectorAll('.vh[data-open="true"]').forEach((h) => {
      h.dataset.open = "false";
      h.nextElementSibling.style.display = "none";
    });
    head.dataset.open = "true";
    body.style.display = "block";
    localStorage.setItem("openInstance", insName);
  }
}
// 生成版本状态统计 HTML（用于头部显示）
function renderVersionStats(status, counts) {
  let parts = [];
  if (counts.synced > 0) parts.push(`✅${counts.synced}`);
  if (counts.missing > 0) parts.push(`⬇️${counts.missing}`);
  if (counts.disabled > 0) parts.push(`⚠️${counts.disabled}`);
  if (counts.extra > 0) parts.push(`📤${counts.extra}`);
  return parts.join(" ") || "✅ 完整";
}

function updateVersionStats(instances, statuses, entries) {
  const insList = instances || [];
  const stsList = statuses || [];
  const entList = entries || [];

  const enabledModels = entList.filter((e) => !isBannedEntry(e)).length;
  const sRepo = document.getElementById("s-repo");
  if (sRepo) {
    sRepo.textContent = `${enabledModels}/${entList.length}`;
    sRepo.style.cursor = "pointer";
    sRepo.title = "点击聚焦仓库树";
    sRepo.onclick = () => {
      document.querySelector(".main-header-row .toggle-btn")?.click(); // 展开预览
      document.querySelector("#search-input")?.focus();
      // 如果左侧栏折叠则展开
      if (document.querySelector(".sidebar")?.style.overflow === "hidden") {
        document.querySelector("#btn-toggle-sidebar")?.click();
      }
    };
  }

  const ysmInstances = insList.filter((_, i) => stsList[i]?.HasYSM);
  const sVer = document.getElementById("s-ver");
  if (sVer) {
    sVer.textContent = `${ysmInstances.length}/${insList.length}`;
    sVer.style.cursor = "pointer";
    sVer.title = "点击聚焦版本列表";
    sVer.onclick = () => {
      document.querySelector("#ver-search")?.focus();
    };
  }

  const ok = stsList.filter(
    (s) =>
      s.HasYSM &&
      (!s.Missing || s.Missing.length === 0) &&
      (!s.Extra || s.Extra.length === 0),
  ).length;
  const sOk = document.getElementById("s-ok");
  const sTot = document.getElementById("s-tot");
  if (sOk) sOk.textContent = ok;
  if (sTot) sTot.textContent = stsList.filter((s) => s.HasYSM).length;

  // 待上传模型：整合包中有但仓库没有的模型
  let pendingCount = 0;
  const repoNames = new Set(entList.map((e) => e.Name));
  stsList.forEach((s) => {
    if (s.Extra) {
      s.Extra.forEach((name) => {
        if (!repoNames.has(name)) pendingCount++;
      });
    }
  });
  const sPending = document.getElementById("s-pending");
  if (sPending) {
    sPending.textContent = pendingCount;
    if (pendingCount > 0) {
      sPending.style.cursor = "pointer";
      sPending.title = "点击转到上传按钮";
      sPending.onclick = () => {
        document.querySelector("#btn-upload")?.click();
      };
    } else {
      sPending.style.cursor = "default";
      sPending.onclick = null;
    }
  }
}
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
// 右键菜单 - 入口
let contextMenu = null;

document.addEventListener("contextmenu", (e) => {
  const ti = e.target.closest(".ti");
  const vh = e.target.closest(".vh");
  if (!ti && !vh) {
    closeContextMenu();
    return;
  }
  if (vh) {
    showVersionContextMenu(e, vh);
    return;
  }
  showTreeContextMenu(e, ti);
});

document.addEventListener("click", closeContextMenu);

function closeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}
// 侧栏/预览切换 - 新版使用 Shadow DOM，旧版跳过
try {
  /* toggle.js skipped - handled by app-content */
} catch (e) {}

var _previewBtn = document.getElementById("btn-toggle-preview");
if (_previewBtn)
  _previewBtn.onclick = function () {
    previewOpen = !previewOpen;
    document.documentElement.style.setProperty(
      "--preview-width",
      previewOpen ? "240px" : "0px",
    );
    document.querySelector(".preview").style.overflow = previewOpen
      ? "auto"
      : "hidden";
    $("#btn-toggle-preview").textContent = previewOpen ? "▶" : "◀";
  };
// 拖拽导入
const dropOverlay = document.createElement("div");
dropOverlay.style.cssText =
  "position:fixed;inset:0;z-index:99998;background:rgba(124,131,255,.15);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;pointer-events:none";
dropOverlay.innerHTML =
  '<div style="background:var(--surf);border:2px dashed var(--accent);border-radius:12px;padding:30px 50px;text-align:center"><div style="font-size:30px;margin-bottom:8px">📥</div><div style="font-size:16px;font-weight:600;color:var(--accent)">放开以导入模型</div><div style="font-size:11px;color:var(--muted);margin-top:4px">支持 .ysm / .zip / .7z 文件</div></div>';
document.addEventListener("DOMContentLoaded", function () {
  document.body.appendChild(dropOverlay);
});

let dropTimer = null;
document.addEventListener("dragover", (e) => {
  // 树内拖拽时不显示导入弹窗
  if (
    isTreeDrag ||
    (e.target && e.target.closest && e.target.closest("#tree"))
  ) {
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
  if (isTreeDrag) {
    isTreeDrag = false;
    return;
  }
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
if (tree)
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
if (tree)
  tree.addEventListener("dragleave", (e) => {
    const ti = e.target.closest(".ti");
    if (ti) ti.style.background = "";
  });
if (tree)
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
            prevTi.querySelector(".nm")?.textContent?.replace(/^📁\s*/, "") ||
            "";
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
// 悬浮确认框
function showConfirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.5)";
    box.innerHTML = `
            <div style="font-size:12px;color:var(--txt);margin-bottom:12px;white-space:pre-wrap">${esc(msg)}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button id="cf-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
                <button id="cf-ok" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">确定</button>
            </div>
        `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector("#cf-cancel").onclick = () => {
      overlay.remove();
      resolve(false);
    };
    box.querySelector("#cf-ok").onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    };
  });
}

// 悬浮提示（自动消失）
function showToast(msg) {
  const existing = document.querySelector(".toast-msg");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast-msg";
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 16px;font-size:11px;color:var(--txt);box-shadow:0 4px 12px rgba(0,0,0,.4);max-width:80%;text-align:center";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
// 摘要对话框（支持详细清单）
function showSummaryDialog(title, success, skip, fail, customMsg, detailList) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:360px;max-height:80vh;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px";
  let html = '<div style="font-size:13px;font-weight:600">' + title + "</div>";
  html +=
    '<div style="font-size:11px;color:#a6e3a1">✅ 成功：' + success + "</div>";
  if (customMsg)
    html +=
      '<div style="font-size:11px;color:var(--txt);margin-top:2px">' +
      customMsg +
      "</div>";
  if (skip > 0)
    html +=
      '<div style="font-size:11px;color:#f9a826">⏭️ 跳过：' + skip + "</div>";
  if (fail > 0)
    html +=
      '<div style="font-size:11px;color:#f38ba8">❌ 失败：' + fail + "</div>";

  // 详细清单
  if (detailList && detailList.length > 0) {
    html +=
      '<div style="max-height:200px;overflow-y:auto;background:var(--bg);border-radius:5px;padding:6px;font-size:10px;margin-top:2px">';
    detailList.forEach((item) => {
      const icon =
        item.type === "success" ? "✅" : item.type === "skip" ? "⏭️" : "❌";
      html +=
        '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--bd)">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' +
        esc(item.name) +
        "</span>" +
        '<span style="flex-shrink:0;margin-left:8px;color:' +
        (item.type === "success"
          ? "#a6e3a1"
          : item.type === "skip"
            ? "#f9a826"
            : "#f38ba8") +
        '">' +
        icon +
        "</span>" +
        "</div>";
    });
    html += "</div>";
  }

  html += '<div style="display:flex;gap:4px;margin-top:4px">';
  html +=
    '<button id="summary-close" style="flex:1;padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">关闭</button>';
  if (fail > 0)
    html +=
      '<button id="summary-logs" style="flex:1;padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:11px">📋 查看日志</button>';
  html += "</div>";
  dialog.innerHTML = html;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#summary-close").onclick = () => overlay.remove();
  dialog.querySelector("#summary-logs")?.addEventListener("click", () => {
    overlay.remove();
    openLogDialog();
  });
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}
// ===== 对话框模块 =====

// 日志对话框
async function openLogDialog() {
  let logs = [];
  try {
    logs = await window.go.main.App.GetImportLogs();
  } catch {}
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:640px;height:420px;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:14px;display:flex;flex-direction:column";
  let logHtml =
    logs.length === 0
      ? '<div style="color:var(--muted);text-align:center;padding:20px">暂无导入记录</div>'
      : [...logs]
          .reverse()
          .map((l) => {
            const sColor =
              l.Status === "success"
                ? "#2ea44f"
                : l.Status === "skipped"
                  ? "#f9a826"
                  : "#ff6";
            const sText =
              l.Status === "success"
                ? "✅成功"
                : l.Status === "skipped"
                  ? "⏭️跳过"
                  : "❌失败";
            return (
              '<div style="padding:4px 0;border-bottom:1px solid var(--bd)"><div style="display:flex;justify-content:space-between"><span style="font-weight:600">' +
              esc(l.ModelName) +
              '</span><span style="color:' +
              sColor +
              '">' +
              sText +
              '</span></div><div style="color:var(--muted)">📅 ' +
              new Date(l.Timestamp).toLocaleString() +
              " | 📦 " +
              fmt(l.FileSize) +
              '</div><div style="color:var(--muted);word-break:break-all">📂 ' +
              esc(l.SourcePath) +
              "</div>" +
              (l.ErrorMsg
                ? '<div style="color:#ff6">⚠️ ' + esc(l.ErrorMsg) + "</div>"
                : "") +
              '<button class="log-copy-btn" data-info="' +
              esc(
                l.ModelName +
                  " | " +
                  l.Status +
                  " | " +
                  l.SourcePath +
                  (l.ErrorMsg ? " | " + l.ErrorMsg : ""),
              ) +
              '" style="padding:1px 5px;font-size:8px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;margin-top:2px">📋 复制</button>' +
              "</div>"
            );
          })
          .join("");
  dialog.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:13px">📋 导入日志</h3><div style="display:flex;gap:4px"><button id="log-copy-all" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer">📋 复制全部</button><button id="log-refresh" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">🔄 刷新</button><button id="log-clear" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:#ff6;cursor:pointer">🗑️ 清空</button><button id="log-close" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">关闭</button></div></div><div style="flex:1;overflow-y:auto;background:var(--bg);border-radius:5px;padding:6px;font-size:10px">' +
    logHtml +
    "</div>";
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#log-close").onclick = () => overlay.remove();
  dialog.querySelector("#log-refresh").onclick = () => {
    overlay.remove();
    openLogDialog();
  };
  dialog.querySelectorAll(".log-copy-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const text = e.target.dataset.info;
      navigator.clipboard.writeText(text).then(() => {
        e.target.textContent = "✅ 已复制";
        setTimeout(() => {
          e.target.textContent = "📋 复制";
        }, 1500);
      });
    };
  });
  dialog.querySelector("#log-clear").onclick = async () => {
    if (confirm("确定清空所有日志？")) {
      await window.go.main.App.ClearImportLogs();
      overlay.remove();
      openLogDialog();
    }
  };
  // 复制所有日志到剪贴板
  dialog.querySelector("#log-copy-all").onclick = () => {
    const allText = logs
      .map(
        (l) =>
          l.ModelName +
          " | " +
          l.Status +
          " | " +
          l.SourcePath +
          (l.ErrorMsg ? " | " + l.ErrorMsg : ""),
      )
      .join("\n");
    navigator.clipboard.writeText(allText).then(() => {
      dialog.querySelector("#log-copy-all").textContent = "✅ 已复制";
      setTimeout(() => {
        dialog.querySelector("#log-copy-all").textContent = "📋 复制全部";
      }, 1500);
    });
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}
// 回收站对话框
async function openRecycleDialog() {
  if (!repoRoot) {
    showToast("❌ 请先选择仓库目录");
    return;
  }
  st.textContent = "⏳ 正在读取回收站...";
  let recycleEntries = [];
  try {
    recycleEntries = await window.go.main.App.ListRecycleBin(repoRoot);
  } catch (e) {
    showToast("❌ 读取回收站失败: " + e.message);
    st.textContent = "❌ 读取回收站失败";
    return;
  }
  st.textContent = "";
  if (!recycleEntries.length) {
    showToast("🗑️ 回收站为空");
    return;
  }
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:420px;max-height:80vh;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px";
  dialog.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:13px;font-weight:600">🗑️ 回收站 (' +
    recycleEntries.length +
    ' 个文件)</span><button id="btn-empty-recycle" style="margin-left:auto;padding:3px 8px;border-radius:4px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">清空回收站</button></div><div id="recycle-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;min-height:0">';
  const listDiv = dialog.querySelector("#recycle-list");
  for (const e of recycleEntries) {
    const item = document.createElement("div");
    item.style.cssText =
      "display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:11px";
    const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
    const size = e.Size ? fmt(e.Size) : "?";
    item.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)" title="' +
      esc(e.Path) +
      '">' +
      esc(name) +
      '</span><span style="font-size:9px;color:var(--muted)">' +
      size +
      '</span><button class="recy-restore" data-path="' +
      esc(e.Path) +
      '" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:9px">↩️ 恢复</button><button class="recy-del" data-path="' +
      esc(e.Path) +
      '" style="padding:2px 6px;border-radius:3px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">🗑️ 删除</button></div><div style="font-size:9px;color:var(--muted);padding-left:2px;word-break:break-all">📂 ' +
      esc(e.Path) +
      "</div>";
    listDiv.appendChild(item);
  }
  dialog.innerHTML +=
    '</div><button id="recycle-close" style="padding:5px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;margin-top:4px">关闭</button>';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#recycle-close").onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  dialog.querySelectorAll(".recy-restore").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await window.go.main.App.RestoreFromRecycle(btn.dataset.path, repoRoot);
        btn.closest("div").remove();
        entries = await window.go.main.App.ScanModelEntries(repoRoot);
        buildTree();
        if (mcRoot) await refreshAll();
        const remaining = dialog.querySelectorAll(".recy-restore").length;
        dialog.querySelector('span[style*="font-size:13px"]').textContent =
          "🗑️ 回收站 (" + remaining + " 个文件)";
        if (!remaining) overlay.remove();
        st.textContent = "✅ 已恢复";
      } catch (e) {
        showToast("❌ 恢复失败: " + e.message);
      }
    };
  });
  dialog.querySelectorAll(".recy-del").forEach((btn) => {
    btn.onclick = async () => {
      if (!(await showConfirm("确定永久删除此文件？"))) return;
      try {
        await window.go.main.App.DeleteFromRecycle(btn.dataset.path);
        btn.closest("div").remove();
        const remaining = dialog.querySelectorAll(".recy-del").length;
        dialog.querySelector('span[style*="font-size:13px"]').textContent =
          "🗑️ 回收站 (" + remaining + " 个文件)";
        if (!remaining) overlay.remove();
        st.textContent = "✅ 已删除";
      } catch (e) {
        showToast("❌ 删除失败: " + e.message);
      }
    };
  });
  dialog.querySelector("#btn-empty-recycle").onclick = async () => {
    if (!(await showConfirm("确定永久清空回收站所有文件？此操作不可恢复！")))
      return;
    try {
      const n = await window.go.main.App.EmptyRecycleBin(repoRoot);
      overlay.remove();
      st.textContent = "✅ 已清空 " + n + " 个文件";
      entries = await window.go.main.App.ScanModelEntries(repoRoot);
      buildTree();
      if (mcRoot) await refreshAll();
    } catch (e) {
      showToast("❌ 清空失败: " + e.message);
    }
  };
}
// 设置对话框
async function openSettingsDialog() {
  const mode = await window.go.main.App.GetLinkMode();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:320px;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px";
  dialog.innerHTML =
    '<div style="font-size:13px;font-weight:600;color:var(--txt)">⚙️ 设置</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px">' +
    '<label style="font-size:10px;color:var(--muted)">🔗 文件该如何链接到仓库</label>' +
    '<select id="settings-link-mode" style="padding:6px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px">' +
    '<option value="copy"' +
    (mode === "copy" ? " selected" : "") +
    ">📄 复制（占用高）</option>" +
    '<option value="hardlink"' +
    (mode === "hardlink" ? " selected" : "") +
    ">🔗 硬链接（省空间）</option>" +
    '<option value="symlink"' +
    (mode === "symlink" ? " selected" : "") +
    ">🔗 符号链接（灵活）</option>" +
    "</select></div>" +
    '<button id="settings-close" style="padding:6px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">关闭</button>';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#settings-close").onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  dialog.querySelector("#settings-link-mode").onchange = async (e) => {
    await window.go.main.App.SetLinkMode(e.target.value);
    localStorage.setItem("linkMode", e.target.value);
    st.textContent =
      "✅ 已切换为" +
      (e.target.value === "copy"
        ? "复制模式"
        : e.target.value === "hardlink"
          ? "硬链接模式"
          : "符号链接模式");
    await saveConfig();
  };
}
// 辅助：显示进度条 + 文字
function updateSyncProgress(current, total, statusText, ok, fail) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  // 查找或创建进度条
  let barWrap = document.querySelector(".progress-bar-wrap");
  if (!barWrap) {
    barWrap = document.createElement("div");
    barWrap.className = "progress-bar-wrap";
    barWrap.innerHTML = '<div class="progress-bar-fill"></div>';
    // 插入到状态栏旁边（#st 后面）
    const st = document.getElementById("st");
    if (st) {
      st.parentNode?.insertBefore(barWrap, st.nextSibling);
    }
  }
  const fill = barWrap.querySelector(".progress-bar-fill");
  if (fill) fill.style.width = pct + "%";
  const errorInfo = fail > 0 ? " ❌" + fail : "";
  const st = document.getElementById("st");
  if (st)
    st.textContent =
      statusText + " (" + current + "/" + total + " ✅" + ok + errorInfo + ")";
}

// 辅助：清除进度条
function clearSyncProgress() {
  const barWrap = document.querySelector(".progress-bar-wrap");
  if (barWrap) barWrap.remove();
}

// 全部同步
// entriesParam / instancesParam / statusesParam 可选，默认使用全局变量
async function doSyncAll(entriesParam, instancesParam, statusesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  const _instances = instancesParam || instances;
  const _statuses = statusesParam || statuses;
  if (!(await showConfirm("将仓库所有模型同步到所有整合包？"))) {
    syncing = false;
    return;
  }
  let ok = 0,
    fail = 0,
    skip = 0;
  const totalFiles = _entries.filter((e) => !isBannedEntry(e)).length;
  let done = 0;
  const detailList = [];
  let lastError = "";

  // 计算需要同步的整合包数量
  const validInstances = _instances.filter((_, vi) => {
    const sts = _statuses.find((s) => s.Name === _instances[vi].Name);
    return sts && sts.HasYSM;
  });
  const totalPacks = validInstances.length;

  for (let vi = 0; vi < _instances.length; vi++) {
    const ins = _instances[vi];
    const sts = _statuses.find((s) => s.Name === ins.Name);
    if (!sts || !sts.HasYSM) {
      skip++;
      continue;
    }
    for (const e of _entries) {
      if (isBannedEntry(e)) continue;
      try {
        await safeCall(() =>
          window.go.main.App.InstallModelTo(e.Path, ins.CustomDir),
        );
        ok++;
        detailList.push({ name: e.Name + " → " + ins.Name, type: "success" });
      } catch (err) {
        fail++;
        const errMsg = err.message || String(err);
        detailList.push({
          name:
            e.Name +
            " → " +
            ins.Name +
            (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
          type: "fail",
        });
        lastError = errMsg;
        console.error("安装失败:", e.Name, "→", ins.Name, err);
      }
      done++;
      const packIdx = vi - skip + 1;
      updateSyncProgress(
        done,
        totalFiles * totalPacks,
        "📦[" + packIdx + "/" + totalPacks + "] " + ins.Name,
        ok,
        fail,
      );
    }
  }
  if (fail > 0)
    showToast("❌ " + fail + " 个安装失败\n" + lastError.substring(0, 80));
  showSummaryDialog("🔄 同步完成", ok, skip, fail, null, detailList);
  await refreshAll();
  clearSyncProgress();
  syncing = false;
}

// 安装缺失
// entriesParam / instancesParam / statusesParam 可选，默认使用全局变量
async function doSyncMissing(entriesParam, instancesParam, statusesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  const _instances = instancesParam || instances;
  const _statuses = statusesParam || statuses;
  let total = _statuses.reduce(
    (s, x) => s + (x.Missing ? x.Missing.length : 0),
    0,
  );
  if (!total) {
    showToast("所有整合包已完整");
    syncing = false;
    return;
  }
  if (!(await showConfirm("将 " + total + " 个缺失模型安装到对应整合包？"))) {
    syncing = false;
    return;
  }
  let ok = 0,
    fail = 0;
  let done = 0;
  const detailList = [];
  let lastError = "";

  for (let si = 0; si < _statuses.length; si++) {
    const s = _statuses[si];
    if (!s.HasYSM) continue;
    for (const n of s.Missing || []) {
      const e = _entries.find((x) => x.Name === n);
      if (!e) continue;
      try {
        await safeCall(() =>
          window.go.main.App.InstallModelTo(e.Path, s.CustomDir),
        );
        ok++;
        detailList.push({ name: e.Name + " → " + s.Name, type: "success" });
      } catch (err) {
        fail++;
        const errMsg = err.message || String(err);
        detailList.push({
          name:
            e.Name +
            " → " +
            s.Name +
            (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
          type: "fail",
        });
        lastError = errMsg;
        console.error("补缺失败:", e.Name, "→", s.Name, err);
      }
      done++;
      updateSyncProgress(
        done,
        total,
        "📦[" + (si + 1) + "/" + _statuses.length + "] " + s.Name,
        ok,
        fail,
      );
    }
  }
  if (fail > 0)
    showToast("❌ " + fail + " 个安装失败\n" + lastError.substring(0, 80));
  showSummaryDialog("🔄 补缺安装完成", ok, 0, fail, null, detailList);
  await refreshAll();
  clearSyncProgress();
  syncing = false;
}

// 去重
// entriesParam 可选，默认使用全局 entries
async function doDeduplicate(entriesParam) {
  if (syncing) return;
  syncing = true;
  const _entries = entriesParam || entries;
  try {
    const hashFiles = {};
    for (const e of _entries) {
      if (!e.Hash) continue;
      hashFiles[e.Hash] = hashFiles[e.Hash] || [];
      hashFiles[e.Hash].push(e);
    }
    let dupCount = 0;
    for (const h in hashFiles) {
      if (hashFiles[h].length > 1) dupCount += hashFiles[h].length - 1;
    }
    if (dupCount === 0) {
      syncing = false;
      showToast("没有重复文件");
      return;
    }
    if (
      !(await showConfirm("移动 " + dupCount + " 个重复文件到 🗑️ 回收站？"))
    ) {
      syncing = false;
      return;
    }
    st.textContent = "⏳ 去重中...";
    let del = 0,
      fail = 0;
    const detailList = [];
    let lastError = "";
    for (const h in hashFiles) {
      const files = hashFiles[h];
      if (files.length <= 1) continue;
      for (let i = 1; i < files.length; i++) {
        try {
          await safeCall(() => window.go.main.App.MoveToRecycle(files[i].Path));
          del++;
          detailList.push({ name: files[i].Name, type: "success" });
        } catch (err) {
          fail++;
          const errMsg = err.message || String(err);
          detailList.push({
            name: files[i].Name + (errMsg.includes("超时") ? " ⏱️ 超时" : ""),
            type: "fail",
          });
          lastError = errMsg;
          console.error("去重移动失败:", files[i].Name, err);
        }
      }
    }
    if (fail > 0)
      showToast("❌ " + fail + " 个移动失败\n" + lastError.substring(0, 80));
    showSummaryDialog("🔄 去重完成", del, 0, fail, null, detailList);
    entries = await window.go.main.App.ScanModelEntries(repoRoot);
    buildTree();
    if (mcRoot) await refreshAll();
  } finally {
    syncing = false;
  }
}

// ===== 加载数据 =====
async function loadAll() {
  if (!mcRoot || !repoRoot) return;
  st.textContent = "⏳ 加载中...";
  try {
    const rawInstances = await window.go.main.App.ListVersionInstances(mcRoot);
    const rawStatuses = await window.go.main.App.GetInstanceStatus(
      mcRoot,
      repoRoot,
    );
    const rawEntries = await window.go.main.App.ScanModelEntries(repoRoot);
    instances = Array.isArray(rawInstances) ? rawInstances : [];
    statuses = Array.isArray(rawStatuses) ? rawStatuses : [];
    entries = Array.isArray(rawEntries) ? rawEntries : [];
    renderVersions();
    buildTree();
    updateVersionStats(instances, statuses, entries);
    updateInstallBtn();
    st.textContent = "就绪";
    // 清除引导提示
    const guide = document.querySelector(".startup-guide");
    if (guide) guide.remove();
  } catch (e) {
    st.textContent = "❌ 加载失败";
    console.error(e);
  }
}

// ===== 显示首次启动引导 =====
function showStartupGuide() {
  // 如果已有引导提示则跳过
  if (document.querySelector(".startup-guide")) return;
  const guide = document.createElement("div");
  guide.className = "startup-guide";
  guide.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:10;background:var(--bg);padding:20px;text-align:center";
  guide.innerHTML = `
        <div style="font-size:36px">🧱</div>
        <h2 style="font-size:16px;color:var(--txt);margin:0">欢迎使用 YSM 模型管理器</h2>
        <p style="font-size:12px;color:var(--muted);max-width:280px;line-height:1.6">
            请先设置「仓库目录」和「游戏路径」以开始管理模型
        </p>
        <div style="display:flex;gap:12px;margin-top:4px">
            <button class="guide-btn" data-action="repo" style="padding:8px 20px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600">📁 选择仓库目录</button>
            <button class="guide-btn" data-action="mc" style="padding:8px 20px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);cursor:pointer;font-size:13px">🎮 选择游戏路径</button>
        </div>
        <p style="font-size:10px;color:var(--muted);margin-top:8px">仓库：存放模型的文件夹<br>游戏路径：.minecraft 目录（含 versions/ 子目录）</p>
    `;
  // 获取 main 容器并设置 position: relative
  const main = document.querySelector(".main");
  if (!main) return;
  main.style.position = "relative";
  main.appendChild(guide);

  // 绑定引导按钮事件
  guide.querySelectorAll(".guide-btn").forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      if (action === "repo") {
        const dir = await window.go.main.App.SelectDirectory();
        if (!dir) return;
        repoRoot = dir;
        window.go.main.App.SetRepoRoot(dir);
        localStorage.setItem("repoRoot", dir);
        document.getElementById("btn-repo").textContent = "📁 " + dir;
      } else if (action === "mc") {
        const dir = await window.go.main.App.SelectDirectory();
        if (!dir) return;
        mcRoot = dir;
        localStorage.setItem("mcRoot", dir);
        document.getElementById("btn-mc").textContent = "🎮 " + dir;
      }
      // 两个都设置后自动加载
      if (mcRoot && repoRoot) {
        await loadAll();
      }
    };
  });
}

// ===== 自动检测 + 恢复配置 =====
async function autoDetect() {
  // 1. 从磁盘配置文件加载（最优先）
  let savedRepo = "",
    savedMc = "",
    savedLinkMode = "";
  try {
    const cfg = await window.go.main.App.LoadAppConfig();
    savedRepo = cfg.repoRoot || "";
    savedMc = cfg.mcRoot || "";
    savedLinkMode = cfg.linkMode || "";
  } catch (e) {
    console.error("读取磁盘配置失败:", e);
  }

  // 2. 磁盘没有则回退 localStorage
  if (!savedRepo) savedRepo = localStorage.getItem("repoRoot") || "";
  if (!savedMc) savedMc = localStorage.getItem("mcRoot") || "";
  if (!savedLinkMode) savedLinkMode = localStorage.getItem("linkMode") || "";

  // 恢复链接模式
  if (savedLinkMode) {
    try {
      await window.go.main.App.SetLinkMode(savedLinkMode);
    } catch {}
  }

  // 恢复仓库路径
  if (savedRepo) {
    repoRoot = savedRepo;
    window.go.main.App.SetRepoRoot(savedRepo);
    document.getElementById("btn-repo").textContent = "📁 " + savedRepo;
  }

  // 恢复游戏路径
  if (savedMc) {
    mcRoot = savedMc;
    document.getElementById("btn-mc").textContent = "🎮 " + savedMc;
  } else {
    // 尝试自动检测
    const result = await window.go.main.App.GetMinecraftPath();
    if (result.includes("✅")) {
      mcRoot = result.replace(/^[^\x20]*\s*/, "").trim();
      localStorage.setItem("mcRoot", mcRoot);
      document.getElementById("btn-mc").textContent = "🎮 " + mcRoot;
    } else {
      st.textContent = result;
    }
  }

  if (mcRoot && repoRoot) {
    await loadAll();
  } else {
    // 首次启动引导：路径未完全设置
    st.textContent = mcRoot
      ? "请选择仓库目录"
      : repoRoot
        ? "请选择游戏路径"
        : "请设置路径开始";
    showStartupGuide();
  }
}

// ===== 更新安装按钮文字 =====
function updateInstallBtn() {
  const btn = document.getElementById("btn-sync-all");
  if (!btn) return;
  const totalMissing = (statuses || [])
    .filter((x) => x.HasYSM)
    .reduce((s, x) => s + (x.Missing ? x.Missing.length : 0), 0);
  btn.textContent =
    totalMissing > 0 ? "📥 批量安装（" + totalMissing + " 个）" : "📥 批量安装";
}

// ===== 启动 =====
// 延时启动，等待 DOM 和 Wails runtime 准备就绪
