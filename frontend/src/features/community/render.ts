// ===== 创意工坊模型列表渲染（类型化版 — ADR-014 P3 features）=====
// DOM API，非字符串拼接
// ADR-190 D1a / R8 销账：仓库页头部字符串模板已外移 views/app-content/tpl-workshop.ts，
// 本文件只保留 RepoTpl/RepoHeaderData 契约 + 行级 DOM 构建（buildModelRow）

import { t } from "@/core/i18n/t.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  "gh-back",
  "gh-srch",
  "gh-toggle",
  "gh-select-all",
  "gh-dl-selected",
  "gh-list",
  "gh-row",
  "gh-cb",
  "gh-name",
  "gh-dl",
  "gh-search-bili",
];

/** 工坊模型条目（index.json 结构） */
export interface WorkshopModel {
  name: string;
  path: string;
  size?: number;
  hash?: string;
}

/**
 * localMap（Map<name, hash>）→ hash 值 Set 的惰性缓存。
 * 每模型调用 isModelMissing 时若遍历 Array.from(localMap.values()) 为 O(M)，
 * N 个模型 = O(N×M)——本地文件上千 + 仓库模型上千时每次搜索/渲染数百万次比较。
 * localMap 实例在会话生命周期内内容固定（show-repo-models 扫描一次后只读传递），
 * 故每个实例仅构建一次 hashSet；WeakMap 弱引用，localMap 被 GC 后自动清理无泄漏。
 */
const _hashSetCache = new WeakMap<Map<string, string>, Set<string>>();

function hashSetOf(localMap: Map<string, string>): Set<string> {
  let s = _hashSetCache.get(localMap);
  if (!s) {
    s = new Set();
    for (const h of localMap.values()) if (h) s.add(h);
    _hashSetCache.set(localMap, s);
  }
  return s;
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
    ? !(hashSetOf(localMap).has(m.hash) || localMap.has(m.name))
    : !localMap.has(m.name);
}

/**
 * 计算缺失数量
 */
export function countMissing(models: WorkshopModel[], localMap: Map<string, string>): number {
  return models.filter((m) => isModelMissing(m, localMap)).length;
}

/**
 * 过滤模型列表：关键词匹配（模型名）+ 「仅显示缺失」开关。
 * 从 community/events.ts 的 renderList 抽出，供单测覆盖（ADR-023 L3）。
 */
export function filterModels(
  models: WorkshopModel[],
  q: string,
  showAll: boolean,
  localMap: Map<string, string>,
): WorkshopModel[] {
  const kw = q.trim().toLowerCase();
  let filtered = kw ? models.filter((m) => m.name.toLowerCase().includes(kw)) : models;
  if (!showAll) {
    filtered = filtered.filter((m) => isModelMissing(m, localMap));
  }
  return filtered;
}

/**
 * 创建图标按钮
 * @param iconHTML SVG 图标 HTML
 * @param action data-action 值
 * @param title 提示文本
 */
function createIconBtn(iconHTML: string, action: string, title?: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "gh-icon-btn";
  btn.dataset.action = action;
  btn.innerHTML = iconHTML;
  if (title) btn.title = title;
  return btn;
}

/** 单行构建上下文（buildModelRow 用；renderModelList 已删除，esc/showAll 字段暂为兼容 events.ts 调用点保留） */
export interface ModelRowCtx {
  dlPrefix: string;
  localMap: Map<string, string>;
  showAll: boolean;
  selectedSet: Set<string>;
  esc: (s: string) => string;
}

/** 构建单行模型行（虚拟列表 renderItem 用） */
export function buildModelRow(m: WorkshopModel, ctx: ModelRowCtx): HTMLElement {
  const { dlPrefix, localMap, selectedSet } = ctx;
  const exists = !isModelMissing(m, localMap);
  const row = document.createElement("div");
  row.dataset.name = m.name;
  row.dataset.testid = "gh-row";
  row.className = `gh-row${exists ? " gh-row-exists" : " gh-row-missing"}`;

  // 列1: 复选框(缺失时) + 名称
  const nameWrap = document.createElement("div");
  nameWrap.className = "gh-name-wrap"; // 规则在 content-diag.ts contentDiagCSS(shadow adopted)
  if (!exists) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "gh-sel gh-cb";
    cb.dataset.testid = "gh-cb";
    cb.dataset.name = m.name;
    cb.checked = selectedSet.has(m.name);
    nameWrap.appendChild(cb);
  }
  const nameSpan = document.createElement("span");
  nameSpan.className = "gh-name";
  nameSpan.dataset.testid = "gh-name";
  nameSpan.innerHTML = renderDisplayName(m.name);
  nameWrap.appendChild(nameSpan);
  row.appendChild(nameWrap);

  // 列2: 大小 + B站搜索按钮
  const metaCell = document.createElement("div");
  metaCell.className = "gh-meta";
  const sizeSpan = document.createElement("span");
  sizeSpan.className = "gh-size";
  // P4（审核发现）：`m.size || 0` 属 truthiness 数值判断，按数值守卫范式用 ?? 0
  sizeSpan.textContent = formatBytes(m.size ?? 0);
  metaCell.appendChild(sizeSpan);
  const searchBtn = createIconBtn(ICONS.SEARCH, "search-bili", t("workshop.bilibiliSearch"));
  searchBtn.dataset.testid = "gh-search-bili";
  metaCell.appendChild(searchBtn);
  row.appendChild(metaCell);

  // 列3: 下载按钮或已有徽章
  const actionsCell = document.createElement("div");
  actionsCell.className = "gh-actions";
  if (exists) {
    const badge = document.createElement("span");
    badge.className = "gh-badge";
    badge.innerHTML = `${ICONS.CHECKMARK} ${t("workshop.exists")}`;
    actionsCell.appendChild(badge);
  } else {
    const dlBtn = createIconBtn(ICONS.DOWNLOAD, "download");
    dlBtn.classList.add("gh-dl-btn");
    dlBtn.dataset.testid = "gh-dl";
    dlBtn.dataset.url = dlPrefix + m.path.replace(/\\/g, "/");
    dlBtn.dataset.name = m.name;
    // P3（审核复核）：同 download-tasks.ts 的有限数守卫——-1（Content-Length=-1 哨兵）不得透传
    dlBtn.dataset.size = String(
      typeof m.size === "number" && Number.isFinite(m.size) && m.size > 0 ? m.size : 0,
    );
    actionsCell.appendChild(dlBtn);
  }
  row.appendChild(actionsCell);

  return row;
}

/**
 * 仓库模型页头部模板的纯数据入参。
 * source：列表数据源（"raw" | "jsd" | "api" | 未知串）；
 * mirror：镜像配置（"jsdelivr" | "githubapi" | ""，GitHub 页恒为 ""）。
 * 来源/镜像徽章的展示派生全部归 views 模板，features 不拼 HTML。
 */
export interface RepoHeaderData {
  repo: string;
  source: string;
  mirror: string;
  modelsLength: number;
  missingCount: number;
}

/**
 * 仓库页 DOM 模板注入契约（ADR-190 D1a：DOM 模板归 views，组合根注入；features 不自渲染。
 * 先例 AdvFilterTpl / BatchRenameTpl）。
 * views/app-content/tpl-workshop.ts 提供实现；工坊页经 showRepoModels 注入，
 * GitHub 页（init-github.ts，本属 views）直接消费同一模板。
 */
export interface RepoTpl {
  /** 仓库模型页头部（含返回按钮、计数、来源徽章、筛选按钮、列表挂载点） */
  repoHeaderHTML: (d: RepoHeaderData) => string;
}
