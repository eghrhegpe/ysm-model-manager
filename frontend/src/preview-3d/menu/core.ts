// ===== 3D 预览底部根菜单（ADR-076 v3）=====
// 对齐 MikuMikuAR：底部根按钮 → createSlideMenu 多层导航。
// 能力驱动：有模型/骨骼项 → 🧍 模型；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景。
// 每组按钮点击：
//   - 组内仅一个 panel 项 → 直接打开该面板（快捷直达）
//   - 组内多个项 → home 到组根视图（项列表），点击项 navigate 下钻面板
// 关闭统一走 SlideMenu header ✕（根级）/ ←（子级），外部点击关闭。

import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS, type PreviewMenuGroupDef } from "./defs.ts";
import type { PreviewMenuNode, PreviewActionMenuCtx, PreviewMenuCtx } from "./node-types.ts";
import { disposeEnvSubscriptions, buildEnvSchema } from "./env.ts";
import { renderCapControls } from "./cap-controls.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { createSlideMenu, type SlideMenuView, type SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import { pushInputBlock } from "../../utils/dom/focus-restore.ts";
import {
  buildCameraSchema,
  buildLightingSchema,
  buildShadowSchema,
  buildPostprocessingSchema,
  buildSettingsSchema,
} from "./settings.ts";
import { ensureFabStyles } from "../../utils/dom/fab.ts";
import { tr } from "../../core/i18n/tr.ts";
import { sceneRegistry } from "../adapters/scene-registry.ts";
import { fillRoles, modelDetailView, motionDetailView, roleBaseName } from "./roles.ts";
import { renderAdapterPanelContent, renderMenu } from "./render.ts";
import { previewSnapshot, setPreviewUiMode } from "../state/preview-state.ts";

/** 公共 API 保持稳定（ADR-076 v3 拆分后自子模块透出） */
export { roleBaseName };
export { renderMenu } from "./render.ts";

// [ADR-169] PreviewMenuCtx 已下沉 node-types.ts（类型叶）——断 core ⇄ env/roles/switch/settings
// 纯 type 环（子模块原 type import 本文件 ctx，而本文件值 import 它们）。原位 re-export 保公共面，
// 外部消费者（mount-preview-core / items.test 等）的 import 语句零改动。
export type { PreviewMenuCtx } from "./node-types.ts";

/** 通用控件渲染器：将 MenuControlDef[] 渲染为 DOM 行，替代手写 fill* 函数 */
export { renderCapControls };


/** 根菜单句柄：dispose 解绑；setAdapterItems 替换适配器专属项；openPanel 直接打开指定面板；refreshDock 在 caps 创建后重渲染底栏（ADR-085 S3） */
export interface PreviewMenuHandle {
  dispose(): void;
  /** 适配器注入声明式节点（直接存 PreviewMenuNode[]，方案 A 已统一） */
  setAdapterItems(items: PreviewMenuNode[]): void;
  openPanel(id: string): void;
  refreshDock(): void;
}

/** 挂载预览底部根菜单，返回句柄 */
// ===================================================================
// mountPreviewRootMenu — 子函数（原 6 闭包升格 + 6 阶段拆 9 子）
// ===================================================================

/** mount 状态壳：handle 在 dock 按钮 onclick 之后才赋值，fillRoles 回调经此壳读取，避免闭包前向捕获 */
interface PreviewHandleShell {
  handle: PreviewMenuHandle | null;
}

