#!/usr/bin/env node
/**
 * test_check_complexity.ts — 认知复杂度扫描器契约测试。
 *
 * 锁 `check-complexity.ts` 核心规约器 `cognitiveFromSeq` 与事件翻译 `fnBodyToEvents`：
 *   - 规约器：喂事件序列断言 { cognitive, maxNesting }（纯函数，零依赖）。
 *   - 事件翻译：喂 mock ts-morph 节点（getKindName/getChildren/getBody），断言产出的事件序列，
 *     深绑定生产实现，防「测试手抄算法」漂移。
 *
 * 运行：node tests/test_check_complexity.ts
 * 用 assert 实现（不计走测试框架）；失败 exit 1。
 */
import assert from "node:assert/strict";
import { type CxEvent, cognitiveFromSeq, fnBodyToEvents } from "../scripts/check-complexity.ts";

// ─── mock ts-morph 节点（只提供翻译层依赖的三个能力）─────────
function node(kindName: string, ...children: any[]): any {
  return {
    getKindName: () => kindName,
    getChildren: () => children,
  };
}
function fn(body: any): any {
  return { getBody: () => body };
}

// ─── 1) 规约器：扁平单 if ───────────────────────────────
{
  const seq: CxEvent[] = [{ k: "nest", kind: "if" }, { k: "nestClose" }];
  assert.deepEqual(cognitiveFromSeq(seq), { cognitive: 1, maxNesting: 1 });
}

// ─── 2) 规约器：if 内嵌 loop（嵌套加层）──────────────────
{
  const seq: CxEvent[] = [
    { k: "nest", kind: "if" }, // depth0 → +1, depth1
    { k: "nest", kind: "loop" }, // depth1 → +2, depth2
    { k: "nestClose" },
    { k: "nestClose" },
  ];
  assert.deepEqual(cognitiveFromSeq(seq), { cognitive: 3, maxNesting: 2 });
}

// ─── 3) 规约器：flat 事件即时计分 + 当前深度────────────
{
  // if{ switch } 中两个 case：if(1) → switch(+2@d1) → case(+3@d2) → case(+3@d2) = 9
  const seq: CxEvent[] = [
    { k: "nest", kind: "if" }, // 1
    { k: "nest", kind: "switch" }, // 2
    { k: "flat", kind: "case" }, // 3
    { k: "flat", kind: "case" }, // 3
    { k: "nestClose" },
    { k: "nestClose" },
  ];
  // 1 + 2 + 3 + 3 = 9
  assert.deepEqual(cognitiveFromSeq(seq), { cognitive: 9, maxNesting: 2 });
}

// ─── 4) 规约器：逻辑运算符（flat，不增层）──────────────
{
  const seq: CxEvent[] = [
    { k: "flat", kind: "logic" },
    { k: "flat", kind: "logic" },
  ];
  assert.deepEqual(cognitiveFromSeq(seq), { cognitive: 2, maxNesting: 0 });
}

// ─── 5) 规约器：复杂嵌套 3 层红档形态──────────────────
{
  const seq: CxEvent[] = [
    { k: "nest", kind: "if" }, // 1
    { k: "nest", kind: "loop" }, // +2@d1
    { k: "flat", kind: "case" }, // +3@d2
    { k: "nestClose" },
    { k: "nest", kind: "if" }, // +2@d1（外层 if 内并列第二分支）
    { k: "nestClose" },
    { k: "nestClose" },
  ];
  // 1 + 2 + 3 + 2 = 8；最深层仍是 2
  assert.deepEqual(cognitiveFromSeq(seq), { cognitive: 8, maxNesting: 2 });
}

// ─── 6) 事件翻译：无 getBody → 空序列（空体/表达式箭头）──
{
  assert.deepEqual(fnBodyToEvents(fn(null)), []);
  assert.deepEqual(fnBodyToEvents(undefined), []);
  assert.deepEqual(fnBodyToEvents({}), []);
}

// ─── 7) 事件翻译：if(cond){ } 编译成 nest/nestClose ────
{
  const cond = node("BinaryExpression");
  const body = node("Block");
  const ifStmt = node("IfStatement", cond, body);
  const seq = fnBodyToEvents(fn(ifStmt));
  assert.deepEqual(seq, [{ k: "nest", kind: "if" }, { k: "nestClose" }]);
}

// ─── 8) 事件翻译：三元 + 逻辑运算符 + else 三段 ────────
{
  const trueExpr = node("Block", node("ConditionalExpression"));
  const elseClause = node("ElseClause", node("LogicalExpression"));
  const ifStmt = node("IfStatement", node("ParenthesizedExpression"), trueExpr, elseClause);
  const seq = fnBodyToEvents(fn(ifStmt));
  // 翻译层应产出：nest(if) / flat(ternary) / flat(logic) / flat(else) 的顺序平铺 + nestClose
  const flatKinds = seq.filter((e) => e.k === "flat").map((e) => (e as { kind: string }).kind);
  // 遍历序：Block 内 ternary → ElseClause（记 else）→ 其内 logic → nestClose
  assert.deepEqual(flatKinds, ["ternary", "else", "logic"]);
  assert.ok(seq.some((e) => e.k === "nest" && (e as { kind: string }).kind === "if"));
  assert.ok(seq.some((e) => e.k === "nestClose"));
}

// ─── 9) 事件翻译：for / while / do / for-of / for-in → loop ──
{
  for (const kind of [
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "WhileStatement",
    "DoStatement",
  ]) {
    const seq = fnBodyToEvents(fn(node(kind)));
    assert.deepEqual(seq, [{ k: "nest", kind: "loop" }, { k: "nestClose" }], `kind=${kind}`);
  }
}

// ─── 10) 事件翻译：catch → nest catch；switch 不受 case 影响层数 ──
{
  const catchStmt = node("CatchClause", node("CaseBlock"));
  const seq = fnBodyToEvents(fn(catchStmt));
  const nestKinds = seq.filter((e) => e.k === "nest").map((e) => (e as { kind: string }).kind);
  assert.deepEqual(nestKinds, ["catch"]);
}

console.log("✅ test_check_complexity.ts 全部通过（10 组契约断言）");
