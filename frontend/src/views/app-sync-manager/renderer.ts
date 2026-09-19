// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { t } from "@/core/i18n/t.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { calcVisibleRange, installScrollSync } from "@/utils/dom/virtual-scroll.ts";
import { esc } from "@/utils/html/html.ts";
import { shortLabelOf } from "@/utils/resource/short-label.ts";
import type { SyncManagerSelf } from "./self-type.ts";
import { applyFilter, tabStatus } from "./store.ts";
import type { SyncItem } from "./tpl.ts";
import {
  containerHTML,
  emptyHintHTML,
  itemHTML,
  statusIconOf,
  statusTabHTML,
  syncDirRowHTML,
} from "./tpl.ts";

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
  // 骨架幂等：已存在则不重建——重建会丢 .sm-list 滚动位置（目录行点击/筛选切换时
  // 用户正停在中段，原实现每次 render 全量重建导致列表「弹回顶部」），且白白重解析
  // 内联 <style>。_init 首帧已注入骨架，此处只补骨架缺失场景。
  if (!self.querySelector(".sm-list")) {
    try {
      self.innerHTML = containerHTML();
    } catch (e) {
      logError("sync-manager", "_render 设置 innerHTML 失败:", e);
      return;
    }
  }

  const statusTabsEl = self.querySelector(".sm-status-tabs");
  const listEl = self.querySelector(".sm-list");
  if (!statusTabsEl || !listEl) {
    logWarn("sync-manager", "_render DOM 查询失败, 放弃渲染");
    return;
  }

  // — 类型统计 —
  const typeCounts: Record<string, TypeCounts> = {};
  for (const tc of self._typeConfig) {
    typeCounts[tc.id] = {
      synced: 0,
      missing: 0,
      disabled: 0,
      optional: 0,
      legacy: 0,
      total: 0,
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
      if (c) {
        (c as unknown as Record<string, number>)[st]++;
        c.total++;
      }
      (globalCounts as unknown as Record<string, number>)[st]++;
      item.children?.forEach(countNode);
    };
    for (const item of self._allItems) countNode(item);
  }

  // — 状态筛选标签 —
  const curCounts: TypeCounts = self._selectedType
    ? typeCounts[self._selectedType] || globalCounts
    : globalCounts;
  // 状态 tab 定义：图标经 statusIconOf()（STATUS_ICON 表 + resolveIcon → SVG），
  // **不再内联字形**——原实现在此写死 `⛔ ${t(...)}`，与 tpl 的 STATUS_ICON 表形成两处来源。
  const statusDefs: Array<[string, string, number]> = [
    [
      "all",
      `${statusIconOf("all")} ${t("syncManager.status.all")}`,
      self._selectedType ? curCounts.total || 0 : self._allItems.length,
    ],
    [
      "synced",
      `${statusIconOf("synced")} ${t("syncManager.status.synced")}`,
      curCounts.synced || 0,
    ],
    [
      "missing",
      `${statusIconOf("missing")} ${t("syncManager.status.missing")}`,
      curCounts.missing || 0,
    ],
    [
      "disabled",
      `${statusIconOf("disabled")} ${t("syncManager.status.disabled")}`,
      curCounts.disabled || 0,
    ],
    [
      "optional",
      `${statusIconOf("optional")} ${t("syncManager.status.optional")}`,
      curCounts.optional || 0,
    ],
    [
      "legacy",
      `${statusIconOf("legacy")} ${t("syncManager.status.legacy")}`,
      curCounts.legacy || 0,
    ],
  ];
  // 当前类型只读指示（类型选择已全局化到 nav 下拉，此处仅展示上下文）；样式在 .sm-cur-type
  const curCfg = self._typeConfig.find((c) => c.id === self._selectedType);
  const curLabel = (curCfg && (shortLabelOf(curCfg.id) || curCfg.name)) || self._selectedType || "";
  // curCfg.icon 是**数据图标**（resource_types.json，ADR-238 §1.3 🚨不可动）→ 按文本 esc 输出，勿转 SVG
  const curIcon = curCfg?.icon || "📦";
  statusTabsEl.innerHTML =
    '<span class="sm-cur-type" data-rtype="' +
    esc(self._selectedType || "") +
    '" title="' +
    t("syncManager.curTypeHint") +
    '">' +
    esc(curIcon) +
    " " +
    esc(curLabel) +
    "</span>" +
    statusDefs
      .map(([id, label, count]) => statusTabHTML(id, label, count, self._statusFilter === id))
      .join("");

  // — 摘要栏（实际扫描目录可见性）—
  renderScanDirs(self);

  // — 列表 —
  applyFilter(self);
  try {
    renderList(self, listEl);
  } catch (e) {
    logError("sync-manager", "renderList 失败:", e);
  }
}

