// ===== morph-controls.ts — MMD 表情开关面板声明式节点（[doc:adr-126-p5-收尾]）=====
// morph 面板与 perception 同构（纯 toggle 集合），照 perceptionNodes 样板声明式化：
//  - 每个表情 = toggle 节点，control.get/set 闭包读写 mesh.morphTargetInfluences[index]
//  - 零 DOM（R1 合规），渲染走 renderMenu toggle 分支（ADR-125 §3.3 预留的 A 层控件分支）
// fillMmdMorphPanel（手写 DOM：图标 ✓/🙂 + 名称 + 点击切换权重）迁移后删除。

import type { PreviewMenuNode } from "../menu/node-types.ts";

/** morph 面板入参（mesh 的 morphTargetDictionary/influences 子集，结构兼容 THREE.SkinnedMesh） */
export interface MorphMeshLike {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

/**
 * MMD 表情开关声明式节点（纯数据工厂零 DOM）。
 * 每个表情 = toggle：get 读当前权重（>0.5 活跃），set 切换 0/1。
 * 无 morph → 空态 field（对齐旧 fillMmdMorphPanel 的 noOtherMorph 行）。
 */
export function morphNodes(ctx: MorphMeshLike): PreviewMenuNode[] {
  const names = Object.keys(ctx.morphTargetDictionary || {});
  if (names.length === 0) {
    return [{ id: "morph-empty", kind: "field" as const, labelKey: "preview.noOtherMorph", fallback: "无表情", value: "" }];
  }
  return names.map((name) => ({
    id: `morph-${name}`,
    kind: "toggle" as const,
    // morph 名是动态数据（非 i18n key）——用 fallback 承载显示名（rmLabel 缺 labelKey 时回退）
    fallback: name,
    control: {
      get: (): boolean => {
        const idx = ctx.morphTargetDictionary?.[name];
        return idx !== undefined && (ctx.morphTargetInfluences?.[idx] ?? 0) > 0.5;
      },
      set: (v: unknown): void => {
        const idx = ctx.morphTargetDictionary?.[name];
        // 缺 morphTargetInfluences（边界）→ 静默返回（对齐旧 fillMmdMorphPanel）
        if (idx === undefined || !ctx.morphTargetInfluences) return;
        ctx.morphTargetInfluences[idx] = Boolean(v) ? 1 : 0;
      },
    },
  }));
}
