// ===== sanctioned.ts — 受控过程式面板白名单（ADR-193 §2.2② / §3 单一事实源）=====
//
// 背景：`renderCustom` 是「真·无法数据化的复杂交互内容」的受限逃生舱。ADR-193 §2.2 拍板
// （2026-09）：bones 面板为**唯一永久例外**（选项②），否掉选项①（给 node 模型新增声明式
// `tree` kind——骨骼树数据化 + raycaster/场景引用经状态层注入，成本最重）。
//
// §3 同时要求：该例外必须**显式标注不可静默**——full 判定永久携带一个 sanctioned 洞，
// 不得只藏在测试白名单里、让 menu-graph 报告对外宣称 full 却对已豁免的手写 DOM 面板只字不提。
//
// 本模块 = 该例外的**单一事实源**，由两处共同消费：
//   1. 审计门 `adapters/render-custom-audit.test.ts` —— 生产源码里「`renderCustom` + 冒号」的
//      构造点必须与本文名单**逐一相等**（多一个 → 红；少一个即路径漂移 → 红）。
//   2. 导航图报告 `menu/menu-graph.ts` 的 `sanctionedProcedural` 字段 —— 把洞摆到明面上。
// 三处（测试白名单 / 报告 / 代码注释）此前各说各话，统一收敛到此处。
//
// ⚠️ 零依赖（纯数据）：审计门跑在 `@vitest-environment node` 做静态源码扫描，
//    本模块的 import 链不得拉进 three / DOM 原语，否则该门在 node 环境炸掉。
//
// 新增流程（ADR-193 豁免流程，勿省）：真·无法数据化才可入名单 —— 先经 code review 拍板，
// 条目须写清 `decidedBy`（ADR 依据）与 `rationale`（具体性质，非套话），再追加到本表。

/** 一个受控过程式面板条目（经拍板豁免，非「图省事走逃生舱」） */
export interface SanctionedProceduralPanel {
  /** 菜单节点 id（与 `makeXxxPanelItem` 产出的 `PreviewMenuNode.id` 一致） */
  id: string;
  /** 承载该逃生舱构造点（`renderCustom` + 冒号）的生产源码（相对 `frontend/src` 的正斜杠路径） */
  sourceFile: string;
  /** 拍板依据（ADR 编号 + 章节），供后来者追溯「凭什么它可以例外」 */
  decidedBy: string;
  /** 豁免理由——须写明「真·无法数据化的具体性质」，非「很复杂」套话 */
  rationale: string;
  /** 假释条件（exit criteria，ADR-193 §2.2「拒绝挂着不动」的可执行化）：写明「什么情况下本例外
   *  不再成立」——满足即触发抽象提取、本条目应从名单移除。
   *  永久例外 ≠ 永久特权：判据用两次法则——第一个消费者手写算例外，第二个同构消费者出现即
   *  说明它是个待抽象的模式。缺此字段的豁免是无到期日的债，审计门会拦。 */
  exitWhen: string;
}

/**
 * 受控过程式面板名单（当前仅 1 项，ADR-193 §2.2 拍板的唯一永久例外）。
 *
 * 语义：**豁免 ≠ 允许增长**。本表长度是声明式收口的欠账账本——ADR-193 §2.2 明示
 * 拒绝「挂着不动」，故每一项都必须带 ADR 依据，且被 menu-graph 报告显式列出。
 */
export const SANCTIONED_PROCEDURAL_PANELS: readonly SanctionedProceduralPanel[] = [
  {
    id: "bones",
    sourceFile: "preview-3d/menu/panels/bones-panel-node.ts",
    decidedBy: "ADR-193 §2.2②",
    rationale:
      "骨骼树浏览器：动态树形列表（骨骼数随模型变）+ 跨域拾取联动（viewContainer click → 写 activeId），" +
      "schema 化须新增「树形 row（深度缩进 + 选中态内联详情）」与「跨域 state 绑定」两类抽象，" +
      "ROI 为负；本体 makeBonePanelRenderer 已是 ADR-074 S2 抽取的通用组件，本工厂仅是其菜单项胶水。",
    exitWhen:
      "出现第二个需要「外部事件 → 状态 → 重绘 + cleanup 生命周期」的声明式面板时，本例外升级为模式提取，" +
      "触发 ADR-193 §2.2 选项①（给 node 模型补 tree / subscribe 抽象）；届时本条目须从本名单移除。",
  },
];