/** [子函数 1/9] 装配底部 dock + SlideMenu popup/menu 外壳，返回 show/hide 句柄 */
function buildPreviewMenuShell(
  overlay: HTMLElement,
  ctx: PreviewMenuCtx,
): {
  dock: HTMLElement;
  popup: HTMLElement;
  menu: SlideMenuHandle;
  showMenu: (view: SlideMenuView) => void;
  hideMenu: () => void;
} {
  ensureFabStyles();
  const dock = document.createElement("div");
  dock.className = "preview-dock-nav";
  overlay.appendChild(dock);

  const popup = document.createElement("div");
  popup.className = "ysm-preview-menu";
  popup.style.cssText =
    "position:absolute;left:16px;bottom:84px;width:300px;max-height:70vh;" +
    "display:none;z-index:25";
  overlay.appendChild(popup);

  const menu = createSlideMenu({ title: "", closeIcon: "✕" });
  popup.appendChild(menu.root);
  menu.root.querySelector<HTMLElement>(".slide-back")?.setAttribute("id", "preview-close-3d");

  const showMenu = (view: SlideMenuView): void => {
    popup.style.display = "flex";
    menu.onShow();
    menu.home(view);
  };
  const hideMenu = (opts?: { restoreFocus?: boolean }): void => {
    popup.style.display = "none";
    menu.onHide(opts);
  };
  // 根级 ✕ 语义 = 关闭整个 3D 预览
  menu.setOnClose(() => {
    hideMenu({ restoreFocus: false });
    ctx.close();
  });
  return { dock, popup, menu, showMenu, hideMenu };
}

