// ===== app-sync-manager 模板 =====
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { esc } from "../../utils/dom/html.ts";
import { formatBytes } from "../../utils/dom/format.ts";
import { t } from "../../core/i18n/t.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  'sm-push',
  'sm-pull',
];


/** 同步列表项（GetInstanceSyncStatus 返回 JSON 条目） */
export interface SyncItem {
  path: string;
  name: string;
  status: "synced" | "missing" | "disabled" | "optional" | "legacy" | "diverged" | string;
  type: string;
  icon?: string;
  size: number;
  /** 是否为文件夹（true）或文件（false）——由 Go 后端判定，前端直接消费 */
  isDir: boolean;
  /** MMD 用途子目录分组（ADR-095 后续）：EntityPlayer/SceneModel/...；根下为空 */
  subdir?: string;
  /** 子条目列表（文件夹级同步单元的内部文件真实状态） */
  children?: SyncItem[];
}

/** 子条目（从仓库 ScanModelEntriesWithLabel 扫出的内部文件，用于 dir-level 层级展示） */
interface SyncFile {
  name: string;
  path: string;      // 相对父目录的完整路径（用于 data-path）
  size: number;
}

// ===== 状态元数据表（单一事实源：syncDirRowHTML / itemHTML 共用，消除 ×2 三元链）=====
export const STATUS_ICON: Record<string, string> = {
  synced: "✅",
  legacy: "🔗",
  missing: "⬇️",
  diverged: "🗂️",
  disabled: "⛔",
  optional: "📤",
};

export const STATUS_COLOR: Record<string, string> = {
  synced: "var(--sz-green)",
  missing: "var(--accent)",
  diverged: "var(--accent)",
  disabled: "var(--muted)",
  optional: "var(--sm-optional)",
  legacy: "var(--muted)",
};

export const statusIconOf = (status: string): string => STATUS_ICON[status] ?? "·";
export const statusColorOf = (status: string): string => STATUS_COLOR[status] ?? "var(--muted)";

/** 状态操作按钮（missing/diverged→push；optional→pull；legacy→pullHere；其余无） */
export function actionBtnHTML(status: string): string {
  if (status === "missing" || status === "diverged") {
    return '<button class="sm-item-btn" data-testid="sm-push" data-action="push" style="border:1px solid var(--accent);color:var(--accent)">' + t("syncManager.push") + '</button>';
  }
  if (status === "optional") {
    return '<button class="sm-item-btn" data-testid="sm-pull" data-action="pull" style="border:1px solid var(--sm-optional);color:var(--sm-optional)">' + t("syncManager.pull") + '</button>';
  }
  if (status === "legacy") {
    return '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--muted);color:var(--muted);font-size:var(--fs-tiny)">' + t("syncManager.pullHere") + '</button>';
  }
  return "";
}

/** 文件夹行 HTML（dir-level 层级展示：箭头 + 图标 + 名称 + 大小 + 操作按钮）
 * 点击整行切换展开/折叠；push/pull 按钮冒泡到文件行层，由 events 处理。
 * @param path 展示路径 key（用于展开状态与树形展示）
 * @param opPath 后端可用的绝对路径（data-path，push/pull 直接消费） */
export function syncDirRowHTML(
  path: string,
  syncItem: SyncItem,
  shouldOpen: boolean,
  index: number,
  opPath?: string,
): string {
  const statusIcon = statusIconOf(syncItem.status);
  const statusColor = statusColorOf(syncItem.status);
  const sizeStr = syncItem.size > 0 ? formatBytes(syncItem.size) : "";
  const actionBtn = actionBtnHTML(syncItem.status);
  const arrow = shouldOpen ? "▾" : "▸";
  return (
    '<div class="sm-item sm-dir" data-path="' +
    esc(opPath || path) +
    '" data-status="' +
    esc(syncItem.status) +
    '" data-type="' +
    esc(syncItem.type) +
    '" style="animation:fadeSlideUp .2s ease both;animation-delay:' +
    stagger(index || 0, 30, 300) +
    'ms">' +
    '<span class="sm-dir-arrow" style="flex-shrink:0;width:14px;text-align:center;cursor:pointer;color:var(--muted)">' +
    arrow +
    "</span>" +
    '<span style="flex-shrink:0;font-size:var(--fs-base)">' +
    (syncItem.icon || "📁") +
    "</span>" +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
    renderFormattedText(syncItem.name) +
    "</span>" +
    (sizeStr
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-tiny)">' +
        sizeStr +
        "</span>"
      : "") +
    actionBtn +
    "</div>"
  );
}

/** 子条目行 HTML（scan 出的内部文件：无状态、无按钮，纯展示层级结构） */
function syncFileRowHTML(f: SyncFile, indent: number): string {
  const sizeStr = f.size > 0 ? formatBytes(f.size) : "";
  return (
    '<div class="sm-item sm-file" data-path="' +
    esc(f.path) +
    '" style="padding-left:' +
    (indent * 16 + 24) +
    'px">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:var(--muted)">·</span>' +
    '<span style="flex-shrink:0;font-size:var(--fs-tiny)">📄</span>' +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">' +
    f.name +
    "</span>" +
    (sizeStr
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-tiny)">' +
        sizeStr +
        "</span>"
      : "") +
    "</div>"
  );
}

