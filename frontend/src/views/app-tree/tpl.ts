// ===== HTML 模板（页面布局级，不含节点行） =====

import { t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { UI_ICONS, type UiIconName } from "@/utils/icon/ui-icons.ts";
import { renderDropdown, toolbarMenuTestids } from "./toolbar-menus.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
// 批量/更多下拉的触发按钮 + 菜单项 testid 由 toolbarMenuTestids 单一派生，
// 其余工具栏控件 testid 手工登记于下方字面量。
export const VIEW_TESTIDS: readonly string[] = [
  "tree-srch",
  "tree-adv-filter",
  "tree-authors",
  ...toolbarMenuTestids(),
  "tree-sel-all",
  "tree-sort",
  "tree-view-mode",
  "tree-repo",
  "tree-ftr-stat",
];

export function headerHTML(): string {
  return `<div class="hdr">
<div class="hdr-row hdr-search-row">
  <input class="srch-inp" id="srch" data-testid="tree-srch" type="text" placeholder="${t("tree.searchPlaceholder")}" autocomplete="off">
</div>
<div class="hdr-row hdr-btn-row">
  <button class="btn-base sm" id="btn-adv-filter" data-testid="tree-adv-filter" title="${t("dialog.advFilter")}">${UI_ICONS.settings} ${t("tree.filter")}</button>
  <div class="dd-wrap" id="dd-authors"><button class="btn-base sm" id="btn-authors" data-testid="tree-authors">${UI_ICONS.brush} ${t("tree.authors")}</button><div class="dd-menu" id="menu-authors"></div></div>
  ${renderDropdown("batch")}
  <button class="btn-base sm" id="sel-all" data-testid="tree-sel-all" title="${t("tree.selectAll")}">${UI_ICONS.checkbox} ${t("tree.selectAll")}</button>
  ${renderDropdown("more")}
  <select class="sort-sel" id="sort" data-testid="tree-sort"><option value="name">${t("tree.sortName")}</option><option value="size">${t("tree.sortSize")}</option><option value="date">${t("tree.sortDate")}</option></select>
  <button class="btn-base sm" id="btn-view-mode" data-testid="tree-view-mode" title="${t("tree.toggleView")}">${UI_ICONS.menu}</button>
</div>
</div>`;
}

export function footerHTML(): string {
  return `<div class="ftr">
<span class="stat" id="ftr-stat" data-testid="tree-ftr-stat">${t("tree.statInitial")}</span>
<div style="flex:1"></div>
<button class="btn-base sm" id="btn-repo" data-testid="tree-repo" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t("tree.repoConfigTitle")}">${UI_ICONS.folder} ${t("tree.repoNotSet")}</button>
</div>`;
}

/**
 * 空态视图。
 *
 * 形参收 `UiIconName`（ADR-248 类型根治）：**裸 emoji 字面量编译期即错**——
 * 此前签名是 `icon: string`，于是「同一函数两处传 UI_ICONS、两处传 📁/🔍 裸字形」
 * 的双轨并存无人拦（2026-09 收尽）。语义名经 `resolveIcon` 落位，随主题着色缩放。
 */
export function emptyStateHTML(icon: UiIconName, msg: string): string {
  return `<div class="empty"><div class="big">${resolveIcon(icon)}</div>${esc(msg)}</div>`;
}

/**
 * 仓库按钮内容（icon + 路径/未设置文案）。
 *
 * 单列为 `render*` builder 的意义有二：① 结构（图标槽）在模板层、i18n 值纯文本；
 * ② 路径是**外部数据**，必须过 `esc` —— 且 R8 模板闸按 `render*` 命名识别可信 HTML 源，
 * 使调用侧只出现「单调用赋值」形态（工具函数内拼串，不散落调用点）。
 */
export function renderRepoLabel(filesRoot: string): string {
  return filesRoot
    ? `${UI_ICONS.folder} ${esc(filesRoot)}`
    : `${UI_ICONS.folder} ${t("tree.repoNotSet")}`;
}

export function spinnerHTML(): string {
  // HTML 结构（empty/big 包裹）在模板层，i18n 值只含纯文本（刀㉓：结构与内容分界）；
  // 图标形参走语义名（空态族统一契约，见 emptyStateHTML）
  return emptyStateHTML("refresh", t("tree.scanning"));
}

/** 树加载失败兜底视图：结构（empty/big + 图标）在模板层，i18n 值纯文本。 */
export function treeLoadFailedHTML(): string {
  return emptyStateHTML("warning", t("tree.treeLoadFailed"));
}
