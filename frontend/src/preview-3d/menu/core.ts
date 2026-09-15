// ===== 3D 预览底部根菜单（ADR-076 v3）=====
// 对齐 MikuMikuAR：底部根按钮 → createSlideMenu 多层导航。
// 能力驱动：有模型/骨骼项 → 🧍 模型；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景。
// 每组按钮点击：
//   - 组内仅一个 panel 项 → 直接打开该面板（快捷直达）
//   - 组内多个项 → home 到组根视图（项列表），点击项 navigate 下钻面板
// 关闭统一走 SlideMenu header ✕（根级）/ ←（子级），外部点击关闭。

import { t, tOf } from "@/core/i18n/t.ts";
import { installOnceStyles } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import {
  getSchema,
  registerSchema,
  type SchemaBuilder,
  unregisterSchema,
} from "@/preview-3d/infra/schema-registry.ts";
import { previewSnapshot, setPreviewUiMode } from "@/preview-3d/state/preview-state.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { renderCapControls } from "./cap-controls.ts";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS, type PreviewMenuGroupDef } from "./defs.ts";
import { buildEnvSchema, disposeEnvSubscriptions } from "./env.ts";
import { ensureFabStyles } from "./fab.ts";
import { createHeaderToggle } from "./header-toggle.ts";
import { MENU_ERROR_NOTE_CSS } from "./menu-styles.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import {
  clearFolderCollapsedState,
  disposeCustomCleanups,
  renderAdapterPanelContent,
  renderMenu,
} from "./render.ts";
import { buildRolesSchema, roleBaseName } from "./roles.ts";
import { motionDetailView } from "./roles-views.ts";
import {
  buildCameraSchema,
  buildLightingSchema,
  buildPostprocessingSchema,
  buildSettingsSchema,
  buildShadowSchema,
} from "./settings.ts";
import { createSlideMenu, type SlideMenuHandle, type SlideMenuView } from "./slide-menu.ts";
import { makeSwitchState } from "./switch.ts";

// [ADR-169] PreviewMenuCtx 已下沉 node-types.ts（类型叶）——断 core ⇄ env/roles/switch/settings
// 纯 type 环（子模块原 type import 本文件 ctx，而本文件值 import 它们）。原位 re-export 保公共面，
// 外部消费者（mount-preview-core / items.test 等）的 import 语句零改动。
export type { PreviewMenuCtx } from "./node-types.ts";
export { renderMenu } from "./render.ts";
/** 公共 API 保持稳定（ADR-076 v3 拆分后自子模块透出） */
/** 通用控件渲染器：将控件定义渲染为 DOM 行，替代手写 fill* 函数 */
export { renderCapControls, roleBaseName };

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

// P1 批次6：core 装配层内联 cssText → 集中类（cm- 前缀本文件私有，ensureCoreStyles
// 幂等注入——buildPreviewMenuShell + makePreviewMenuRow 双入口调用覆盖 popup/行/错误行）
// [菜单共享样式] .cm-error-note 与 roles .fr-error-note 同值，已收敛至 menu-styles.ts
// MENU_ERROR_NOTE_CSS 单一事实源（旧注释称镜像 switch .sw-row，ADR-193 第四刀
// switch DOM 层退役后该镜像已不存在——同步修正）。
function ensureCoreStyles(): void {
  installOnceStyles(
    "core",
    `
/* core 装配层集中样式（P1 批次6：cssText→类）。cm-row 为 core 行专属（switch .sw-row
   镜像已随 ADR-193 第四刀退役）。 */
.ysm-preview-menu.cm-popup { position:absolute;left:16px;bottom:84px;width:300px;max-height:70vh;z-index:25; }
.ysm-preview-menu-row.cm-row { display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-lg);cursor:pointer;font-size:var(--fs-md); }
.cm-row-icon { font-size:15px;width:18px;text-align:center; }
.cm-row-chev { margin-left:auto;font-size:var(--fs-md);font-weight:700;opacity:0.4;user-select:none; }
${MENU_ERROR_NOTE_CSS}
`,
  );
}

