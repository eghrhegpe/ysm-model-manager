#!/usr/bin/env node
/**
 * cycles.ts — 有向图环检测共享核（DFS 三色标记）。
 *
 * 统一 check-circular.ts（前端 ESM 文件级图）与 check-circular-go.ts
 * （Go 包级图）的 findCycles 算法——此前两脚本逐行复制同一 DFS 三色实现，
 * 出现「同一算法改两遍」风险。抽核后单点修 bug。
 *
 * 语义（与两版历史行为对齐，无变更）：
 *   - 按图节点顺序做 DFS；遇到 GRAY（祖先）即得一个环；
 *   - 环以「去重 key（排序后 join）」+「原始顺序链」存入 Map，天然去重；
 *   - maxCycles 截断防稠密环区指数爆炸（枚举上限）。
 *
 * 零依赖（仅 node 内建）。
 */
/**
 * 有向图环检测（DFS 三色标记），返回环链数组。
 * @param {Map<string,string[]>} graph 邻接表：node → 依赖列表
 * @param {number} [maxCycles] 环枚举上限，防稠密环区指数爆炸（默认 100）
 * @returns {{ cycles: string[][], truncated: boolean }}
 *   cycles：每条为环上的节点顺序链（[a,b]，a 在栈中，首尾相接成环）；
 *   truncated：是否因达到 maxCycles 而截断（区别于「恰好枚举完」）。
 */
export function findCycles(graph: Map<string, string[]>, maxCycles = 100): { cycles: string[][]; truncated: boolean } {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>(); // key（排序去重）→ 原始顺序环链
  let truncated = false;

  function dfs(node: string) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        if (cycles.size >= maxCycles) { truncated = true; continue; }
        dfs(next);
      } else if (c === GRAY) {
        // 找到环：stack 中 next 位置截取，去掉首尾重复（next 即栈内起点）
        const start = stack.indexOf(next);
        if (start < 0) continue; // 防御：颜色残留兜底（正常流程 GRAY 必在栈内）
        const display = stack.slice(start); // [a, b]（a 在栈中）
        const key = [...display].sort().join('→');
        cycles.set(key, display);
        if (cycles.size >= maxCycles) truncated = true; // 枚举上限，防稠密环区指数爆炸
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      stack.length = 0;
      dfs(node);
    }
  }
  return { cycles: [...cycles.values()], truncated };
}
