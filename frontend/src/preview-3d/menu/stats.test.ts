// 覆盖：统计面板节点构造（buildStatsPanel）+ 与适配器 menuItems 合并（mergeStatsMenuItems）。
// ADR-131 P1：核心 post-build 挂点用「sceneBaseline 差量 roots → collectSceneStats →
// 合并注入 menuItems」，统计面板走声明式 PreviewMenuNode（panel + field 行），
// visibleWhen 守卫有统计才显示（可被所有数组类菜单调用，铁律）。

import { describe, expect, it } from "vitest";
import type { SceneStats } from "../scene-stats.ts";
import { buildStatsPanel, mergeStatsMenuItems } from "./stats.ts";
import type { PreviewMenuNode } from "./node-types.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";

function stats(overrides: Partial<SceneStats> = {}): SceneStats {
  return {
    boneCount: 2,
    meshCount: 3,
    triangleCount: 120,
    materialCount: 4,
    textureCount: 1,
    morphCount: 0,
    ...overrides,
  };
}

describe("buildStatsPanel", () => {
  it("panel + 6 个 field 行（骨骼/网格/三角面/材质/纹理/表情）", () => {
    const panel = buildStatsPanel(stats());
    expect(panel.kind).toBe("panel");
    expect(panel.icon).toBe("📊");
    expect(panel.dockGroup).toBe("model");
    expect(panel.id).toBe("stats-panel");
    expect(panel.children).toHaveLength(6);
    const fields = panel.children!;
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual([
      "stat-bones",
      "stat-meshes",
      "stat-triangles",
      "stat-materials",
      "stat-textures",
      "stat-morphs",
    ]);
    // field 行的值对（labelKey + value）
    const bones = fields.find((f) => f.id === "stat-bones")!;
    expect(bones.kind).toBe("field");
    expect(bones.labelKey).toBe("preview.stats.bones");
    expect(bones.value).toBe(2);
    const tri = fields.find((f) => f.id === "stat-triangles")!;
    expect(tri.value).toBe(120);
  });

  it("visibleWhen：有嵌套统计（mesh/bone > 0）→ true", () => {
    const panel = buildStatsPanel(stats({ meshCount: 1, boneCount: 0 }));
    expect(panel.visibleWhen!(null as unknown as PreviewSnapshot)).toBe(true);
  });

  it("visibleWhen：全空统计（无 mesh 无 bone）→ false", () => {
    const panel = buildStatsPanel(stats({ meshCount: 0, boneCount: 0 }));
    expect(panel.visibleWhen!(null as unknown as PreviewSnapshot)).toBe(false);
  });

  it("i18n 缺失回退：labelKey 存在，fallback 非空（tr 兜底链路）", () => {
    const panel = buildStatsPanel(stats());
    for (const f of panel.children!) {
      expect(f.labelKey).toMatch(/^preview\.stats\./);
      expect(f.fallback).toBeTruthy();
    }
  });
});

describe("mergeStatsMenuItems", () => {
  it("适配器无 menuItems + 有统计 → 仅统计面板", () => {
    const merged = mergeStatsMenuItems(null, stats());
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("stats-panel");
  });

  it("有统计 → 追加到适配器 menuItems 之后，不覆盖", () => {
    const adapterItems: PreviewMenuNode[] = [
      { id: "layers", kind: "panel", icon: "⛰️", labelKey: "x", fallback: "分层" },
    ];
    const merged = mergeStatsMenuItems(adapterItems, stats());
    expect(merged).toHaveLength(2);
    expect(merged[0]!.id).toBe("layers");
    expect(merged[1]!.id).toBe("stats-panel");
    // 不修改入参数组（纯函数）
    expect(adapterItems).toHaveLength(1);
  });

  it("无统计（全 0）→ 仅保留适配器项，不注入统计面板", () => {
    const adapterItems: PreviewMenuNode[] = [
      { id: "layers", kind: "panel", icon: "⛰️", labelKey: "x", fallback: "分层" },
    ];
    const merged = mergeStatsMenuItems(adapterItems, stats({ meshCount: 0, boneCount: 0 }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("layers");
  });

  it("幂等保护：入参已含 stats-panel（id 去重）→ 不重复追加", () => {
    // 审核 nit：防日后多调用点重复注入（现仅 mount3D + switch 两处互斥调用）
    const existing: PreviewMenuNode[] = [
      { id: "layers", kind: "panel", icon: "⛰️", labelKey: "x", fallback: "分层" },
      { id: "stats-panel", kind: "panel", icon: "📊", labelKey: "x", fallback: "渲染实测", children: [] },
    ];
    const merged = mergeStatsMenuItems(existing, stats());
    expect(merged).toHaveLength(2);
    expect(merged.filter((n) => n.id === "stats-panel")).toHaveLength(1);
    // 不修改入参（纯函数）
    expect(existing).toHaveLength(2);
  });
});