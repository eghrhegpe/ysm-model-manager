// ===== 声明式菜单规格（ADR-021 B 层）=====
// 唯一事实来源：context-menus.ts 从本表生成 menu:show 载荷；
// 测试遍历本表断言结构与行为，加菜单项只改这里，测试自动覆盖。
// 2026-XX P1 扩展（与 utils/3d PreviewMenuNode.visibleWhen 对齐）：
// 节点级 `visibleWhen` 谓词吃 ctx 快照（与 AGENTS.md「3d菜单只允许 visibleWhen」
// 的精神面一致），实现右键菜单与3D 菜单的声明式语义统一；未定义时行为不变。
import type { CtxShowPayload } from "../bus";
import { tr } from "./i18n/tr.ts";

/** 菜单项声明：结构（label/icon/danger/divider）+ 行为标识（action）+ 节点级显隐守卫 */
interface MenuItemDef {
  /** 行为标识：context-menus.ts 查 handler 表绑定 onClick */
  action?: string;
  /**
   * 静态文案或按 ctx 动态生成（如标题项）；divider 项省略。
   * 2026-XX 收紧：原 `string | ((ctx) => string)` 的 string 分支已无消费者
   * （所有声明均函数式：`() => tr("menu.xxx", "Fallback")` 或 `(ctx) => 动态`），
   * 收紧为纯函数式让「label 必须经 i18n 或 ctx 动态生成」成为类型级约束。
   */
  label?: (ctx: CtxShowPayload) => string;
  icon?: string;
  danger?: boolean;
  divider?: boolean;
  /**
   * 节点级可见性谓词：返回 false 则该 item 不出现在 menu:show 载荷。
   * 与 utils/3d/adapters/preview-menu/node-types.ts 的 `PreviewMenuNode.visibleWhen`
   * 同构（吃 ctx 快照，纯函数，无副作用）；未定义 → 恒可见。
   * 与 viewer-mode 全局过滤（context-menus.ts `canWebAction`）AND：两边都通过才显示。
   */
  visibleWhen?: (ctx: CtxShowPayload) => boolean;
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
      { action: "instance.open-folder", label: () => tr("menu.openFolder", "Open Folder"), icon: "📂" },
      { divider: true },
      { action: "instance.export-list", label: () => tr("menu.copyModelList", "Copy Model List"), icon: "📄" },
      { divider: true },
      {
        action: "instance.clear",
        label: () => tr("menu.clearPack", "Clear Pack"),
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
      { action: "batch.rename", label: () => tr("menu.batchRename", "Batch Rename"), icon: "✂️" },
      { action: "batch.move", label: () => tr("menu.moveTo", "Move To"), icon: "📂" },
      { action: "batch.copy", label: () => tr("menu.copyTo", "Copy To"), icon: "📋" },
      { divider: true },
      {
        action: "batch.recycle",
        label: () => tr("menu.recycle", "Recycle"),
        icon: "♻️",
        danger: true,
      },
      { divider: true },
      { action: "batch.copy-paths", label: () => tr("menu.copyPaths", "Copy Paths"), icon: "📋" },
      { action: "batch.export-list", label: () => tr("menu.exportList", "Export List"), icon: "📄" },
    ],
  },
  {
    type: "file",
    items: [
      { action: "file.rename", label: () => tr("menu.rename", "Rename"), icon: "✂️" },
      { action: "file.move", label: () => tr("menu.moveTo", "Move To"), icon: "📂" },
      { action: "file.copy", label: () => tr("menu.copyTo", "Copy To"), icon: "📋" },
      { action: "file.push-to-pack", label: () => tr("menu.pushToPack", "Push to Pack"), icon: "📦" },
      { divider: true },
      { action: "file.edit-tags", label: () => tr("menu.editTags", "Edit Tags"), icon: "🏷️" },
      { divider: true },
      {
        action: "file.recycle",
        label: () => tr("menu.recycle", "Recycle"),
        icon: "♻️",
        danger: true,
      },
      { action: "file.reveal", label: () => tr("menu.openFileLocation", "Open File Location"), icon: "📂" },
      { divider: true },
      { action: "file.copy-path", label: () => tr("menu.copyFilePath", "Copy File Path"), icon: "📋" },
    ],
  },
  {
    type: "dir",
    items: [
      { action: "dir.rename", label: () => tr("menu.rename", "Rename"), icon: "✂️" },
      { action: "dir.batch-rename", label: () => tr("menu.batchRename", "Batch Rename"), icon: "📝" },
      { divider: true },
      { action: "dir.move", label: () => tr("menu.moveTo", "Move To"), icon: "📂" },
      { action: "dir.copy", label: () => tr("menu.copyTo", "Copy To"), icon: "📋" },
      { divider: true },
      { action: "dir.mkdir", label: () => tr("menu.newSubfolder", "New Subfolder"), icon: "🗂" },
      { divider: true },
      {
        action: "dir.recycle",
        label: () => tr("menu.recycle", "Recycle"),
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
