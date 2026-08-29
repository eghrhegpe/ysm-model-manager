// ===== menu-graph.ts — [doc:adr-128] 菜单导航图生成器（声明式收口后的可验证性）=====
//
// 把「菜单即数据」投影成可机器遍历的导航树：dock(group) → panel → node → children。
// 纯函数、零 DOM / 零 Wails 桥依赖——可在 node / vitest / doctor 环境单测与生成。
//
// 入口 = 双通道并集（修正初稿误用 listSchemas 单一入口，见 ADR-128 §5 死穴一）：
//   1. routers.schemaBuilders 闭包（6 常驻 L2 面板）    —— 渲染器第一真值源
//   2. schema-registry Map（ysm-model + 动态 litematic）— 渲染器第二通道
//   3. PreviewMenuNode.children[] 递归                   —— L3/L4 声明式下钻
//   4. fillers（roles 过程式下钻）                       —— P4-B 前必需，标 procedural
//   5. runners（close 动作式）                            —— 标 nonNav，不进导航路径
//
// 可达性 = 对代表性快照集求 node.visibleWhen(snap)；节点级谓词（吃 PreviewSnapshot）
// 与 cap 级 collectVisiblePredicates（无参 c.visible）严格区分，不可混用（§5 死穴二）。

import type { PreviewMenuNode, PreviewMenuNodeKind, PreviewSnapshot } from "./preview-menu-node-types.ts";
import type { PreviewMenuRouters } from "./preview-menu.ts";
import type { SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";
import { getSchema, listSchemas } from "./schema-registry.ts";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./preview-menu-defs.ts";

/** 代表性快照：命名 + 状态层快照（ADR-128 §2.1 四档约定：default / roleLoaded / motionActive / envOn） */
export interface RepresentativeSnapshot {
  name: string;
  snapshot: PreviewSnapshot;
}

/** 导航图节点（菜单节点的投影，只读不写） */
export interface MenuGraphNode {
  id: string;
  kind: PreviewMenuNodeKind;
  dockGroup?: string;
  schemaId?: string;
  /** 兼容既有 e2e 选择器的 legacy data-testid */
  legacyTestId?: string;
  /** 含 renderCustom 逃生舱（骨骼面板 / litematic 切片等真·复杂内容，图不强行走通） */
  escapeHatch: boolean;
  /** action 节点（runners / node.action），不进导航路径 */
  nonNav: boolean;
  /** 过程式下钻（fillers），内部结构不可静态走通 */
  procedural?: boolean;
  /** 在 ≥1 档代表性快照下可见（无 visibleWhen 守卫 → 恒 true） */
  reachable: boolean;
  /** 可见的各快照档名（空 = 当前代表性集下恒不可达，可能条件路径盲点） */
  reachableBy: string[];
  children: MenuGraphNode[];
}

/** 导航图：dock 分组 → 面板 → 节点树 + 动作节点 + 覆盖度 */
export interface MenuGraph {
  docks: Array<{ group: string; panels: MenuGraphNode[] }>;
  /** 动作式节点（close 等），不计入导航路径 */
  actions: MenuGraphNode[];
  /** full = 全部面板可声明式走通；partial = 存在过程式下钻 / 双通道债（ADR-128 §2.2） */
  coverage: "full" | "partial";
  /** partial 时未覆盖层（procedural 面板 id + "schemaBuilders-not-in-registry"） */
  uncoveredLayers: string[];
  /** 过程式面板 id（fillers，图内仅占位，内部节点不可枚举） */
  proceduralPanels: string[];
  /** 节点级 visibleWhen 谓词总数（与 cap 级 collectVisiblePredicates 区分） */
  predicateCount: number;
}

/** collectMenuGraph 入参 */
export interface CollectMenuGraphOpts {
  /** 真实 routers（buildPreviewMenuRouters 产出；schemaBuilders 需 menu 句柄） */
  routers: PreviewMenuRouters;
  /** 代表性快照集（至少 1 档，建议 4 档） */
  snapshots: RepresentativeSnapshot[];
  /** schemaBuilders 调用所需的 menu 句柄（生产传真实 handle，测试传 stub） */
  menu: SlideMenuHandle;
  /** 覆盖 listSchemas()——指定要枚举的 registry 键（默认全量 listSchemas()） */
  registryIds?: string[];
}

/** 节点级谓词收集（递归）：与 cap 级 collectVisiblePredicates 严格区分（ADR-128 §5 死穴二） */
export function collectNodePredicates(
  nodes: PreviewMenuNode[],
): Array<{ nodeId: string; predicate: (s: PreviewSnapshot) => boolean }> {
  const out: Array<{ nodeId: string; predicate: (s: PreviewSnapshot) => boolean }> = [];
  for (const n of nodes) {
    if (n.visibleWhen) out.push({ nodeId: n.id, predicate: n.visibleWhen });
    if (n.children) out.push(...collectNodePredicates(n.children));
  }
  return out;
}

/** 静态 dockGroup 查表（CORE_MENU_ITEMS 提供闭包面板 / roles filler 的归属） */
function lookupDock(id: string): string | undefined {
  return CORE_MENU_ITEMS.find((n) => n.id === id)?.dockGroup;
}

/** 单节点投影（递归求可达性） */
function projectNode(n: PreviewMenuNode, snaps: RepresentativeSnapshot[]): MenuGraphNode {
  const reachableBy = snaps
    .filter((s) => !n.visibleWhen || n.visibleWhen(s.snapshot) === true)
    .map((s) => s.name);
  return {
    id: n.id,
    kind: n.kind,
    dockGroup: n.dockGroup,
    schemaId: n.schemaId,
    legacyTestId: n.legacyTestId,
    escapeHatch: !!n.renderCustom,
    nonNav: n.kind === "action" || !!n.action,
    reachable: reachableBy.length > 0,
    reachableBy,
    children: n.children ? n.children.map((c) => projectNode(c, snaps)) : [],
  };
}

/** 由已解析节点构造面板投影节点（闭包 / registry 两通道共用，消除重复块） */
function buildPanelNode(
  id: string,
  nodes: PreviewMenuNode[],
  snaps: RepresentativeSnapshot[],
  dockGroup: string | undefined,
  schemaId?: string,
): MenuGraphNode {
  return {
    id,
    kind: "panel",
    dockGroup,
    schemaId,
    escapeHatch: false,
    nonNav: false,
    reachable: true,
    reachableBy: snaps.map((s) => s.name),
    children: nodes.map((n) => projectNode(n, snaps)),
  };
}

/**
 * 收集菜单导航图（纯函数，不改任何状态）。
 * 任一面板的 builder 抛错 → 抛异常（生成失败），由上层门禁（doctor）拦截，
 * 把「AI 改菜单破坏真实路径」挡在 e2e 之前（ADR-128 §2.2）。
 */
export function collectMenuGraph(opts: CollectMenuGraphOpts): MenuGraph {
  const { routers, snapshots, menu } = opts;
  const registryIds = opts.registryIds ?? listSchemas();
  const snapForBuilder = snapshots[0]?.snapshot ?? ({} as PreviewSnapshot);

  const allPanels: MenuGraphNode[] = [];
  const allResolvedNodes: PreviewMenuNode[][] = [];
  const proceduralPanels: string[] = [];

  // 通道 1：闭包 schemaBuilders（6 常驻 L2 面板）
  for (const [id, builder] of Object.entries(routers.schemaBuilders)) {
    let nodes: PreviewMenuNode[];
    try {
      nodes = builder(menu);
    } catch (e) {
      throw new Error(`collectMenuGraph: 面板 "${id}" builder 抛错（${(e as Error).message}）`);
    }
    allResolvedNodes.push(nodes);
    allPanels.push(buildPanelNode(id, nodes, snapshots, lookupDock(id) ?? nodes[0]?.dockGroup));
  }

  // 通道 2：schema-registry Map（ysm-model + 动态 litematic 切片键）
  for (const id of registryIds) {
    const builder = getSchema(id);
    if (!builder) continue;
    let nodes: PreviewMenuNode[];
    try {
      nodes = builder(snapForBuilder);
    } catch (e) {
      throw new Error(`collectMenuGraph: registry 面板 "${id}" builder 抛错（${(e as Error).message}）`);
    }
    allResolvedNodes.push(nodes);
    allPanels.push(buildPanelNode(id, nodes, snapshots, nodes[0]?.dockGroup ?? lookupDock(id), id));
  }

  // 通道 4：fillers（roles 过程式下钻，P4-B 前必需）——仅占位，内部不可静态走通
  for (const id of Object.keys(routers.fillers)) {
    proceduralPanels.push(id);
    allPanels.push({
      id,
      kind: "panel",
      dockGroup: lookupDock(id),
      procedural: true,
      escapeHatch: false,
      nonNav: false,
      reachable: true,
      reachableBy: snapshots.map((s) => s.name),
      children: [],
    });
  }

  // 通道 5：runners 动作式节点（close 等，非导航路径）
  const actions: MenuGraphNode[] = Object.keys(routers.runners).map((id) => ({
    id,
    kind: "action",
    escapeHatch: false,
    nonNav: true,
    reachable: true,
    reachableBy: snapshots.map((s) => s.name),
    children: [],
  }));

  // dock 分组（按 PREVIEW_MENU_GROUPS 顺序稳定输出 5 组骨架，空组保留）
  const docks: Array<{ group: string; panels: MenuGraphNode[] }> = PREVIEW_MENU_GROUPS.map((g) => ({
    group: g.id,
    panels: [],
  }));
  const dockMap = new Map(docks.map((d) => [d.group, d.panels]));
  for (const panel of allPanels) {
    const g = panel.dockGroup ?? "settings";
    const arr = dockMap.get(g);
    if (arr) arr.push(panel);
    else docks.push({ group: g, panels: [panel] });
  }

  // 覆盖度：过程式下钻 或 闭包 builder 未迁 registry → partial
  const dualChannelDebt = Object.keys(routers.schemaBuilders).filter(
    (id) => !registryIds.includes(id),
  );
  const coverage: MenuGraph["coverage"] =
    proceduralPanels.length === 0 && dualChannelDebt.length === 0 ? "full" : "partial";
  const uncoveredLayers = [
    ...proceduralPanels,
    ...(dualChannelDebt.length ? ["schemaBuilders-not-in-registry"] : []),
  ];

  const predicateCount = collectNodePredicates(allResolvedNodes.flat()).length;

  return { docks, actions, coverage, uncoveredLayers, proceduralPanels, predicateCount };
}