/** mount 状态壳：handle 在 dock 按钮 onclick 之后才赋值，fillRoles 回调经此壳读取，避免闭包前向捕获 */
interface PreviewHandleShell {
  handle: PreviewMenuHandle | null;
}

/** [子函数 1/9] 装配底部 dock + SlideMenu popup/menu 外壳，返回 show/hide 句柄 */
function buildPreviewMenuShell(
  overlay: HTMLElement | ShadowRoot,
  ctx: PreviewMenuCtx,
): {
  dock: HTMLElement;
  popup: HTMLElement;
  menu: SlideMenuHandle;
  showMenu: (view: SlideMenuView) => void;
  hideMenu: (opts?: { restoreFocus?: boolean }) => void;
} {
  ensureFabStyles();
  ensureCoreStyles();
  const dock = document.createElement("div");
  dock.className = "preview-dock-nav";
  overlay.appendChild(dock);

  const popup = document.createElement("div");
  popup.className = "ysm-preview-menu cm-popup";
  // 动态豁免(P1)：显隐由 showMenu/hideMenu 内联切 flex/none（core/roles.test 断言 style.display），初始 none 也须内联
  popup.style.display = "none";
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
  ensureCoreStyles();
  row.className = "ysm-preview-menu-row cm-row";
  row.dataset.testid = `preview-${node.id}`;
  if (node.danger) row.style.color = "#ff7b7b";
  const ic = document.createElement("span");
  ic.textContent = node.icon ?? "";
  ic.className = "cm-row-icon";
  const lb = document.createElement("span");
  lb.textContent = tOf(node.labelKey ?? node.id);
  row.append(ic, lb);
  if (node.headerToggle) {
    // 组根视图 panel 行能力总开关（对齐环境面板 cap 行 / folder headerToggle）：
    // createHeaderToggle 内置 stopPropagation → 开关点击不触发整行 action（下钻）。
    // 对齐 rmAppendDynamicRow（render.ts）：行尾有 chevron 时 toggle 紧跟 label、chevvron
    // 靠 auto margin 推行尾；无 chevron（纯 action 行）才 toggle 自己 auto 推右。二者绝不同时 auto。
    const ht = node.headerToggle;
    const tg = createHeaderToggle({
      value: ht.value,
      onChange: (v: boolean) => ht.onChange(v),
    });
    if (!opts?.chevron) tg.style.marginLeft = "auto";
    row.append(tg);
  }
  if (opts?.chevron) {
    const chev = document.createElement("span");
    chev.textContent = ">";
    chev.dataset.testid = "row-chevron";
    chev.className = "cm-row-chev"; // CSS .cm-row-chev 已含 margin-left:auto 推行尾
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
 *  - schemaBuilders：core 注册面板（key 收窄为 CorePanelId 联合——ADR-193 §2.4 宽表收 key，
 *    拼错面板 id 编译期报错，模式同右键菜单 MenuAction 三层钉死）；第四刀起 fillers 字段退役
 *    （roles 迁入 schemaBuilders，过程式 filler 通道不复存在）
 *  - runners：动作入口（close 等） */
export type CorePanelId =
  | "lighting"
  | "shadow"
  | "postproc"
  | "settings"
  | "camera"
  | "environment"
  | "roles";

/** core 面板 id 运行时清单（注册/注销共用，防两处漂移） */
const CORE_PANEL_IDS: readonly CorePanelId[] = [
  "lighting",
  "shadow",
  "postproc",
  "settings",
  "camera",
  "environment",
  "roles",
];

export interface PreviewMenuRouters {
  schemaBuilders: Record<CorePanelId, (menu?: SlideMenuHandle) => PreviewMenuNode[]>;
  runners: Record<string, () => void>;
  /** 本挂载注册进 schema-registry 的 core 面板 wrapper（dispose 所有权校验凭据）——
   *  code_review 8988145d #4/#5：注销只删仍属本挂载的条目，防旧会话 dispose 误删新会话注册 */
  coreSchemaOwners?: Map<CorePanelId, SchemaBuilder>;
}

/**
 * [子函数 4/9] 构建 core 面板路由表（schemaBuilders 声明式 + runners 动作；第四刀起无 fillers）。
 *   roles 面板需要 setAdapterItems 回写 dock——handle 尚未构造时经 shell 延迟读取。
 *   导出供 preview-menu-health.test.ts 复用（ADR-128 落地前哨：真正执行每个常驻面板渲染器，
 *   捕捉「菜单没迁移就断渲染」），与 check-menu-health.mjs（正则静态扫表）互补。
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
  // ADR-193 第四刀：switch 段状态（mount 级一次；activeTab 解析含持久化记忆）
  const rolesSwitchState = makeSwitchState(ctx);
  // 先占位：makePanelView 上面的闭包会立即引用 routers，routers 下面立即赋值
  const routers: PreviewMenuRouters = {
    schemaBuilders: {
      lighting: (_menu) => buildLightingSchema(ctx),
      shadow: () => buildShadowSchema(ctx),
      postproc: () => buildPostprocessingSchema(ctx),
      settings: (menu) => buildSettingsSchema(ctx, menu),
      camera: () => buildCameraSchema(ctx),
      environment: (menu) => buildEnvSchema(ctx, menu),
      // ADR-193 第四刀：roles 自 fillers 过程式臂迁入声明式（角色 row + switch 段）
      roles: (menu) =>
        buildRolesSchema(
          ctx,
          {
            makeRow,
            makePanelView,
            // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
            menu: menu!,
            actionCtx,
            setAdapterItems: (items) => shell.handle?.setAdapterItems(items),
            hideMenu,
          },
          rolesSwitchState,
        ),
    },
    runners: {
      close: () => ctx.close(),
    },
  };
  // ADR-193 §2.5 双注册合并：core 六面板统一注册进 schema-registry——
  // dualChannelDebt（schemaBuilders key ∉ fullRegistry）清零，coverage:full 的隐藏前置步。
  // 快照参数 core builder 不消费（内容走 ctx 闭包），透传 menu 兼容 settings/environment 两级菜单分支。
  // 注册记 owner wrapper（按挂载实例），注销前身份校验——
  // 无条件删固定 key 会在重叠挂载时误删新会话条目（Bug-A 纪律，对齐 ysm-model-{sessionId} 范式）
  const coreSchemaOwners = new Map<CorePanelId, SchemaBuilder>();
  for (const id of CORE_PANEL_IDS) {
    const builder = routers.schemaBuilders[id];
    const wrapper: SchemaBuilder = () => builder(menu);
    registerSchema(id, wrapper);
    coreSchemaOwners.set(id, wrapper);
  }
  routers.coreSchemaOwners = coreSchemaOwners;
  return routers;
}

/** 类型守卫：string → CorePanelId 收窄（替代 `as readonly string[]` 强转，联合收窄收益保留） */
function isCorePanelId(id: string): id is CorePanelId {
  return (CORE_PANEL_IDS as readonly string[]).includes(id);
}

/** 收 key 后的运行时安全取值：panel id 字符串 → core builder（非 core 面板返回 undefined）。
 *  renderPreviewPanel 的分派入口吃任意 node.id（含 adapter 面板），类型窄化后需此守卫桥接。 */
export function corePanelBuilder(
  routers: PreviewMenuRouters,
  id: string,
): ((menu?: SlideMenuHandle) => PreviewMenuNode[]) | undefined {
  return isCorePanelId(id) ? routers.schemaBuilders[id] : undefined;
}

/** dispose 时注销 core 六面板的 registry 注册（与注册循环同 key 集）——
 *  防陈旧 builder 闭包持有已 dispose 场景的 ctx/handle 引用（对齐 schema-registry
 *  头注释的跨会话污染防线）。
 *  code_review 8988145d #4/#5/#7/#9：所有权校验——只删「当前 registry 条目仍是本挂载
 *  注册的 wrapper」的 key（身份相等才删）。重叠挂载时旧会话 dispose 不得误删新会话
 *  已覆盖的条目（Bug-A 纪律，对齐 ysm-adapter/litematic per-scene key 只注销自己的）；
 *  未传 owners（测试直建 routers 场景）退化为无条件注销，保持旧语义。 */
export function unregisterCorePanelSchemas(routers: PreviewMenuRouters): void {
  const owners = routers.coreSchemaOwners;
  for (const id of CORE_PANEL_IDS) {
    if (!owners) {
      unregisterSchema(id);
      continue;
    }
    // 身份相等才删：新挂载已覆盖（getSchema(id) !== 本挂载 wrapper）则跳过，勿误删
    if (getSchema(id) === owners.get(id)) unregisterSchema(id);
  }
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
  // title hover 提示人读——用户悬停面板内容即可读到内部 id，
  // 反馈「我看到的这个面板」时直接报 id，免去视觉路径转译歧义
  list.dataset.panelId = node.id;
  list.title = `panel: ${node.id}`;
  try {
    const builder = corePanelBuilder(routers, node.id);
    if (builder) {
      // schema 面板内容统一走 renderMenu（renderCustomDirect：custom 直接填充面板，
      // 与 renderPreviewPanel 五级衰退的其余通道同源——2026-09 双轨归一，删 renderPreviewSchemaContent）
      renderMenu(list, builder(menu), {
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
    }
    // ADR-193 第四刀：fillers 过程式臂退役——roles 已迁 schemaBuilders（路径①），
    // 全部面板内容只走「schema 节点 + 动作节点」两路，逃生舱仅余 adapter renderCustom（bones）
  } catch (err) {
    console.error("[preview-menu] renderPanel FAILED", node.id, err);
    const errRow = document.createElement("div");
    errRow.className = "cm-error-note";
    errRow.textContent = `${t("preview.renderFail")}: ${safeErrorMessage(err)}`;
    list.appendChild(errRow);
  }
}

/** [子函数 6/9] SlideMenuView 工厂（原 makePanelView 闭包升格） */
function previewMakePanelView(
  node: PreviewMenuNode,
  renderPanelFn: (list: HTMLElement, node: PreviewMenuNode) => void,
): SlideMenuView {
  return {
    title: tOf(node.labelKey ?? node.id),
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
    title: tOf(g.labelKey),
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
function dockGroupItemsFor(g: PreviewMenuGroupDef, allItems: PreviewMenuNode[]): PreviewMenuNode[] {
  const snapshot = previewSnapshot();
  return allItems
    .filter((d) => d.dockGroup === g.id && d.kind !== "divider")
    .filter((d) => !d.visibleWhen || d.visibleWhen(snapshot));
}

/**
 * 场景组根视图：可启停能力的 panel 行附加能力总开关（对齐环境面板 cap 行 headerToggle）。
 *  panelId → capId 映射（lighting→light, shadow→shadow, postproc→postprocessing）。
 *  仅上述三个真「可启停能力」加开关；camera 是视口（关闭=黑屏）不可关，故不加——保持
 *  「能关的才给开关」语义正确。value/onChange 直连 cap 的 isEnabled/setEnabled（setEnabled(false)
 *  语义 = 整体 detach 该能力，与 shadow/postproc/light 面板首行总开关同一真值源）。
 */
const SCENE_ROW_TOGGLE_CAPS: Readonly<Record<string, string>> = {
  lighting: "light",
  shadow: "shadow",
  postproc: "postprocessing",
};

function withSceneGroupRowToggles(
  ctx: PreviewMenuCtx,
  g: PreviewMenuGroupDef,
  groupItems: PreviewMenuNode[],
): PreviewMenuNode[] {
  if (g.id !== "scene") return groupItems;
  return groupItems.map((node) => {
    if (node.kind !== "panel") return node;
    const capId = SCENE_ROW_TOGGLE_CAPS[node.id];
    if (!capId) return node;
    const cap = ctx.getCap(capId);
    if (!cap?.isEnabled || !cap.setEnabled || node.headerToggle) return node;
    // 浅克隆：不改 CORE_MENU_ITEMS 共享单例，仅本组视图行附加 headerToggle
    return {
      ...node,
      headerToggle: { value: cap.isEnabled(), onChange: (v) => cap.setEnabled(v) },
    };
  });
}

/**
 * [子函数 8/9] 底部 dock 渲染（原 renderDock 闭包升格）。
 *   直达语义（[S5 收口] 数据驱动）：组定义 `directToPanel` 静态声明 → 点击直达该面板节点
 *   （model 组 → roles），新增静态直达组零改本函数；
 *   💃 motion 是唯一动态直达特例（活跃角色 → 动作详情），保留下方显式分支。
 *   通用分支：组内仅 1 个 panel 项 → 直达面板；否则进组根视图。
 */
function renderPreviewDock(
  dock: HTMLElement,
  menu: SlideMenuHandle,
  showMenu: (view: SlideMenuView) => void,
  makeRowFn: (n: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelViewFn: (n: PreviewMenuNode) => SlideMenuView,
  makeGroupViewFn: (g: PreviewMenuGroupDef, items: PreviewMenuNode[]) => SlideMenuView,
  actionCtx: PreviewActionMenuCtx,
  adapterItemsRef: { v: PreviewMenuNode[] },
  ctx: PreviewMenuCtx,
): void {
  dock.innerHTML = "";
  const allItems = [...CORE_MENU_ITEMS, ...adapterItemsRef.v];
  for (const g of PREVIEW_MENU_GROUPS) {
    const groupItems = dockGroupItemsFor(g, allItems);
    if (groupItems.length === 0) continue;

    const btn = document.createElement("button");
    btn.className = "preview-dock-navbtn";
    btn.dataset.testid = `dock-${g.id}`;
    // dock 按钮同样可定位（2026-08-28 反馈通道）：组名 fallback 是「模型」但点击直达
    // roles 面板（「加载角色」）——hover 提示写明组 id 与组内项，消除「按钮叫模型、
    // 进去叫加载角色」的语义错位；机器可读 data-dock-group 供测试/诊断
    btn.dataset.dockGroup = g.id;
    btn.title = `dock: ${g.id} · ${groupItems.map((n) => n.id).join(" / ")}`;
    btn.innerHTML = `<span class="preview-ic">${g.icon}</span><span class="preview-dock-navlabel">${tOf(g.labelKey)}</span>`;
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      // [S5 收口] 静态直达声明（组定义 directToPanel）：model 组 → roles 面板（新手第一跳）。
      // 数据驱动——新增「组点击直达某面板」零改本函数；声明指向不存在的面板时回落通用逻辑
      if (g.directToPanel) {
        const direct = allItems.find((d) => d.id === g.directToPanel && d.kind === "panel");
        if (direct) {
          showMenu(makePanelViewFn(direct));
          return;
        }
      }
      // 💃 动作组动态直达特例（全库唯一非声明——目标依赖 sceneRegistry 活跃角色 + 详情工厂，
      // 静态 directToPanel 无法表达；声明式化属 ADR-126 P4 候选）：
      // 有活跃角色+技能 → 直达动作详情（骨骼/播放/感知）；否则角色列表（onSelectRole → motionDetailView）
      if (g.id === "motion") {
        const activeId = sceneRegistry.getActiveId();
        const active = activeId ? sceneRegistry.getAll().find((x) => x.id === activeId) : undefined;
        if (active?.menuItems) {
          showMenu(
            motionDetailView(active, {
              makeRow: makeRowFn,
              makePanelView: makePanelViewFn,
              menu,
              actionCtx,
            }),
          );
          return;
        }
      }
      const panels = groupItems.filter((d) => d.kind === "panel");
      if (panels.length === 1 && groupItems.length === 1) {
        showMenu(makePanelViewFn(panels[0]));
      } else {
        // 组根视图：可启停能力的 panel 行附加能力总开关（对齐环境面板 cap 行 headerToggle；
        // 相机不可关——视口开关=黑屏——故不附开关，保语义正确）
        showMenu(makeGroupViewFn(g, withSceneGroupRowToggles(ctx, g, groupItems)));
      }
    };
    dock.appendChild(btn);
  }
}

/** 点按 vs 拖拽判定阈值：点按 = 位移 ≤ 5px 且 时长 ≤ 400ms（3D 渲染器拖拽手势的折中，
 *  对齐浏览器 click 的位移语义但放宽时长——OrbitControls 拖拽常慢移，阈值需同量级）。
 *  命名为模块常量：避免魔法值散落，pointercancel 复位依赖同一语义。 */
const TAP_MAX_MOVE_PX = 5;
const TAP_MAX_DURATION_MS = 400;

/**
 * [子函数 9/9] 渲染器点按 vs 拖拽识别。
 *   点按 = 位移≤TAP_MAX_MOVE_PX 且 时长≤TAP_MAX_DURATION_MS，此时切换 popup 显隐（仅切 display，DOM/栈保留）。
 *   pointercancel（系统手势抢占）时复位 downT，防后续 pointerup 误判为点按。
 *   返回 abort 句柄供 dispose 解绑。
 *
 * 显隐两条路径严格配对 onShow/onHide（输入阻断栈 + 焦点记忆 _prevFocus）：
 *   - popup 可见时点按渲染器 → hideMenu()（onHide 解阻断 + 恢复焦点给触发元素）
 *   - popup 隐藏时点按渲染器 → showMenu()（onShow 记焦点 + 推阻断 + 聚焦首项）
 * 早期实现隐藏路径手搓 `pushInputBlock` 绕过 onShow：输入阻断计数与 onHide 的单次 pop
 * 不再配对（计数虚高致 WASD 永久挂起），且 _prevFocus 未重新武装 → 后续关闭时焦点
 * 无法恢复给触发元素（a11y 缺陷）。现统一走 showMenu/onShow，push/pop 严格成对。
 */
function bindPreviewTapToggle(
  viewEl: HTMLElement,
  popup: HTMLElement,
  menu: { onShow: () => void },
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
    "pointercancel",
    (): void => {
      downT = 0; // 系统手势抢占（如滚动/拖拽接管）→ 复位，防 pointerup 误判为点按
    },
    { signal: tapAbort.signal },
  );
  viewEl.addEventListener(
    "pointerup",
    (e: PointerEvent): void => {
      if (downT === 0) return; // 已被 pointercancel 复位 → 非点按
      const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
      if (moved > TAP_MAX_MOVE_PX || performance.now() - downT > TAP_MAX_DURATION_MS) return;
      if (popup.style.display !== "none") {
        hideMenu(); // 点击渲染器 → 隐藏菜单（onHide 解阻断 + 恢复焦点给触发元素）
      } else {
        const list = popup.querySelector<HTMLElement>(".slide-list");
        if (list && list.childElementCount > 0) {
          // 走 onShow 而非手搓 pushInputBlock：重新武装 _prevFocus + 推输入阻断（计数 1），
          // 与后续 onHide 的单次 pop 严格配对——计数对称，WASD 不永久挂起；焦点可恢复。
          // 不导航（无具体视图），仅恢复 popup 显示态 + 焦点记忆。
          popup.style.display = "flex";
          menu.onShow();
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
      throw new Error(`[preview-menu] setAdapterItems 重复 id: "${it.id}"（适配器项之间冲突）`);
    }
    if (CORE_MENU_ITEMS.some((c) => c.id === it.id)) {
      throw new Error(`[preview-menu] setAdapterItems id "${it.id}" 与 CORE_MENU_ITEMS 冲突`);
    }
    seen.add(it.id);
  }
}

// ===================================================================
// mountPreviewRootMenu — 主函数
// ===================================================================

// ADR-175 M1：overlay 参数放宽为 HTMLElement | ShadowRoot——内容实体已迁入 host.shadowRoot
export function mountPreviewRootMenu(
  overlay: HTMLElement | ShadowRoot,
  ctx: PreviewMenuCtx,
): PreviewMenuHandle {
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
    // ADR-193 第四刀：声明式 action 内下钻子视图（roles 角色行 → modelDetailView 等）
    navigate: (view) => menu.navigate(view),
  };
  const shell: PreviewHandleShell = { handle: null };
  const adapterItemsRef = { v: [] as PreviewMenuNode[] };
  // 阶段 3：面板路由表（schema / fillers / runners 三级衰退链）
  const routers = buildPreviewMenuRouters(ctx, hideMenu, menu, actionCtx, shell);
  // 阶段 4：面板/组视图工厂（引用 routers 做渲染）
  const renderPanelFn = (l: HTMLElement, n: PreviewMenuNode): void =>
    renderPreviewPanel(l, n, routers, menu, hideMenu, actionCtx, {
      makeRow: makePreviewMenuRow,
      makePanelView: makePanelViewFn,
    });
  const makePanelViewFn = (n: PreviewMenuNode): SlideMenuView =>
    previewMakePanelView(n, renderPanelFn);
  const makeRowFn = makePreviewMenuRow;
  const makeGroupViewFn = (g: PreviewMenuGroupDef, items: PreviewMenuNode[]): SlideMenuView =>
    previewMakeGroupView(g, items, menu, makeRowFn, makePanelViewFn, actionCtx, hideMenu);
  // 阶段 5：dock 渲染器（闭包捕获 adapterItemsRef，setAdapterItems 后自动刷新）
  const refreshDock = (): void =>
    renderPreviewDock(
      dock,
      menu,
      showMenu,
      makeRowFn,
      makePanelViewFn,
      makeGroupViewFn,
      actionCtx,
      adapterItemsRef,
      ctx,
    );
  // 阶段 6：tap 识别（点击渲染器区域显隐菜单，拖拽不响应）
  const abortTap = bindPreviewTapToggle(ctx.getViewContainer(), popup, menu, hideMenu);

  // ---- 句柄方法 ----
  const setAdapterItems = (items: PreviewMenuNode[]): void => {
    validateAdapterItemIds(items);
    adapterItemsRef.v = items;
    refreshDock();
  };
  const openPanel = (id: string): void => {
    const node = [...CORE_MENU_ITEMS, ...adapterItemsRef.v].find((d) => d.id === id);
    if (node?.kind !== "panel") return;
    showMenu(makePanelViewFn(node));
  };
  refreshDock();

  const handle: PreviewMenuHandle = {
    dispose: (): void => {
      abortTap();
      // ⚠️ 必须**先** hide 再拆壳：菜单处于开启态时 popup 可见，onShow() 已 pushInputBlock
      // 而 pop 只在 onHide 内。三档 teardown（mount-session 的 early/failed/full）与
      // closeAllOverlays 都是直接调本 dispose、前置无 hide——漏这一步则阻断计数永久残留，
      // isInputBlocked() 恒 true，input-and-animation 的 onKeyDown 提前 return，
      // 该会话之后相机 WASD/方向键彻底失灵（MENU_BLOCK_ID 是常量，打在全局单例栈上）。
      // 同源教训见 bindPreviewTapToggle 注释：手搓 push 不经 onShow 曾致「计数虚高致
      // WASD 永久挂起」；此处是同一不变量在 dispose 路径上的另一半。
      // restoreFocus:false —— 会话正在销毁，焦点归还由 finishSession 的 returnFocus 统一负责。
      hideMenu({ restoreFocus: false });
      disposeEnvSubscriptions(menu); // 清环境面板 cap 订阅（per-mount 隔离，防 cap 单例持有过期 menu 引用）
      unregisterCorePanelSchemas(routers); // ADR-193 §2.5：注销 core 六面板 registry 注册（所有权感知，防陈旧 ctx 闭包跨会话污染/误删新会话）
      clearFolderCollapsedState(); // 清 folder 折叠态记忆（render.ts 模块级 Map，dispose 不清则残留到下次 mount——render.ts 注释承诺的调用点）
      menu.dispose();
      dock.remove();
      popup.remove();
      // renderCustom 逃生舱 cleanup（如骨骼面板的 viewContainer raycaster listener）——
      // 须在 dock/popup
      // remove 之后调用——disposeCustomCleanups 现只清「容器已脱离文档」的条目，
      // remove 后本会话面板容器均已离文档命中全清；并行挂载会话仍存活的面板
      // （isConnected=true）不被本会话误清（render.ts 注释的防御场景）
      disposeCustomCleanups();
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
