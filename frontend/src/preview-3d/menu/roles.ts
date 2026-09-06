// ===== 角色面板（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// MikuMikuAR buildModelRootItems 移植（2026-08-20）：
// 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
// （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
// 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载模型，
// 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。

import { tr } from "../../core/i18n/tr.ts";
import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { attachTooltip } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { type ModelEntry, sceneRegistry } from "../adapters/scene-registry.ts";
import { onOverlayStyleTargetReset, overlayStyleRoot } from "../overlay-style-bridge.ts";
import { MENU_ERROR_NOTE_CSS } from "./menu-styles.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import { renderAdapterPanelContent, renderMenu } from "./render.ts";
import { buildSwitchNodes, type SwitchState } from "./switch.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
/** 角色路径 basename：角色详情/工具面板标题复用（fillRoles 与 dock 🧍 捷径共享，防两处漂移）。
 *  [ADR-159] 容器语义：entry 有 displayName（容器实体名，如 zip 名剥扩展名）时优先展示——
 *  用户看到「包」而非包内首个模型的技术文件名。
 *  否则剥离扩展名（.ysm/.json/.zip/.vrm/.pmx/.fbx/.litematic 等任意单段后缀）——
 *  entry.path 可能指向包内入口文件（如 ysm.json），basename 直接展示会露出无意义的技术文件名。 */
