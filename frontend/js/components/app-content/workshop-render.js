// 已迁移至 features/workshop/render.js
// 保留为重导出以确保向后兼容
export {
  isModelMissing,
  countMissing,
  renderModelList,
} from "../../features/workshop/render.js";

  if (!m) return true;
  return m.hash
    ? !(
        Array.from(localMap.values()).some((h) => h && h === m.hash) ||
        localMap.has(m.name)
      )
    : !localMap.has(m.name);
}

/**
 * 计算缺失数量
 */
export function countMissing(models, localMap) {
  return models.filter((m) => isModelMissing(m, localMap)).length;
}

/**
 * 渲染模型列表（DocumentFragment）
 * @param {Array} filtered - 已筛选的模型数组
 * @param {Array} allModels - 全部模型（用于 data-id）
 * @param {string} dlPrefix - 下载 URL 前缀
 * @param {Map} localMap - 本地文件映射
 * @param {boolean} showAll - 是否显示全部
 * @param {Set} selectedSet - 选中集合
 * @param {Function} esc - HTML 转义函数
 */
export function renderModelList(
  filtered,
  allModels,
  dlPrefix,
  localMap,
  showAll,
  selectedSet,
  esc,
) {
  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "ws-empty";
    empty.textContent = "🔍 没有匹配的模型";
    frag.appendChild(empty);
    return frag;
  }

  filtered.forEach((m) => {
    const exists = !isModelMissing(m, localMap);
    const row = document.createElement("div");
    row.className = "model-row";
    row.dataset.id = String(allModels.indexOf(m));
    row.dataset.name = m.name;
    row.className = "ws-row" + (exists ? " ws-row-exists" : " ws-row-missing");

    // 复选框（仅未下载的）
    if (!exists) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ws-sel";
      cb.dataset.name = m.name;
      cb.checked = selectedSet.has(m.name);
      cb.className = "ws-cb";
      row.appendChild(cb);
    }

    // 文件名
    const nameSpan = document.createElement("span");
    nameSpan.className = "ws-name";
    nameSpan.innerHTML = renderDisplayName(m.name);
    row.appendChild(nameSpan);

    // B站搜索按钮
    const searchBtn = document.createElement("button");
    searchBtn.className = "ws-search-bili";
    searchBtn.textContent = "🔍";
    searchBtn.title = "B站搜索作者";
    searchBtn.style.cssText =
      "font-size:9px;padding:1px 5px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .12s";
    searchBtn.onmouseenter = () => {
      searchBtn.style.borderColor = "var(--accent)";
      searchBtn.style.color = "var(--accent)";
    };
    searchBtn.onmouseleave = () => {
      searchBtn.style.borderColor = "transparent";
      searchBtn.style.color = "var(--muted)";
    };
    searchBtn.onclick = async (e) => {
      e.stopPropagation();
      const { parseModelName } = await import("../../utils/display.js");
      const { author } = parseModelName(m.name);
      if (author) {
        import("../../../wailsjs/go/main/App.js").then(({ OpenInBrowser }) =>
          OpenInBrowser("https://search.bilibili.com/all?keyword=" +
            encodeURIComponent(author)),
        );
      }
    };
    row.appendChild(searchBtn);

    if (exists) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = "✅ 已有";
      row.appendChild(badge);
    } else {
      // 大小 + 下载按钮放在右侧
      const rightGroup = document.createElement("div");
      rightGroup.className = "ws-row-right";

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "ws-size";
      sizeSpan.textContent = m.size ? (m.size / 1024).toFixed(0) + "KB" : "";
      rightGroup.appendChild(sizeSpan);

      const dlBtn = document.createElement("button");
      dlBtn.className = "ws-dl-model";
      dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
      dlBtn.dataset.name = m.name;
      dlBtn.dataset.size = String(m.size || 0);
      dlBtn.textContent = "⬇️";
      rightGroup.appendChild(dlBtn);

      row.appendChild(rightGroup);
    }

    // 整行悬停高亮
    row.addEventListener("mouseenter", () => {
      row.style.background = exists
        ? "rgba(166,227,161,.1)"
        : "rgba(243,139,168,.08)";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = exists
        ? "rgba(166,227,161,.06)"
        : "rgba(243,139,168,.04)";
    });

    frag.appendChild(row);
  });

  return frag;
}

/**
 * 分组标签映射
 */
export const GROUP_LABELS = {
  search: { icon: "🔍", label: "搜索平台" },
  repo: { icon: "📦", label: "模型仓库" },
  browse: { icon: "👁️", label: "浏览平台" },
};

/**
 * 生成左栏站点卡片 HTML
 * @param {Array} sites - 站点数组
 * @param {Function} esc - HTML 转义
 * @returns {string}
 */
export function renderCardsHTML(sites, esc) {
  const groups = {};
  sites.forEach((s) => {
    const g = s.group || "browse";
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  let html = "";
  const order = ["search", "repo", "browse"];
  order.forEach((g) => {
    if (!groups[g] || !groups[g].length) return;
    const info = GROUP_LABELS[g] || { icon: "🔗", label: g };
    html +=
      '<div class="ws-section-title">' +
      info.icon +
      " " +
      info.label +
      "</div>";
    groups[g].forEach((s) => {
      html +=
        '<div class="ws-card" data-index="' +
        sites.indexOf(s) +
        '" data-group="' +
        g +
        '">' +
        '<div class="ws-card-icon">' +
        (s.icon || "🔗") +
        "</div>" +
        '<div class="ws-card-body">' +
        '<div class="ws-card-label">' +
        esc(s.label) +
        "</div>" +
        '<div class="ws-card-desc">' +
        esc(s.desc) +
        "</div>" +
        "</div>" +
        "</div>";
    });
  });
  return html;
}

/**
 * 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等）
 * @param {Object} params
 * @returns {string}
 */
export function renderRepoHeaderHTML({
  esc,
  repo,
  sourceLabel,
  modelsLength,
  missingCount,
}) {
  return (
    '<div class="ws-header">' +
    '<div class="ws-header-top">' +
    '<button class="ws-back-repo ws-btn ws-btn-txt">← 返回</button>' +
    '<span class="ws-repo-name">📦 ' +
    esc(repo) +
    "</span>" +
    sourceLabel +
    '<span class="ws-model-count">' +
    modelsLength +
    " 个模型</span>" +
    (missingCount > 0
      ? '<span class="ws-missing-count">⬇️' +
        missingCount +
        "</span>" +
        '<button class="ws-dl-selected ws-btn-sm ws-btn-muted" disabled>⬇️ 选中 (0)</button>'
      : "") +
    '<button class="ws-filter-btn ws-btn ws-btn-txt">⚙️ 筛选</button>' +
    '<div class="ws-filter-dropdown">' +
    (missingCount > 0
      ? '<button class="ws-dl-all ws-btn-sm ws-btn-accent">⬇️ 下载全部缺失</button>' +
        '<button class="ws-select-all ws-btn-sm ws-btn-muted">☐ 全选</button>'
      : "") +
    '<button class="ws-toggle-all ws-btn-sm ws-btn-txt">📁 仅显示缺失</button>' +
    "</div>" +
    "</div>" +
    '<div id="ws-queue-status" class="ws-queue-status"></div>' +
    '<div style="padding:2px 0 6px">' +
    '<input id="ws-repo-srch" class="ws-search" type="text" placeholder="🔍 搜索模型名称">' +
    "</div>" +
    '<div id="ws-repo-list"></div>' +
    "</div>"
  );
}
