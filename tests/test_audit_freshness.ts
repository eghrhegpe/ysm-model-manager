#!/usr/bin/env node
/**
 * 契约测试：scripts/audit-freshness.ts 的时效判定内核与 fail-closed 边界。
 *
 * 背景（2026-10-09 审核体系锐评 · 第四刀）：审查器假阳性 54% 的第一大成因是「孤立 commit
 * 快照」——finding 基于基线时代码，基线之后已有同源提交修掉。方法论早已写进知识卡
 * （ai-review-pitfalls「审计 commit 前先 git log 看有无同源后续提交」），但一直是散文；
 * 本工具把它变成一条口令。本测试锁定其判定的三个要害：
 *   1. classifyFiles 三分类：未动 = stable（值得逐条实证）/ 改写 = 降权 / 删除迁走 = 失效；
 *   2. 空输入/空 changed 集不误报；summarize 计数自洽；
 *   3. fail-closed 边界（CLI 退出码实测）：基线不可解析 → exit 2，**绝不**回落
 *      「全部 stable」——那等于把「判不了」冒充「判过了」，是本刀要消灭的假绿形态自己复发。
 *
 * 依赖：node:assert / node:child_process / 被测模块 / tests/_lib.mts。
 * 用法：node tests/test_audit_freshness.ts
 * 退出码：0 全绿；非 0 断言失败（check + finish 汇总裁决）。
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { classifyFiles, summarize, type FileVerdict } from "../scripts/audit-freshness.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check, finish } from "./_lib.mts";

const touch = (f: string) => (f === "a.ts" ? ["deadbeef fix: 修掉 finding"] : []);
const exists = (f: string) => f !== "gone.ts";

check("classifyFiles：三分类（stable / rewritten / deleted）", () => {
  const changed = new Set(["a.ts", "gone.ts"]);
  const vs = classifyFiles(["a.ts", "b.ts", "gone.ts"], changed, touch, exists);
  const byFile = Object.fromEntries(vs.map((v) => [v.file, v])) as Record<string, FileVerdict>;
  assert.strictEqual(byFile["a.ts"]!.verdict, "rewritten", "基线后被改写 ⇒ 降权");
  assert.deepStrictEqual(byFile["a.ts"]!.laterCommits, ["deadbeef fix: 修掉 finding"], "降权必须带证据提交");
  assert.strictEqual(byFile["b.ts"]!.verdict, "stable", "未动 ⇒ finding 可信");
  assert.deepStrictEqual(byFile["b.ts"]!.laterCommits, []);
  assert.strictEqual(byFile["gone.ts"]!.verdict, "deleted", "文件已删/迁走 ⇒ finding 失效（不同于降权）");
});

check("summarize：demote = 非 stable 计数，total 自洽", () => {
  const vs: FileVerdict[] = [
    { file: "a", verdict: "stable", laterCommits: [] },
    { file: "b", verdict: "rewritten", laterCommits: [] },
    { file: "c", verdict: "deleted", laterCommits: [] },
  ];
  assert.deepStrictEqual(summarize(vs), { total: 3, stable: 1, demote: 2 });
  assert.deepStrictEqual(summarize([]), { total: 0, stable: 0, demote: 0 });
});

check("CLI：基线不可解析必须 exit 2（fail-closed，拒绝冒充「全部 stable」）", () => {
  const r = spawnSync(process.execPath, ["scripts/audit-freshness.ts", "--base", "definitely-not-a-ref", "--files", "x.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 2, `应 exit 2，实为 ${r.status}；stderr=${r.stderr}`);
  assert.match(r.stderr, /基线不可解析|拒绝/);
  // 假绿防线：失败路径不得输出 stable 判定
  assert.doesNotMatch(r.stdout, /稳定（finding 可信）/);
});

check("CLI：真实基线跑通全链（HEAD~1，机读 JSON 形状稳定）", () => {
  const r = spawnSync(process.execPath, ["scripts/audit-freshness.ts", "--base", "HEAD~1", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, `exit=${r.status} stderr=${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.ok(j._summary.ok, "情报型恒 ok:true（判定信息在 counts 里，不在闸语义里）");
  assert.ok(typeof j._summary.filesChangedSinceBase === "number");
});

finish("test_audit_freshness.ts 全部断言通过");