export function roleBaseName(e: ModelEntry): string {
  if (e.displayName) return e.displayName;
  const base = e.path.split(/[/\\]/).pop() || e.path;
  // 剥最后一段 .ext（任意后缀，保留带点号的版本号如 1.2）
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// P1 批次3：角色面板内联 cssText → 集中类（fr- 前缀本文件私有，ensureRolesStyles
// 幂等注入——modelDetailView/motionDetailView/fillRoles 三个入口各调一次，覆盖全部渲染路径）
let _rolesStylesInjected = false;
onOverlayStyleTargetReset(() => {
  _rolesStylesInjected = false;
}); // ADR-175 M1:目标切换重注入
function ensureRolesStyles(): void {
  if (_rolesStylesInjected) return;
  const style = document.createElement("style");
  style.textContent = `
/* 角色面板集中样式（P1 批次3：cssText→类）。高亮单一源 .fr-row-active：角色 active 与
   组件当前行共用，派生 --accent（刀② 收编后禁回硬编码 rgba）。 */
.fr-role-row, .fr-comp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  cursor: pointer;
}
.fr-role-row { padding: 6px 8px; font-size: 13px; }
.fr-comp-row { padding: 6px 10px; font-size: 12px; }
.fr-row-active { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.fr-empty-note { padding: 8px 10px; color: rgba(255,255,255,0.5); font-size: 12px; }
${MENU_ERROR_NOTE_CSS}
.fr-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 6px 10px; }
.fr-scroll-box { max-height: 220px; overflow-y: auto; }
.fr-name-ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-focus-btn {
  width: 18px; height: 18px; flex-shrink: 0; background: transparent; border: none;
  cursor: pointer; font-size: 14px; line-height: 1; color: rgba(255,255,255,0.5);
}
.fr-row-active .fr-focus-btn { color: var(--accent); }
.fr-tools-btn {
  width: 22px; height: 22px; flex-shrink: 0; background: rgba(255,255,255,0.08);
  border: none; border-radius: 4px; cursor: pointer; font-size: 13px; line-height: 1;
}
.fr-comp-add-btn {
  width: 20px; height: 20px; flex-shrink: 0; background: rgba(255,255,255,0.08);
  border: none; border-radius: 4px; cursor: pointer; font-size: 11px; line-height: 1;
}
.fr-unload-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
  cursor: pointer; font-size: 13px; color: #ff7b7b;
}
.fr-section-title { padding: 6px 10px 2px; color: rgba(255,255,255,0.5); font-size: 11px; }
.fr-comp-mark { width: 14px; flex-shrink: 0; text-align: center; }
`;
  overlayStyleRoot().appendChild(style);
  _rolesStylesInjected = true;
}

// ── 模型详情（🧍 模型 dock 入口）──
// 模型信息面板本体直渲（统计/纹理）+ 工具行（截图/材质）——纯模型上下文，无动作项
export function modelDetailView(
  e: ModelEntry,
  deps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
    menu: SlideMenuHandle;
    actionCtx: PreviewActionMenuCtx;
    /** [ADR-159 呈现收敛] 容器组件导航：点名切活跃组件 / ➕ keepInScene 追加同框 */
    switchTo: (path: string, options?: { keepInScene?: boolean }) => Promise<void> | void;
  },
): SlideMenuView {
  ensureRolesStyles();
  const panelDeps = {
    makeRow: deps.makeRow,
    makePanelView: deps.makePanelView,
    menu: deps.menu,
    actionCtx: deps.actionCtx,
  };
  return {
    title: roleBaseName(e),
    render: (l) => {
      // [ADR-159 呈现收敛] 渲染以「当前活跃 entry」为基准：组件切换后重渲，统计/高亮自动跟随；
      // 组件区置顶（镜像 mmd 面板「组件 → 名称/概览」范式），无 components 零输出。
      const renderAll = (): void => {
        l.innerHTML = "";
        const cur = sceneRegistry.get(sceneRegistry.getActiveId() ?? "") ?? e;
        const hadComponents = renderComponentsSection(l, {
          entry: cur,
          switchTo: deps.switchTo,
          onChanged: renderAll,
        });
        const modelItems = (cur.menuItems ?? []).filter(
          (d) => d.kind === "panel" && d.dockGroup === "model",
        );
        if (modelItems.length === 0) {
          if (!hadComponents) {
            const empty = document.createElement("div");
            empty.className = "fr-empty-note";
            empty.textContent = tr("preview.roleNoDetail", "（该角色无可查看项）");
            l.appendChild(empty);
          }
          return;
        }
        const primary = modelItems[0];
        const toolItems = modelItems.slice(1);
        // 模型信息面板本体直渲（1 跳看内容，用户「最想进入」）——走与 ⚙ 面板同一条
        // 三通道衰退（schema-registry → children → renderCustom，renderAdapterPanelContent
        // 共享实现）。P5 事故修复：旧直渲门只认 renderCustom，四类适配器模型面板迁离后
        // （ysm/maid→schemaId、mmd/vrm→children）统计/纹理/组件 select 在此集体消失。
        if (primary) {
          const infoHost = document.createElement("div");
          infoHost.dataset.panelId = primary.id;
          try {
            const handled = renderAdapterPanelContent(infoHost, primary, {
              ...panelDeps,
              hideMenu: () => deps.menu.back(),
            });
            if (handled) {
              l.appendChild(infoHost);
              const sep = document.createElement("div");
              sep.className = "fr-divider";
              l.appendChild(sep);
            }
          } catch (err) {
            console.error("[preview-menu] 模型信息面板渲染失败", primary.id, err);
            const errRow = document.createElement("div");
            errRow.className = "fr-error-note";
            errRow.textContent = `${tr("preview.renderFail", "Panel render failed")}: ${safeErrorMessage(err)}`;
            l.appendChild(errRow);
          }
        }
        // 工具行（截图/材质）：单项平铺，多项折叠
        const sections: PreviewMenuNode[] = [];
        if (toolItems.length === 1) {
          sections.push(toolItems[0]);
        } else if (toolItems.length > 1) {
          sections.push({
            id: "preview-role-tools",
            kind: "folder",
            labelKey: "preview.roleToolsSection",
            fallback: "工具",
            defaultOpen: true,
            children: toolItems,
          });
        }
        if (sections.length > 0) renderMenu(l, sections, panelDeps);
      };
      renderAll();
    },
  };
}

// ── 动作详情（💃 动作 dock 入口）──
// 纯动作上下文：骨骼/播放/感知——无模型信息、无工具项、无折叠
export function motionDetailView(
  e: ModelEntry,
  deps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
    menu: SlideMenuHandle;
    actionCtx: PreviewActionMenuCtx;
  },
): SlideMenuView {
  ensureRolesStyles();
  const motionItems = (e.menuItems ?? []).filter(
    (d) => d.kind === "panel" && d.dockGroup === "motion",
  );
  return {
    title: roleBaseName(e),
    render: (l) => {
      l.innerHTML = "";
      if (motionItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "fr-empty-note";
        empty.textContent = tr("preview.roleNoMotion", "（该角色无可播放动作）");
        l.appendChild(empty);
        return;
      }
      // 动作项全部平铺——骨骼/播放/感知各自直达，不需要折叠
      renderMenu(l, motionItems, deps);
    },
  };
}

interface FrToolsDeps {
  unloadModel: (id: string) => void;
  closePopup: () => void;
}

