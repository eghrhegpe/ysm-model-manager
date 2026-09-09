#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-report.ts —— FAIL 摘要渲染 + 错误详情提取。
 *
 * 背景（2026-09 锐评「输出运行过程而非返回信息」）：
 * 门禁 FAIL tail 曾用 slice(-12) 取原始输出末尾——JSON 输出末尾是 `}`，
 * AI 只看尾部 ~25 行不知道错在哪。契约锁死两组纯函数：
 *
 *   1. firstErrors(out, n)：JSON errors/warns_list/任意非空字符串数组 → 前 n 条；
 *      非 JSON → 原始输出末 n 行。
 *   2. formatFailSummary(item, pass, total, attributable)：FAIL 块——
 *      [FAIL][归属] 命令  pass/total 通过 耗s note / → 前 ≤4 条错误 / […还有 N 条] / 复现: 命令
 *      归属语义：debt→存量债、failClosed→失守、hard→attributable?本次引入:待归因
 *      （全扫模式无法归因，不许冒充「本次引入」）。
 *      详情优先级：raw(JSON) > 策展 tail > raw 末行 > note
 *      ——回归锚：tail 可能是 slice(-12) 的 JSON 碎片，绝不能当详情。
 *      数据透明化（2026-09）：多条错误展示前 4 条，超出加「…还有 N 条」尾行；单条 = 3 行块（与旧行为兼容）。
 *
 * 零依赖（仅 node:assert + _lib/gate-report.ts 本身）。
 * 运行：node tests/test_gate_report.ts
 */
import assert from "node:assert";
import { firstErrors, formatFailSummary } from "../scripts/_lib/gate-report.ts";
import { check, finish } from "./_lib.mts";

// ── firstErrors ──
check("firstErrors：JSON errors 数组 → 提取前 n 条", () => {
  const out = JSON.stringify({
    _summary: { errors: 3 },
    errors: ["卡A 引用不存在: x.js", "卡B 锚失效: y.ts", "卡C 漂移: z.ts"],
  });
  assert.deepEqual(firstErrors(out, 2), ["卡A 引用不存在: x.js", "卡B 锚失效: y.ts"]);
});

check("firstErrors：JSON errors 不足 n 条 → 返回实际条数", () => {
  const out = JSON.stringify({ _summary: { errors: 1 }, errors: ["唯一错误"] });
  assert.deepEqual(firstErrors(out, 5), ["唯一错误"]);
});

check("firstErrors：_summary 内 warns_list 形态 → 提取", () => {
  const out = JSON.stringify({ _summary: { ok: false, warns_list: ["文件A 违规", "文件B 违规"] } });
  assert.deepEqual(firstErrors(out, 1), ["文件A 违规"]);
});

check("firstErrors：非 JSON 输出 → 原始输出末 n 行", () => {
  assert.deepEqual(firstErrors("line1\nline2\nline3\nline4", 2), ["line3", "line4"]);
});

check("firstErrors：errors 空数组 → 回退 warns_list（不返回空）", () => {
  const out = JSON.stringify({ _summary: { errors: 0 }, errors: [], warns_list: ["w1"] });
  assert.deepEqual(firstErrors(out, 2), ["w1"]);
});

check("firstErrors：错误在任意非空字符串数组键（missing 形态）→ 泛化提取", () => {
  const out = JSON.stringify({
    _summary: { ok: false, missing: 1 },
    missing: ["experiments/fail-output-styles.ts"],
    assertionViolations: [],
    duplicates: [],
    ghosts: [],
  });
  assert.deepEqual(firstErrors(out, 1), ["experiments/fail-output-styles.ts"]);
});

check("firstErrors：数字数组键不提取（errors 键优先）", () => {
  const out = JSON.stringify({ _summary: { errors: 1 }, errors: ["真实错误"], counts: [1, 2, 3] });
  assert.deepEqual(firstErrors(out, 2), ["真实错误"]);
});

// ── formatFailSummary ──
const BASE = {
  label: "node scripts/check-knowledge-drift.ts --json",
  ok: false,
  time: 2300,
  note: "errors=3 warns=0",
};

check("formatFailSummary：归属+前 N 错+复现 块（raw JSON 供详情，2 条错误 → 4 行无尾行）", () => {
  const item = {
    ...BASE,
    tail: "",
    blockPolicy: "debt" as const,
    raw: JSON.stringify({
      _summary: { errors: 3 },
      errors: ["知识卡 animation-system.md 的 source_files 引用不存在: x.js", "卡B"],
    }),
  };
  const s = formatFailSummary(item, 16, 20, true);
  assert.ok(s.includes("[存量债]"), `应有归属标签，实际:\n${s}`);
  assert.ok(s.includes("knowledge-drift"), "应含命令");
  assert.ok(s.includes("知识卡 animation-system.md"), "应含 raw 提取的首错");
  assert.ok(s.includes("卡B"), "应含第 2 条错误（多条全列）");
  assert.ok(s.includes("复现: node scripts/check-knowledge-drift.ts --json"), "应含复现命令");
  assert.ok(s.includes("16/20"), "应含通过计数");
  assert.ok(!s.includes("还有"), "未超 cap 不应有「还有 N 条」尾行");
  assert.equal(s.split("\n").length, 4, `head + 2 详情行 + 复现 = 4 行，实际:\n${s}`);
});

