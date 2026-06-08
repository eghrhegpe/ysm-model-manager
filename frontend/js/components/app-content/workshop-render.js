// ===== 创意工坊模型列表渲染（DOM API，非字符串拼接） =====
import { bus } from "../../bus.js";
import { renderDisplayName } from "../../utils/display.js";

// 永久预览元素：只创建一次，永远不销毁，hover 时切换 src/display
const _previewEl = document.createElement("div");
_previewEl.id = "ws-preview";
_previewEl.className = "ws-preview";
document.body.appendChild(_previewEl);

// 最新鼠标坐标（由 mousemove 持续更新，异步 showPreview 用最新值）
let _lastClientX = 0;
let _lastClientY = 0;

// 鼠标离开窗口时强制隐藏预览
document.addEventListener("mouseleave", () => hideGlobalPreview());

// 内部子元素：img（正常）或 div（占位）
const _previewImg = document.createElement("img");
_previewImg.className = "ws-preview-img";
_previewEl.appendChild(_previewImg);

const _previewFallback = document.createElement("div");
_previewFallback.textContent = "🎨";
_previewFallback.className = "ws-preview-fallback";
_previewEl.appendChild(_previewFallback);

export function hideGlobalPreview() {
  _previewEl.style.display = "none";
  _previewImg.style.opacity = "0";
  _previewImg.style.transform = "scale(.97)";
  _previewImg.src = "";
  _previewFallback.style.display = "none";
}

export function showPreview(anchorX, anchorY, url) {
  _previewEl.style.display = "block";
  _previewEl.style.left = anchorX + 16 + "px";
  _previewEl.style.top = anchorY - 90 + "px";

  _previewFallback.style.display = "none";
  _previewImg.style.display = "block";
  _previewImg.style.opacity = "0";
  _previewImg.style.transform = "scale(.97)";
  _previewImg.src = url;
  _previewImg.onload = () => {
    _previewImg.style.opacity = "1";
    _previewImg.style.transform = "scale(1)";
  };
  _previewImg.onerror = () => {
    _previewImg.style.display = "none";
    _previewFallback.style.display = "flex";
    _previewFallback.style.opacity = "0";
    _previewFallback.style.transform = "scale(.9)";
    _previewFallback.getBoundingClientRect();
    _previewFallback.style.opacity = "1";
    _previewFallback.style.transform = "scale(1)";
  };
}

export function movePreview(e) {
  _lastClientX = e.clientX;
  _lastClientY = e.clientY;
  if (_previewEl.style.display !== "none") {
    _previewEl.style.left = e.clientX + 16 + "px";
    _previewEl.style.top = e.clientY - 90 + "px";
  }
}

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
  // 🪦 守墓人：列表重绘前清理孤儿预览，无论谁调用的 renderModelList
  hideGlobalPreview();

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

    if (exists) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = "✅ 已有";
      row.appendChild(badge);
    } else {
      // 大小 + 下载按钮放在右侧
      const rightGroup = document.createElement("div");
      rightGroup.className = "ws-right";

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "ws-size";
      sizeSpan.textContent = m.size ? (m.size / 1024).toFixed(0) + "KB" : "";
      rightGroup.appendChild(sizeSpan);

      const dlBtn = document.createElement("button");
      dlBtn.className = "ws-dl-model";
      dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
      dlBtn.dataset.name = m.name;
      dlBtn.dataset.size = String(m.size || 0);
      dlBtn.className = "ws-dl-btn";
      dlBtn.textContent = "⬇️";
      rightGroup.appendChild(dlBtn);

      row.appendChild(rightGroup);
    }

    // 预览图（文件名映射：.ysm → .png/.jpg/.webp，hover 浮动）
    const PREVIEW_EXTS = ["png", "jpg", "webp"];
    const safeModelName = m.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

    // 预览图快速加载：三个后缀并行测试，谁先成功用谁
    const tryShowPreview = (anchorX, anchorY) => {
      const urls = PREVIEW_EXTS.map((ext) => {
        const n = safeModelName.replace(/\.(ysm|zip|7z)$/i, "." + ext);
        return n !== safeModelName ? dlPrefix + n : null;
      }).filter(Boolean);

      if (!urls.length) {
        hideGlobalPreview();
        return;
      }

      let settled = false;
      let loaded = 0;
      urls.forEach((url) => {
        const img = new Image();
        img.onload = () => {
          if (!settled) {
            settled = true;
            showPreview(anchorX, anchorY, url);
          }
        };
        img.onerror = () => {
          loaded++;
          if (loaded >= urls.length && !settled) {
            // 全失败 → 占位
            settled = true;
            hideGlobalPreview();
            _previewEl.style.display = "block";
            _previewEl.style.left = anchorX + 16 + "px";
            _previewEl.style.top = anchorY - 100 + "px";
            _previewImg.style.display = "none";
            _previewFallback.style.display = "flex";
            _previewFallback.style.opacity = "0";
            _previewFallback.style.transform = "scale(.9)";
            _previewFallback.getBoundingClientRect();
            _previewFallback.style.opacity = "1";
            _previewFallback.style.transform = "scale(1)";
          }
        };
        img.src = url;
      });
    };

    // 整行悬停高亮 + 预览
    row.addEventListener("mouseenter", (e) => {
      row.style.background = exists
        ? "rgba(166,227,161,.1)"
        : "rgba(243,139,168,.08)";
      tryShowPreview(e.clientX, e.clientY);
    });
    row.addEventListener("mousemove", movePreview);
    row.addEventListener("mouseleave", () => {
      row.style.background = exists
        ? "rgba(166,227,161,.06)"
        : "rgba(243,139,168,.04)";
      hideGlobalPreview();
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