function frBuildToolsView(e: ModelEntry, deps: FrToolsDeps): SlideMenuView {
  // 注意：原函数在 fillRoles 里声明的 toolsView 直接是闭包返回对象，未立即调用 navigate；
  // 调用 navigate 在 frBuildRoleToolsBtn 的 onclick 里完成，但原 onclick 调用的是 menu.navigate(toolsView(e))，
  // 而此函数返回的正好就是 SlideMenuView，供点击方调用。
  return {
    title: `${roleBaseName(e)} ${tr("preview.roleTools", "模型工具")}`,
    render: (l) => {
      l.innerHTML = "";
      const unload = document.createElement("div");
      unload.dataset.testid = "preview-role-unload";
      unload.textContent = `🗑 ${tr("preview.unloadModel", "卸载模型")}`;
      unload.className = "fr-unload-row";
      unload.onclick = (): void => {
        deps.unloadModel(e.id);
        deps.closePopup();
      };
      l.appendChild(unload);
    },
  };
}

/** [ADR-159 呈现收敛] 容器组件导航段：entry 带 components（资源包 = zip 内模型）时平铺。
 *  初版挂「加载角色」面板顶层（fillRoles），与组件详情（stats）分居两处、导航绕；现收进
 *  modelDetailView 详情置顶渲染——点组件名 switchTo 切活跃、➕ keepInScene 追加同框，
 *  onChanged 于切换落定后回调（详情据此重渲：✓ 高亮 + 统计跟随新组件）。
 *  返回是否实际渲染（供调用方决定空态文案）。 */
function renderComponentsSection(
  container: HTMLElement,
  opts: {
    entry: ModelEntry;
    switchTo: (path: string, options?: { keepInScene?: boolean }) => Promise<void> | void;
    onChanged?: () => void;
  },
): boolean {
  const { entry } = opts;
  const components = entry.components ?? [];
  if (components.length === 0) return false;

  // 切换落定后回调 onChanged（switchTo 可能异步；void 返回视为即时完成）
  const runSwitch = (path: string, keep: boolean): void => {
    const after = (): void => opts.onChanged?.();
    const r = keep ? opts.switchTo(path, { keepInScene: true }) : opts.switchTo(path);
    if (r && typeof (r as Promise<void>).then === "function") {
      void (r as Promise<void>).then(after, () => undefined);
    } else {
      after();
    }
  };

  const title = document.createElement("div");
  title.dataset.testid = "preview-components-title";
  title.textContent = `${tr("preview.component", "组件")}（${components.length}）`;
  title.className = "fr-section-title";
  container.appendChild(title);

  const box = document.createElement("div");
  box.dataset.testid = "preview-components-list";
  box.className = "fr-scroll-box";
  const curNorm = (entry.path ?? "").replace(/\\/g, "/").toLowerCase();
  for (const p of components) {
    const isCur = p.replace(/\\/g, "/").toLowerCase() === curNorm;
    const row = document.createElement("div");
    row.dataset.testid = "preview-component-row";
    row.dataset.componentPath = p;
    row.className = `fr-comp-row${isCur ? " fr-row-active" : ""}`;
    const mark = document.createElement("span");
    mark.className = "fr-comp-mark";
    mark.textContent = isCur ? "✓" : "🧩";
    const name = document.createElement("span");
    name.className = "fr-name-ellipsis";
    name.textContent = p.split(/[/\\]/).pop() || p;
    attachTooltip(name, p);
    row.append(mark, name);
    if (!isCur) {
      const append = document.createElement("button");
      append.dataset.testid = "preview-component-append";
      append.textContent = "➕";
      attachTooltip(append, () => tr("preview.appendModel", "追加到场景"));
      append.className = "fr-comp-add-btn";
      append.onclick = (ev): void => {
        ev.stopPropagation();
        runSwitch(p, true);
      };
      row.appendChild(append);
    }
    row.onclick = (): void => {
      runSwitch(p, false);
    };
    box.appendChild(row);
  }
  container.appendChild(box);
  return true;
}

// ── ADR-193 第四刀：roles 面板声明式化（fillRoles DOM 层退役）──
// 结构：角色 row 列表（radio 焦点 / 整行进详情 / ⚙ badge 工具）+ divider + switch 加载入口。
// modelDetailView / motionDetailView（SlideMenuView 工厂）保留——它们是 navigate 目标，
// 内部本就声明式（renderAdapterPanelContent 三通道 → renderMenu）。
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
  ensureRolesStyles();
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
