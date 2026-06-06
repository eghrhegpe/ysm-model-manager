// ===== 创意工坊模型列表渲染（DOM API，非字符串拼接） =====
import { bus } from "../../bus.js";

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
  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "padding:12px;text-align:center;color:var(--muted);font-size:10px";
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
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);font-size:11px;margin-bottom:6px;transition:background .15s" +
      (exists
        ? ";opacity:.6;background:rgba(166,227,161,.06);cursor:context-menu"
        : ";background:rgba(243,139,168,.04);cursor:pointer");

    // 复选框（仅未下载的）
    if (!exists) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ws-sel";
      cb.dataset.name = m.name;
      cb.checked = selectedSet.has(m.name);
      cb.style.cssText = "cursor:pointer;flex-shrink:0";
      row.appendChild(cb);
    }

    // 文件名
    const nameSpan = document.createElement("span");
    nameSpan.style.cssText =
      "flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);font-size:11px;cursor:pointer";
    nameSpan.textContent = m.name;
    row.appendChild(nameSpan);

    if (exists) {
      const badge = document.createElement("span");
      badge.style.cssText =
        "padding:2px 8px;border-radius:4px;font-size:10px;color:var(--success,#4caf50);flex-shrink:0";
      badge.textContent = "✅ 已有";
      row.appendChild(badge);
    } else {
      // 大小 + 下载按钮放在右侧
      const rightGroup = document.createElement("div");
      rightGroup.style.cssText =
        "display:flex;align-items:center;gap:6px;flex-shrink:0";

      const sizeSpan = document.createElement("span");
      sizeSpan.style.cssText = "font-size:10px;color:var(--muted)";
      sizeSpan.textContent = m.size ? (m.size / 1024).toFixed(0) + "KB" : "";
      rightGroup.appendChild(sizeSpan);

      const dlBtn = document.createElement("button");
      dlBtn.className = "ws-dl-model";
      dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
      dlBtn.dataset.name = m.name;
      dlBtn.dataset.size = String(m.size || 0);
      dlBtn.style.cssText =
        "padding:3px 10px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;flex-shrink:0;transition:all .15s";
      dlBtn.textContent = "⬇️";
      dlBtn.onmouseenter = () => {
        dlBtn.style.borderColor = "var(--accent)";
        dlBtn.style.color = "var(--accent)";
      };
      dlBtn.onmouseleave = () => {
        dlBtn.style.borderColor = "var(--bd)";
        dlBtn.style.color = "var(--muted)";
      };
      rightGroup.appendChild(dlBtn);

      row.appendChild(rightGroup);
    }

    // 整行悬停高亮
    row.onmouseenter = () => {
      row.style.background = exists
        ? "rgba(166,227,161,.1)"
        : "rgba(243,139,168,.08)";
    };
    row.onmouseleave = () => {
      row.style.background = exists
        ? "rgba(166,227,161,.06)"
        : "rgba(243,139,168,.04)";
    };

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
      '<div style="font-size:9px;font-weight:600;color:var(--muted);padding:8px 8px 2px">' +
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
    '<div style="flex:1;overflow-y:auto;padding:0 12px">' +
    '<div style="padding:8px 0 4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
    '<button class="ws-back-repo" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">← 返回</button>' +
    '<span style="font-size:11px;font-weight:600;color:var(--txt)">📦 ' +
    esc(repo) +
    "</span>" +
    sourceLabel +
    '<span style="font-size:9px;color:var(--muted)">' +
    modelsLength +
    " 个模型</span>" +
    (missingCount > 0
      ? '<span style="font-size:9px;color:var(--accent);margin-left:auto">⬇️' +
        missingCount +
        "</span>" +
        '<button class="ws-dl-selected" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px;opacity:.4;pointer-events:none">⬇️ 选中 (0)</button>'
      : "") +
    '<button class="ws-filter-btn" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:10px">⚙️ 筛选</button>' +
    '<div class="ws-filter-dropdown" style="display:none;width:100%;padding:4px 0 2px;gap:4px;flex-wrap:wrap">' +
    (missingCount > 0
      ? '<button class="ws-dl-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">⬇️ 下载全部缺失</button>' +
        '<button class="ws-select-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px">☐ 全选</button>'
      : "") +
    '<button class="ws-toggle-all" style="padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:9px">📁 仅显示缺失</button>' +
    "</div>" +
    "</div>" +
    '<div id="ws-queue-status" style="display:none;padding:4px 12px;background:var(--surf);border-bottom:1px solid var(--bd);font-size:10px;color:var(--txt)"></div>' +
    '<div style="padding:2px 0 6px">' +
    '<input id="ws-repo-srch" type="text" placeholder="🔍 搜索模型名称" style="width:100%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:10px;outline:none">' +
    "</div>" +
    '<div id="ws-repo-list"></div>' +
    "</div>"
  );
}
