// ===== skeleton-fill-panel.ts — YSM 模型面板声明式 schema（ADR-126 P5）=====
// 填充 3D 信息面板：统计 + 纹理 + 模型选择（声明式节点）

import { ysmComponentSelectNode } from "@/preview-3d/adapters/ysm-component-select.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import type { Spec3D } from "@/preview-3d/mesh/model3d.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-state.ts";

/** YSM 模型面板的 model 入参结构（BedrockGeometry + 面板数理化扩展字段） */
type PanelModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  textureCategories?: string[];
  boneCount?: number;
  bones?: unknown[];
};

// ===== [doc:adr-126-p5-c] YSM 模型面板声明式 schema（受控 builder 注册的落地）=====
// 组件切换由 per-scene 闭包处理，本层仅消费外部传入的会话态。

/** 组件统计（按 activeComponent 聚合；-1 = All）：骨骼数 + 立方体数 + 组件名 */
export interface YsmModelStats {
  bones: number;
  cubes: number;
  /** 当前组件名（-1 = All 时为 "main" 或首个组件名） */
  compName: string;
}

/** 统计聚合（纯函数，供 schema builder 消费） */
export function ysmModelStats(spec: Spec3D, rawIdx: number): YsmModelStats {
  let bones = 0;
  let cubes = 0;
  if (rawIdx < 0) {
    for (const m of spec.models || []) {
      const mm = m as { bones?: Array<{ _cubeCount?: number }> };
      bones += mm.bones?.length || 0;
      for (const b of mm.bones || []) cubes += b._cubeCount || 0;
    }
  } else {
    const mm = spec.models?.[rawIdx] as { bones?: Array<{ _cubeCount?: number }> } | undefined;
    bones = mm?.bones?.length || 0;
    for (const b of mm?.bones || []) cubes += b._cubeCount || 0;
  }
  const eff = rawIdx < 0 ? 0 : rawIdx;
  const mg = spec.models?.[eff] as { name?: string; id?: string } | undefined;
  return { bones, cubes, compName: mg?.name || mg?.id || "main" };
}

/** 当前组件纹理槽位（meshGroups.texIdx 去重；缺省回退全部声明纹理） */
export function ysmModelTextureSlots(spec: Spec3D, rawIdx: number, texCount: number): number[] {
  const eff = rawIdx < 0 ? 0 : rawIdx;
  const mg = spec.models?.[eff] as { meshGroups?: Array<{ texIdx?: number }> } | undefined;
  const slots: number[] = [];
  for (const msh of mg?.meshGroups || []) {
    const s = msh.texIdx;
    if (typeof s === "number" && s >= 0 && s < texCount && !slots.includes(s)) slots.push(s);
  }
  if (mg && slots.length === 0 && texCount > 0) {
    for (let i = 0; i < texCount; i++) slots.push(i);
  }
  return slots;
}

/**
 * YSM 模型面板声明式节点（组件选择 + 统计 + 纹理）。
 * @param ctx YSM 控件上下文（model/spec/texArr）
 * @param snapshot 状态层快照（兼容保留：P4-D visibleWhen 谓词同构；组件下标不再读它）
 * @param sessionActiveComponent per-scene 组件选择会话态闭包（get/set 读写，-1 = All）——
 *   组件切换副作用（showModelGroup）由 views 层 registerModelSchema 闭包驱动（本函数只产出节点）。
 */
export function buildYsmModelSchema(
  ctx: {
    model: PanelModel;
    spec: Spec3D;
    texArr: import("three").Texture[];
  },
  _snapshot: Partial<PreviewSnapshot>,
  sessionActiveComponent?: { get: () => number; set: (n: number) => void },
): PreviewMenuNode[] {
  // 会话态真源 = 闭包（per-scene）
  const rawIdxRaw = sessionActiveComponent ? sessionActiveComponent.get() : -1;
  const mgCount = ctx.spec.models?.length ?? 0;
  // clamp：组件数变化后的陈旧下标（≥ mgCount）视为 -1（All）——防 stats 聚合越界 + select 无匹配项
  const rawIdx = rawIdxRaw >= mgCount ? -1 : rawIdxRaw;
  const { bones, cubes, compName } = ysmModelStats(ctx.spec, rawIdx);
  const slots = ysmModelTextureSlots(ctx.spec, rawIdx, ctx.texArr.length);

  // 组件选择（多组件才显示；-1 = All 选项恒在）
  // [doc:adr-132][doc:adr-270-d6] 候选派生/切换语义归 adapters/ysm-component-select.ts
  // （「-1 = All」哨兵 + 组件下标 entries + `mgCount > 1` 守卫 + per-scene 会话态闭包读写）。
  // 本层只注入会话态（sessionActiveComponent）并消费节点：快照回退（审核修复）与 stats/纹理
  // 聚合行共用同一 sessionActiveComponent 口径（select 显示 = stats/纹理聚合行）。
  const nodes: PreviewMenuNode[] = [];
  const select = ysmComponentSelectNode({
    models: ctx.spec.models,
    sessionActiveComponent,
  });
  if (select) nodes.push(select);

  // 统计
  nodes.push(
    {
      id: "ysm-stats-bones",
      kind: "field",
      labelKey: "preview.section.bones",
      value: `${bones} 根`,
    },
    {
      id: "ysm-stats-cubes",
      kind: "field",
      labelKey: "preview.cubesLabel",
      value: `${cubes} 个`,
    },
  );

  // 纹理行（当前组件绑定）
  // [doc:adr-126-p5] ADR-114 专属纹理回归（P5-A review P2）：componentTextures[compName] 命中
  // → 渲染专属纹理行（对齐旧 fillPanelComponent 语义），否则走全局槽（meshGroups.texIdx 去重）
  const compTex = (ctx.spec as { componentTextures?: Record<string, string[]> }).componentTextures;
  const declM = ctx.spec.models?.[rawIdx < 0 ? 0 : rawIdx] as
    | { textureWidth?: number; textureHeight?: number }
    | undefined;
  const decl =
    typeof declM?.textureWidth === "number" && typeof declM?.textureHeight === "number"
      ? `${declM.textureWidth}×${declM.textureHeight}`
      : "?";
  const exclusive = rawIdx >= 0 && rawIdx < mgCount ? compTex?.[compName] : undefined;
  if (exclusive?.length) {
    exclusive.forEach((_uri, k) => {
      nodes.push({
        id: `ysm-tex-ex-${k}`,
        kind: "row",
        label: `${compName}${exclusive.length > 1 ? ` #${k + 1}` : ""}`,
        value: `专属纹理 声明 ${decl}`,
      });
    });
  } else {
    for (const s of slots) {
      const tex = ctx.texArr[s];
      const name =
        ctx.model.textureNames?.[s] ||
        ctx.model.textures?.[s]
          ?.split(/[/\\]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") ||
        `纹理 ${s + 1}`;
      const cat = ctx.model.textureCategories?.[s] || "";
      const ud = (tex as unknown as { userData?: { imgWidth?: unknown; imgHeight?: unknown } })
        ?.userData;
      const w = typeof ud?.imgWidth === "number" ? ud.imgWidth : null;
      const h = typeof ud?.imgHeight === "number" ? ud.imgHeight : null;
      const size = w !== null && h !== null ? `${w}×${h}` : "?";
      nodes.push({
        id: `ysm-tex-${s}`,
        kind: "row",
        label: name,
        value: `${cat ? `${cat} · ` : ""}声明 ${decl} · 加载 ${size}`,
      });
    }
  }

  return nodes;
}
