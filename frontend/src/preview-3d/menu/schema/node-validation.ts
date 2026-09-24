// ===== node-validation.ts — PreviewMenuNode per-kind 字段契约校验（2026-10 锐评收口）=====
//
// 背景（锐评核实结论）：PreviewMenuNode 是宽接口（25 字段 × 16 kind），`kind` 非 TS 判别器
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

/** 全 kind 合法的通用字段（呈现 / 放置语义，与 kind 无关）。
 *  字段名由 `satisfies` 锁死（拼错/越界即编译期报错）；**完整性**由两测试门的真实树断言兜底
 *  ——漏登记某通用字段会让它在全 kind 被判违规，门立即变红（见 node-validation.test.ts）。 */
export const COMMON_NODE_FIELDS = [
  "id",
  "kind",
  "labelKey",
  "label",
  "hintKey",
  "settingsOrder",
  "icon",
  "visibleWhen",
  "dockGroup",
] as const satisfies readonly (CommonNodeField | "kind")[];

/**
 * 各 kind 的专有字段白名单（不含 COMMON_NODE_FIELDS）。
 *
 * 判定依据 = 渲染器实际读取面（render.ts 各 rmAppend* / appendFoldedShape 分支 +
 * rows.ts 各叶原语 + core.ts makePreviewMenuRow）——某字段不在该 kind 的渲染分支里
 * 被读取，即「挂了也不生效」的静默浪费，属契约外字段。空数组 = 该 kind 无专有字段。
 *
 * 逐项读取面实证（2026-10 按渲染器源码逐函数核对，非按「当前用到什么」反推）：
 *  - `rowDensity` 读于 `rows.ts|rmMakeRowBase`（button/row 共用行壳的入口），故 **button 亦合法**；
 *  - `danger` **仅**读于 `core.ts|makePreviewMenuRow`（叶节点 makeRow 路径），故只对
 *    panel/action/custom 合法——button 走 rmMakeRowBase、row 走 rmAppendDynamicRow，二者均不读 danger。
 *    ⚠️ 现状：全仓无任一 PreviewMenuNode 实际设置 danger（声明+读取齐备但无用例）；
 *    若将来要让 button/row 也支持红字，须先在对应 rmAppend* 里补读取，再入本表。
 *  - `action`：rmBindLeafClick（panel/action/custom）+ rmAppendButton 整行臂 + rmAppendDynamicRow（row）
 *    + renderPreviewPanel 分支③（panel）；
 *  - `value`：rmAppendField（显示值）/ rmAppendDynamicRow（副标签）；`control`：rmAppendButton +
 *    nodeControlToView（slider/toggle/select/color）；`eye`/`opacity`：rmAppendMaterialRow；
 *    `radio`/`badge`/`headerToggle`：rmAppendDynamicRow（headerToggle 亦见 render.ts|rmAppendFolder）；
 *    `children`/`defaultOpen`：rmAppendFolder + rmAppendCard；`collapsible`：rmAppendCard 独有；
 *    `schemaId`/`renderCustom`/`controls`：renderAdapterPanelContent / appendFoldedShape / controls 臂。
 *
 * **[ADR-302 走法丙] 本 const 是 per-kind 字段契约的唯一事实源**：运行期校验（`validateNode`）
 * 与类型层窄类型（`NodeFor<K>`）**都从它派生**——改字段只改这一处，两表无漂移可能。
 * `as const` 保留字面量类型供类型层投影；`satisfies` 保住穷尽性（漏 kind / 拼错字段名 → 编译期报错）。
 */
export const KIND_SPECIFIC_FIELDS = {
  // appendFoldedShape → rmAppendFolder：可折叠 section + header 总开关
  folder: ["defaultOpen", "headerToggle", "children"],
  // 叶（rmAppendLeaf → makeRow）或折叠体（hasFoldedBody → rmAppendFolder）；
  // action 分支见 renderPreviewPanel ③
  panel: ["children", "renderCustom", "schemaId", "action", "danger"],
  // 动作节点：rmBindLeafClick
  action: ["action", "danger"],
  // 控件节点：control → nodeControlToView → cap 栈渲染器
  slider: ["control"],
  toggle: ["control"],
  select: ["control"],
  // 两形态（rows.ts|rmAppendButton）：有按钮语义 control → 行内真按钮；无 → 整行 action。
  // rowDensity 经 rmMakeRowBase 生效；danger 不经此路（见上「逐项读取面实证」）
  button: ["control", "action", "rowDensity"],
  color: ["control"],
  // 键值对行：value = 显示值
  field: ["value"],
  // 动态列表行：value = 副标签附加信息（与 field 语义不同）、radio/badge 槽位、下钻 action
  row: ["value", "radio", "badge", "headerToggle", "action", "rowDensity"],
  // 装饰节点
  divider: [],
  sectionTitle: [],
  // 卡牌容器：children + 可选折叠
  card: ["children", "collapsible", "defaultOpen"],
  // 组合行：eye 显隐 + opacity 滑条
  "material-row": ["eye", "opacity"],
  // cap 复杂控件组通道
  controls: ["controls"],
  // 逃生舱：renderCustom 直填容器；列表语义下走 rmAppendLeaf（读 action/danger）
  custom: ["renderCustom", "action", "danger"],
} as const satisfies Record<PreviewMenuNodeKind, readonly (keyof PreviewMenuNode)[]>;

// ===== [ADR-302 走法丙] 类型层投影：由上面的 const 派生，非第二份手写清单 =====

/** K 的专有字段字面量联合（由 KIND_SPECIFIC_FIELDS 派生——改字段只改表） */
type KindSpecificFieldOf<K extends PreviewMenuNodeKind> = (typeof KIND_SPECIFIC_FIELDS)[K][number];

/** 公共字段 = 宽接口字段全集 **减去** kind 与全部 kind 专有字段的并集（自动推导，无手写清单）。
 *  ⚠️ 推论：新增字段若忘了登记进 KIND_SPECIFIC_FIELDS，它会静默落进「公共字段」而逃过
 *  per-kind 判定——故新字段必须显式登记到某个 kind，或确认其真为全 kind 通用。 */
type CommonNodeField = Exclude<
  keyof PreviewMenuNode,
  "kind" | KindSpecificFieldOf<PreviewMenuNodeKind>
>;

/** 指定 kind 的窄类型：公共字段（保留原可选性）+ 该 kind 的专有字段（可选）。
 *
 *  用途（**可选，非强制**）：新增构造点写 `{ … } satisfies NodeFor<"folder">` 即得编译期字段校验
 *  （把「字段挂了不生效」前移到编译器）；渲染器逐 kind 处理器可据此取得内建收窄。
 *
 *  设计约束（ADR-302 走法丙）：**`PreviewMenuNode` 宽别名保持不变**——既有引用零改动，
 *  故本类型是「可选的编译期前哨」而非强制路径；运行期门（`validateAdapterItemIds` warn +
 *  core/cap 两测试门）继续为动态与外来输入兜底，两者互补而非替代。 */
export type NodeFor<K extends PreviewMenuNodeKind> = Pick<PreviewMenuNode, CommonNodeField> & {
  kind: K;
} & Partial<Pick<PreviewMenuNode, KindSpecificFieldOf<K>>>;

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
