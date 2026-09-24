// ===== cap-menu-trees.test.ts — cap 侧菜单树的 per-kind 字段契约门 =====
//
// 为什么单独一个文件：node-validation.test.ts 的正向门跑的是 core 面板 builder + registry，
// 而 core 面板（settings/environment）**聚合 cap 节点**——单测环境无 cap 注册时这些面板的
// cap 段为空，故 cap 自己 getMenuNodes() 产出的树（菜单节点的大头：sky/ground/water/fog/
// shadow/reflector/postprocessing/light/environment/renderMode）在那边覆盖不到。
//
// 本门经 `sceneCapabilityRegistry.createAll()` 一次性实例化全部内置 cap（清单 = 注册表底部
// `add()` 调用，新增 cap 自动纳入，无需改本文件），逐个校验 getMenuNodes() 的树。
// 与 node-validation.test.ts 同门同判据，只是数据来源换成 cap 侧；两门合起来覆盖
// 「core 手写节点 + cap 自产节点」的全量菜单树。
import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { sceneCapabilityRegistry } from "./scene-capability-registry.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { validateNodeTree } from "@/preview-3d/menu/schema/node-validation.ts";

/** 递归计数节点总数（防门空转用：树全空则门在空跑） */
function countNodes(nodes: PreviewMenuNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.children?.length) n += countNodes(node.children);
  }
  return n;
}

describe("cap 侧菜单树 per-kind 字段契约（零违规门）", () => {
  afterEach(() => sceneCapabilityRegistry.dispose());

  it("自检：本门校验器在此上下文确实生效（防 import/接线错误导致空转恒绿）", () => {
    const forged = [
      { id: "forged", kind: "divider", controls: [] } as unknown as PreviewMenuNode,
    ];
    expect(validateNodeTree(forged)).toEqual([
      { id: "forged", kind: "divider", fields: ["controls"] },
    ]);
  });

  it("全部内置 cap 的 getMenuNodes() 零 kind/字段错配", () => {
    const scene = new THREE.Scene();
    // ⚠️ 必须补 shadowMap：test-setup 的全局 Fake WebGLRenderer 无该字段，而
    // ShadowCapability 构造期读 `renderer.shadowMap.enabled`（快照旧值）→ 不补则构造抛错，
    // 被 createAll 的 try/catch 静默吞掉（ringLog warn）→ shadow 缺席且本门无声漏过。
    const renderer = new THREE.WebGLRenderer() as THREE.WebGLRenderer & {
      shadowMap: { enabled: boolean; type: number; needsUpdate: boolean };
    };
    renderer.shadowMap = { enabled: false, type: 0, needsUpdate: false };
    const camera = new THREE.PerspectiveCamera();
    const caps = sceneCapabilityRegistry.createAll({ scene, renderer, camera });

    // 防门空转①：实例数须等于注册的工厂数（免漂移——新增 cap 自动纳入要求，
    // 某 cap 构造失败即在此暴露；createAll 对单 cap 失败只 ringLog 不抛，故此处是必要断言）
    expect(
      caps.length,
      `内置 cap 应全部实例化；缺失=${caps.map((c) => c.id).join(",")}`,
    ).toBe(sceneCapabilityRegistry.getFactoryCount());

    const violations: Array<{ cap: string; id: string; kind: string; fields: string[] }> = [];
    const covered: string[] = [];
    let nodeCount = 0;
    for (const cap of caps) {
      const nodes = cap.getMenuNodes?.() ?? [];
      if (nodes.length) covered.push(cap.id);
      nodeCount += countNodes(nodes);
      for (const v of validateNodeTree(nodes)) {
        violations.push({ cap: cap.id, ...v });
      }
    }

    // 防门空转②：cap 树是菜单节点大头——每个内置 cap 都应产出菜单节点（无 UI 的 cap 不存在），
    // 数量级断言兜底「树全空则门在空跑」
    expect(
      covered.length,
      `应有全部 cap 产出菜单节点；未产出=${caps.map((c) => c.id).filter((id) => !covered.includes(id)).join(",")}`,
    ).toBe(caps.length);
    expect(nodeCount, "cap 树节点总数应达量级（防门空转）").toBeGreaterThan(50);

    expect(
      violations,
      `cap 菜单树存在 kind/字段错配：${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
