// ===== mmd-model-select.ts — MMD zip 多 pmx 候选派生与切换语义（ADR-270-d6）=====
//
// 【归属：为什么在 preview-3d/adapters/mmd 而非 views（ADR-270-d6 决策 2）】
// 本节点原在 `views/app-preview/mmd-controls.ts` 的 `mmdModelInfoNodes` 内联构造——
// 但候选派生（zip 虚拟路径 → basename 显示名）、activeId 的 basename 匹配语义、
// 切换副作用（`switchTo(虚拟路径)` 重建内容层）都是 **MMD 适配器域知识**，
// 不是视图模板。视图只注入会话态并消费返回的 `PreviewMenuNode`。
//
// 原语 `menu/panels/multi-model.ts`（`multiModelSelectNode`）是零运行时依赖的声明原语，
// 不是病根——R10 治的是「域的候选/切换语义住错了层」。
//
// ADR: ADR-270-d6（本迁移的法律依据）、ADR-132（多模型选择原语）、ADR-270-d2（R10 入口面立法）。

import { multiModelSelectNode } from "@/preview-3d/menu/panels/multi-model.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";

/** MMD zip 多 pmx 候选切换所需的会话态（views 注入；候选不足 2 个 → 无「选择」语义） */
export interface MmdModelSelectCtx {
  /** zip 内全部 pmx/pmd 候选虚拟路径（mmd-adapter 暴露；非 zip = 空/缺省） */
  zipModelCandidates?: string[] | null;
  /** 当前模型显示名（= 虚拟路径 basename，与候选 label 同口径匹配） */
  modelName: string;
  /** 切换到另一候选（复用核心外壳重建内容层） */
  switchTo?: (path: string) => void | Promise<void>;
}

/**
 * zip 多 pmx 的模型选择 select 节点。
 *
 * - 候选 = `zipModelCandidates` 虚拟路径，label 取路径 basename；
 * - `activeId` 保持 basename 匹配语义（`modelName` = 虚拟路径 basename），
 *   命中不到时回落首候选（对齐原语 get 的 set-外回退）；
 * - `onSelect` → `switchTo(虚拟路径)` 重建内容层。
 *
 * 单候选/无候选 → null（原语自带 `entries.length < 2` 守卫，调用方不注入）。
 */
export function mmdModelSelectNode(ctx: MmdModelSelectCtx): PreviewMenuNode | null {
  const candidates = (ctx.zipModelCandidates ?? []).map((p) => ({
    id: p,
    label: p.split(/[/\\]/).pop() || p,
  }));
  return multiModelSelectNode({
    entries: candidates,
    nodeId: "mmd-model-select",
    activeId: (): string =>
      candidates.find((c) => c.label === ctx.modelName)?.id ?? candidates[0]?.id ?? "",
    onSelect: (id: string): void => {
      if (ctx.switchTo && id) void ctx.switchTo(id);
    },
  });
}
