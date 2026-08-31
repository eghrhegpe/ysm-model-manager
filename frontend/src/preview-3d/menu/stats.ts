// ===== 3D 统计面板菜单节点（ADR-131 P1）=====
// 核心 post-build 挂点采集 collectSceneStats 后，经本模块构造统计面板节点并
// 合并进适配器 menuItems——「能渲染就能出统计」，所有格式自动受益。
//
// 铁律对齐（AGENTS.md）：
// - 统计面板是声明式 PreviewMenuNode（panel + field 行），不手写 DOM
// - visibleWhen: (s) => boolean 守卫「有统计才显示」——可被所有数组类菜单调用
// - 与适配器 menuItems 合并后**一次** setAdapterItems，避免互相覆盖（ADR-131 §2.3）
//
// i18n：child field 行的 labelKey 走「preview.stats.<metric>」三段式（ADR-124），
// 三个语言包同步补键；visibleWhen 不依赖状态层快照（统计是 build 后闭包值）。

import type { PreviewMenuNode } from "./node-types.ts";
import type { SceneStats } from "../scene-stats.ts";

/** 统计面板的稳定 id（merger/schema 引用；渲染为 data-testid="preview-stats-panel"） */
export const STATS_PANEL_ID = "stats-panel";

/** 是否有可供展示的统计（mesh/bone 任一 > 0；全 0 = 空场景/纯装饰，无意义） */
export function hasSceneStats(s: SceneStats): boolean {
  return s.meshCount > 0 || s.boneCount > 0;
}

/** 构造统计面板节点：panel + 6 个 field 行（骨骼/网格/三角面/材质/纹理/表情） */
export function buildStatsPanel(stats: SceneStats): PreviewMenuNode {
  const field = (id: string, labelKey: string, fallback: string, value: number): PreviewMenuNode => ({
    id,
    kind: "field",
    labelKey,
    fallback,
    value,
  });
  return {
    id: STATS_PANEL_ID,
    kind: "panel",
    icon: "📊",
    labelKey: "preview.stats.panel",
    // 口径标注（审核建议 ②）：traverse 渲染实测，与 YSM 模型面板 Go 口径区分
    fallback: "渲染实测",
    dockGroup: "model",
    // 有统计才显示（铁律：visibleWhen 纯函数守卫；stats 是 build 后闭包值，非状态层项）
    visibleWhen: () => hasSceneStats(stats),
    children: [
      field("stat-bones", "preview.stats.bones", "骨骼", stats.boneCount),
      field("stat-meshes", "preview.stats.meshes", "网格", stats.meshCount),
      field("stat-triangles", "preview.stats.triangles", "三角面", stats.triangleCount),
      field("stat-materials", "preview.stats.materials", "材质", stats.materialCount),
      field("stat-textures", "preview.stats.textures", "纹理", stats.textureCount),
      field("stat-morphs", "preview.stats.morphs", "表情", stats.morphCount),
    ],
  };
}

/**
 * 合并统计面板进适配器 menuItems（ADR-131 §2.3：合并后一次注入，避免 setAdapterItems 互相覆盖）。
 * 纯函数：不修改入参；有统计才追加（全 0 场景无统计面板）。
 * 幂等保护（审核 nit）：入参已含 stats-panel（id 去重）时不再追加——防日后多调用点重复注入。
 */
export function mergeStatsMenuItems(
  items: PreviewMenuNode[] | null | undefined,
  stats: SceneStats,
): PreviewMenuNode[] {
  if (!hasSceneStats(stats)) return items ?? [];
  const base = items ?? [];
  if (base.some((n) => n.id === STATS_PANEL_ID)) return base;
  return [...base, buildStatsPanel(stats)];
}