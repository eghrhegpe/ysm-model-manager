// ===== ysm-component-select.ts — YSM 组件选择候选派生与切换语义（ADR-270-d6）=====
//
// 【归属：为什么在 preview-3d/adapters 而非 views（ADR-270-d6 决策 2）】
// 本节点原在 `views/app-preview/skeleton-fill-panel.ts` 的 `buildYsmModelSchema` 内联构造——
// 但「`-1` = All 哨兵 + 组件下标 entries + `mgCount > 1` 守卫 + per-scene 会话态闭包读写」
// 都是 **YSM 适配器域知识**（后续新增资源类型时视图无需再学一遍候选语义），
// 不是视图模板。视图只注入会话态并消费返回的 `PreviewMenuNode`。
//
// 原语 `menu/panels/multi-model.ts`（`multiModelSelectNode`）是零运行时依赖的声明原语，
// 不是病根——R10 治的是「域的候选/切换语义住错了层」。
//
// ADR: ADR-270-d6（本迁移的法律依据）、ADR-132（多模型选择原语）、ADR-126-p5-c（面板声明式 schema）、
//      ADR-270-d2（R10 入口面立法）。

import { t } from "@/core/i18n/t.ts";
import { multiModelSelectNode } from "@/preview-3d/menu/panels/multi-model.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";

/** 组件候选面（spec.models[] 投影；只取候选派生消费的字段）。
 *  刻意不导出：本文件是唯一使用者，导出即成 knip「未引用导出」债。 */
interface YsmComponentModel {
  name?: string;
  id?: string;
  bones?: unknown[];
}

/** YSM 组件选择所需会话态（views 注入） */
export interface YsmComponentSelectCtx {
  /** 3D spec 的组件清单（显式 undefined 合法——spec.models 本身可选；缺省 = 无候选） */
  models?: YsmComponentModel[] | null | undefined;
  /** per-scene 组件选择会话态闭包（-1 = All）；缺省 = 只读展示（set 静默 no-op） */
  sessionActiveComponent?: { get: () => number; set: (n: number) => void } | undefined;
}

/**
 * YSM 组件选择 select 节点（`-1` = 全部组件，其余为组件下标）。
 *
 * ⚠️ 显式 `models.length > 1` 守卫——「-1 = All」恒选项使 entries 恒 ≥2，
 * 不能依赖原语的单候选 null 判断（单组件时也不显示 select，对齐旧语义）。
 * `activeId`/`onSelect` 走 per-scene 会话态闭包（6b080b33 Bug B 范式）；
 * `refreshOnChange` 切档后 stats/纹理行按新会话态重建。
 */
export function ysmComponentSelectNode(ctx: YsmComponentSelectCtx): PreviewMenuNode | null {
  const models = ctx.models ?? [];
  if (models.length <= 1) return null;
  const allLabel = t("preview.allComponents");
  return multiModelSelectNode({
    nodeId: "ysm-component-select",
    labelKey: "preview.component",
    refreshOnChange: true,
    entries: [
      { id: "-1", label: allLabel === "preview.allComponents" ? "全部组件" : allLabel },
      ...models.map((mg, i) => ({
        id: String(i),
        label: `${mg?.name || mg?.id || "model"} (${mg?.bones?.length ?? 0})`,
      })),
    ],
    activeId: (): string =>
      String(ctx.sessionActiveComponent ? ctx.sessionActiveComponent.get() : -1),
    onSelect: (id: string): void => {
      ctx.sessionActiveComponent?.set(Number.isFinite(Number(id)) ? Number(id) : -1);
    },
  });
}
