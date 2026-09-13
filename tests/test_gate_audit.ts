#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-audit.ts 的审计留痕（锐评 P1）。
 *
 * 锁定的语义（行为断言）：
 *   1. appendGateAudit 按注入路径追加（不覆盖既有内容）——审计是 append-only 流
 *   2. 行格式：`<ISO 时间> <PUSH|SKIPPED> <oid> <verdict> <counts> <remote>`（可 grep）
 *   3. 判定字段顺序稳定（机器解析契约）；verdict/counts 来自调用方，模块不臆造
 *   4. 注入不可写路径时静默失败不抛错（审计层 fail-open，不阻断推送）
 *
 * 依赖：node:assert / node:fs / node:os / node:path / 被测模块。
 * 用法：node tests/test_gate_audit.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendGateAudit } from "../scripts/_lib/gate-audit.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-audit-test-"));
const file = path.join(dir, "audit.log");

// 1+2+3. 追加两行：不覆盖、格式稳定
appendGateAudit(file, {
  kind: "PUSH",
  localOid: "1234567890ab",
  verdict: "PASS",
  counts: "29/31",
  remote: "origin",
});
appendGateAudit(file, {
  kind: "SKIPPED",
  localOid: "deadbeefcafe",
  verdict: "SKIP",
  counts: "SKIP/SKIP",
  remote: "origin",
});
const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
assert.strictEqual(lines.length, 2, "append 不得覆盖既有行");

for (const line of lines) {
  const cols = line.split(" ");
  // <ts> <kind> <oid> <verdict> <counts> <remote> = 6 列
  assert.strictEqual(cols.length, 6, `行应为 6 列: ${line}`);
  assert.ok(!Number.isNaN(Date.parse(cols[0])), `首列应为 ISO 时间: ${cols[0]}`);
  assert.ok(["PUSH", "SKIPPED"].includes(cols[1]), `第二列应为 kind: ${cols[1]}`);
}

assert.match(lines[0], / PUSH 1234567890ab PASS 29\/31 origin$/);
assert.match(lines[1], / SKIPPED deadbeefcafe SKIP SKIP\/SKIP origin$/);

// 4. fail-open：不可写路径静默
appendGateAudit(path.join(dir, "no-such-dir", "x.log"), {
  kind: "PUSH",
  localOid: "x",
  verdict: "PASS",
  counts: "1/1",
  remote: "origin",
});

fs.rmSync(dir, { recursive: true, force: true });
console.log("[OK] test_gate_audit.ts 全部断言通过");
