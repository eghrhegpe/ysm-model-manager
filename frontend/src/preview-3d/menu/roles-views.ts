// ===== 角色生态 navigate 目标视图工厂（2026-09 从 roles.ts 迁出）=====
// roles.ts 只留声明式 schema 构建器（buildRolesSchema + 类型）；本文件收拢角色
// 详情/动作/工具等 SlideMenuView 工厂——它们是 actionCtx.navigate 的落点，内部本就
// 声明式（renderAdapterPanelContent 三通道 → renderMenu），但本体是手写 DOM 装配层，
// 与「声明式 schema」是两种抽象级。分开存放防后来者把 DOM 半身误当 buildRolesSchema
// 的写法复制。
//
// roleBaseName 单源落位本文件（modelDetailView/motionDetailView/frBuildToolsView 标题
// 共用；roles.ts 单向 import，方向不反向）。

import { t } from "@/core/i18n/t.ts";
import { installOnceStyles } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { type ModelEntry, sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { attachTooltip } from "@/utils/dom/tooltip.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { MENU_ERROR_NOTE_CSS } from "./menu-styles.ts";
import type { PreviewActionMenuCtx, PreviewMenuNode } from "./node-types.ts";
import { renderAdapterPanelContent, renderMenu } from "./render.ts";
import type { SlideMenuHandle, SlideMenuView } from "./slide-menu.ts";
import { switchNormPath } from "./switch.ts";

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
// 幂等注入——modelDetailView/motionDetailView/frBuildToolsView 三个入口各调一次，覆盖全部渲染路径）
function ensureRolesStyles(): void {
  installOnceStyles(
    "roles",
    `
/* 角色面板集中样式（P1 批次3：cssText→类）。高亮单一源 .fr-row-active：角色 active 与
   组件当前行共用，派生 --accent（刀② 收编后禁回硬编码 rgba）。 */
.fr-role-row, .fr-comp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius:var(--radius-md);
  cursor: pointer;
}
.fr-role-row { padding: 6px 8px; font-size:var(--fs-md); }
.fr-comp-row { padding: 6px 10px; font-size:var(--fs-base); }
.fr-row-active { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.fr-empty-note { padding: 8px 10px; color: rgba(255,255,255,0.5); font-size:var(--fs-base); }
${MENU_ERROR_NOTE_CSS}
.fr-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 6px 10px; }
.fr-scroll-box { max-height: 220px; overflow-y: auto; }
.fr-name-ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-focus-btn {
  width: 18px; height: 18px; flex-shrink: 0; background: transparent; border: none;
  cursor: pointer; font-size:var(--fs-lg); line-height: 1; color: rgba(255,255,255,0.5);
}
.fr-row-active .fr-focus-btn { color: var(--accent); }
.fr-tools-btn {
  width: 22px; height: 22px; flex-shrink: 0; background: rgba(255,255,255,0.08);
  border: none; border-radius:var(--radius-sm); cursor: pointer; font-size:var(--fs-md); line-height: 1;
}
.fr-comp-add-btn {
  width: 20px; height: 20px; flex-shrink: 0; background: rgba(255,255,255,0.08);
  border: none; border-radius:var(--radius-sm); cursor: pointer; font-size:var(--fs-sm); line-height: 1;
}
.fr-unload-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius:var(--radius-lg);
  cursor: pointer; font-size:var(--fs-md); color: var(--status-error);
}
.fr-section-title { padding: 6px 10px 2px; color: rgba(255,255,255,0.5); font-size:var(--fs-sm); }
.fr-comp-mark { width: 14px; flex-shrink: 0; text-align: center; }
`,
  );
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
            empty.textContent = t("preview.roleNoDetail");
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
            errRow.textContent = `${t("preview.renderFail")}: ${safeErrorMessage(err)}`;
            l.appendChild(errRow);
          }
        }
        // [ADR-242] 工具行（截图/材质）：卡壳收纳 + 面板入口行 array（与环境/动作组同形态）——
        // 内容仅在 navigate 到次级菜单后渲染，一级不被巨多内容淹没。
        if (toolItems.length > 0) {
          const card: PreviewMenuNode = {
            id: "preview-role-tools",
            kind: "card",
            labelKey: "preview.roleToolsSection",
            collapsible: true,
            defaultOpen: true,
            children: toolItems.map((item) => panelEntryRow(item, panelDeps, "model-entry")),
          };
          renderMenu(l, [card], panelDeps);
        }
      };
      renderAll();
    },
  };
}

