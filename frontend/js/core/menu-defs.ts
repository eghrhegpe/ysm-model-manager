// ===== 声明式菜单规格（ADR-021 B 层）=====
// 唯一事实来源：context-menus.ts 从本表生成 menu:show 载荷；
// 测试遍历本表断言结构与行为，加菜单项只改这里，测试自动覆盖。
import type { CtxShowPayload } from "../bus";

/** 菜单项声明：结构（label/icon/danger/divider）+ 行为标识（action） */
interface MenuItemDef {
  /** 行为标识：context-menus.ts 查 handler 表绑定 onClick */
  action?: string;
  /** 静态文案或按 ctx 动态生成（如标题项） */
  label?: string | ((ctx: CtxShowPayload) => string);
  icon?: string;
  danger?: boolean;
  divider?: boolean;
}

/** 单类菜单的完整声明 */
export interface MenuDef {
  type: CtxShowPayload["type"];
  items: MenuItemDef[];
}

/** 四类右键菜单的声明式规格（唯一事实来源） */
export const MENU_DEFS: MenuDef[] = [
  {
    type: "instance",
    items: [
      {
        action: "noop",
        label: (ctx) =>
          `📦 ${ctx.instanceName || ""}${ctx.rtype ? ` (${ctx.rtype})` : ""}`,
      },
      { divider: true },
      { action: "instance.open-folder", label: "打开文件夹", icon: "📂" },
      { divider: true },
      { action: "instance.export-list", label: "复制模型清单", icon: "📄" },
      { divider: true },
      {
        action: "instance.clear",
        label: "清空此整合包的模型",
        icon: "🗑️",
        danger: true,
      },
    ],
  },
  {
    type: "batch",
    items: [
      {
        action: "noop",
        label: (ctx) => `📦 已选 ${ctx.count || 0} 个文件`,
      },
      { divider: true },
      { action: "batch.rename", label: "批量重命名...", icon: "✂️" },
      { action: "batch.move", label: "移动到…", icon: "📂" },
      { action: "batch.copy", label: "复制到…", icon: "📋" },
      { divider: true },
      {
        action: "batch.recycle",
        label: "移入回收站",
        icon: "♻️",
        danger: true,
      },
      { divider: true },
      { action: "batch.copy-paths", label: "复制文件路径列表", icon: "📋" },
      { action: "batch.export-list", label: "导出文件名清单 (.txt)", icon: "📄" },
    ],
  },
  {
    type: "file",
    items: [
      { action: "file.rename", label: "重命名", icon: "✂️" },
      { action: "file.move", label: "移动到…", icon: "📂" },
      { action: "file.copy", label: "复制到…", icon: "📋" },
      { action: "file.push-to-pack", label: "推送到整合包…", icon: "📦" },
      { divider: true },
      { action: "file.edit-tags", label: "🏷️ 编辑标签" },
      { divider: true },
      {
        action: "file.recycle",
        label: "移入回收站",
        icon: "♻️",
        danger: true,
      },
      { action: "file.reveal", label: "打开文件位置", icon: "📂" },
      { divider: true },
      { action: "file.copy-path", label: "复制文件路径", icon: "📋" },
    ],
  },
  {
    type: "dir",
    items: [
      { action: "dir.rename", label: "重命名…", icon: "✂️" },
      { action: "dir.batch-rename", label: "批量重命名…", icon: "📝" },
      { divider: true },
      { action: "dir.mkdir", label: "新建子文件夹…", icon: "🗂" },
      { divider: true },
      {
        action: "dir.recycle",
        label: "移入回收站",
        icon: "♻️",
        danger: true,
      },
    ],
  },
];

/** 测试辅助：按 type 取声明（不存在返回 undefined） */
export function getMenuDef(type: CtxShowPayload["type"]): MenuDef | undefined {
  return MENU_DEFS.find((d) => d.type === type);
}
