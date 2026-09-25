// ===== 工具栏下拉菜单声明式规格（收敛 tpl.ts 手写 <button class="dd-item">）=====
// 唯一事实来源：批量 + 更多 两个下拉的菜单项在此声明，tpl.ts 用 renderMenuItems 生成 HTML。
// 范式对齐 ADR-021 声明式菜单 + ADR-238 图标语义名规范（context-menu/menu-defs.ts）：
//   - 菜单项声明只描述「语义」：action（行为）、label（i18n）、icon（图标语义名）、divider
//   - 渲染与图标解析由本层统一处理，调用侧不垫 SVG/emoji 字符串
// 行为外置（ADR-298 D1）：本表只描述语义，行为实现经 action 联合类型指向命令注册表；
// 声明侧写错 / 改名漏挂即 tsc 报错（原 action: string 与 if-else 分派无类型约束）。
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
// 类型唯一事实源 = 命令注册表（ADR-298 D1）
import type { ToolbarCommandId } from "./toolbar-commands.ts";

/** 单个工具栏下拉菜单项声明（只描述语义，不垫渲染字符串） */
interface ToolbarMenuItem {
  /** 命令 id：data-batch / data-more 委托值，也即 toolbar-commands 注册表的键 */
  action: ToolbarCommandId;
  /** 唯一 testid（ADR-133 G-1 契约；与 action 不必同名，勿机械拼凑） */
  testid: string;
  /** i18n 文案 key（渲染时经 t() 解析——模块加载冻结会让语言热切换后文案停留在旧语言） */
  labelKey: LocaleKey;
  /** 图标语义名（UI_ICONS 的 key）；缺省无图标 */
  icon?: UiIconName;
  /** 在项前插分隔线 */
  dividerBefore?: boolean;
}

/**
 * 某下拉的菜单项声明（数组序 = 渲染序）。
 *
 * testid **在表中显式声明**，不由 action 派生。原注释误称「由 action 语义按前缀派生」，
 * 与本文件 ToolbarMenuItem.testid 的注释（「与 action 不必同名，勿机械拼凑」）自相矛盾，
 * 且事实不成立——7 项里有 2 项不可派生：action `enable-all` 的 testid 是 `tree-batch-enable`
 * （非 `…-enable-all`）。**刻意不改成派生**：testid 是 ADR-133 G-1 契约（e2e 按它寻址），
 * 机械拼凑会改名 → 破坏契约；且「双处维护」早已由「表即单一事实源」消解——
 * 渲染端 renderDropdown() 只从表取（`data-testid="${it.testid}"`），模板里不二次手写。
 */
type ToolbarMenuKey = "batch" | "more";

/** 下拉容器（按钮 + 菜单）与它承载的菜单项声明 */
interface ToolbarMenuDef {
  /** 下拉触发按钮的稳定 id/testid（ADR-133） */
  id: string;
  /** 菜单容器 id */
  menuId: string;
  /** 触发按钮文案 key（渲染时经 t() 解析） */
  buttonLabelKey: LocaleKey;
  /** 触发按钮图标语义名（UI_ICONS 的 key，经 resolveIcon 解析）；缺省无图标 */
  buttonIcon?: UiIconName;
  /** 全部菜单项（data-<key> 委托到 toolbar-events.ts） */
  items: readonly ToolbarMenuItem[];
}

/** 工具栏两个下拉的声明式定义 */
const TOOLBAR_MENUS: Record<ToolbarMenuKey, ToolbarMenuDef> = {
  batch: {
    id: "btn-batch",
    menuId: "menu-batch",
    buttonLabelKey: "tree.batch",
    buttonIcon: "performance",
    items: [
      {
        action: "enable-all",
        testid: "tree-batch-enable",
        labelKey: "tree.batchEnableAll",
        icon: "enableAll",
      },
      {
        action: "disable-all",
        testid: "tree-batch-disable",
        labelKey: "tree.batchDisableAll",
        icon: "disableAll",
      },
    ],
  },
  more: {
    id: "btn-more",
    menuId: "menu-more",
    buttonLabelKey: "tree.more",
    buttonIcon: "verticalDots",
    items: [
      {
        action: "import-file",
        testid: "tree-more-import-file",
        labelKey: "tree.moreImportFile",
        icon: "file",
      },
      {
        action: "import-dir",
        testid: "tree-more-import-dir",
        labelKey: "tree.moreImportDir",
        icon: "folderOpen",
      },
      {
        action: "open-folder",
        testid: "tree-more-open-folder",
        labelKey: "tree.moreOpenFolder",
        icon: "folderOpen",
        dividerBefore: true,
      },
      {
        action: "refresh",
        testid: "tree-more-refresh",
        labelKey: "tree.moreRefresh",
        icon: "refresh",
      },
      {
        action: "genindex",
        testid: "tree-more-genindex",
        labelKey: "tree.moreGenIndex",
        icon: "book",
      },
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
        ? '<div style="border-top:1px solid var(--bd);margin:var(--pad-v-2)"></div>'
        : "";
      const icon = it.icon ? `${resolveIcon(it.icon)} ` : "";
      return `${gap}<button class="dd-item" data-${attr}="${it.action}" data-testid="${it.testid}">${icon}${t(it.labelKey)}</button>`;
    })
    .join("");
  return (
    `<div class="dd-wrap" id="dd-${attr}">` +
    `<button class="btn-base sm" id="${def.id}" data-testid="tree-${attr}">${def.buttonIcon ? `${resolveIcon(def.buttonIcon)} ` : ""}${t(def.buttonLabelKey)}</button>` +
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
