// ===== 角色面板（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// MikuMikuAR buildModelRootItems 移植（2026-08-20）：
// 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
// （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
// 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载角色，
// 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。

import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { attachTooltip } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { t, type LocaleKey } from "../../core/i18n/t.ts";
import type { PreviewMenuNode, PreviewActionMenuCtx } from "./node-types.ts";
import { sceneRegistry, type ModelEntry } from "../adapters/scene-registry.ts";
import { renderMenu, renderAdapterPanelContent } from "./render.ts";
import { fillSwitch } from "./switch.ts";
import type { PreviewMenuCtx } from "./core.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
const tr = (key: string, fallback: string): string => {
  const v = t(key as LocaleKey);
  return v === key ? fallback : v;
};

/** 角色路径 basename：角色详情/工具面板标题复用（fillRoles 与 dock 🧍 捷径共享，防两处漂移）。
 *  剥离扩展名（.ysm/.json/.zip/.vrm/.pmx/.fbx/.litematic 等任意单段后缀）——
 *  用户实测 ysm.json 当标题反直觉：entry.path 可能指向包内入口文件（如 ysm.json），
 *  basename 直接展示会露出无意义的技术文件名；剥后缀后保留模型真名
 *  （如 [vup]子言-水手服(...)[VUP曼云]1.2.zip → [vup]子言-水手服(...)[VUP曼云]1.2）。 */
