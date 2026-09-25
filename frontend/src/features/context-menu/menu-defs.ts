// ===== 声明式菜单规格（ADR-021 B 层）=====
// 唯一事实来源：context-menus.ts 从本表生成 menu:show 载荷；
// 测试遍历本表断言结构与行为，加菜单项只改这里，测试自动覆盖。
// kind 判别联合（锐评 #7 收口，对齐 preview-3d PreviewMenuNode.kind 判别范式）：
//   - "divider" 纯分隔线，无任何字段；
//   - "header"  纯展示行（instance/batch 标题、workshop 信息行）——不占 action 空间，
//     假动作 `noop` 已从 MENU_ACTIONS 退役（标题不再是「行为标识为无」的 action）；
//   - "action"  唯一带行为的分支：visibleWhen 只活在 action 上，viewer-mode 守卫只过滤它。
// 三分支各自字段自洽，跨 kind 误填（如 divider 写 label）编译期即红。
import type { CtxShowPayload } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { formatBytes } from "@/utils/format/format.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { shortLabelOf } from "@/utils/resource/short-label.ts";

/** 分隔线条目 */
interface MenuDividerItemDef {
  kind: "divider";
}

/** 标题/信息条目：纯展示行，label 吃 ctx 快照动态渲染，表意走 icon 字段（禁 emoji 夹带） */
interface MenuHeaderItemDef {
  kind: "header";
  /** 展示文案：按 ctx 动态生成（实例名/工坊信息等数据行），表意符号走 icon 字段 */
  label: (ctx: CtxShowPayload) => string;
  icon?: UiIconName;
}

/** 行为条目：声明结构（label/icon/danger）+ 行为标识（action）+ 节点级显隐守卫 */
interface MenuActionItemDef {
  kind: "action";
  /** 行为标识：context-menus.ts 查 handler 表绑定 onClick；必须属于 MENU_ACTIONS（编译期约束） */
  action: MenuAction;
  /**
   * 文案按 ctx 动态生成（i18n `t()` 或 ctx 快照）。
   * 纯函数式 = 「label 必须经 i18n 或 ctx 动态生成」的类型级约束，防裸字符串漏 i18n
   * （2026-08-30 收紧：原 string 分支已无消费者，删除死分支）。
   */
  label: (ctx: CtxShowPayload) => string;
  icon?: UiIconName;
  danger?: boolean;
  /**
   * 节点级可见性谓词：返回 false 则该 item 不出现在 menu:show 载荷。
   * 与 preview-3d/menu/schema/node-types.ts 的 `PreviewMenuNode.visibleWhen`
   * 同构（吃 ctx 快照，纯函数，无副作用）；未定义 → 恒可见。
   * 与 viewer-mode 全局过滤（context-menus.ts `canWebAction`）AND：两边都通过才显示。
   */
  visibleWhen?: (ctx: CtxShowPayload) => boolean;
}

/** 菜单项声明：kind 判别三分支（divider | header | action） */
export type MenuItemDef = MenuDividerItemDef | MenuHeaderItemDef | MenuActionItemDef;

/** 单类菜单的完整声明 */
export interface MenuDef {
  type: CtxShowPayload["type"];
  items: MenuItemDef[];
}

/**
 * action 联合唯一事实来源（P2 收窄）：HANDLERS 断言覆盖它，
 * MenuItemDef.action 收窄为它 —— MENU_DEFS ⊂ MENU_ACTIONS ⊂ HANDLERS 三层由编译期钉死。
 * 新增/改名 action 漏挂 handler 或拼错即 typecheck 报错，不再等到运行时 warn。
 * 不导出（knip 死代码契约）：运行时消费者已收窄为 type-only（context-menu-file-handlers.ts L14），
 * 仅 MenuAction 类型派生需要它留在模块作用域。
 * noop 假动作已退役：标题项走 kind:"header"，不占 action 空间。
 */
