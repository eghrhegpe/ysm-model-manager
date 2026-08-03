// ===== 创意工坊模型列表渲染（类型化版 — ADR-014 P3 features）=====
// DOM API，非字符串拼接
import { renderDisplayName } from "../../utils/display.ts";
import { ICONS } from "../../components/app-content/community/workshop-icons.js";
import { stagger } from "../../utils/stagger.ts";

/** 工坊模型条目（index.json 结构） */
export interface WorkshopModel {
  name: string;
  path: string;
  size?: number;
  hash?: string;
}

/** 工坊站点 */
export interface WorkshopSite {
  group?: string;
  label: string;
  desc?: string;
  icon?: string;
}

/**
 * 判断模型是否缺失（本地不存在）
 */
export function isModelMissing(
  m: WorkshopModel | null | undefined,
  localMap: Map<string, string>,
): boolean {
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
export function countMissing(
  models: WorkshopModel[],
  localMap: Map<string, string>,
): number {
  return models.filter((m) => isModelMissing(m, localMap)).length;
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

/**
 * 创建图标按钮
 * @param iconHTML SVG 图标 HTML
 * @param action data-action 值
 * @param title 提示文本
 */
function createIconBtn(
  iconHTML: string,
  action: string,
  title?: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "gh-icon-btn";
  btn.dataset.action = action;
  btn.innerHTML = iconHTML;
  if (title) btn.title = title;
  return btn;
}

/**
 * 渲染模型列表（DocumentFragment）
 * @param filtered 已筛选的模型数组
 * @param dlPrefix 下载 URL 前缀
 * @param localMap 本地文件映射
 * @param showAll 是否显示全部
 * @param selectedSet 选中集合
 * @param esc HTML 转义函数
 */
export function renderModelList(
  filtered: WorkshopModel[],
  dlPrefix: string,
  localMap: Map<string, string>,
  showAll: boolean,
  selectedSet: Set<string>,
  esc: (s: string) => string,
): DocumentFragment {
  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "gh-empty";
    frag.appendChild(empty);
    return frag;
  }

  filtered.forEach((m) => {
    const exists = !isModelMissing(m, localMap);
    const row = document.createElement("div");
    row.dataset.name = m.name;
    row.className = "gh-row" + (exists ? " gh-row-exists" : " gh-row-missing");

    // 列1: 复选框(缺失时) + 名称
    const nameWrap = document.createElement("div");
    nameWrap.style.cssText =
      "display:flex;align-items:center;gap:6px;min-width:0";
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
    sizeSpan.textContent = formatSize(m.size || 0);
    metaCell.appendChild(sizeSpan);
    const searchBtn = createIconBtn(
      ICONS.SEARCH,
      "search-bili",
      "B站搜索作者",
    );
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
export const GROUP_LABELS: Record<string, { icon: string; label: string }> = {
  search: { icon: "🔍", label: "搜索平台" },
  repo: { icon: "📦", label: "模型仓库" },
  browse: { icon: "👁️", label: "浏览平台" },
};

/**
 * 生成左栏站点卡片 HTML
 * @param sites 站点数组
 * @param esc HTML 转义
 */
export function renderCardsHTML(
  sites: WorkshopSite[],
  esc: (s: string) => string,
): string {
  const groups: Record<string, WorkshopSite[]> = {};
  sites.forEach((s) => {
    const g = s.group || "browse";
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  let html = "";
  const order = ["search", "repo", "browse"];
  let cardIdx = 0;
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
        '<div class="gh-card" style="animation-delay:' +
        stagger(cardIdx, 30, 300) +
        'ms" data-index="' +
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
        esc(s.desc || "") +
        "</div>" +
        "</div>" +
        '<div class="gh-card-external" title="系统浏览器打开">↗</div>' +
        "</div>";
      cardIdx++;
    });
  });
  return html;
}

/**
 * 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等）
 */
export function renderRepoHeaderHTML(params: {
  esc: (s: string) => string;
  repo: string;
  sourceLabel: string;
  modelsLength: number;
  missingCount: number;
}): string {
  const { esc, repo, sourceLabel, modelsLength, missingCount } = params;
  return (
    '<div class="gh-header">' +
    // 行1: 返回 | 模型计数徽章
    '<div class="gh-header-top">' +
    '<button class="btn-base sm gh-back-repo">← 返回</button>' +
    '<span class="gh-section-fill"></span>' +
    '<span class="gh-model-badge gh-model-badge-total">模型 ' +
    modelsLength +
    "</span>" +
    (missingCount > 0
      ? '<span class="gh-model-badge gh-model-badge-missing">⬇️ ' +
        missingCount +
        "</span>"
      : "") +
    "</div>" +
    // 行2: 仓库名（独占）+ 来源
    '<div class="gh-header-repo">' +
    '<span class="gh-repo-name">' +
    ICONS.PACKAGE +
    " " +
    esc(repo) +
    "</span>" +
    sourceLabel +
    "</div>" +
    // 行3: 搜索
    '<div class="gh-search-wrap">' +
    '<input id="gh-repo-srch" class="gh-search" type="text" placeholder="🔍 搜索模型名称...">' +
    "</div>" +
    // 行4: 操作按钮
    '<div class="gh-header-actions">' +
    '<label class="btn-base sm gh-select-all"><input type="checkbox"> ☐ 全选</label>' +
    '<button class="btn-base sm gh-toggle-missing">📁 仅显示缺失</button>' +
    '<span class="gh-section-fill"></span>' +
    '<button class="btn-base sm gh-dl-selected" disabled>⬇️ 选中 (0)</button>' +
    "</div>" +
    '<div id="gh-queue-status" class="gh-queue-status"></div>' +
    '<div id="gh-repo-list"></div>' +
    "</div>"
  );
}
