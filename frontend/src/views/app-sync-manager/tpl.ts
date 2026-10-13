// ===== app-sync-manager 模板 =====

import { t } from "@/core/i18n/t.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { esc } from "@/utils/html/html.ts";
import { renderFormattedText } from "@/utils/html/mc-format.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { UI_ICONS, type UiIconName } from "@/utils/icon/ui-icons.ts";
import { SM_STYLE } from "./sm-css.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = ["sm-push", "sm-pull"];

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

// ===== 状态元数据表（单一事实源：tab / syncDirRowHTML / itemHTML 共用）=====
// icon 填**语义名**（ADR-238/ADR-248：经 `resolveIcon()` 渲染为 SVG），不是字形字面量。
// 本表原是「消除 ×2 三元链」的单一事实源，但 tab 构建器一度**绕过它内联写字形**
//（同一组字形两处声明）——2026-09 收敛回本表（ADR-248 §3「隐藏的第二来源」同族教训）。
export const STATUS_ICON: Record<string, UiIconName> = {
  all: "chart", // 仅 tab 使用（"全部"不是行状态）
  synced: "success",
  legacy: "link",
  missing: "upload",
  // diverged（本/远端均有改动，需处理）取 `warning` 而不另造 `diff`：语义即「需注意」，
  // 且行色已由 STATUS_COLOR 标为 --accent —— 本次迁移零新增图标。
  diverged: "warning",
  disabled: "blocked",
  optional: "download",
};

export const STATUS_COLOR: Record<string, string> = {
  synced: "var(--size-ok)",
  missing: "var(--accent)",
  diverged: "var(--accent)",
  disabled: "var(--muted)",
  optional: "var(--sm-optional)",
  legacy: "var(--muted)",
};

/** 状态 → 可渲染串（SVG HTML）；未知状态回落占位符 `·`（占位符非图标位，允许是文本）。 */
export const statusIconOf = (status: string): string => {
  const name = STATUS_ICON[status];
  return (name && resolveIcon(name)) || "·";
};
export const statusColorOf = (status: string): string => STATUS_COLOR[status] ?? "var(--muted)";

/** 状态操作按钮（missing/diverged→push；optional→pull；legacy→pullHere；其余无） */
export function actionBtnHTML(status: string): string {
  if (status === "missing" || status === "diverged") {
    return `<button class="sm-item-btn" data-testid="sm-push" data-action="push" style="border:1px solid var(--accent);color:var(--accent)">${t(
      "syncManager.push",
    )}</button>`;
  }
  if (status === "optional") {
    return `<button class="sm-item-btn" data-testid="sm-pull" data-action="pull" style="border:1px solid var(--sm-optional);color:var(--sm-optional)">${t(
      "syncManager.pull",
    )}</button>`;
  }
  if (status === "legacy") {
    return `<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--muted);color:var(--txt)">${t(
      "syncManager.pullHere",
    )}</button>`;
  }
  return "";
}

/** 文件夹行 HTML（dir-level 层级展示：箭头 + 图标 + 名称 + 大小 + 操作按钮）
 * 点击整行切换展开/折叠；push/pull 按钮冒泡到文件行层，由 events 处理。
 * ⚠️ 不得为本行加 `animation` 入场动画：行由 renderer 窗口化注入 DOM，滚动即反复新增节点，
 * `animation-fill-mode: both` 会持续重播 → 滚动闪烁（ADR-015 §2.4 约束 3 及其「已知例外」）。
 * @param path 展示路径 key（用于展开状态与树形展示）
 * @param indent 缩进像素（padding-left，由渲染层按树深算出——虚拟滚动下行自带缩进，不再套嵌套 wrapper）
 * @param opPath 后端可用的绝对路径（data-path，push/pull 直接消费） */
