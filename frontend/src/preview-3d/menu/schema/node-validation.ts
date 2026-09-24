// ===== node-validation.ts — PreviewMenuNode per-kind 字段契约的运行期校验器 =====
//
// 背景（锐评核实结论）：PreviewMenuNode 是宽接口（25 字段 × 16 kind），`kind` 非 TS 判别器
// （单一 interface + 字符串联合，非 discriminated union）——可以写 `{ kind:"field", radio:{…} }`
// 编译通过、渲染器静默忽略。既有校验只有 validateAdapterItemIds 的「id 唯一性」，
// renderMenu 只兜底「未知 kind」，**字段与 kind 错配零捕获**。
//
// 职责划分（[ADR-302] 契约与校验器分家）：
//  - **契约与其类型层投影住在 ./menu-node-types.ts**（`COMMON_NODE_FIELDS` / `KIND_SPECIFIC_FIELDS`
//    是唯一手写清单；`NodeFor<K>` / `AssertCommonFieldIsExact` 由它派生）——契约与它约束的类型同址，
//    故渲染器 / cap / 适配器 import 窄类型时不必跨到「校验」模块。
//  - **本模块只是该契约的运行期校验器**：纯函数 validateNode / validateNodeTree。这里零逻辑依赖
//    （仅 type import + 常量 import），node 环境可直测（对齐 sanctioned.ts 的零依赖纪律）。
//  - 只报「该 kind 不该带的专有字段」；通用字段全 kind 合法，不参与判定。
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
import {
  COMMON_NODE_FIELDS,
  KIND_SPECIFIC_FIELDS,
  type PreviewMenuNode,
} from "./menu-node-types.ts";
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
