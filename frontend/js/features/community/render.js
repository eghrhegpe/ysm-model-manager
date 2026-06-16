// ===== 创意工坊模型列表渲染（DOM API，非字符串拼接） =====
import { renderDisplayName } from "../../utils/display.js";
import { ICONS } from "../../components/app-content/workshop-icons.js";

/**
 * 判断模型是否缺失（本地不存在）
 */
export function isModelMissing(m, localMap) {
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
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

/**
 * 创建图标按钮
 * @param {string} iconHTML - SVG 图标 HTML
 * @param {string} action - data-action 值
 * @param {string} [title] - 提示文本
 * @returns {HTMLButtonElement}
 */
function createIconBtn(iconHTML, action, title) {
  const btn = document.createElement("button");
  btn.className = "gh-icon-btn";
  btn.dataset.action = action;
  btn.innerHTML = iconHTML;
  if (title) btn.title = title;
  return btn;
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
    empty.className = "gh-empty";

    // 细化空状态提示 — q / models 由闭包捕获（绑定事件时传入相同作用域）
    // 这里用 showAll / filtered 推断

    frag.appendChild(empty);
    return frag;
  }

  filtered.forEach((m) => {
    const exists = !isModelMissing(m, localMap);
    const row = document.createElement("div");
    row.dataset.id = String(allModels.indexOf(m));
    row.dataset.name = m.name;
    row.className = "gh-row" + (exists ? " gh-row-exists" : " gh-row-missing");

    // 列1: 复选框(缺失时) + 名称
    const nameWrap = document.createElement("div");
    nameWrap.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";
    if (!exists) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "gh-sel gh-cb";
      cb.dataset.name = m.name;
      cb.checked = selectedSet.has(m.name);
      nameWrap.appendChild(cb);
    }
    const nameSpan = document.createElement("span");
    nameSpan.className = "gh-name";
    nameSpan.innerHTML = renderDisplayName(m.name);
    nameWrap.appendChild(nameSpan);
    row.appendChild(nameWrap);

    // 列2: 大小 + B站搜索按钮
    const metaCell = document.createElement("div");
    metaCell.className = "gh-meta";
    const sizeSpan = document.createElement("span");
    sizeSpan.className = "gh-size";
    sizeSpan.textContent = formatSize(m.size);
    metaCell.appendChild(sizeSpan);
    const searchBtn = createIconBtn(ICONS.SEARCH, "search-bili", "B站搜索作者");
    metaCell.appendChild(searchBtn);
    row.appendChild(metaCell);

    // 列3: 下载按钮或已有徽章
    const actionsCell = document.createElement("div");
    actionsCell.className = "gh-actions";
    if (exists) {
      const badge = document.createElement("span");
      badge.className = "gh-badge";
      badge.innerHTML = ICONS.CHECKMARK + " 已有";
      actionsCell.appendChild(badge);
    } else {
      const dlBtn = createIconBtn(ICONS.DOWNLOAD, "download");
      dlBtn.classList.add("gh-dl-btn");
      dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
      dlBtn.dataset.name = m.name;
      dlBtn.dataset.size = String(m.size || 0);
      actionsCell.appendChild(dlBtn);
    }
    row.appendChild(actionsCell);

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
      '<div class="gh-section-title">' +
      info.icon +
      " " +
      info.label +
      "</div>";
    groups[g].forEach((s) => {
      html +=
        '<div class="gh-card" data-index="' +
        sites.indexOf(s) +
        '" data-group="' +
        g +
        '">' +
        '<div class="gh-card-icon">' +
        (s.icon || "🔗") +
        "</div>" +
        '<div class="gh-card-body">' +
        '<div class="gh-card-label">' +
        esc(s.label) +
        "</div>" +
        '<div class="gh-card-desc">' +
        esc(s.desc) +
        "</div>" +
        "</div>" +
        '<div class="gh-card-external" title="系统浏览器打开">↗</div>' +
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
    '<div class="gh-header">' +
    // 行1: 返回 + repo名 + 来源标签 | 模型计数徽章
    '<div class="gh-header-top">' +
    '<button class="btn-base sm gh-back-repo">← 返回</button>' +
    '<span class="gh-repo-name">' + ICONS.PACKAGE + ' ' + esc(repo) + '</span>' +
    sourceLabel +
    '<span class="gh-section-fill"></span>' +
    '<span class="gh-model-badge gh-model-badge-total">模型 ' + modelsLength + '</span>' +
    (missingCount > 0
      ? '<span class="gh-model-badge gh-model-badge-missing">⬇️ ' + missingCount + '</span>'
      : "") +
    "</div>" +
    // 行2: 搜索 + 操作按钮
    '<div class="gh-header-actions">' +
    '<div class="gh-search-wrap">' +
    '<input id="gh-repo-srch" class="gh-search" type="text" placeholder="🔍 搜索模型名称...">' +
    "</div>" +
    '<span class="gh-section-fill"></span>' +
    '<button class="btn-base sm gh-dl-selected" disabled>⬇️ 选中 (0)</button>' +
    '<button class="btn-base sm gh-filter-btn">⚙️ 筛选</button>' +
    '<div class="gh-filter-dropdown">' +
    (missingCount > 0
      ? '<button class="btn-base sm gh-dl-all gh-btn-accent">⬇️ 下载全部缺失</button>' +
        '<button class="btn-base sm gh-select-all">☐ 全选</button>'
      : "") +
    '<button class="btn-base sm gh-toggle-all">📁 仅显示缺失</button>' +
    "</div>" +
    "</div>" +
    '<div id="gh-queue-status" class="gh-queue-status"></div>' +
    '<div id="gh-repo-list"></div>' +
    "</div>"
  );
}