// ── 动作详情（💃 动作 dock 入口）──
// 纯动作上下文：骨骼/播放/感知——无模型信息、无工具项。
// [ADR-242] 一级 = 卡壳收纳 + 面板入口行 array（对齐 env `env-card-basic` 范式）：
// 卡内每行是「跳转入口」（icon + label + ›），内容仅在 navigate 到次级菜单后渲染——
// 骨骼/表情这类巨多内容不再在一级内联铺开，与环境组形态统一（环境有收纳，动作也有）。
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
        empty.textContent = t("preview.roleNoMotion");
        l.appendChild(empty);
        return;
      }
      // [ADR-242] 卡壳收纳：kind:"card" + collapsible（复用 rmAppendCard 盒式折叠），
      // 卡内每行 = 面板入口 row，action → navigate 到该面板内容视图（内容此时才渲染）。
      const card: PreviewMenuNode = {
        id: "motion-card",
        kind: "card",
        labelKey: "preview.groupMotion",
        collapsible: true,
        defaultOpen: true,
        children: motionItems.map((item) => panelEntryRow(item, deps, "motion-entry")),
      };
      renderMenu(l, [card], deps);
    },
  };
}

/** [ADR-242] 面板入口行：icon + label + ›，整行 action navigate 到该面板内容视图。
 *  照抄 env `envCapRow` 形态（row + compact + action:navigate）——内容跳转后才渲染。
 *  prefix 区分归属域（motion-entry / model-entry），testid 可定位。 */
function panelEntryRow(
  item: PreviewMenuNode,
  deps: {
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  },
  prefix = "motion-entry",
): PreviewMenuNode {
  return {
    id: `${prefix}-${item.id}`,
    kind: "row",
    labelKey: item.labelKey ?? item.id,
    rowDensity: "compact",
    // exactOptionalPropertyTypes：可选字段按存在性展开（undefined 不得显式赋值）
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.label ? { label: item.label } : {}),
    action: (ctx) => ctx.navigate?.(deps.makePanelView(item)),
  };
}

interface FrToolsDeps {
  unloadModel: (id: string) => void;
  closePopup: () => void;
}

/** 工具子面板（⚙ badge → navigate 落点）：卸载模型行（frBuildToolsView 原居 roles.ts，
 *  2026-09 随 DOM 半身迁出——roles.ts buildRolesSchema 的 badge onClick 经此 navigate） */
export function frBuildToolsView(e: ModelEntry, deps: FrToolsDeps): SlideMenuView {
  // 注意：原函数在 fillRoles 里声明的 toolsView 直接是闭包返回对象，未立即调用 navigate；
  // 调用 navigate 在 frBuildRoleToolsBtn 的 onclick 里完成，但原 onclick 调用的是 menu.navigate(toolsView(e))，
  // 而此函数返回的正好就是 SlideMenuView，供点击方调用。
  return {
    title: `${roleBaseName(e)} ${t("preview.roleTools")}`,
    render: (l) => {
      l.innerHTML = "";
      const unload = document.createElement("div");
      unload.dataset.testid = "preview-role-unload";
      unload.textContent = `🗑 ${t("preview.unloadModel")}`;
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
  title.textContent = `${t("preview.component")}（${components.length}）`;
  title.className = "fr-section-title";
  container.appendChild(title);

  const box = document.createElement("div");
  box.dataset.testid = "preview-components-list";
  box.className = "fr-scroll-box";
  const curNorm = switchNormPath(entry.path ?? "");
  for (const p of components) {
    const isCur = switchNormPath(p) === curNorm;
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
      append.innerHTML = UI_ICONS.add;
      attachTooltip(append, () => t("preview.appendModel"));
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