/** [子函数 2/9] 行工厂（原 makeRow 闭包升格）：可选 chevron 箭头导航提示 */
function makePreviewMenuRow(node: PreviewMenuNode, opts?: { chevron?: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "ysm-preview-menu-row";
  row.dataset.testid = "preview-" + node.id;
  if (node.legacyTestId) row.id = node.legacyTestId;
  row.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px";
  if (node.danger) row.style.color = "#ff7b7b";
  const ic = document.createElement("span");
  ic.textContent = node.icon ?? "";
  ic.style.cssText = "font-size:15px;width:18px;text-align:center";
  const lb = document.createElement("span");
  lb.textContent = tr(node.labelKey ?? node.id, node.fallback ?? node.id);
  row.append(ic, lb);
  if (opts?.chevron) {
    const chev = document.createElement("span");
    chev.textContent = ">";
    chev.dataset.testid = "row-chevron";
    chev.style.cssText =
      "margin-left:auto;font-size:13px;font-weight:700;opacity:0.4;user-select:none";
    row.append(chev);
  }
  row.onmouseenter = (): void => {
    row.style.background = "rgba(255,255,255,0.08)";
  };
  row.onmouseleave = (): void => {
    row.style.background = "transparent";
  };
  return row;
}

/** buildPreviewMenuRouters 返回类型：面板路由 + 声明式 schema 映射（导出供菜单健康测试复用，零行为变更）
 *  - schemaBuilders：core 注册面板（lighting/shadow/postproc/settings/camera/environment），内容 = 状态层 schema
 *  - fillers：**roles-only**（G3 删 fill* 后唯一残留——加载角色内容组件；新面板禁添，health.test 白名单守卫）
 *  - runners：动作入口（close 等） */
export interface PreviewMenuRouters {
  schemaBuilders: Record<string, (menu?: SlideMenuHandle) => PreviewMenuNode[]>;
  fillers: Record<string, (list: HTMLElement, menu?: SlideMenuHandle) => void>;
  runners: Record<string, () => void>;
}

/**
 * [子函数 4/9] 构建 core 面板路由表（schemaBuilders 声明式 + fillers roles-only + runners 动作）。
 *   roles 面板需要 setAdapterItems 回写 dock——handle 尚未构造时经 shell 延迟读取。
 *   导出供 preview-menu-health.test.ts 复用（ADR-128 落地前哨：真正执行每个常驻面板渲染器，
 *   捕捉「菜单没迁移就断渲染」），与 check-menu-health.mjs（正则静态扫表）互补。
 *   [G4 收口] G3 删 fill* 后 fillers 仅剩 roles 一项（内容组件，声明式化属 ADR-126 P4 后续）；
 */
export function buildPreviewMenuRouters(
  ctx: PreviewMenuCtx,
  hideMenu: () => void,
  menu: SlideMenuHandle,
  actionCtx: PreviewActionMenuCtx,
  shell: PreviewHandleShell,
): PreviewMenuRouters {
  const makeRow = makePreviewMenuRow;
  const makePanelView = (node: PreviewMenuNode): SlideMenuView =>
    previewMakePanelView(node, (l, n) =>
      renderPreviewPanel(l, n, routers, menu, hideMenu, actionCtx, { makeRow, makePanelView }),
    );
  // 先占位：makePanelView 上面的闭包会立即引用 routers，routers 下面立即赋值
  const routers: PreviewMenuRouters = {
    schemaBuilders: {
      lighting: (_menu) => buildLightingSchema(ctx),
      shadow: () => buildShadowSchema(ctx),
      postproc: () => buildPostprocessingSchema(ctx),
      settings: (menu) => buildSettingsSchema(ctx, menu),
      camera: () => buildCameraSchema(ctx),
      environment: (menu) => buildEnvSchema(ctx, menu),
    },
    fillers: {
      roles: (list, m) =>
        fillRoles(
          list,
          ctx,
          hideMenu,
          makeRow,
          makePanelView,
          m!,
          (items) => shell.handle?.setAdapterItems(items),
          // 🧍 模型 dock → 角色列表 → 点角色名 → 模型详情（组件导航置顶 + 统计/纹理 + 工具行）
          (e) =>
            modelDetailView(e, {
              makeRow,
              makePanelView,
              menu: m!,
              actionCtx,
              // 缺省参数契约：无 options 不透传 undefined（下游 mock/实现零噪音）
              switchTo: (p, o) => (o === undefined ? ctx.switchTo(p) : ctx.switchTo(p, o)),
            }),
        ),
    },
    runners: {
      close: () => ctx.close(),
    },
  };
  return routers;
}

/** [子函数 5/9] 单面板渲染：四路互斥分派 + try-catch 错误边界。
 *  命中路径（if-else 互斥，每面板唯一）：① schemaBuilders（core 注册面板）② renderAdapterPanelContent
 *  （adapter 面板，内部 schema-registry → children → renderCustom 三通道衰退）③ node.action（动作节点）
 *  ④ fillers（仅 roles）。[G4 收口] G3 删 fill* 旧轨后外层无「逐级衰退」——除 adapter 面板内部三通道外，
 *  面板不再可能走多条路径；schema 面板内容统一 renderMenu（renderCustomDirect，2026-09 双轨归一）。 */
export function renderPreviewPanel(
  list: HTMLElement,
  node: PreviewMenuNode,
  routers: PreviewMenuRouters,
  menu: SlideMenuHandle,
  hideMenu: () => void,
  actionCtx: PreviewActionMenuCtx,
  panelDeps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
  },
): void {
  list.innerHTML = "";
  // 面板可定位（2026-08-28 反馈通道）：data-panel-id 机器可读（测试/诊断/外部工具），
  // title hover 提示人读——用户悬停面板内容即可读到内部 id / testid，
  // 反馈「我看到的这个面板」时直接报 id，免去视觉路径转译歧义
  list.dataset.panelId = node.id;
  list.dataset.panelTestId = node.legacyTestId ?? "";
  list.title = `panel: ${node.id}${node.legacyTestId ? ` · testid: ${node.legacyTestId}` : ""}`;
  try {
    if (routers.schemaBuilders[node.id]) {
      // schema 面板内容统一走 renderMenu（renderCustomDirect：custom 直接填充面板，
      // 与 renderPreviewPanel 五级衰退的其余通道同源——2026-09 双轨归一，删 renderPreviewSchemaContent）
      renderMenu(list, routers.schemaBuilders[node.id]!(menu), {
        makeRow: panelDeps.makeRow,
        makePanelView: panelDeps.makePanelView,
        menu,
        actionCtx,
        renderCustomDirect: true,
      });
    } else if (
      renderAdapterPanelContent(list, node, {
        makeRow: panelDeps.makeRow,
        makePanelView: panelDeps.makePanelView,
        menu,
        actionCtx,
        hideMenu: () => hideMenu(),
      })
    ) {
      // [doc:adr-126-p5-a] schema-registry → children → renderCustom 三通道（共享实现）——
      // 与 modelDetailView（roles 详情模型信息本体直渲）同源，两条组装路径永不再分叉
      // （P5 事故：旧直渲门只认 renderCustom，四类适配器面板迁新通道后本体在 roles 消失）
    } else if (node.action) {
      node.action(actionCtx);
    } else {
      // roles-only：core 注册面板中唯一内容组件（fillRoles），G3 后不再接受新 filler（health.test 白名单守卫）
      routers.fillers[node.id]?.(list, menu);
    }
  } catch (err) {
    console.error("[preview-menu] renderPanel FAILED", node.id, err);
    const errRow = document.createElement("div");
    errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
    errRow.textContent = `${tr("preview.renderFail", "Panel render failed")}: ${safeErrorMessage(err)}`;
    list.appendChild(errRow);
  }
}

