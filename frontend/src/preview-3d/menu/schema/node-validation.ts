// ===== node-validation.ts — PreviewMenuNode per-kind 字段契约校验（2026-10 锐评收口）=====
//
// 背景（锐评核实结论）：PreviewMenuNode 是宽接口（35 字段 × 15 kind），`kind` 非 TS 判别器
// （单一 interface + 字符串联合，非 discriminated union）——可以写 `{ kind:"field", radio:{…} }`
// 编译通过、渲染器静默忽略。既有校验只有 validateAdapterItemIds 的「id 唯一性」，
// renderMenu 只兜底「未知 kind」，**字段与 kind 错配零捕获**。
//
// 本模块补这一层：per-kind 字段白名单 + 纯函数 validateNode / validateNodeTree。
//  - 零运行时依赖（仅 type import），node 环境可直测（对齐 sanctioned.ts 的零依赖纪律）。
//  - KIND_SPECIFIC_FIELDS 是 `Record<PreviewMenuNodeKind, …>`：新增 kind 漏登记 → 编译期报错，
//    与 render.ts 的 MENU_HANDLERS 穷尽表同一机制（防表漂移）。
//  - 只报「该 kind 不该带的专有字段」；通用字段（id/kind/labelKey/label/hintKey/
//    settingsOrder/icon/visibleWhen/dockGroup）全 kind 合法，不参与判定。
//  - 不抛错、不改行为：调用方决定 warn / 断言。渲染热路径**不**调用本模块
//    （每次 refresh 遍历全树逐字段校验是白付成本）——只在①测试门②adapter 注入点消费。
//
// 消费点：
//  ① node-validation.test.ts（core 侧）—— 走 CORE_MENU_ITEMS + core 面板 builder + schema-registry
//     断言零违规（正向门），并用自检用例证明校验非摆设（负向控制）。
//  ② caps/cap-menu-trees.test.ts（cap 侧）—— sceneCapabilityRegistry.createAll 实例化全部内置 cap，
//     逐个校验 getMenuNodes() 产出的树（cap 树是菜单节点大头，core 门跑不到）。
//     两门合起来覆盖「core 手写节点 + cap 自产节点」的全量菜单树；各自带防门空转断言。
//  ③ core.ts validateAdapterItemIds —— adapter 外来节点入口 warn（非热路径，只在注入时跑）。
import type { PreviewMenuNode, PreviewMenuNodeKind } from "./menu-node-types.ts";

/** 全 kind 合法的通用字段（呈现 / 放置语义，与 kind 无关） */
export const COMMON_NODE_FIELDS: readonly (keyof PreviewMenuNode)[] = [
  "id",
  "kind",
  "labelKey",
  "label",
  "hintKey",
  "settingsOrder",
  "icon",
  "visibleWhen",
  "dockGroup",
];

/**
 * 各 kind 的专有字段白名单（不含 COMMON_NODE_FIELDS）。
 *
 * 判定依据 = 渲染器实际读取面（render.ts 各 rmAppend* / appendFoldedShape 分支）——
 * 某字段不在该 kind 的渲染分支里被读取，即「挂了也不生效」的静默浪费，
 * 属契约外字段。空数组 = 该 kind 无专有字段（纯装饰/纯文本节点）。
 */
export const KIND_SPECIFIC_FIELDS: Record<PreviewMenuNodeKind, readonly (keyof PreviewMenuNode)[]> =
  {
    // appendFoldedShape → rmAppendFolder：可折叠 section + header 总开关
    folder: ["defaultOpen", "headerToggle", "children"],
    // 叶（rmAppendLeaf → makeRow）或折叠体（hasFoldedBody → rmAppendFolder）；
    // action 分支见 renderPreviewPanel ③
    panel: ["children", "renderCustom", "schemaId", "action", "danger"],
    // 动作节点：rmBindLeafClick / rmBindActionClick
    action: ["action", "danger"],
    // 控件节点：control → nodeControlToView → cap 栈渲染器
    slider: ["control"],
    toggle: ["control"],
    select: ["control"],
    // 两形态（render.ts rmAppendButton）：有按钮语义 control → 行内真按钮；无 → 整行 action
    button: ["control", "action", "danger"],
    color: ["control"],
    // 键值对行：value = 显示值
    field: ["value"],
    // 动态列表行：value = 副标签附加信息（与 field 语义不同）、radio/badge 槽位、下钻 action
    row: ["value", "radio", "badge", "headerToggle", "action", "danger", "rowDensity"],
    // 装饰节点
    divider: [],
    sectionTitle: [],
    // 卡牌容器：children + 可选折叠
    card: ["children", "collapsible", "defaultOpen"],
    // 组合行：eye 显隐 + opacity 滑条
    "material-row": ["eye", "opacity"],
    // cap 复杂控件组通道
    controls: ["controls"],
    // 逃生舱：renderCustom 直填容器（无 children 时 rmAppendLeaf 行壳）
    custom: ["renderCustom"],
  };

/** 校验单节点：返回违规的专有字段名（空数组 = 合规）。不递归 children。 */
export function validateNode(node: PreviewMenuNode): string[] {
  const allowed = new Set<string>([
    ...COMMON_NODE_FIELDS,
    ...(KIND_SPECIFIC_FIELDS[node.kind] ?? []),
  ]);
  const out: string[] = [];
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) out.push(key);
  }
  return out;
}

/** 违规项（供门禁/告警聚合报告） */
export interface NodeViolation {
  id: string;
  kind: string;
  /** 该 kind 不该带的字段 */
  fields: string[];
}

/** 递归校验节点树（含 children 下钻），返回全部违规项。 */
export function validateNodeTree(nodes: PreviewMenuNode[]): NodeViolation[] {
  const out: NodeViolation[] = [];
  const walk = (list: PreviewMenuNode[]): void => {
    for (const n of list) {
      const fields = validateNode(n);
      if (fields.length) out.push({ id: n.id, kind: String(n.kind), fields });
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
