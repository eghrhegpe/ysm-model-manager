// ===== 角色面板（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// MikuMikuAR buildModelRootItems 移植（2026-08-20）：
// 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
// （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
// 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载模型，
// 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。

import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { attachTooltip } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { t, type LocaleKey } from "../../core/i18n/t.ts";
import type { PreviewMenuNode, PreviewActionMenuCtx } from "./node-types.ts";
import { sceneRegistry, type ModelEntry } from "../adapters/scene-registry.ts";
import { renderMenu, renderAdapterPanelContent } from "./render.ts";
import { fillSwitch } from "./switch.ts";
import type { PreviewMenuCtx } from "./node-types.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
const tr = (key: string, fallback: string): string => {
  const v = t(key as LocaleKey);
  return v === key ? fallback : v;
};

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
.fr-error-note { padding: 8px 10px; color: #ff7b7b; font-size: 12px; }
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
  document.head.appendChild(style);
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
        const modelItems = (cur.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "model");
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
          infoHost.dataset.panelTestId = primary.legacyTestId ?? "";
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
  const motionItems = (e.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "motion");
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

interface FrRenderDeps {
  setAdapterItems: (items: PreviewMenuNode[]) => void;
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
  makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  menu: SlideMenuHandle;
  actionCtx: PreviewActionMenuCtx;
  reRender?: () => void;
}

interface FrToolsDeps {
  unloadModel: (id: string) => void;
  closePopup: () => void;
}

function frBuildRolesBox(): HTMLDivElement {
  const rolesBox = document.createElement("div");
  rolesBox.dataset.testid = "preview-roles-list";
  rolesBox.className = "fr-scroll-box";
  return rolesBox;
}

function frAppendSeparator(list: HTMLElement): void {
  const sep = document.createElement("div");
  sep.className = "fr-divider";
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
    empty.className = "fr-empty-note";
    empty.textContent = tr("preview.noRoles", "（无已加载角色）");
    rolesBox.appendChild(empty);
    return;
  }
  const activeId = sceneRegistry.getActiveId();
  for (const e of entries) {
    rolesBox.appendChild(frBuildRoleRow(e, e.id === activeId, deps, toolsDeps, onSelectRole, reRender));
  }
}

/** 角色行类 token（P1 批次3：cssText → 类后原样式串缝转为类 token 缝；样式本体在
 *  ensureRolesStyles 注入的 .fr-role-row/.fr-row-active，见 roles.ts 顶部样式块）。
 *  纯函数便于测试直断——happy-dom 计算样式读 color-mix() 丢声明（与 WebView2 不一致），
 *  测试断「类 token + 注入样式表原文」两级（roles.test.ts）。 */
export function frRoleRowClass(isActive: boolean): string {
  return "fr-role-row" + (isActive ? " fr-row-active" : "");
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
  row.className = frRoleRowClass(isActive);
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
  radio.className = "fr-focus-btn";
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
  name.className = "fr-name-ellipsis";
  return name;
}

function frBuildRoleToolsBtn(e: ModelEntry, toolsDeps: FrToolsDeps, menu: SlideMenuHandle): HTMLButtonElement {
  const tools = document.createElement("button");
  tools.dataset.testid = "preview-role-tools";
  tools.textContent = "⚙";
  attachTooltip(tools, () => tr("preview.roleTools", "模型工具"));
  tools.className = "fr-tools-btn";
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
      unload.textContent = "🗑 " + tr("preview.unloadModel", "卸载模型");
      unload.className = "fr-unload-row";
      unload.onclick = (): void => {
        deps.unloadModel(e.id);
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
  ensureRolesStyles();
  const actionCtx: PreviewActionMenuCtx = {
    toast: ctx.toast,
    closeAllOverlays: ctx.closeAllOverlays,
  };
  list.innerHTML = "";

  const rolesBox = frBuildRolesBox();
  list.appendChild(rolesBox);

  const renderDeps: FrRenderDeps = { setAdapterItems, makeRow, makePanelView, menu, actionCtx };
  const toolsDeps: FrToolsDeps = { unloadModel: (id) => ctx.unloadModel?.(id), closePopup };
  const reRender: () => void = () => frRenderRoles(rolesBox, renderDeps, toolsDeps, onSelectRole, reRender);
  renderDeps.reRender = reRender;

  reRender();

  // [ADR-159 呈现收敛] 组件导航收进 modelDetailView 详情（镜像 mmd 面板范式），
  // 顶层不再平铺组件区——「加载角色」保持纯角色列表 + 底部加载入口。
  frAppendSeparator(list);
  fillSwitch(list, ctx);
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
    row.className = "fr-comp-row" + (isCur ? " fr-row-active" : "");
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
