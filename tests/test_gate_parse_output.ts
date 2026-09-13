#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-parse.ts 的 parseToolOutput 行为。
 *
 * 背景（锐评三刀 #3）：pre-push-gate.ts 内联了 11 处 JSON.parse + _summary 判定，
 * runTools / runScopedDocDrift / 5 个域检查各自手写一套 try/parse/ok 判定——
 * 判定口径一旦漂移（一处用 _summary.ok、一处用 errors、一处退回 rc），
 * 门禁的「fail 时可靠错误信息」承诺就塌了。本契约锁死共享函数的判定语义：
 *
 *   1. _summary.ok 为 boolean → 以它为准（最高优先级）
 *   2. 否则 _summary.errors 为 number → errors===0 判定
 *   3. 否则退回 rc===0（非 JSON 输出 / 无结构化契约）
 *   4. 解析失败时 note 必须说明「非 JSON 回退」，不许静默假绿
 *   5. warns_list 数组 → 提取为 tail 摘要（FAIL 可读性）
 *   6. _summary.degraded=true → note 追加 degraded（「扫描跳过」≠「扫描通过」）
 *
 * 另锁生产端 buildScanVerdict 与消费端 parseToolOutput 的**往返一致性**——
 * 档位扫描器把判定写进 _summary.ok/errors 才会被门禁读到（写顶层 ok 会被
 * `_summary || parsed` 短路，2026-09-13 三脚本接线前的实证缺陷）。
 *
 * 零依赖（仅 node:assert + _lib/gate-parse.ts 本身）。
 * 运行：node tests/test_gate_parse_output.ts
 */
import assert from "node:assert";
import {
  buildScanVerdict,
  parseToolOutput,
  tryParseJson,
  tryParseSummary,
  WARNS_TOP_N,
} from "../scripts/_lib/gate-parse.ts";
import { check, finish } from "./_lib.mts";

check("_summary.ok=true → ok=true，note 含计数键", () => {
  const r = parseToolOutput(JSON.stringify({ _summary: { ok: true, total: 79, errors: 0 } }), 0);
  assert.equal(r.ok, true, "_summary.ok=true → ok 应为 true");
  assert.ok(r.note.includes("total=79"), `note 应含计数键，实际: ${r.note}`);
});

check("_summary.ok=false → ok=false（即使 rc=0 也不放行）", () => {
  const r = parseToolOutput(JSON.stringify({ _summary: { ok: false, errors: 2 } }), 0);
  assert.equal(r.ok, false, "_summary.ok=false 优先于 rc=0");
  assert.ok(r.note.includes("errors=2"), `note 应含 errors 计数，实际: ${r.note}`);
});

check("无 _summary.ok 时用 errors===0 判定", () => {
  const r = parseToolOutput(JSON.stringify({ _summary: { errors: 3 } }), 0);
  assert.equal(r.ok, false, "errors=3 → ok 应为 false");
});

check("非 JSON 输出 → 退回 rc 判定，且 note 明示非 JSON 回退", () => {
  const okR = parseToolOutput("纯文本通过输出", 0);
  assert.equal(okR.ok, true, "rc=0 + 非 JSON → ok=true");
  const failR = parseToolOutput("纯文本失败输出", 1);
  assert.equal(failR.ok, false, "rc=1 + 非 JSON → ok=false");
  assert.ok(failR.note.includes("非 JSON"), `note 应明示非 JSON 回退，实际: ${failR.note}`);
});

check("warns_list → tail 提取为摘要（FAIL 可读性）", () => {
  const r = parseToolOutput(
    JSON.stringify({
      _summary: { ok: false, errors: 1, warns_list: ["文件A 违规", "文件B 违规"] },
    }),
    0,
  );
  assert.ok(r.tail.includes("文件A 违规"), `tail 应含 warns_list 摘要，实际: ${r.tail}`);
  assert.ok(r.tail.includes("文件B 违规"), "tail 应含全部 warn 项");
});

check("warns_list 为空 → tail 为空串", () => {
  const r = parseToolOutput(
    JSON.stringify({ _summary: { ok: false, errors: 1, warns_list: [] } }),
    0,
  );
  assert.equal(r.tail, "", "空 warns_list → tail 应为空（由调用方回退原始输出尾部）");
});

check("ok=true 时不提取 tail（PASS 不需要详情）", () => {
  const r = parseToolOutput(
    JSON.stringify({ _summary: { ok: true, warns_list: ["不应出现的"] } }),
    0,
  );
  assert.equal(r.tail, "", "ok=true → tail 应为空");
});

