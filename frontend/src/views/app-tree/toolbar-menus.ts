// ===== 工具栏下拉菜单声明式规格（收敛 tpl.ts 手写 <button class="dd-item">）=====
// 唯一事实来源：批量 + 更多 两个下拉的菜单项在此声明，tpl.ts 用 renderMenuItems 生成 HTML。
// 收 ede 于 ADR-021 声明式菜单范式（对齐 features/context-menu/menu-defs.ts：
// 加菜单项只改这里，结构/testid 自动派生，渲染与行为不随项数膨胀）。
// 行为侧不变：toolbar-events.ts 仍靠 data-batch / data-more 委托，本表不碰事件逻辑。
import { t } from "@/core/i18n/t.ts";
import { ICON_KIT, renderIcon } from "@/utils/icon/icon-kit/index.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 单个工具栏下拉菜单项声明 */
export interface ToolbarMenuItem {
  /** 唯一 testid（须登记到 VIEW_TESTIDS，G-1 钩子单一事实源） */
  testid: string;
  /** 行为标识：data-batch / data-more 的取值，toolbar-events.ts 按它分派 */
  action: string;
  /** 渲染好的图标前缀（SVG render 串或 UI_ICONS 字符）；无图标传空串 */
  icon: string;
  /** i18n 文案 */
  label: string;
  /** 在项前插分隔线（如更多菜单的「打开文件夹」前） */
  dividerBefore?: boolean;
}

/** tooltend 下拉项分派属性 key（区分 batch / more 两类菜单） */
export type ToolbarMenuKey = "batch" | "more";

/** 批量下拉菜单项（data-batch 委托） */
export const BATCH_MENU_ITEMS: readonly ToolbarMenuItem[] = [
  {
    testid: "tree-batch-enable",
    action: "enable-all",
    icon: renderIcon(ICON_KIT.enableAll),
    label: t("tree.batchEnableAll"),
  },
  {
    testid: "tree-batch-disable",
    action: "disable-all",
    icon: renderIcon(ICON_KIT.disableAll),
    label: t("tree.batchDisableAll"),
  },
];

/** 更多下拉菜单项（data-more 委托） */
export const MORE_MENU_ITEMS: readonly ToolbarMenuItem[] = [
  {
    testid: "tree-more-import-file",
    action: "import-file",
    icon: UI_ICONS.file,
    label: t("tree.moreImportFile"),
  },
  {
    testid: "tree-more-import-dir",
    action: "import-dir",
    icon: "",
    label: t("tree.moreImportDir"),
  },
  {
    testid: "tree-more-open-folder",
    action: "open-folder",
    icon: "",
    dividerBefore: true,
    label: t("tree.moreOpenFolder"),
  },
  {
    testid: "tree-more-refresh",
    action: "refresh",
    icon: "",
    label: t("tree.moreRefresh"),
  },
  {
    testid: "tree-more-genindex",
    action: "genindex",
    icon: "",
    label: t("tree.moreGenIndex"),
  },
];

/** 按 key 取菜单项列表 */
export function getToolbarMenu(key: ToolbarMenuKey): readonly ToolbarMenuItem[] {
  return key === "batch" ? BATCH_MENU_ITEMS : MORE_MENU_ITEMS;
}

/**
 * 渲染某下拉的全部菜单项 HTML（`<button class="dd-item" data-<key>="<action>">`）。
 * dividerBefore 项前插分隔线，位置随数据走（增删项无需改渲染）。
 */
export function renderMenuItems(key: ToolbarMenuKey): string {
  const items = getToolbarMenu(key);
  const attr = key;
  return items
    .map((it) => {
      const gap = it.dividerBefore
        ? '<div style="border-top:1px solid var(--bd);margin:2px 0"></div>'
        : "";
      return (
        `${gap}<button class="dd-item" data-${attr}="${it.action}" data-testid="${it.testid}">` +
        `${it.icon ? `${it.icon} ` : ""}${it.label}</button>`
      );
    })
    .join("");
}

/** 归档：当前两个下拉的全部 testid（供 tpl.ts 的 VIEW_TESTIDS 派生，单一事实源） */
export function toolbarMenuTestids(): string[] {
  return [...BATCH_MENU_ITEMS, ...MORE_MENU_ITEMS].map((it) => it.testid);
}