/**
 * 容器骨架
 */
export function containerHTML(): string {
  return (
    "<style>" +
    ".sm-item{display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default;transition:background var(--tr-fast)}" +
    ".sm-item:hover{background:var(--hover)}" +
    ".sm-item-btn{padding:var(--pad-btn-secondary) 8px;border-radius:var(--radius-sm);background:transparent;cursor:pointer;flex-shrink:0;font-size:var(--fs-btn-secondary);transition:background var(--tr-fast),border-color var(--tr-fast),color var(--tr-fast)}" +
    ".sm-item-btn:hover{background:var(--hover)}" +
    ".sm-tab{transition:var(--tr-fast)}" +
    ".sm-status-tab{transition:background var(--tr-fast),color var(--tr-fast),border-color var(--tr-fast)}" +
    ".sm-empty{animation:fade-in .2s ease}" +
    ".sm-list{animation:fade-in .15s ease}" +
    ".sm-loading{display:flex;flex-direction:column;gap:8px;padding:12px}" +
    ".sm-dir{cursor:pointer}" +
    ".sm-dir .sm-dir-arrow{transition:color var(--tr-fast)}" +
    ".sm-dir:hover{background:var(--hover)}" +
    ".sm-file{cursor:default}" +
    ".sm-file:hover{background:transparent}" +
    ".sm-shimmer{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--bd) 25%,var(--hover) 50%,var(--bd) 75%);background-size:200% 100%;animation:sk-shimmer 1.5s infinite}" +
    ".sm-shimmer-w80{width:80%}" +
    ".sm-shimmer-w60{width:60%}" +
    ".sm-shimmer-w70{width:70%}" +
    "@keyframes sm-item-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes fade-in{from{opacity:0}to{opacity:1}}" +
    "@keyframes sk-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}" +
    "</style>" +
    '<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // 状态筛选栏（类型选择已全局化到 nav 下拉，sm-cur-type 只读指示随本栏渲染）
    '<div class="sm-status-tabs" style="display:flex;gap:2px;padding:3px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 摘要栏
    '<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:2px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 列表容器
    '<div class="sm-list" style="flex:1;overflow-y:auto;padding:2px 0"></div>' +
    "</div>"
  );
}

/**
 * 状态筛选标签 HTML
 * @param id - 筛选 ID (all/synced/missing/disabled/optional)
 * @param label - 标签文字
 * @param count - 数量
 * @param active - 是否选中
 */
export function statusTabHTML(
  id: string,
  label: string,
  count: number,
  active: boolean,
): string {
  const cls = active ? " active" : "";
  const showCount = count > 0 ? " (" + count + ")" : "";
  return (
    '<button class="sm-status-tab' +
    cls +
    '" data-status="' +
    id +
    '" style="padding:var(--pad-filter) 12px;border-radius:4px;border:1px solid ' +
    (active ? "var(--accent)" : "transparent") +
    ";background:" +
    (active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent") +
    ";color:" +
    (active ? "var(--accent)" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-filter);white-space:nowrap">' +
    label +
    showCount +
    "</button>"
  );
}

/**
 * 列表项 HTML（扁平文件行，按 isDir 为 false 渲染）
 */
export function itemHTML(item: SyncItem, index: number): string {
  const statusIcon = statusIconOf(item.status);
  const statusColor = statusColorOf(item.status);
  const sizeStr = item.size > 0 ? formatBytes(item.size) : "";
  const actionBtn = actionBtnHTML(item.status);
  return (
    // code review P1：class 补 sm-file——children/扁平文件行统一 .sm-item sm-file
    //（旧 syncFileRowHTML 语义；渲染层 children 走 itemHTML，无 sm-file 会让
    // 展开后的子文件行无法被 .sm-file 选择器命中）
    '<div class="sm-item sm-file" data-path="' +
    esc(item.path) +
    '" data-status="' +
    esc(item.status) +
    '" data-type="' +
    esc(item.type) +
    '" style="animation:fadeSlideUp .2s ease both;animation-delay:' +
    stagger(index || 0, 30, 300) +
    'ms">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:' +
    statusColor +
    '">' +
    statusIcon +
    "</span>" +
    '<span style="flex-shrink:0;font-size:var(--fs-base)">' +
    (item.icon || "📦") +
    "</span>" +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
    renderFormattedText(item.name) +
    "</span>" +
    (sizeStr
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-tiny)">' +
        sizeStr +
        "</span>"
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 空状态 HTML
 * @param msg 提示文案
 */
export function emptyHTML(msg: string): string {
  return (
    '<div class="sm-empty" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:var(--fs-base)">' +
    '<div style="font-size:20px">📭</div>' +
    "<div>" +
    msg +
    "</div>" +
    "</div>"
  );
}

/**
 * 加载中
 */
export function loadingHTML(): string {
  return (
    '<div class="sm-loading">' +
    '<div class="sm-shimmer sm-shimmer-w80"></div>' +
    '<div class="sm-shimmer sm-shimmer-w60"></div>' +
    '<div class="sm-shimmer sm-shimmer-w70"></div>' +
    "</div>"
  );
}


