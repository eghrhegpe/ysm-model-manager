#!/usr/bin/env node
/**
 * test_complexity_parity.ts — 认知复杂度规约器 Go↔TS 契约对拍。
 *
 * 与 go/ccheck/parity_test.go 读同一份 tests/parity/go-ts-complexity.json，把同一
 * 事件序列送入 TS cognitiveFromSeq 与 Go CognitiveFromSeq，断言 (cognitive, nesting)
 * 逐字一致。防「任一端改规约器、另一端手抄漂移」——Go 端复用不了 TS 函数本体，
 * 用共享向量把『纯函数规约数学』这一可复用内核锁死。期望以本向量为权威。
 *
 * 运行：node tests/test_complexity_parity.ts（失败 exit 1；由契约测试 runner 收集）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CxEvent, cognitiveFromSeq } from "../scripts/check-complexity.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fx = JSON.parse(readFileSync(join(ROOT, "tests", "parity", "go-ts-complexity.json"), "utf8"));

interface FxCase {
  name: string;
  seq: Array<{ k: string; kind: string }>;
  cognitive: number;
  nesting: number;
}
const cases: FxCase[] = fx.reduce as FxCase[];

assert.ok(cases.length > 0, "契约向量为空（防空转守卫）");

for (const c of cases) {
  const seq: CxEvent[] = c.seq.map((e) =>
    e.k === "nest"
      ? { k: "nest", kind: e.kind as "if" | "loop" | "switch" | "catch" }
      : e.k === "flat"
        ? { k: "flat", kind: e.kind as "else" | "case" | "logic" | "ternary" }
        : { k: "nestClose" },
  );
  const got = cognitiveFromSeq(seq);
  assert.deepEqual(
    got,
    { cognitive: c.cognitive, maxNesting: c.nesting },
    `向量「${c.name}」: got ${JSON.stringify(got)}, 期望 ${c.cognitive}/${c.nesting}`,
  );
}

console.log(`✅ test_complexity_parity.ts 全部通过（${cases.length} 条向量，Go↔TS 规约器对拍）`);