const MENU_ACTIONS = [
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

/** 合法菜单 action 联合：MENU_DEFS 声明 / HANDLERS 表键双约束的公共类型 */
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** 五类右键菜单的声明式规格（唯一事实来源） */
export const MENU_DEFS: MenuDef[] = [
  {
    type: "instance",
    items: [
      {
        kind: "header",
        icon: "package",
        // 类型词同样走 shortLabelOf，与下方两项 action 同口径（2026-09 锐评「整合包菜单」
        // 收口的漏网处）：原先直插 ctx.rtype **原始 ID**，同一条菜单里于是并存
        // 「测试整合包 (EntityPlayer)」与「复制MMD清单」——相邻两行对同一个类型各叫各的。
        // rtype 缺失时不追加括号（handler 层已硬拒空 rtype，此处只求文案不塌陷）。
        label: (ctx) =>
          `${ctx.instanceName || ""}${ctx.rtype ? ` (${shortLabelOf(ctx.rtype)})` : ""}`,
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "instance.open-folder",
        label: () => t("menu.openFolder"),
        icon: "folderOpen",
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "instance.export-list",
        // 文案参数化（锐评「整合包菜单」收口，2026-09）：原「复制模型清单」写死"模型"，
        // 实际导出的是**当前 rtype** 的资源清单（instance-ops 按 rtype 限定目录，P0 修复）。
        // 停在光影包/蓝图卡片上说"复制模型清单"是语义塌陷——label 吃 ctx，类型走
        // shortLabelOf（i18n 感知的资源类型短标签；勿用 RESOURCE_TYPE_LABELS，那是
        // 中文全名硬编码，en/ja 下会注入中文）。rtype 缺失时短标签兜底 YSM，与既有
        // 展示层口径一致（handler 层仍硬拒空 rtype，此处只求文案不塌陷）。
        label: (ctx) => t("menu.copyModelList", { type: shortLabelOf(ctx.rtype || "") }),
        icon: "file",
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "instance.clear",
        // 同上：清空只清当前 rtype 的资源（instance-ops.ts L96-102 P0 修复明文拒绝
        // fallback 全类型），文案必须跟着类型走，否则危险操作挂在 implicit 上下文上。
        label: (ctx) => t("menu.clearPack", { type: shortLabelOf(ctx.rtype || "") }),
        icon: "delete",
        danger: true,
      },
    ],
  },
  {
    type: "batch",
    items: [
      {
        kind: "header",
        label: (ctx) => t("menu.batchSelected", { count: ctx.count || 0 }),
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "batch.rename",
        label: () => t("menu.batchRename"),
        icon: "cut",
      },
      { kind: "action", action: "batch.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { kind: "action", action: "batch.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      { kind: "divider" },
      {
        kind: "action",
        action: "batch.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "batch.copy-paths",
        label: () => t("menu.copyPaths"),
        icon: "clipboard",
      },
      {
        kind: "action",
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
        kind: "action",
        action: "file.rename",
        label: () => t("menu.rename"),
        icon: "cut",
        visibleWhen: (ctx) => (ctx.path || "").split(/[/\\]/).pop()?.toLowerCase() !== "ysm.json",
      },
      { kind: "action", action: "file.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { kind: "action", action: "file.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      {
        kind: "action",
        action: "file.push-to-pack",
        label: () => t("menu.pushToPack"),
        icon: "package",
      },
      { kind: "divider" },
      { kind: "action", action: "file.edit-tags", label: () => t("menu.editTags"), icon: "tag" },
      { kind: "divider" },
      {
        kind: "action",
        action: "file.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
      {
        kind: "action",
        action: "file.reveal",
        label: () => t("menu.openFileLocation"),
        icon: "folderOpen",
      },
      { kind: "divider" },
      {
        kind: "action",
        action: "file.copy-path",
        label: () => t("menu.copyFilePath"),
        icon: "clipboard",
      },
    ],
  },
  {
    type: "dir",
    items: [
      { kind: "action", action: "dir.rename", label: () => t("menu.rename"), icon: "cut" },
      {
        kind: "action",
        action: "dir.batch-rename",
        label: () => t("menu.batchRename"),
        icon: "edit",
      },
      { kind: "divider" },
      { kind: "action", action: "dir.move", label: () => t("menu.moveTo"), icon: "folderOpen" },
      { kind: "action", action: "dir.copy", label: () => t("menu.copyTo"), icon: "clipboard" },
      { kind: "divider" },
      { kind: "action", action: "dir.mkdir", label: () => t("menu.newSubfolder"), icon: "folder" },
      { kind: "divider" },
      {
        kind: "action",
        action: "dir.recycle",
        label: () => t("menu.recycle"),
        icon: "recycle",
        danger: true,
      },
    ],
  },
  {
    // 创意工坊模型行右键（community/events.ts 发射 ctx:show type="workshop"，ADR-208 D3）：
    // 纯展示信息行（名称/路径/哈希/大小），kind:"header" 判别——不再借 noop 假动作，
    // 表意走 icon 字段（ADR-245 语义名），体积走 utils/format formatBytes（自适应档位）。
    type: "workshop",
    items: [
      { kind: "header", icon: "file", label: (ctx) => ctx.workshop?.name ?? "" },
      { kind: "header", icon: "folderOpen", label: (ctx) => ctx.workshop?.path ?? "" },
      { kind: "header", icon: "lockClosed", label: (ctx) => ctx.workshop?.hash || "—" },
      {
        kind: "header",
        icon: "package",
        label: (ctx) => formatBytes(ctx.workshop?.size ?? 0) || "—",
      },
    ],
  },
];

/** 测试辅助：按 type 取声明（不存在返回 undefined） */
export function getMenuDef(type: CtxShowPayload["type"]): MenuDef | undefined {
  return MENU_DEFS.find((d) => d.type === type);
}