/** [子函数 6/9] SlideMenuView 工厂（原 makePanelView 闭包升格） */
function previewMakePanelView(
  node: PreviewMenuNode,
  renderPanelFn: (list: HTMLElement, node: PreviewMenuNode) => void,
): SlideMenuView {
  return {
    title: tr(node.labelKey ?? node.id, node.fallback ?? node.id),
    render: (list) => renderPanelFn(list, node),
  };
}

/** [子函数 7/9] 组根视图：列出组内项，panel 型带箭头下钻 / action 型直接执行并关菜单 */
function previewMakeGroupView(
  g: PreviewMenuGroupDef,
  groupItems: PreviewMenuNode[],
  menu: SlideMenuHandle,
  makeRowFn: (n: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelViewFn: (n: PreviewMenuNode) => SlideMenuView,
  actionCtx: PreviewActionMenuCtx,
  hideMenu: () => void,
): SlideMenuView {
  return {
    title: tr(g.labelKey, g.fallback),
    render: (list) => {
      list.innerHTML = "";
      for (const node of groupItems) {
        const row = makeRowFn(node, { chevron: node.kind === "panel" });
        row.onclick = (e: MouseEvent): void => {
          e.stopPropagation();
          if (node.kind === "panel") {
            menu.navigate(makePanelViewFn(node));
          } else if (node.action) {
            hideMenu();
            node.action(actionCtx);
          }
        };
        list.appendChild(row);
      }
    },
  };
}

/** dock 组内工具过滤链（共用：与 render.ts 内容级同一 visibleWhen 求值器——
 *  2026-09 双轨归一：sharedOnly/hideInSelfMode/requiresEnvironment 三布尔已删，
 *  dock 侧与内容级同吃状态层快照谓词，组内全被 visibleWhen 隐藏时 dock 按钮自动不渲染） */
function dockGroupItemsFor(
  g: PreviewMenuGroupDef,
  allItems: PreviewMenuNode[],
): PreviewMenuNode[] {
  const snapshot = previewSnapshot();
  return allItems
    .filter((d) => d.dockGroup === g.id && d.kind !== "divider")
    .filter((d) => !d.visibleWhen || d.visibleWhen(snapshot));
}

/**
 * [子函数 8/9] 底部 dock 渲染（原 renderDock 闭包升格）。
 *   两大捷径分支：🧍 model 直达 roles；💃 motion 有活跃角色则直达详情的动作 section。
 *   通用分支：组内仅 1 个 panel 项 → 直达面板；否则进组根视图。
 */
function renderPreviewDock(
  dock: HTMLElement,
  _ctx: PreviewMenuCtx, // dock 过滤已谓词化走状态层快照，ctx 仅保签名兼容（visibleWhen 谓词读 previewSnapshot）
  menu: SlideMenuHandle,
  showMenu: (view: SlideMenuView) => void,
  makeRowFn: (n: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelViewFn: (n: PreviewMenuNode) => SlideMenuView,
  makeGroupViewFn: (g: PreviewMenuGroupDef, items: PreviewMenuNode[]) => SlideMenuView,
  actionCtx: PreviewActionMenuCtx,
  _hideMenu: () => void,
  adapterItemsRef: { v: PreviewMenuNode[] },
): void {
  dock.innerHTML = "";
  const allItems = [...CORE_MENU_ITEMS, ...adapterItemsRef.v];
  for (const g of PREVIEW_MENU_GROUPS) {
    const groupItems = dockGroupItemsFor(g, allItems);
    if (groupItems.length === 0) continue;

    const btn = document.createElement("button");
    btn.className = "preview-dock-navbtn";
    btn.dataset.testid = "dock-" + g.id;
    // dock 按钮同样可定位（2026-08-28 反馈通道）：组名 fallback 是「模型」但点击直达
    // roles 面板（「加载角色」）——hover 提示写明组 id 与组内项，消除「按钮叫模型、
    // 进去叫加载角色」的语义错位；机器可读 data-dock-group 供测试/诊断
    btn.dataset.dockGroup = g.id;
    btn.title = `dock: ${g.id} · ${groupItems.map((n) => n.id).join(" / ")}`;
    btn.innerHTML =
      `<span class="preview-ic">${g.icon}</span><span class="preview-dock-navlabel">${tr(g.labelKey, g.fallback)}</span>`;
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      const rolesDef = allItems.find((d) => d.id === "roles" && d.kind === "panel");
      // 🧍 模型组：直达 roles 角色列表（新手第一跳）
      if (g.id === "model") {
        if (rolesDef) {
          showMenu(makePanelViewFn(rolesDef));
          return;
        }
      }
      // 💃 动作组：有活跃角色+技能 → 直达动作详情（骨骼/播放/感知）；否则角色列表（onSelectRole → motionDetailView）
      if (g.id === "motion") {
        const activeId = sceneRegistry.getActiveId();
        const active = activeId ? sceneRegistry.getAll().find((x) => x.id === activeId) : undefined;
        if (active?.menuItems) {
          showMenu(motionDetailView(active, { makeRow: makeRowFn, makePanelView: makePanelViewFn, menu, actionCtx }));
          return;
        }
      }
      const panels = groupItems.filter((d) => d.kind === "panel");
      if (panels.length === 1 && groupItems.length === 1) {
        showMenu(makePanelViewFn(panels[0]));
      } else {
        showMenu(makeGroupViewFn(g, groupItems));
      }
    };
    dock.appendChild(btn);
  }
}

/**
 * [子函数 9/9] 渲染器点按 vs 拖拽识别。
 *   点按 = 位移≤5 且 时长≤400ms，此时切换 popup 显隐（仅切 display，DOM/栈保留）。
 *   返回 abort 句柄供 dispose 解绑。
 */
function bindPreviewTapToggle(
  viewEl: HTMLElement,
  popup: HTMLElement,
  _showMenu: (view: SlideMenuView) => void,
  hideMenu: (opts?: { restoreFocus?: boolean }) => void,
): () => void {
  const tapAbort = new AbortController();
  let downX = 0;
  let downY = 0;
  let downT = 0;
  viewEl.addEventListener(
    "pointerdown",
    (e: PointerEvent): void => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    },
    { signal: tapAbort.signal },
  );
  viewEl.addEventListener(
    "pointerup",
    (e: PointerEvent): void => {
      const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
      if (moved > 5 || performance.now() - downT > 400) return;
      if (popup.style.display !== "none") {
        hideMenu(); // 点击渲染器 → 隐藏菜单（焦点恢复给触发元素）
      } else {
        const list = popup.querySelector<HTMLElement>(".slide-list");
        if (list && list.childElementCount > 0) {
          popup.style.display = "flex";
          // 仅恢复输入阻断栈（不调 onShow：无具体视图，仅恢复之前 popup 状态）
          pushInputBlock("slide-menu");
        }
      }
    },
    { signal: tapAbort.signal },
  );
  return (): void => tapAbort.abort();
}

