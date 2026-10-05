/**
 * test_check_twin_siblings.ts — check-twin-siblings.ts 纯函数核契约测试（P2② 补网）。
 *
 * 设计意图：锁死「归一化 → 抽指纹 → 同胞检索」三段纯函数语义（指纹稳定性、过滤口径、
 * MIN_HITS/MAX_HITS/MAX_CANDIDATES 阈值行为），使 git 管道与主流程可自由重构。
 * 零依赖（node:assert/strict）；import 探针导出的纯函数。
 */
import assert from "node:assert/strict";
import {
  extractShapes,
  matchShapes,
  normalizeLine,
  type AddedLine,
  type Shape,
  type TargetLine,
} from "../scripts/check-twin-siblings.ts";

// ── §1 normalizeLine：字面量→Q/N、空白折叠、标识符保留 ──
{
  assert.equal(normalizeLine('  el.setAttribute("aria-disabled", String(open));'), "el.setAttribute(Q, String(open));");
  assert.equal(normalizeLine("el.setAttribute('aria-hidden', String(open))   "), "el.setAttribute(Q, String(open))"); // 单引号同胞同指纹
  assert.equal(normalizeLine("el.setAttribute(`aria-label`, String(open));"), "el.setAttribute(Q, String(open));"); // 反引号同胞同指纹
  assert.equal(normalizeLine("if (vmd.boneCount > 42) { return; }"), "if (vmd.boneCount > N) { return; }");
  assert.equal(normalizeLine("const x = f(a, 42, 3.14, 1e3, 0x10);"), "const x = f(a, N, N, N, N);");
  assert.equal(normalizeLine("if (v2 > 10) return x;"), "if (v2 > N) return x;"); // v2 是标识符不动，10→N
  assert.equal(normalizeLine("a = `tpl ${b} c` + 1;"), "a = Q + N;"); // 模板串整段→Q
  // 同胞稳定性：仅字面量不同的两行归一化后同指纹
  assert.equal(
    normalizeLine('el.setAttribute("aria-disabled", String(open));'),
    normalizeLine('el.setAttribute("aria-hidden", String(open));'),
  );
}

// ── §2 extractShapes：过滤口径（短/无括号/注释/import/去重）+ cap ──
{
  const added: AddedLine[] = [
    { text: '  el.setAttribute("aria-disabled", String(open));', file: "a.ts", line: 5 },
    { text: "short()", file: "a.ts", line: 6 }, // 归一化 <30 → 弃
    { text: "// el.setAttribute(Q, String(open)); a long comment line", file: "a.ts", line: 7 }, // 注释 → 弃
    { text: 'import { el, setAttribute } from "./mod"; // padding line makes it long', file: "a.ts", line: 8 }, // import → 弃
    { text: "el.setAttribute('aria-hidden', String(open));", file: "b.ts", line: 9 }, // 与第 1 行同指纹 → 去重
    { text: "if (vmd.boneCount > 42) { return; }", file: "b.ts", line: 10 }, // 独立指纹
  ];
  const shapes = extractShapes(added);
  assert.equal(shapes.length, 2, "短/注释/import 行与重复指纹均应被过滤");
  assert.equal(shapes[0].shape, "el.setAttribute(Q, String(open));");
  assert.equal(shapes[0].origin, "a.ts:5");
  assert.equal(shapes[1].shape, "if (vmd.boneCount > N) { return; }");
  assert.equal(shapes[1].origin, "b.ts:10");
  // cap 截断
  assert.equal(extractShapes(added, 1).length, 1, "cap=1 只取首个指纹");
  assert.deepEqual(extractShapes([]), []);
}

// ── §3 matchShapes：MIN_HITS=2 门槛 / MAX_HITS=10 截断 / MAX_CANDIDATES=12 截断 / 目标侧同口径预筛 ──
{
  const S1 = "el.setAttribute(Q, String(open));";
  const S2 = "if (vmd.boneCount > N) { return; }";
  const targets: TargetLine[] = [
    { file: "x.ts", line: 10, text: 'el.setAttribute("aria-disabled", String(open));' },
    { file: "y.ts", line: 20, text: "el.setAttribute('aria-hidden', String(open));" },
    { file: "z.ts", line: 30, text: "el.setAttribute(Q, String(c));" }, // 不同形状（String(c) 标识符）
    { file: "z.ts", line: 31, text: "short line()" }, // 目标侧预筛弃（太短）
    { file: "z.ts", line: 32, text: "// el.setAttribute(Q, String(open)); padding padding" }, // 注释弃
    { file: "w.ts", line: 40, text: "if (vmd.boneCount > 3) { return; }" }, // 仅 1 行同胞 → 无候选
    { file: "s.ts", line: 50, text: "import { el } from './x'; // import import import padding" }, // import 弃
  ];
  const shapes: Shape[] = [
    { shape: S1, origin: "new.ts:1" },
    { shape: S2, origin: "new.ts:2" },
  ];
  const cand = matchShapes(shapes, targets);
  assert.equal(cand.length, 1, "仅 ≥2 同胞行的指纹出候选");
  assert.equal(cand[0].shape, S1);
  assert.equal(cand[0].origin, "new.ts:1");
  assert.equal(cand[0].total, 2);
  assert.deepEqual(cand[0].hits, ["x.ts:10", "y.ts:20"]);

  // MAX_HITS=10 截断：同指纹 15 行同胞 → total=15, hits=前 10
  const many: TargetLine[] = Array.from({ length: 15 }, (_, i) => ({
    file: `f${i}.ts`,
    line: i + 1,
    text: 'el.setAttribute("aria-disabled", String(open));',
  }));
  const c2 = matchShapes([{ shape: S1, origin: "n.ts:1" }], many);
  assert.equal(c2.length, 1);
  assert.equal(c2[0].total, 15);
  assert.equal(c2[0].hits.length, 10);

  // MAX_CANDIDATES=12 截断：13 个各带 2 同胞行的独立指纹 → 只出 12
  const multiShapes: Shape[] = [];
  const multiTargets: TargetLine[] = [];
  for (let i = 0; i < 13; i++) {
    multiShapes.push({ shape: `call${i}(Q, String(open${i})); // pad pad pad`, origin: `m.ts:${i}` });
    multiTargets.push(
      { file: `t${i}a.ts`, line: 1, text: `call${i}("x", String(open${i})); // pad pad pad` },
      { file: `t${i}b.ts`, line: 2, text: `call${i}('y', String(open${i})); // pad pad pad` },
    );
  }
  const c3 = matchShapes(multiShapes, multiTargets);
  assert.equal(c3.length, 12, "MAX_CANDIDATES=12 截断");

  // 空目标集 → 无候选
  assert.deepEqual(matchShapes(shapes, []), []);
}

console.log("✅ test_check_twin_siblings.ts 全部通过（归一化/过滤口径/阈值行为 锁核）");
