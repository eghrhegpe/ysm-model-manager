/**
 * foldMolangConstant 价值实证 bench。
 * 问题：正则常量折叠（窄模式）是否值得存在，还是直接 compileMolang 一把梭？
 * 口径：折叠发生在动画 JSON 解析期（每轴字符串一次），编译同理；求值才在每帧发生。
 * 因此对比「折叠 3 正则 + Number()」vs「compileMolang 全量编译」的解析期开销。
 *
 * 运行：cd frontend && node src/utils/animation/bench-fold-molang.ts
 */
import { compileMolang } from "./molang.ts";
import { foldMolangConstant } from "./animation.ts";

// 真实分布样本：折叠可命中的模式 + 折叠不命中必须走编译的动态式
const FOLDABLE = [
  "q.life_time * 0 + 30",
  "math.sin(0) * 0 + 45",
  "q.mod_var * 0 - 12.5",
  "30 + q.life_time * 0",
  "-7.5",
  "42",
];
const DYNAMIC = [
  "query.anim_time * 10",
  "q.life_time > 1 ? 10 : -10",
  "math.sin(query.anim_time * 360) * 45",
  "query.mod_expanded_query + 7",
];

function bench(name: string, fn: () => void, iters: number): number {
  // 预热
  for (let i = 0; i < Math.min(1000, iters); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = performance.now() - t0;
  const perOp = (ms / iters) * 1e6; // ns/op
  console.log(`${name.padEnd(46)} ${perOp.toFixed(0).padStart(8)} ns/op  (${iters} iters)`);
  return perOp;
}

const N = 100_000;
console.log("== 解析期：单轴字符串处理一次的成本 ==\n");

const foldNs = bench("foldMolangConstant（6 样本轮转，含命中/不命中）", () => {
  for (const s of FOLDABLE) foldMolangConstant(s);
}, N);

const compFoldNs = bench("compileMolang（同 6 样本，若不做折叠全走编译）", () => {
  for (const s of FOLDABLE) compileMolang(s);
}, N);

bench("compileMolang（4 动态样本，折叠救不了）", () => {
  for (const s of DYNAMIC) compileMolang(s);
}, N);

console.log("\n== 结论口径 ==");
console.log(`折叠 vs 编译（可折叠样本）: ${(compFoldNs / foldNs).toFixed(0)}x`);
console.log(
  `动画解析场景（20% 可折叠）省下的解析时间 ≈ ` +
    `${(((compFoldNs - foldNs) * FOLDABLE.length * 0.2) / 1e6).toFixed(1)} ms / 万轴次`,
);
