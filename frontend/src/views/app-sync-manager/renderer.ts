// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
  syncDirRowHTML,
} from "./tpl.ts";
import type { SyncItem } from "./tpl.ts";
import { applyFilter, tabStatus } from "./store.ts";
import type { SyncManagerSelf } from "./index.ts";

export type SyncRenderSelf = SyncManagerSelf;

// 类型统计计数（diverged 折叠进 missing tab——counts 不含 diverged 字段，防误导）
interface TypeCounts {
  synced: number;
  missing: number;
  disabled: number;
  optional: number;
  legacy: number;
  total: number;
}

/** 主渲染入口：设置骨架 → 类型标签 → 状态标签 → 列表 */
export async function render(self: SyncRenderSelf): Promise<void> {
  try {
    self.innerHTML = containerHTML();
  } catch (e) {
    console.error("[sync-manager] _render 设置 innerHTML 失败:", e);
    return;
  }

  const statusTabsEl = self.querySelector(".sm-status-tabs");
  const listEl = self.querySelector(".sm-list");
  if (!statusTabsEl || !listEl) {
    console.warn("[sync-manager] _render DOM 查询失败, 放弃渲染");
    return;
  }

  // — 类型统计 —
  const typeCounts: Record<string, TypeCounts> = {};
  for (const tc of self._typeConfig) {
    typeCounts[tc.id] = {
      synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, total: 0,
    };
  }
  let globalCounts: TypeCounts;
  // ⚙️ 递归计数：与 applyFilter 同口径（tabStatus 折叠 diverged→missing），
  // 遍历全部嵌套 children 而非仅顶层——保证徽标数 = 列表可见行数（点2）。
  {
    globalCounts = { synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, total: 0 };
    const countNode = (item: SyncItem): void => {
      const c = typeCounts[item.type];
      const st = tabStatus(item);
      if (c) { (c as unknown as Record<string, number>)[st]++; c.total++; }
      (globalCounts as unknown as Record<string, number>)[st]++;
      item.children?.forEach(countNode);
    };
    for (const item of self._allItems) countNode(item);
  }

  // — 状态筛选标签 —
  const curCounts: TypeCounts = self._selectedType
    ? (typeCounts[self._selectedType] || globalCounts)
    : globalCounts;
  const statusDefs: Array<[string, string, number]> = [
    ["all", "📊 " + t("syncManager.status.all"), self._selectedType ? curCounts.total || 0 : self._allItems.length],
    ["synced", "✅ " + t("syncManager.status.synced"), curCounts.synced || 0],
    ["missing", "⬇️ " + t("syncManager.status.missing"), curCounts.missing || 0],
    ["disabled", "⛔ " + t("syncManager.status.disabled"), curCounts.disabled || 0],
    ["optional", "📤 " + t("syncManager.status.optional"), curCounts.optional || 0],
    ["legacy", "🔗 " + t("syncManager.status.legacy"), curCounts.legacy || 0],
  ];
  // 当前类型只读指示（类型选择已全局化到 nav 下拉，此处仅展示上下文）
  const curCfg = self._typeConfig.find((c) => c.id === self._selectedType);
  const curLabel = (curCfg && (shortLabelOf(curCfg.id) || curCfg.name)) || self._selectedType || "";
  const curIcon = curCfg?.icon || "📦";
  statusTabsEl.innerHTML =
    '<span class="sm-cur-type" data-rtype="' +
    esc(self._selectedType || "") +
    '" style="display:inline-flex;align-items:center;gap:4px;padding:0 8px;' +
    "color:var(--accent);font-size:var(--fs-filter);white-space:nowrap;" +
    'border-right:1px solid var(--bd);margin-right:6px" title="' +
    t("syncManager.curTypeHint") +
    '">' +
    esc(curIcon) +
    " " +
    esc(curLabel) +
    "</span>" +
    statusDefs
      .map(([id, label, count]) =>
        statusTabHTML(id, label, count, self._statusFilter === id),
      )
      .join("");

  // — 摘要栏（实际扫描目录可见性）—
  renderScanDirs(self);

  // — 列表 —
  applyFilter(self);
  await renderList(self, listEl).catch((e) => console.error("[sync-manager] renderList 失败:", e));
}

