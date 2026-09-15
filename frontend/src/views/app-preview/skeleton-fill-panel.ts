// ===== skeleton-fill-panel.ts — YSM 模型面板声明式 schema（ADR-126 P5）=====
// 填充 3D 信息面板：统计 + 纹理 + 模型选择（声明式节点）
import { t } from "@/core/i18n/t.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import { multiModelSelectNode } from "@/preview-3d/menu/multi-model.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/node-types.ts";
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
  // [doc:adr-132] 迁 multiModelSelectNode 统一原语（对齐 MMD zip/资源包）：
  // entries 首项 "-1" = All（「全部组件」），其余为组件下标；get/set 走 per-scene 会话态闭包
  // （sessionActiveComponent，6b080b33 Bug B 范式）；refreshOnChange 切档后 stats/纹理行重建。
  // 注意：显式 `mgCount > 1` 守卫——「-1 = All」恒选项使 entries 恒 ≥2，不能依赖原语的
  // 单候选 null 判断（单组件时也不显示 select，对齐旧语义）。
  // 快照回退（审核修复）：get 与 rawIdxRaw 同表达式——闭包缺省（旧调用/测试）时读
  // snapshot["ui.activeComponent"]，面板内部口径一致（select 显示 = stats/纹理聚合行）；
  // set 在闭包缺省时无写入目标（snapshot 只读）→ 静默 no-op，legacy 路径为只读展示。
  const nodes: PreviewMenuNode[] = [];
  if (mgCount > 1) {
    const allLabel = t("preview.allComponents");
    const select = multiModelSelectNode({
      nodeId: "ysm-component-select",
      labelKey: "preview.component",
      refreshOnChange: true,
      entries: [
        { id: "-1", label: allLabel === "preview.allComponents" ? "全部组件" : allLabel },
        ...(ctx.spec.models ?? []).map((mg, i) => ({
          id: String(i),
          label: `${(mg as { name?: string; id?: string })?.name || (mg as { id?: string })?.id || "model"} (${(mg as { bones?: unknown[] })?.bones?.length ?? 0})`,
        })),
      ],
      activeId: (): string => String(sessionActiveComponent ? sessionActiveComponent.get() : -1),
      onSelect: (id: string): void => {
        sessionActiveComponent?.set(Number.isFinite(Number(id)) ? Number(id) : -1);
      },
    });
    if (select) nodes.push(select);
  }

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
        labelKey: `${compName}${exclusive.length > 1 ? ` #${k + 1}` : ""}`,
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
        labelKey: name,
        value: `${cat ? `${cat} · ` : ""}声明 ${decl} · 加载 ${size}`,
      });
    }
  }

  return nodes;
}