/** 渲染 `.sm-summary`：显示仓库基准目录与实例实际扫描目录，兜底路径一目了然。 */
function renderScanDirs(self: SyncRenderSelf): void {
  const summaryEl = self.querySelector(".sm-summary");
  if (!summaryEl) return;
  const dirs =
    self._selectedType && self._scanDirs ? self._scanDirs[self._selectedType] : undefined;
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

// ===== 行级虚拟滚动（对齐 app-tree 窗口化范式）=====
// 背景：原实现把全部 SyncItem 递归拼串后一次 `innerHTML` 注入——整合包页 MMD 模型
// 上百时 DOM 行数 = 条目数 × 展开层级，滚动卡顿、内存膨胀（仓库树 app-tree 早已
// 窗口化，故同数据量下只有本页出事）。现补齐 DOM 层窗口化：数据侧展平为定高行数组，
// 只把可见窗口 ± 缓冲注入 DOM，用 padding 撑出滚动高度。
//
// 三条不能回退的约束：
//   ① 定高行——行不等高则窗口范围算不准（行高 CSS 在 tpl 定，TS 首帧实测取整）；
//   ② 行不得挂入场动画——窗口化会随滚动反复注入节点，`animation-fill-mode: both` 会
//      持续重播成滚动闪烁（ADR-015 §2.4 约束 3 及其「已知例外」，模型树当年同因禁用）；
//   ③ 骨架幂等——`render` 不得重建 `.sm-list`，否则每次目录点击/筛选都丢滚动位置。

/** 每级缩进像素（与原 renderNode 逐级套 26px wrapper 的观感等价） */
const INDENT_PER_LEVEL = 26;
/** 行基础左内边距（与 .sm-item 的 padding 左值同源） */
const ROW_PAD_LEFT = 10;
/** 行高回退值（--fs-sm 基准 12px 派生 ≈ 25.8px 取整）。真实值由首帧实测校正。 */
const SM_ROW_H_FALLBACK = 26;

/** 扁平化行（虚拟滚动数据单元） */
interface SmRow {
  /** 行键 = item.path（Go 侧树保证同层唯一） */
  key: string;
  html: string;
}

/** 行模板缓存（WeakMap——row 对象为 key；滚动帧复用同一 rows 数组即命中，
 *  数据变化重建 rows 后旧条目随数组 GC 自动回收，无手工失效负担） */
const rowTplCache = new WeakMap<SmRow, HTMLTemplateElement>();

/** 单容器虚拟滚动状态 */
interface SmVsState {
  cleanup: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  rows: SmRow[];
  /** 实测行高（0 = 未测，暂用回退值） */
  rowH: number;
}

/** 容器虚拟滚动状态表（WeakMap——listEl 为 key，元素 GC 自动回收） */
const vsStates = new WeakMap<HTMLElement, SmVsState>();

function vsOf(listEl: HTMLElement): SmVsState {
  let st = vsStates.get(listEl);
  if (!st) {
    st = { cleanup: null, resizeObserver: null, rows: [], rowH: 0 };
    vsStates.set(listEl, st);
  }
  return st;
}

/** 断开虚拟滚动监听（容器重建 / 组件卸载时调用，防 ResizeObserver 吊着旧容器） */
export function cleanupSyncVirtualScroll(listEl: HTMLElement): void {
  const st = vsStates.get(listEl);
  if (!st) return;
  st.cleanup?.();
  st.cleanup = null;
  st.resizeObserver?.disconnect();
  st.resizeObserver = null;
  st.rows = [];
  st.rowH = 0;
}

/** 行 DOM 节点：row.html 解析一次后按 row 对象缓存（克隆插入，防缓存模板被搬移） */
function rowElOf(row: SmRow): HTMLElement {
  let tpl = rowTplCache.get(row);
  if (!tpl) {
    tpl = document.createElement("template");
    tpl.innerHTML = row.html;
    rowTplCache.set(row, tpl);
  }
  const el = tpl.content.firstElementChild as HTMLElement | null;
  if (!el) throw new Error(`rowElOf: row.html 未产出元素（key=${row.key}）`);
  return el.cloneNode(true) as HTMLElement;
}

/**
 * 把可见树压平成定高行数组（虚拟滚动数据源）。
 * 展开判定与原 renderNode 逐字同口径：dirOpen 手动优先（显式 false 也尊重），
 * 未点过（undefined）才允许 status 筛选的 _forceOpenPaths 强开。
 */
function flattenRows(self: SyncRenderSelf, out: SmRow[]): void {
  const dirOpen = self._dirOpen || {};
  const forceOpen = self._forceOpenPaths;
  const walk = (items: SyncItem[], depth: number): void => {
    const indent = ROW_PAD_LEFT + depth * INDENT_PER_LEVEL;
    for (const item of items) {
      if (!item.isDir) {
        out.push({ key: item.path, html: itemHTML(item, indent) });
        continue;
      }
      const hasChildren = !!item.children?.length;
      const isOpen = hasChildren && (dirOpen[item.path] ?? !!forceOpen?.has(item.path));
      out.push({
        key: item.path,
        html: syncDirRowHTML(item.path, item, isOpen, indent, item.path),
      });
      if (isOpen && item.children) walk(item.children, depth + 1);
    }
  };
  walk(self._filteredItems, 0);
}

/** 窗口化切片渲染：只把可见行 ± 缓冲注入 DOM，padding 撑出总高。 */
function renderSlice(listEl: HTMLElement): void {
  const st = vsOf(listEl);
  const total = st.rows.length;
  if (!total) return;
  // 零高度（jsdom / 首帧布局未就绪）→ 全量渲染降级（同 community/virtual-list 口径），
  // 保证既有测试与首帧可见性不因窗口化而空白
  const rowH = st.rowH || SM_ROW_H_FALLBACK;
  const range =
    listEl.clientHeight > 0
      ? calcVisibleRange(listEl, total, rowH)
      : { startIdx: 0, endIdx: total };

  const frag = document.createDocumentFragment();
  for (let i = range.startIdx; i < range.endIdx; i++) frag.appendChild(rowElOf(st.rows[i]));
  listEl.replaceChildren(frag);
  listEl.style.paddingTop = `${range.startIdx * rowH}px`;
  listEl.style.paddingBottom = `${(total - range.endIdx) * rowH}px`;

  // 首帧实测行高：CSS 用 calc(var(--fs-sm) * 1.4 + 9px) 保证同行等高，但 --fs-scale
  // 是用户可调设置（设置页 ±2px），TS 侧拿不到解析值——按实测值重渲一次（置位后
  // 递归即收敛）。否则 padding 撑出的滚动高度与实际行高漂移，末行可能滚不到。
  if (!st.rowH) {
    const measured = (listEl.firstElementChild as HTMLElement | null)?.offsetHeight || 0;
    if (measured > 0) {
      st.rowH = measured;
      if (measured !== rowH) renderSlice(listEl);
    }
  }
}

/** 渲染列表（含空态）——数据展平后交给窗口化切片 */
function renderList(self: SyncRenderSelf, listEl: HTMLElement): void {
  const rows: SmRow[] = [];
  flattenRows(self, rows);

  if (!rows.length) {
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
    listEl.innerHTML = emptyHintHTML(hint);
    // 空态无行可滚：摘监听 + 清占位 padding，防上次窗口化的撑高残留
    listEl.style.paddingTop = "";
    listEl.style.paddingBottom = "";
    const st = vsOf(listEl);
    st.rows = [];
    st.cleanup?.();
    st.cleanup = null;
    return;
  }

  const st = vsOf(listEl);
  st.rows = rows;
  if (!st.cleanup) st.cleanup = installScrollSync(listEl, () => renderSlice(listEl));
  renderSlice(listEl);

  // 首帧容器尚未布局（clientHeight=0 → 上一步已全量渲染）→ 等 layout 后按真实视口重算
  if (listEl.clientHeight === 0) {
    requestAnimationFrame(() => {
      if (vsOf(listEl).rows.length) renderSlice(listEl);
    });
  }

  // 容器尺寸变化（侧栏折叠 / 窗口 resize）重算可见窗口
  if (!st.resizeObserver) {
    st.resizeObserver = new ResizeObserver(() => {
      if (vsOf(listEl).rows.length) renderSlice(listEl);
    });
    st.resizeObserver.observe(listEl);
  }
}