check("JSON 但无 _summary 且无 errors → 退回 rc 判定", () => {
  const r = parseToolOutput(JSON.stringify({ some: "json", without: "contract" }), 0);
  assert.equal(r.ok, true, "无 _summary 契约 → 退回 rc=0 → ok=true");
});

// ── tryParseSummary / tryParseJson：域检查块与特殊块的解析收敛 ──
check("tryParseSummary：提取 _summary，解析失败/无 _summary → null", () => {
  assert.deepEqual(
    tryParseSummary(JSON.stringify({ _summary: { issues: 3 } })),
    { issues: 3 },
    "应提取 _summary",
  );
  assert.equal(tryParseSummary("非 JSON"), null, "解析失败 → null");
  assert.equal(tryParseSummary(JSON.stringify({ no: "summary" })), null, "无 _summary 键 → null");
});

check("tryParseJson：返回整对象，解析失败 → null", () => {
  assert.deepEqual(
    tryParseJson(JSON.stringify({ _summary: { ok: true }, results: [1] })),
    {
      _summary: { ok: true },
      results: [1],
    },
    "应返回整对象",
  );
  assert.equal(tryParseJson("非 JSON"), null, "解析失败 → null");
});

check("fail-closed 语义：issues 提取在解析失败时应为 null（≠0，阻断而非放行）", () => {
  // 镜像 pre-push-gate 数据/文档域的 issues/broken 提取：解析失败 → null → ok=false（fail-closed）。
  const issues = tryParseSummary("非 JSON")?.issues ?? null;
  assert.equal(issues, null, "解析失败 → issues=null → 判定 issues===0 为 false → 阻断");
  const broken = tryParseSummary("非 JSON")?.links_broken ?? null;
  assert.equal(broken, null, "解析失败 → broken=null → 判定 broken===0 为 false → 阻断");
});

check("degraded=true → note 追加 degraded 标记（扫描跳过不得与通过同形）", () => {
  const r = parseToolOutput(
    JSON.stringify({ _summary: { ok: true, errors: 0, degraded: true, skippedDueToNoTsMorph: true } }),
    0,
  );
  assert.equal(r.ok, true, "degraded 不置红灯（仓库约定），由调用方决定是否接受");
  assert.ok(r.note.includes("degraded"), `note 应留痕 degraded，实际: ${r.note}`);
});

// ── 生产端 buildScanVerdict ↔ 消费端 parseToolOutput 往返 ──
check("buildScanVerdict PASS：ok=true、errors=0、不写 warns_list", () => {
  const v = buildScanVerdict(0, ["不该出现的明细"]);
  assert.deepEqual(v, { ok: true, errors: 0 }, "PASS 应精简（无 warns_list）");
  const r = parseToolOutput(JSON.stringify({ _summary: v }), 0);
  assert.equal(r.ok, true, "PASS 往返后仍 ok=true");
  assert.equal(r.tail, "", "PASS 不应产生 tail");
});

check("buildScanVerdict FAIL：往返后门禁读到 ok=false + warns_list→tail（防顶层 ok 短路）", () => {
  // 回归锁：原三脚本把 ok 写顶层、_summary 内无 ok → parseToolOutput 的 `_summary || parsed`
  // 短路后恒退回 rc，而它们 rc 恒 0 → 静默假绿。此断言确保判定字段确实在 _summary 内。
  const v = buildScanVerdict(2, ["views/a.ts:120 foo 认知81", "views/b.ts:44 bar 认知60"]);
  assert.equal(v.ok, false, "errors>0 → ok=false");
  assert.deepEqual(v.warns_list?.length, 2, "warns_list 应含全部明细");
  const r = parseToolOutput(JSON.stringify({ ok: true, _summary: v }), 0);
  assert.equal(r.ok, false, "顶层 ok=true 不得掩盖 _summary.ok=false");
  assert.ok(r.note.includes("errors=2"), `note 应含 errors=2，实际: ${r.note}`);
  assert.ok(r.tail.includes("views/a.ts:120"), `tail 应含明细，实际: ${r.tail}`);
});

check("buildScanVerdict FAIL：warns_list 按 WARNS_TOP_N 截断（门禁 tail 窗口有限）", () => {
  const many = Array.from({ length: WARNS_TOP_N + 5 }, (_, i) => `明细${i}`);
  const v = buildScanVerdict(many.length, many);
  assert.equal(v.errors, WARNS_TOP_N + 5, "errors 保留总数，不受截断影响");
  assert.equal(v.warns_list?.length, WARNS_TOP_N, `warns_list 应截断到 ${WARNS_TOP_N}`);
  assert.equal(v.warns_list?.[0], "明细0", "截断应保留前 N 条（最严重者，由调用方排序）");
});

finish("契约测试全过");
console.log("\n全部通过");
