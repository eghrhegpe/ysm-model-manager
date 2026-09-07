// ===== 角色面板声明式 schema（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// MikuMikuAR buildModelRootItems 移植（2026-08-20）：
// 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
// （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
// 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载模型，
// 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。
//
// [2026-09 迁出] 本文件只留声明式 schema 构建器（buildRolesSchema + RolesSchemaDeps）。
// modelDetailView / motionDetailView / frBuildToolsView / renderComponentsSection /
// ensureRolesStyles 及 roleBaseName 的实现已迁 roles-views.ts（navigate 目标视图工厂，
// DOM 半身）——分开存放防后来者把 DOM 装配误当 buildRolesSchema 的写法复制。

import { tr } from "@/core/i18n/tr.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/ui/ui-slide-menu.ts";
import { sceneRegistry } from "../adapters/scene-registry.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import { frBuildToolsView, modelDetailView, roleBaseName } from "./roles-views.ts";
import { buildSwitchNodes, type SwitchState } from "./switch.ts";

// 迁出兼容：roleBaseName 仍从本文件 re-export（core.ts 原位 import；实现单源 roles-views.ts）
export { roleBaseName } from "./roles-views.ts";

// ── ADR-193 第四刀：roles 面板声明式化（fillRoles DOM 层退役）──
// 结构：角色 row 列表（radio 焦点 / 整行进详情 / ⚙ badge 工具）+ divider + switch 加载入口。
// modelDetailView / motionDetailView（SlideMenuView 工厂）保留于 roles-views.ts——它们是
// navigate 目标，内部本就声明式（renderAdapterPanelContent 三通道 → renderMenu）。
// 旧 fillRoles DOM 层（rolesBox/frBuildRoleRow/focus radio/➕）删除；row 节点新增的
// radio/badge 槽位（node-types.ts）承接「行首焦点钮 + 行尾 ⚙」复合行语义。

/** roles 面板 deps（buildPreviewMenuRouters 组装；闭包延迟求值防 handle 未就绪） */
export interface RolesSchemaDeps {
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
  makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  menu: SlideMenuHandle;
  actionCtx: PreviewActionMenuCtx;
  setAdapterItems: (items: PreviewMenuNode[]) => void;
  hideMenu: () => void;
}

/** roles 面板声明式 schema：角色列表 + divider + switch 加载入口（switch 状态 mount 级） */
export function buildRolesSchema(
  ctx: PreviewMenuCtx,
  deps: RolesSchemaDeps,
  switchState: SwitchState,
): PreviewMenuNode[] {
  const nodes: PreviewMenuNode[] = [];
  const entries = sceneRegistry.getAll();
  const activeId = sceneRegistry.getActiveId();
  if (entries.length === 0) {
    nodes.push({
      id: "roles-empty",
      kind: "sectionTitle",
      labelKey: "",
      fallback: tr("preview.noRoles", "（无已加载角色）"),
    });
  }
  for (const e of entries) {
    const isActive = e.id === activeId;
    nodes.push({
      id: `role-${e.id}`,
      kind: "row",
      fallback: roleBaseName(e),
      // 整行进详情（navigate 目标 = modelDetailView：组件导航/统计/工具齐备）
      action: () =>
        deps.actionCtx.navigate?.(
          modelDetailView(e, {
            makeRow: deps.makeRow,
            makePanelView: deps.makePanelView,
            menu: deps.menu,
            actionCtx: deps.actionCtx,
            switchTo: (p, o) => (o === undefined ? ctx.switchTo(p) : ctx.switchTo(p, o)),
          }),
        ),
      radio: {
        active: isActive,
        title: tr("preview.roleFocus", "设为焦点"),
        onClick: () => {
          sceneRegistry.setActive(e.id);
          // setActive 仅在 menuItems truthy 时经 menuSink 换菜单；无专属项的角色
          // 需显式清空 dock 适配器项，避免残留上一角色的菜单（code_review P2）
          if (!e.menuItems) deps.setAdapterItems([]);
          deps.menu.refresh(); // 重跑 builder：active 态/列表即时跟随
        },
      },
      badge: {
        label: "⚙",
        title: tr("preview.roleTools", "模型工具"),
        onClick: () =>
          deps.actionCtx.navigate?.(
            frBuildToolsView(e, {
              unloadModel: (id) => ctx.unloadModel?.(id),
              closePopup: () => deps.hideMenu(),
            }),
          ),
      },
    });
  }
  nodes.push({ id: "roles-divider", kind: "divider" });
  nodes.push(...buildSwitchNodes(ctx, deps.menu, switchState));
  return nodes;
}
