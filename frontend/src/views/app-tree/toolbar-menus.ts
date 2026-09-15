// ===== 工具栏下拉菜单声明式规格（收敛 tpl.ts 手写 <button class="dd-item">）=====
// 唯一事实来源：批量 + 更多 两个下拉的菜单项在此声明，tpl.ts 用 renderMenuItems 生成 HTML。
// 范式对齐 ADR-021 声明式菜单 + ADR-238 图标语义名规范（context-menu/menu-defs.ts）：
//   - 菜单项声明只描述「语义」：action（行为）、label（i18n）、icon（图标语义名）、divider
//   - 渲染与图标解析由本层统一处理，调用侧不垫 SVG/emoji 字符串
// 行为侧不变：toolbar-events.ts 仍靠 data-batch / data-more 委托，本表不碰事件逻辑。
import { t } from "@/core/i18n/t.ts";
import { ICON_KIT, renderIcon } from "@/utils/icon/icon-kit/index.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 图标语义名 → 渲染串。统一入口：ICON_KIT（多源）优先，UI_ICONS（SVG）兜底。 */
function resolveIcon(name: string): string {
  if (name in ICON_KIT) return renderIcon(ICON_KIT[name]);
  if (name in UI_ICONS) return UI_ICONS[name];
  return "";
}

/** 单个工具栏下拉菜单项声明（只描述语义，不垫渲染字符串） */
interface ToolbarMenuItem {
  /** 行为标识：data-batch / data-more 取值，toolbar-events.ts 按它分派 */
  action: string;
  /** 唯一 testid（ADR-133 G-1 契约；与 action 不必同名，勿机械拼凑） */
  testid: string;
  /** i18n 文案 */
  label: string;
  /** 图标语义名（ICON_KIT / UI_ICONS 的 key）；缺省无图标 */
  icon?: string;
  /** 在项前插分隔线 */
  dividerBefore?: boolean;
}

/**
 * 某下拉的菜单项声明（数组序 = 渲染序）。
 * testid 由 action 语义按前缀派生，避免「声明 + testid 双处维护」。
 */
type ToolbarMenuKey = "batch" | "more";

/** 下拉容器（按钮 + 菜单）与它承载的菜单项声明 */
interface ToolbarMenuDef {
  /** 下拉触发按钮的稳定 id/testid（ADR-133） */
  id: string;
  /** 菜单容器 id */
  menuId: string;
  /** 触发按钮文案 */
  buttonLabel: string;
  /** 全部菜单项（data-<key> 委托到 toolbar-events.ts） */
  items: readonly ToolbarMenuItem[];
}

/** 工具栏两个下拉的声明式定义 */
const TOOLBAR_MENUS: Record<ToolbarMenuKey, ToolbarMenuDef> = {
  batch: {
    id: "btn-batch",
    menuId: "menu-batch",
    buttonLabel: t("tree.batch"),
    items: [
      {
        action: "enable-all",
        testid: "tree-batch-enable",
        label: t("tree.batchEnableAll"),
        icon: "enableAll",
      },
      {
        action: "disable-all",
        testid: "tree-batch-disable",
        label: t("tree.batchDisableAll"),
        icon: "disableAll",
      },
    ],
  },
  more: {
    id: "btn-more",
    menuId: "menu-more",
    buttonLabel: t("tree.more"),
    items: [
      {
        action: "import-file",
        testid: "tree-more-import-file",
        label: t("tree.moreImportFile"),
        icon: "file",
      },
      { action: "import-dir", testid: "tree-more-import-dir", label: t("tree.moreImportDir") },
      {
        action: "open-folder",
        testid: "tree-more-open-folder",
        label: t("tree.moreOpenFolder"),
        dividerBefore: true,
      },
      { action: "refresh", testid: "tree-more-refresh", label: t("tree.moreRefresh") },
      { action: "genindex", testid: "tree-more-genindex", label: t("tree.moreGenIndex") },
    ],
  },
};

/**
 * 渲染某下拉的完整 HTML（触发按钮 + 菜单容器 + 菜单项）。
 * 供 tpl.ts headerHTML() 单点引用，替代手写 `<div class="dd-wrap">` 块。
 */
export function renderDropdown(key: ToolbarMenuKey): string {
  const def = TOOLBAR_MENUS[key];
  const attr = key;
  const itemsHtml = def.items
    .map((it) => {
      const gap = it.dividerBefore
        ? '<div style="border-top:1px solid var(--bd);margin:2px 0"></div>'
        : "";
      const icon = it.icon ? `${resolveIcon(it.icon)} ` : "";
      return `${gap}<button class="dd-item" data-${attr}="${it.action}" data-testid="${it.testid}">${icon}${it.label}</button>`;
    })
    .join("");
  return (
    `<div class="dd-wrap" id="dd-${attr}">` +
    `<button class="btn-base sm" id="${def.id}" data-testid="tree-${attr}">${def.buttonLabel}</button>` +
    `<div class="dd-menu" id="${def.menuId}">${itemsHtml}</div></div>`
  );
}

/** 两下拉全部菜单项 testid（供 VIEW_TESTIDS 单一派生，ADR-133 G-1） */
export function toolbarMenuTestids(): string[] {
  const out: string[] = [];
  for (const key of ["batch", "more"] as const) {
    out.push(`tree-${key}`); // 触发按钮（tree-batch / tree-more）
    for (const it of TOOLBAR_MENUS[key].items) out.push(it.testid);
  }
  return out;
}