/** 渲染 `.sm-summary`：显示仓库基准目录与实例实际扫描目录，兜底路径一目了然。 */
function renderScanDirs(self: SyncRenderSelf): void {
  const summaryEl = self.querySelector(".sm-summary");
  if (!summaryEl) return;
  const dirs = self._selectedType && self._scanDirs ? self._scanDirs[self._selectedType] : undefined;
  if (!dirs || (!dirs.global && !dirs.instance)) {
    summaryEl.innerHTML = "";
    return;
  }
  const cell = (label: string, dir: string): string =>
    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" title="' +
    esc(dir) +
    '">' +
    esc(label) +
    "</span>";
  if (dirs.warningCode === "scan_dir_wide" && dirs.warningParams) {
    // 仓库基准疑似过宽：优先展示告警，避免静默混入（后端只给 code+参数，文案走 i18n 组装）
    const warnText = t("syncManager.scanDirWide", {
      label: dirs.warningParams.label,
      dir: dirs.warningParams.dir,
      subDir: dirs.warningParams.subDir,
    });
    summaryEl.innerHTML =
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--err)" title="' +
      esc(warnText) +
      '">' +
      esc(warnText) +
      "</span>";
    return;
  }
  summaryEl.innerHTML =
    cell(t("syncManager.scanGlobal", { dir: dirs.global || "—" }), dirs.global) +
    cell(t("syncManager.scanInstance", { dir: dirs.instance || "—" }), dirs.instance);
}

/** 渲染列表行（含空态）——按 isDir 分流 */
async function renderList(self: SyncRenderSelf, listEl: HTMLElement): Promise<void> {
  if (!listEl) return;
  if (self._filteredItems.length === 0) {
    const statusLabels: Record<string, string> = {
      all: "",
      synced: t("syncManager.status.synced"),
      missing: t("syncManager.status.missing"),
      disabled: t("syncManager.status.disabled"),
      optional: t("syncManager.status.optional"),
      legacy: t("syncManager.status.legacy"),
    };
    const hint =
      self._statusFilter !== "all"
        ? t("syncManager.emptyFiltered", { status: statusLabels[self._statusFilter] || "" })
        : t("syncManager.emptyType");
    listEl.innerHTML = emptyHTML(hint);
    return;
  }

  const dirOpen = self._dirOpen || {};
  const htmlParts: string[] = [];

  self._filteredItems.forEach((item, i) => {
    renderNode(self, item, "", htmlParts, i);
  });

  listEl.innerHTML = htmlParts.join("");
}

/**
 * 递归渲染一个同步节点及其 children。
 * 镜像磁盘层级：中间目录（isDir 且含 children）渲染为可展开 sm-dir，
 * 其子项递归下沉；扁平文件渲染为 sm-item。
 * @param self 组件实例
 * @param item 当前节点
 * @param indentPadding 继承缩进（px），递归层层累加
 * @param htmlParts 输出缓冲
 * @param index 动画错峰基准
 */
function renderNode(
  self: SyncRenderSelf,
  item: SyncItem,
  indentPadding: string,
  htmlParts: string[],
  index: number,
): void {
  const dirOpen = self._dirOpen || {};
  const isDir = item.isDir;
  const hasChildren = !!(item.children && item.children.length > 0);
  // 目录且未展开，或本无 children → 该子树的叶子/子树到此为止不再下钻
  // 展开判定：dirOpen 手动折叠优先（用户点过即尊重）；未点过的目录在 status
  // 筛选激活且「有命中后代」时由 _forceOpenPaths 强制展开（点1——折叠目录下
  // 的命中子项无需手动展开即可见）。
  const forceOpen = !!self._forceOpenPaths?.has(item.path);
  // ?? 而非 ||：显式折叠（false）必须优先于 forceOpen——用户点过折叠即尊重，
  // 只有「未点过」（undefined）才允许 status 筛选强制展开；原 `||` 会让
  // 折叠过的命中目录在下次渲染被强开，折叠无效（code_review P2）。
  const isOpen = isDir && hasChildren && (dirOpen[item.path] ?? forceOpen);

  const wrapped = (contentHTML: string): string =>
    indentPadding ? '<div style="padding-left:26px">' + contentHTML + "</div>" : contentHTML;

  if (!isDir) {
    // 扁平文件行
    htmlParts.push(wrapped(itemHTML(item, index)));
    return;
  }

  // 目录行：可展开 sm-dir
  htmlParts.push(wrapped(syncDirRowHTML(item.path, item, isOpen, index, item.path)));
  if (isOpen && item.children) {
    item.children.forEach((child, ci) => {
      renderNode(self, child, "  ", htmlParts, index + ci + 1);
    });
  }
}