/** setAdapterItems 的 id 冲突守卫（ADR-085 S1）：发现重复/冲突抛错阻断 */
function validateAdapterItemIds(items: PreviewMenuNode[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) {
      throw new Error(
        `[preview-menu] setAdapterItems 重复 id: "${it.id}"（适配器项之间冲突）`,
      );
    }
    if (CORE_MENU_ITEMS.some((c) => c.id === it.id)) {
      throw new Error(
        `[preview-menu] setAdapterItems id "${it.id}" 与 CORE_MENU_ITEMS 冲突`,
      );
    }
    seen.add(it.id);
  }
}

// ===================================================================
// mountPreviewRootMenu — 主函数
// ===================================================================

export function mountPreviewRootMenu(overlay: HTMLElement, ctx: PreviewMenuCtx): PreviewMenuHandle {
  // [doc:adr-126-p4-d] 会话模式上浮状态层：dock 级 visibleWhen 谓词经 s["ui.mode"] 读取
  // （旧 hideInSelfMode 语义）。每次 mount 覆盖写，防会话/测试残留（dispose 不复位——
  // 下次 mount 必覆盖，间隙无谓词求值路径）
  setPreviewUiMode(ctx.selfMode ? "self" : "shared");
  // 阶段 1：dock + popup + SlideMenu 外壳装配（含 show/hide）
  const { dock, popup, menu, showMenu, hideMenu } = buildPreviewMenuShell(overlay, ctx);
  // 阶段 2：action ctx 与 handle 延迟壳（fillRoles 回调在 handle 构造前就能安全引用）
  const actionCtx: PreviewActionMenuCtx = {
    toast: ctx.toast,
    closeAllOverlays: ctx.closeAllOverlays,
  };
  const shell: PreviewHandleShell = { handle: null };
  const adapterItemsRef = { v: [] as PreviewMenuNode[] };
  // 阶段 3：面板路由表（schema / fillers / runners 三级衰退链）
  const routers = buildPreviewMenuRouters(ctx, hideMenu, menu, actionCtx, shell);
  // 阶段 4：面板/组视图工厂（引用 routers 做渲染）
  const renderPanelFn = (l: HTMLElement, n: PreviewMenuNode): void =>
    renderPreviewPanel(l, n, routers, menu, hideMenu, actionCtx, { makeRow: makePreviewMenuRow, makePanelView: makePanelViewFn });
  const makePanelViewFn = (n: PreviewMenuNode): SlideMenuView =>
    previewMakePanelView(n, renderPanelFn);
  const makeRowFn = makePreviewMenuRow;
  const makeGroupViewFn = (g: PreviewMenuGroupDef, items: PreviewMenuNode[]): SlideMenuView =>
    previewMakeGroupView(g, items, menu, makeRowFn, makePanelViewFn, actionCtx, hideMenu);
  // 阶段 5：dock 渲染器（闭包捕获 adapterItemsRef，setAdapterItems 后自动刷新）
  const refreshDock = (): void =>
    renderPreviewDock(
      dock,
      ctx,
      menu,
      showMenu,
      makeRowFn,
      makePanelViewFn,
      makeGroupViewFn,
      actionCtx,
      hideMenu,
      adapterItemsRef,
    );
  // 阶段 6：tap 识别（点击渲染器区域显隐菜单，拖拽不响应）
  const abortTap = bindPreviewTapToggle(ctx.getViewContainer(), popup, showMenu, hideMenu);

  // ---- 句柄方法 ----
  const setAdapterItems = (items: PreviewMenuNode[]): void => {
    validateAdapterItemIds(items);
    adapterItemsRef.v = items;
    refreshDock();
  };
  const openPanel = (id: string): void => {
    const node = [...CORE_MENU_ITEMS, ...adapterItemsRef.v].find((d) => d.id === id);
    if (!node || node.kind !== "panel") return;
    showMenu(makePanelViewFn(node));
  };
  refreshDock();

  const handle: PreviewMenuHandle = {
    dispose: (): void => {
      abortTap();
      disposeEnvSubscriptions(); // 清环境面板 cap 订阅，防 cap 单例持有过期 menu 引用
      menu.dispose();
      dock.remove();
      popup.remove();
    },
    setAdapterItems,
    openPanel,
    refreshDock, // ADR-085 S3：caps 创建后调用，修复 litematic/pack environment 项时序
  };
  shell.handle = handle;
  return handle;
}

/**
 * 角色面板（MikuMikuAR buildModelRootItems 移植，2026-08-20）：
 * 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
 * （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
 * 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载模型，
 * 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。
 */