check("formatFailSummary：单条错误 → 3 行块（与旧行为兼容）", () => {
  const item = {
    ...BASE,
    tail: "",
    blockPolicy: "debt" as const,
    raw: JSON.stringify({ _summary: { errors: 1 }, errors: ["唯一错误：卡A 引用不存在"] }),
  };
  const s = formatFailSummary(item, 16, 20, true);
  assert.ok(s.includes("唯一错误：卡A 引用不存在"), "应含该错误");
  assert.equal(s.split("\n").length, 3, `head + 1 详情行 + 复现 = 3 行，实际:\n${s}`);
});

check("formatFailSummary：6 条错误 → cap 4 展示 + 「还有 2 条」尾行", () => {
  const six = ["错误A", "错误B", "错误C", "错误D", "错误E", "错误F"];
  const item = {
    ...BASE,
    tail: "",
    blockPolicy: "debt" as const,
    raw: JSON.stringify({ _summary: { errors: 6 }, errors: six }),
  };
  const s = formatFailSummary(item, 16, 20, true);
  for (const e of six.slice(0, 4)) assert.ok(s.includes(e), `应展示前 4 条内的 ${e}`);
  assert.ok(!s.includes("错误E"), "cap 外错误不展示");
  assert.ok(s.includes("还有 2 条"), "应含「还有 N 条」尾行");
  assert.ok(s.includes("完整报告"), "尾行应指向完整报告");
});

check("formatFailSummary：raw(JSON) 优先于 tail 碎片（回归锚：tail 是 slice(-12) 残渣）", () => {
  const item = {
    ...BASE,
    blockPolicy: undefined,
    tail: '{\n      "assertionViolations": 0,\n      "duplicates": [],',
    raw: JSON.stringify({ _summary: { errors: 3 }, errors: ["真实首错：卡A 锚失效"] }),
  };
  const s = formatFailSummary(item, 16, 20, true);
  assert.ok(s.includes("真实首错：卡A 锚失效"), `应用 raw 的错误，实际:\n${s}`);
  assert.ok(!s.includes('"assertionViolations"'), "JSON 碎片不得出现在首错");
});

check("formatFailSummary：无 raw + 策展 tail（warns_list 预格式化）→ 跳过头部取内容行", () => {
  const item = { ...BASE, blockPolicy: undefined, tail: "warns_list:\n  - 文件A 违规详情" };
  const s = formatFailSummary(item, 16, 20, true);
  assert.ok(s.includes("文件A 违规详情"), `应取内容行，实际:\n${s}`);
  assert.ok(!s.includes("→ warns_list:"), "warns_list: 头部行不得当首错");
});

check("formatFailSummary：hard + attributable → [本次引入]", () => {
  const item = { ...BASE, blockPolicy: undefined, tail: "frontend/x.ts: 低于 60% 覆盖率" };
  assert.ok(formatFailSummary(item, 16, 20, true).includes("[本次引入]"));
});

check("formatFailSummary：hard + 全扫（!attributable）→ [待归因]（不冒充本次引入）", () => {
  const item = { ...BASE, blockPolicy: undefined, tail: "存量债错误" };
  assert.ok(formatFailSummary(item, 16, 20, false).includes("[待归因]"));
  assert.ok(!formatFailSummary(item, 16, 20, false).includes("[本次引入]"));
});

check("formatFailSummary：failClosed → [失守]", () => {
  const item = { ...BASE, blockPolicy: "failClosed" as const, tail: "rg 缺失：fail-closed 阻断" };
  assert.ok(formatFailSummary(item, 16, 20, true).includes("[失守]"));
});

check("formatFailSummary：首错过长 → 截断 ~120 字符加省略号", () => {
  const long = "很长的错误".repeat(60);
  const item = { ...BASE, blockPolicy: "debt" as const, raw: JSON.stringify({ errors: [long] }) };
  const s = formatFailSummary(item, 16, 20, true);
  assert.ok(s.length < 400, `整行不应过长，实际 ${s.length}`);
  assert.ok(s.includes("…"), "应截断");
});

finish("契约测试全过");
console.log("\n全部通过");