export function roleBaseName(e: ModelEntry): string {
  const base = e.path.split(/[/\\]/).pop() || e.path;
  // 剥最后一段 .ext（任意后缀，保留带点号的版本号如 1.2）
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
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
  },
): SlideMenuView {
  const modelItems = (e.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "model");
  const primary = modelItems[0];
  const toolItems = modelItems.slice(1);
  return {
    title: roleBaseName(e),
    render: (l) => {
      l.innerHTML = "";
      if (modelItems.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
        empty.textContent = tr("preview.roleNoDetail", "（该角色无可查看项）");
        l.appendChild(empty);
        return;
      }
      // 模型信息面板本体直渲（1 跳看内容，用户「最想进入」）——走与 ⚙ 面板同一条
      // 三通道衰退（schema-registry → children → renderCustom，renderAdapterPanelContent
      // 共享实现）。P5 事故修复：旧直渲门只认 renderCustom，四类适配器模型面板迁离后
      // （ysm/maid→schemaId、mmd/vrm→children）统计/纹理/组件 select 在此集体消失。
      if (primary) {
        const infoHost = document.createElement("div");
        infoHost.dataset.panelId = primary.id;
        infoHost.dataset.panelTestId = primary.legacyTestId ?? "";
        try {
          const handled = renderAdapterPanelContent(infoHost, primary, {
            makeRow: deps.makeRow,
            makePanelView: deps.makePanelView,
            menu: deps.menu,
            actionCtx: deps.actionCtx,
            hideMenu: () => deps.menu.back(),
          });
          if (handled) {
            l.appendChild(infoHost);
            const sep = document.createElement("div");
            sep.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
            l.appendChild(sep);
          }
        } catch (err) {
          console.error("[preview-menu] 模型信息面板渲染失败", primary.id, err);
          const errRow = document.createElement("div");
          errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
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
      if (sections.length > 0) renderMenu(l, sections, deps);
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
  const motionItems = (e.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "motion");
  return {
    title: roleBaseName(e),
    render: (l) => {
      l.innerHTML = "";
      if (motionItems.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
        empty.textContent = tr("preview.roleNoMotion", "（该角色无可播放动作）");
        l.appendChild(empty);
        return;
      }
      // 动作项全部平铺——骨骼/播放/感知各自直达，不需要折叠
      renderMenu(l, motionItems, deps);
    },
  };
}

interface FrRenderDeps {
  setAdapterItems: (items: PreviewMenuNode[]) => void;
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
  makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  menu: SlideMenuHandle;
  actionCtx: PreviewActionMenuCtx;
  reRender?: () => void;
}

interface FrToolsDeps {
  unloadRole: (id: string) => void;
  closePopup: () => void;
}

function frBuildRolesBox(): HTMLDivElement {
  const rolesBox = document.createElement("div");
  rolesBox.dataset.testid = "preview-roles-list";
  rolesBox.style.cssText = "max-height:220px;overflow-y:auto";
  return rolesBox;
}

function frAppendSeparator(list: HTMLElement): void {
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
  list.appendChild(sep);
}

function frRenderRoles(
  rolesBox: HTMLDivElement,
  deps: FrRenderDeps,
  toolsDeps: FrToolsDeps,
  onSelectRole: (e: ModelEntry) => SlideMenuView,
  reRender: () => void
): void {
  rolesBox.innerHTML = "";
  const entries = sceneRegistry.getAll();
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.dataset.testid = "preview-roles-empty";
    empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    empty.textContent = tr("preview.noRoles", "（无已加载角色）");
    rolesBox.appendChild(empty);
    return;
  }
  const activeId = sceneRegistry.getActiveId();
  for (const e of entries) {
    rolesBox.appendChild(frBuildRoleRow(e, e.id === activeId, deps, toolsDeps, onSelectRole, reRender));
  }
}

function frBuildRoleRow(
  e: ModelEntry,
  isActive: boolean,
  deps: FrRenderDeps,
  toolsDeps: FrToolsDeps,
  onSelectRole: (e: ModelEntry) => SlideMenuView,
  reRender: () => void
): HTMLElement {
  const row = document.createElement("div");
  row.dataset.testid = "preview-role-row";
  row.dataset.roleId = e.id;
  row.style.cssText =
    "display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px" +
    (isActive ? ";background:rgba(124,131,255,0.25)" : "");
  const radio = frBuildFocusRadio(e, isActive, deps.setAdapterItems, reRender);
  const name = frBuildRoleName(e);
  row.onclick = (): void => {
    deps.menu.navigate(onSelectRole(e));
  };
  const tools = frBuildRoleToolsBtn(e, toolsDeps, deps.menu);
  row.append(radio, name, tools);
  return row;
}

function frBuildFocusRadio(
  e: ModelEntry,
  isActive: boolean,
  setAdapterItems: (items: PreviewMenuNode[]) => void,
  reRender: () => void
): HTMLButtonElement {
  const radio = document.createElement("button");
  radio.dataset.testid = "preview-role-focus";
  radio.textContent = isActive ? "●" : "○";
  attachTooltip(radio, () => tr("preview.roleFocus", "设为焦点"));
  radio.style.cssText =
    "width:18px;height:18px;flex-shrink:0;background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1" +
    (isActive ? ";color:#7c83ff" : ";color:rgba(255,255,255,0.5)");
  radio.onclick = (ev): void => {
    ev.stopPropagation();
    sceneRegistry.setActive(e.id);
    // setActive 仅在 menuItems truthy 时经 menuSink 换菜单；无专属项的角色
    // 需显式清空 dock 适配器项，避免残留上一角色的菜单（code_review P2）
    if (!e.menuItems) setAdapterItems([]);
    reRender();
  };
  return radio;
}

function frBuildRoleName(e: ModelEntry): HTMLSpanElement {
  const name = document.createElement("span");
  name.dataset.testid = "preview-role-name";
  name.textContent = roleBaseName(e);
  attachTooltip(name, e.path);
  name.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  return name;
}

function frBuildRoleToolsBtn(e: ModelEntry, toolsDeps: FrToolsDeps, menu: SlideMenuHandle): HTMLButtonElement {
  const tools = document.createElement("button");
  tools.dataset.testid = "preview-role-tools";
  tools.textContent = "⚙";
  attachTooltip(tools, () => tr("preview.roleTools", "模型工具"));
  tools.style.cssText =
    "width:22px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;font-size:13px;line-height:1";
  tools.onclick = (ev): void => {
    ev.stopPropagation();
    menu.navigate(frBuildToolsView(e, toolsDeps));
  };
  return tools;
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
      unload.textContent = "🗑 " + tr("preview.unloadRole", "卸载角色");
      unload.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:#ff7b7b";
      unload.onclick = (): void => {
        deps.unloadRole(e.id);
        deps.closePopup();
      };
      l.appendChild(unload);
    },
  };
}

export function fillRoles(
  list: HTMLElement,
  ctx: PreviewMenuCtx,
  closePopup: () => void,
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelView: (node: PreviewMenuNode) => SlideMenuView,
  menu: SlideMenuHandle,
  setAdapterItems: (items: PreviewMenuNode[]) => void,
  onSelectRole: (e: ModelEntry) => SlideMenuView,
): void {
  const actionCtx: PreviewActionMenuCtx = {
    toast: ctx.toast,
    closeAllOverlays: ctx.closeAllOverlays,
  };
  list.innerHTML = "";

  const rolesBox = frBuildRolesBox();
  list.appendChild(rolesBox);

  const renderDeps: FrRenderDeps = { setAdapterItems, makeRow, makePanelView, menu, actionCtx };
  const toolsDeps: FrToolsDeps = { unloadRole: (id) => ctx.unloadRole?.(id), closePopup };
  const reRender: () => void = () => frRenderRoles(rolesBox, renderDeps, toolsDeps, onSelectRole, reRender);
  renderDeps.reRender = reRender;

  reRender();

  frAppendSeparator(list);
  fillSwitch(list, ctx);
}
