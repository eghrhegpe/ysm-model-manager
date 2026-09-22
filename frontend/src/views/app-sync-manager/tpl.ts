// ===== app-sync-manager 模板 =====

import { t } from "@/core/i18n/t.ts";
import { formatBytes } from "@/utils/format/format.ts";
import { esc } from "@/utils/html/html.ts";
import { renderFormattedText } from "@/utils/html/mc-format.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { UI_ICONS, type UiIconName } from "@/utils/icon/ui-icons.ts";

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
  missing: "download",
  // diverged（本/远端均有改动，需处理）取 `warning` 而不另造 `diff`：语义即「需注意」，
  // 且行色已由 STATUS_COLOR 标为 --accent —— 本次迁移零新增图标。
  diverged: "warning",
  disabled: "blocked",
  optional: "upload",
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
    return (
      '<button class="sm-item-btn" data-testid="sm-push" data-action="push" style="border:1px solid var(--accent);color:var(--accent)">' +
      t("syncManager.push") +
      "</button>"
    );
  }
  if (status === "optional") {
    return (
      '<button class="sm-item-btn" data-testid="sm-pull" data-action="pull" style="border:1px solid var(--sm-optional);color:var(--sm-optional)">' +
      t("syncManager.pull") +
      "</button>"
    );
  }
  if (status === "legacy") {
    return (
      '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--muted);color:var(--txt)">' +
      t("syncManager.pullHere") +
      "</button>"
    );
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
  const arrow = shouldOpen ? "▾" : "▸";
  return (
    '<div class="sm-item sm-dir" data-path="' +
    esc(opPath || path) +
    '" data-status="' +
    esc(syncItem.status) +
    '" data-type="' +
    esc(syncItem.type) +
    '" style="padding-left:' +
    indent +
    'px">' +
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
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-xs)">' +
        sizeStr +
        "</span>"
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 容器骨架
 */
export function containerHTML(): string {
  return (
    "<style>" +
    // 定高行：虚拟滚动要求同行等高，且行高必须随用户 --fs-scale（设置页可调）缩放——
    // 故用 calc 从 --fs-sm 派生（12px 基准 → 25.8px），TS 侧首帧实测取整（见 renderer 行高实测）。
    // 注意：这里是**静态** height，非 height 过渡——ADR-015 §2.4 约束 3 禁的是虚拟滚动组件上的
    // height/max-height **transition**（与 innerHTML 替换冲突触发闪烁）；定高恰是窗口化的前提，
    // 且本行 transition 只列 background。另：行不再挂入场动画，理由同该 ADR「已知例外」
    // （模型树子行淡入即因此禁用：animation-fill-mode:both 叠加窗口化替换会滚动闪烁）。
    ".sm-item{display:flex;align-items:center;gap:4px;padding:var(--btn-padding-std);height:calc(var(--fs-sm) * 1.4 + 9px);box-sizing:border-box;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default;transition:background var(--tr-fast)}" +
    ".sm-item:hover{background:var(--hover)}" +
    ".sm-item-btn{padding:var(--pad-btn-secondary) 8px;border-radius:var(--radius-sm);background:transparent;cursor:pointer;flex-shrink:0;font-size:var(--fs-btn-secondary);transition:background var(--tr-fast),border-color var(--tr-fast),color var(--tr-fast)}" +
    ".sm-item-btn:hover{background:var(--hover)}" +
    ".sm-tab{transition:var(--tr-fast)}" +
    // 状态筛选 tab：样式回到样式表（原为 statusTabHTML 里字符串拼接的行内 style=）——
    // 行内样式绕开样式表，主题切换 / 媒体查询 / 复用都够不着；且与既有 transition 规则分裂成两处。
    // 12px 横向内边距走 --btn-padding-filter（沿用 --btn-padding-* 既有简写约定）。
    ".sm-status-tab{padding:var(--btn-padding-filter);border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;font-size:var(--fs-filter);white-space:nowrap;transition:background var(--tr-fast),color var(--tr-fast),border-color var(--tr-fast)}" +
    // 选中态用「accent 18% 淡化」而非实心 accent：本栏 6 个筛选并排（all/synced/missing/
    // disabled/optional/legacy），实心会成视觉噪音。与 .cr-tag-filter-btn.active 逐值同款——
    // 判据：**并排 4+ 个的筛选组用 18% 淡化**（.cr-tag-filter-btn / .diag-log-fbtn /
    // .diag-sub-tab / .sm-status-tab 逐值同款）；**2 个的切换组用实心 accent**（仅 .pv-tab，
    // 见 app-preview/css.ts .pv-tab-active）——实心底 + accent 字在「二选一」场景才是强反馈，
    // 在「多并排筛选」场景则成噪音。
    ".sm-status-tab.active{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent);color:var(--accent)}" +
    // 当前类型只读指示（原同样是行内 style=）
    ".sm-cur-type{display:inline-flex;align-items:center;gap:4px;padding:0 8px;color:var(--accent);font-size:var(--fs-filter);white-space:nowrap;border-right:1px solid var(--bd);margin-right:6px}" +
    ".sm-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:var(--fs-base);animation:fade-in .2s ease}" +
    // 空状态图标尺寸：原内联 20px（design-tokens 的 inline-style-font-size，属基线内已知债）。
    // 20px 无精确令牌 → 按既有「归最近档位」口径收为 --fs-xl(24px)：样式从内联回到样式表、
    // 硬编码字号消失，债真正还掉（非仅搬位置——闸对硬编码字号位置无关）。
    ".sm-empty-icon{font-size:var(--fs-xl)}" +
    ".sm-list{animation:fade-in .15s ease}" +
    ".sm-loading{display:flex;flex-direction:column;gap:8px;padding:var(--sp-3)}" +
    ".sm-dir{cursor:pointer}" +
    ".sm-dir .sm-dir-arrow{transition:color var(--tr-fast)}" +
    ".sm-dir:hover{background:var(--hover)}" +
    ".sm-file{cursor:default}" +
    ".sm-file:hover{background:transparent}" +
    ".sm-shimmer{height:12px;border-radius:var(--radius-md);background:linear-gradient(90deg,var(--bd) 25%,var(--hover) 50%,var(--bd) 75%);background-size:200% 100%;animation:sk-shimmer 1.5s infinite}" +
    ".sm-shimmer-w80{width:80%}" +
    ".sm-shimmer-w60{width:60%}" +
    ".sm-shimmer-w70{width:70%}" +
    "@keyframes fade-in{from{opacity:0}to{opacity:1}}" +
    "@keyframes sk-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}" +
    "</style>" +
    '<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // 状态筛选栏（类型选择已全局化到 nav 下拉，sm-cur-type 只读指示随本栏渲染）
    '<div class="sm-status-tabs" style="display:flex;gap:2px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 摘要栏
    '<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:var(--btn-padding-tool-lg);flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
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
export function statusTabHTML(id: string, label: string, count: number, active: boolean): string {
  const cls = active ? " active" : "";
  const showCount = count > 0 ? ` (${count})` : "";
  return (
    '<button class="sm-status-tab' +
    cls +
    '" data-status="' +
    id +
    '">' +
    label +
    showCount +
    "</button>"
  );
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
    '<div class="sm-item sm-file" data-path="' +
    esc(item.path) +
    '" data-status="' +
    esc(item.status) +
    '" data-type="' +
    esc(item.type) +
    '" style="padding-left:' +
    indent +
    'px">' +
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
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-xs)">' +
        sizeStr +
        "</span>"
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
  return (
    '<div class="sm-empty">' +
    '<div class="sm-empty-icon">' +
    UI_ICONS.inboxEmpty +
    "</div>" +
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
