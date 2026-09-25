// ===== menu-test-helpers.ts — 菜单树断言 helper（ADR-311 三分法 D2）=====
//
// 为什么独立一叶而不并入 menu-test-fixtures.ts：fixtures 顶层 import
// preview-state（setSceneCapabilityLookup 副作用接线），而 fog/cap 侧大量测试跑
// `@vitest-environment node`——引 fixtures 即被拖进整条状态层依赖链（R6 反桶精神：
// 勿一根测试拉起一整个模块）。本文件零上层依赖：只有 vitest expect + schema 叶的
// collectPreviewNodeIds，任何环境的安全 import。
//
// 用法契约（详见 ADR-311 D1 三分法）：
//   行为不变量 → 逐条硬断言（control/visibleWhen/值域/i18n 不经本组 helper）；
//   成员归属   → findNodeById + childIds 配**集合**判据（仓内惯例 `.sort()).toEqual([...].sort())`
//                或 toContain / arrayContaining）；
//   顺序/计数  → 仅产品决策可写，且该行须带 `// layout-assert: <理由>` 注释
//                （check-menu-test-layout.ts 执法闸的豁免载体）。
import { expect } from "vitest";
import {
  collectPreviewNodeIds,
  type PreviewMenuNode,
} from "@/preview-3d/menu/schema/node-types.ts";

/** 树内（含 children 递归）按 id 查找；未命中即失败并报出全树 id。替代 `find(...)!` 裸
 *  bang 与 `nodes[3]!` 位置索引——菜单项增删/重排不再让测试指错或崩栈。 */
export function findNodeById(nodes: PreviewMenuNode[], id: string): PreviewMenuNode {
  const walk = (list: PreviewMenuNode[]): PreviewMenuNode | undefined => {
    for (const n of list) {
      if (n.id === id) return n;
      if (Array.isArray(n.children)) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const hit = walk(nodes);
  expect(
    hit,
    `菜单树中找不到节点 "${id}"；现有 id: ${collectPreviewNodeIds(nodes).join(", ")}`,
  ).toBeDefined();
  // expect().toBeDefined() 已收窄类型（Biome noNonNullAssertion 合规写法）
  return hit as PreviewMenuNode;
}

/** 节点直接子级的 id 数组（归属断言配集合判据，勿 toEqual 有序数组锁布局）。 */
export function childIds(node: PreviewMenuNode): string[] {
  return (node.children ?? []).map((c) => c.id);
}

/** 节点列表的 id 数组（同上，集合判据用）。 */
export function nodeIds(nodes: PreviewMenuNode[]): string[] {
  return nodes.map((n) => n.id);
}

/** 树内 id 唯一（渲染 data-testid="preview-<id>" 撞车防线）。check-menu-health 的 id
 *  唯一只按正则扫 4 个根表文件，cap 自产树 / 工厂产出够不到——本函数补运行期全覆盖。 */
export function assertNoDuplicateIds(nodes: PreviewMenuNode[]): void {
  const ids = collectPreviewNodeIds(nodes);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  expect(dups, `菜单树 id 重复（渲染 testid 撞车）: ${dups.join(", ")}`).toEqual([]);
}
