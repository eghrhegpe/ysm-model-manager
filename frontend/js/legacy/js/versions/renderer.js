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