export function syncDirRowHTML(
  path: string,
  syncItem: SyncItem,
  shouldOpen: boolean,
  indent: number,
  opPath?: string,
): string {
  const sizeStr = syncItem.size > 0 ? formatBytes(syncItem.size) : "";
  const actionBtn = actionBtnHTML(syncItem.status);
  const arrow = shouldOpen ? UI_ICONS.chevronDown : UI_ICONS.chevronRight;
  return (
    `<div class="sm-item sm-dir" data-path="${esc(opPath || path)}" data-status="${esc(
      syncItem.status,
    )}" data-type="${esc(syncItem.type)}" data-name="${esc(syncItem.name)}" style="padding-left:${indent}px">` +
    // a11y（2026 复测补缺）：箭头由装饰 span 升为原生 button（键盘可达 + 原生 Enter/Space），
    // 展开态走 aria-expanded，可访问名 = 文件夹名（屏幕阅读器读「名称，已展开/折叠」）；
    // 点击冒泡到 ③ dir 行委托翻转（既有事件链不变，零新增 handler）
    `<button class="sm-dir-arrow" aria-expanded="${shouldOpen}" aria-label="${esc(
      syncItem.name,
    )}">${arrow}</button>` +
    `<span aria-hidden="true" style="flex-shrink:0;font-size:var(--fs-base)">${
      syncItem.icon || UI_ICONS.folder
    }</span>` +
    `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">${renderFormattedText(
      syncItem.name,
    )}</span>` +
    (sizeStr
      ? `<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-xs)">${sizeStr}</span>`
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 容器骨架。
 * ⚠️ 样式已迁出至 sm-css.ts（SM_STYLE）——含定高行 / 选中态淡化 / a11y 复位等
 * 全部样式语义注释，见该文件头。本函数只保留结构与布局槽位。
 */
export function containerHTML(): string {
  return `<style>${SM_STYLE}</style>
<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">
<div class="sm-status-tabs" style="display:flex;align-items:center;gap:2px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)">
<span class="sm-cur-type-slot"></span>
<div class="sm-status-radios" role="radiogroup" aria-label="${esc(
    t("syncManager.statusFiltersAria"),
  )}"></div>
</div>
<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>
<div class="sm-list" style="flex:1;overflow-y:auto;padding:var(--pad-v-2)"></div>
</div>`;
}

/** 状态筛选标签 HTML
 * @param id - 筛选 ID (all/synced/missing/disabled/optional)
 * @param label - 标签文字
 * @param count - 数量
 * @param active - 是否选中
 * a11y（2026 复测补缺）：模板层统一产出 radio 语义——role=radio + aria-checked +
 * roving tabindex（激活项 0，其余 -1）。键盘半边由 events.ts 容器级 keydown 委托
 * 消费本组模板（仓内先例：tabs-shell.ts renderSubBar 同款「模板出属性、事件出键盘」）。
 */
export function statusTabHTML(id: string, label: string, count: number, active: boolean): string {
  const cls = active ? " active" : "";
  const showCount = count > 0 ? ` (${count})` : "";
  return `<button class="sm-status-tab${cls}" data-status="${id}" role="radio" aria-checked="${active}" tabindex="${
    active ? "0" : "-1"
  }">${label}${showCount}</button>`;
}

/**
 * 列表项 HTML（扁平文件行，按 isDir 为 false 渲染）
 * @param indent 缩进像素（padding-left，同 syncDirRowHTML）
 */
export function itemHTML(item: SyncItem, indent: number): string {
  const statusIcon = statusIconOf(item.status);
  const statusColor = statusColorOf(item.status);
  const sizeStr = item.size > 0 ? formatBytes(item.size) : "";
  const actionBtn = actionBtnHTML(item.status);
  return (
    // code review P1：class 补 sm-file——children/扁平文件行统一 .sm-item sm-file
    //（旧 syncFileRowHTML 语义；渲染层 children 走 itemHTML，无 sm-file 会让
    // 展开后的子文件行无法被 .sm-file 选择器命中）
    `<div class="sm-item sm-file" data-path="${esc(item.path)}" data-status="${esc(
      item.status,
    )}" data-type="${esc(item.type)}" data-name="${esc(item.name)}" style="padding-left:${indent}px">` +
    // a11y（2026 复测补缺）：状态图标（SVG）与文件图标（emoji）均为装饰，aria-hidden 降噪——
    // 屏幕阅读器读「名称 + 大小」即可，行动语义由行内原生 button（push/pull）承担
    `<span aria-hidden="true" style="flex-shrink:0;width:14px;text-align:center;color:${statusColor}"${
      item.status === "diverged" ? ` title="${esc(t("syncManager.divergedWarnTitle"))}"` : ""
    }>${statusIcon}</span>` +
    `<span aria-hidden="true" style="flex-shrink:0;font-size:var(--fs-base)">${
      item.icon || UI_ICONS.package
    }</span>` +
    `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">${renderFormattedText(
      item.name,
    )}</span>` +
    (sizeStr
      ? `<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-xs)">${sizeStr}</span>`
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 空状态 HTML（固定 📭 图标 + 提示文案）
 * @param msg 提示文案
 */
export function emptyHintHTML(msg: string): string {
  // 原为两处行内 style=（外层容器 + `font-size:20px` 的图标行）。后者是**基线内已知债**
  //（design-tokens 的 inline-style-font-size），本次一并还掉：样式归 .sm-empty / .sm-empty-icon。
  return `<div class="sm-empty"><div class="sm-empty-icon">${UI_ICONS.inboxEmpty}</div><div>${msg}</div></div>`;
}

/**
 * 加载中
 * a11y：role=status（隐式 aria-live=polite）——屏幕阅读器自动播报加载开始
 */
export function loadingHTML(): string {
  return `<div class="sm-loading" role="status" aria-label="${esc(
    t("common.loading"),
  )}"><div class="sm-shimmer sm-shimmer-w80"></div><div class="sm-shimmer sm-shimmer-w60"></div><div class="sm-shimmer sm-shimmer-w70"></div></div>`;
}

/**
 * 空实例态占位（无 instance 属性 / instance 被置空共用）。
 * ⚠️ 自带 `<style>${SM_STYLE}</style>`：本块整体覆盖组件 innerHTML，会连骨架里的样式表
 * 一并抹掉——`.sm-no-instance` 的 padding/color 无规则来源则视觉退化（裸 div 无内边距）。
 * 与 containerHTML 同一注入出口，不新造第二套样式依赖。
 * a11y：role=status（状态切换播报，非错误）
 */
export function noInstanceHTML(): string {
  return `<style>${SM_STYLE}</style>
<div class="sm-no-instance" role="status">${UI_ICONS.warning} ${esc(t("sync.noInstance"))}</div>`;
}
