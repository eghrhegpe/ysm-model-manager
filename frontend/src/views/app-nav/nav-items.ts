// ===== app-nav 导航页清单（**单一事实源**）=====
// 侧边栏渲染（index.ts）与设置页「启动默认页」下拉框（tpl-settings.ts）均从此派生。
// 独立叶模块：无组件副作用（不在 index.ts 的 customElements.define 域内），
// 破 app-content/settings → app-nav/index 的跨视图组件模块耦合（self-type.ts 先例同款）。

import { can } from "@/backend/capabilities.ts";
import type { PageName } from "@/bus";
import type { LocaleKey } from "@/core/i18n/t.ts";

export interface NavItem {
  id: PageName;
  /** 语义图标名（ADR-238/ADR-245：resolveIcon 解析为 SVG），非字形字面量。 */
  icon: string;
  key: LocaleKey;
}

/**
 * 导航页清单（**单一事实源**）：侧边栏渲染与设置页「启动默认页」下拉框均从此派生。
 *
 * 准入：`id` 必须是 `PageName`（与 `core/page-store.ts` 的 VALID_PAGES 同源）。
 * 此前设置页手抄了一份三页副本（只有 repository/instances/workshop），
 * 导致 github/diagnostics/settings 可作启动页却在 UI 选不到——能力被 UI 阉割。
 */
export function navItems(): NavItem[] {
  // 查看器模式（Android/网页版 ADR-049）：instances 页依赖桌面专属 binding
  // ListVersionInstances（未桥接），用 can(binding) 能力门控精确判定——
  // 替代 isViewerMode() 复合判定（平台检测收敛到 capabilities 抽象，债务 #2）。
  const isViewer = !can("ListVersionInstances");
  return [
    { id: "repository", icon: "book", key: "nav.repository" },
    ...(isViewer ? [] : [{ id: "instances", icon: "game", key: "nav.instances" } as NavItem]),
    // 图标曾用 appearance（圆脸笑脸）：它与设置页二级 tab「外观」引用同一个 UI_ICONS 常量
    // → 左侧一级「社区」与设置页内「外观」跨两级同形、两种语义（与「点齿轮层级歧义」同类病）。
    // 社区 = 一群人，改 users，字形与语义同时归位。
    { id: "community", icon: "users", key: "nav.community" },
    { id: "github", icon: "parser", key: "nav.workshop" },
    { id: "diagnostics", icon: "tools", key: "nav.diagnostics" },
    { id: "settings", icon: "settings", key: "nav.settings" },
  ];
}
