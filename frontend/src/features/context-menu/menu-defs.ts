// ===== 声明式菜单规格（ADR-021 B 层）=====
// 唯一事实来源：context-menus.ts 从本表生成 menu:show 载荷；
// 测试遍历本表断言结构与行为，加菜单项只改这里，测试自动覆盖。
// 2026-XX P1 扩展（与 preview-3d PreviewMenuNode.visibleWhen 对齐）：
// 节点级 `visibleWhen` 谓词吃 ctx 快照（与 AGENTS.md「3d菜单只允许 visibleWhen」
// 的精神面一致），实现右键菜单与3D 菜单的声明式语义统一；未定义时行为不变。
import type { CtxShowPayload } from "@/bus";
import { t } from "@/core/i18n/t.ts";

/** 菜单项声明：结构（label/icon/danger/divider）+ 行为标识（action）+ 节点级显隐守卫 */
interface MenuItemDef {
  /** 行为标识：context-menus.ts 查 handler 表绑定 onClick；必须属于 MENU_ACTIONS（编译期约束） */
  action?: MenuAction;
  /**
   * 静态文案或按 ctx 动态生成（如标题项）；divider 项省略。
   * 2026-XX 收紧：原 `string | ((ctx) => string)` 的 string 分支已无消费者
   * （所有声明均函数式：`() => t(<key>)` 或 `(ctx) => 动态`），
   * 收紧为纯函数式让「label 必须经 i18n 或 ctx 动态生成」成为类型级约束。
   */
  label?: (ctx: CtxShowPayload) => string;
  icon?: string;
  danger?: boolean;
  divider?: boolean;
  /**
   * 节点级可见性谓词：返回 false 则该 item 不出现在 menu:show 载荷。
   * 与 preview-3d/menu/node-types.ts 的 `PreviewMenuNode.visibleWhen`
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

/**
 * action 联合唯一事实来源（P2 收窄）：HANDLERS 断言覆盖它，
 * MenuItemDef.action 收窄为它 —— MENU_DEFS ⊂ MENU_ACTIONS ⊂ HANDLERS 三层由编译期钉死。
 * 新增/改名 action 漏挂 handler 或拼错即 typecheck 报错，不再等到运行时 warn。
 * 不导出（knip 死代码契约）：运行时消费者已收窄为 type-only（context-menu-handlers.ts L12），
 * 仅 MenuAction 类型派生需要它留在模块作用域。
 */
const MENU_ACTIONS = [
  "noop",
  "instance.open-folder",
  "instance.export-list",
  "instance.clear",
  "batch.rename",
  "batch.move",
  "batch.copy",
  "batch.recycle",
  "batch.copy-paths",
  "batch.export-list",
  "file.rename",
  "file.move",
  "file.copy",
  "file.push-to-pack",
  "file.edit-tags",
  "file.recycle",
  "file.reveal",
  "file.copy-path",
  "dir.rename",
  "dir.batch-rename",
  "dir.move",
  "dir.copy",
  "dir.mkdir",
  "dir.recycle",
] as const;

/** 合法菜单 action 联合：MENU_DEFS 声明 / HANDLERS 注册双约束的公共类型 */
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** 四类右键菜单的声明式规格（唯一事实来源） */
export const MENU_DEFS: MenuDef[] = [
  {
    type: "instance",
    items: [
      {
        action: "noop",
        label: (ctx) => `📦 ${ctx.instanceName || ""}${ctx.rtype ? ` (${ctx.rtype})` : ""}`,
      },
      { divider: true },
      {
        action: "instance.open-folder",
        label: () => t("menu.openFolder"),
        icon: "folderOpen",
      },
      { divider: true },
      {
        action: "instance.export-list",
        label: () => t("menu.copyModelList"),
        icon: "file",
      },
      { divider: true },
      {
        action: "instance.clear",
        label: () => t("menu.clearPack"),
        icon: "delete",
        danger: true,
      },
    ],
  },
  {
    type: "batch",
    items: [
      {
        action: "noop",
        label: (ctx) => t("menu.batchSelected", { count: ctx.count || 0 }),
      },
      { divider: true },
      { action: "batch.rename", label: () => t("menu.batchRename"), icon: "cut" },
      { action: "batch.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { action: "batch.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      { divider: true },
      {
        action: "batch.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
      { divider: true },
      { action: "batch.copy-paths", label: () => t("menu.copyPaths"), icon: "clipboard" },
      {
        action: "batch.export-list",
        label: () => t("menu.exportList"),
        icon: "file",
      },
    ],
  },
  {
    type: "file",
    items: [
      // ysm.json 是模型目录清单（ADR-038 D3，Go fileops / web-fs 后端双侧硬拒）——
      // visibleWhen 首个真实消费者：菜单层直接不给出死动作，替代 handler 内 toast 教育
      {
        action: "file.rename",
        label: () => t("menu.rename"),
        icon: "cut",
        visibleWhen: (ctx) => (ctx.path || "").split(/[/\\]/).pop()?.toLowerCase() !== "ysm.json",
      },
      { action: "file.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { action: "file.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      {
        action: "file.push-to-pack",
        label: () => t("menu.pushToPack"),
        icon: "package",
      },
      { divider: true },
      { action: "file.edit-tags", label: () => t("menu.editTags"), icon: "tag" },
      { divider: true },
      {
        action: "file.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
      {
        action: "file.reveal",
        label: () => t("menu.openFileLocation"),
        icon: "folderOpen",
      },
      { divider: true },
      {
        action: "file.copy-path",
        label: () => t("menu.copyFilePath"),
        icon: "clipboard",
      },
    ],
  },
  {
    type: "dir",
    items: [
      { action: "dir.rename", label: () => t("menu.rename"), icon: "cut" },
      {
        action: "dir.batch-rename",
        label: () => t("menu.batchRename"),
        icon: "edit",
      },
      { divider: true },
      { action: "dir.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { action: "dir.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      { divider: true },
      { action: "dir.mkdir", label: () => t("menu.newSubfolder"), icon: "folder" },
      { divider: true },
      {
        action: "dir.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
    ],
  },
  {
    // 创意工坊模型行右键（community/events.ts 发射 ctx:show type="workshop"，ADR-208 D3）：
    // 纯展示项（名称/路径/哈希/大小），行为挂 noop——与 instance/batch 标题项同款模式，
    // 替代原 community 域手搓 menu:show + 空 onClick 的幽灵菜单（视觉行为等价）。
    type: "workshop",
    items: [
      {
        action: "noop",
        label: (ctx) => `📄 ${ctx.workshop?.name ?? ""}`,
      },
      {
        action: "noop",
        label: (ctx) => `📂 ${ctx.workshop?.path ?? ""}`,
      },
      {
        action: "noop",
        label: (ctx) => `🔐 ${ctx.workshop?.hash || "—"}`,
      },
      {
        action: "noop",
        label: (ctx) => {
          const size = ctx.workshop?.size ?? 0;
          return size > 0 ? `📏 ${(size / 1024).toFixed(0)}KB` : "📏 ?KB";
        },
      },
    ],
  },
];

/** 测试辅助：按 type 取声明（不存在返回 undefined） */
export function getMenuDef(type: CtxShowPayload["type"]): MenuDef | undefined {
  return MENU_DEFS.find((d) => d.type === type);
}
