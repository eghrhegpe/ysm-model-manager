#!/usr/bin/env node
/**
 * 契约测试：ADR-232 三方向（D1/D2/D3）的可注入纯逻辑。
 *
 * 背景：2026-09-13 锐评发现 .githooks + scripts 三处结构性病灶——
 *   P1-1 并发竞态：`.git/ysm_gen_staged`（无 oid 单文件，last-writer-wins）被并发 commit
 *     互踩；/tmp/ysm_gen_to_stage.txt 亦无进程后缀。
 *   P1-3 逃生不留痕 + 文案误导：`YSM_SKIP_BIOME_LINES` / `YSM_SKIP_ANDROID` 命中时零审计；
 *     文案把「可留痕的 YSM_SKIP_*」与「零痕迹的 --no-verify」混为一谈。
 *   P1-2 审计锚点建在会消失的数据上：reconcile 以远端跟踪 reflog 为锚点，GC/新 clone 后
 *     把「正常数据缺失」误报成「--no-verify 缺口」。
 *
 * 本测试锁定的语义（行为断言，全部针对可注入纯逻辑模块，不触发 git）：
 *   D1（gen-staged-pair）：
 *     1. pairListPath 按 12 位前缀拼 oid；两不同 oid 互不覆盖（并发竞态根治）
 *     2. writePairList / readPairList / deletePairList 幂等 + 不存在返回 []
 *     3. sweepOrphanPairs 只碰 `ysm_gen_staged_*` 前缀、TTL 过期删除、新清单不动、
 *        旧单文件 `ysm_gen_staged`（无 oid 段）永不被误删
 *   D2（hook-audit）：
 *     4. appendHookAudit 追加 SKIPPED_PRECOMMIT 行（6 列格式，可 grep），不覆盖既有行
 *     5. parentOid 取前 12 位；空 oid → "none" 占位（列对齐）
 *     6. fail-open：不可写路径静默不抛
 *   D3（audit-degraded）：
 *     7. isReconcileDegraded 三退化条件（日志缺失 / 窗口空 / reflog 无 push）任一命中即退化
 *     8. 全不命中 → 非退化（走正常缺口判定，既有契约不回归）
 *
 * 依赖：node:assert / node:fs / node:os / node:path + 三个被测模块。
 * 用法：node tests/test_hooks_concurrency.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deletePairList,
  GEN_STAGED_PREFIX,
  pairListPath,
  readPairList,
  sweepOrphanPairs,
  writePairList,
} from "../scripts/_lib/gen-staged-pair.ts";
import { appendHookAudit, hookAuditFilePath } from "../scripts/_lib/hook-audit.ts";
import { isReconcileDegraded, type PushEvent } from "../scripts/_lib/audit-degraded.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";

const OID_A = "aaaaaaaaaa11";
const OID_B = "bbbbbbbbbb22";

// ============ D1：按 commit 父 oid 配对（并发竞态根治） ============
{
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-staged-pair-"));

  // 1. 路径按 12 位前缀拼
  assert.strictEqual(pairListPath(gitDir, OID_A), path.join(gitDir, `ysm_gen_staged_${OID_A.slice(0, 12)}`));
  // 长 oid 截断到 12 位（git rev-parse 给 40 位）
  assert.strictEqual(
    pairListPath(gitDir, "cccccccccccccccccccccccccccccccccccc"),
    path.join(gitDir, "ysm_gen_staged_cccccccccccc"),
  );

  // 2. 两不同 oid 互不覆盖（并发竞态根治核心断言）
  writePairList(gitDir, OID_A, ["docs/a.md", "frontend/public/locales/zh.json"]);
  writePairList(gitDir, OID_B, ["docs/b.md"]);
  assert.deepStrictEqual(readPairList(gitDir, OID_A), ["docs/a.md", "frontend/public/locales/zh.json"]);
  assert.deepStrictEqual(readPairList(gitDir, OID_B), ["docs/b.md"]);
  assert.ok(fs.existsSync(pairListPath(gitDir, OID_A)), "A 的清单不得被 B 覆盖");
  assert.ok(fs.existsSync(pairListPath(gitDir, OID_B)));

  // 3. 幂等：同 oid 重写覆盖
  writePairList(gitDir, OID_A, ["docs/a2.md"]);
  assert.deepStrictEqual(readPairList(gitDir, OID_A), ["docs/a2.md"]);

  // 4. 不存在返回 []
  assert.deepStrictEqual(readPairList(gitDir, "nonexistent000"), []);

  // 5. deletePairList 删除 + 不存在返回 false
  assert.strictEqual(deletePairList(gitDir, OID_A), true);
  assert.deepStrictEqual(readPairList(gitDir, OID_A), []);
  assert.strictEqual(deletePairList(gitDir, OID_A), false);

  // 6. 旧单文件遗留 `ysm_gen_staged`（无 oid 段）永不被 sweep 误删
  fs.writeFileSync(path.join(gitDir, "ysm_gen_staged"), "legacy\n", "utf-8");
  const now = Date.now();
  // 旧文件 mtime 设为 1 小时前（> 48h TTL 才删？不——设 1h 内保证 TTL 不触发）
  const oneHourAgo = now - 3600_000;
  fs.utimesSync(path.join(gitDir, "ysm_gen_staged"), oneHourAgo / 1000, oneHourAgo / 1000);
  // 再放一个 50h 前的孤儿（应被删）
  fs.writeFileSync(path.join(gitDir, `ysm_gen_staged_${OID_B}`), "orphan\n", "utf-8");
  const fiftyHoursAgo = now - 50 * 3600_000;
  fs.utimesSync(path.join(gitDir, `ysm_gen_staged_${OID_B}`), fiftyHoursAgo / 1000, fiftyHoursAgo / 1000);
  const removed = sweepOrphanPairs(gitDir, 48 * 3600_000, now);
  assert.strictEqual(removed.length, 1, "只应删 50h 前孤儿");
  assert.ok(removed[0]!.includes(`ysm_gen_staged_${OID_B.slice(0, 12)}`));
  assert.ok(fs.existsSync(path.join(gitDir, "ysm_gen_staged")), "旧单文件不得被误删");
  assert.strictEqual(readPairList(gitDir, OID_B).length, 0, "孤儿已删");

  // 7. 新清单（1h 内）TTL 不触发
  writePairList(gitDir, "dddddddddd33", ["x.md"]);
  const removed2 = sweepOrphanPairs(gitDir, 48 * 3600_000, now + 3600_000);
  assert.strictEqual(removed2.length, 0, "1h 内新清单不得被误清");

  fs.rmSync(gitDir, { recursive: true, force: true });
  console.log("[OK] D1 gen-staged-pair 并发配对契约通过");
}

// ============ D2：pre-commit 逃生留痕 ============
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-audit-"));
  const auditFile = hookAuditFilePath(dir);

  // 4. 追加两行不覆盖
  appendHookAudit(auditFile, { parentOid: OID_A, skipKey: "YSM_SKIP_BIOME_LINES" });
  appendHookAudit(auditFile, { parentOid: OID_B, skipKey: "YSM_SKIP_ANDROID" });
  const lines = fs.readFileSync(auditFile, "utf-8").trim().split("\n");
  assert.strictEqual(lines.length, 2, "append 不得覆盖既有行");

  // 行格式：6 列 <ts> SKIPPED_PRECOMMIT <oid12|none> <skipKey> <verdict> <counts>
  for (const line of lines) {
    const cols = line.split(" ");
    assert.strictEqual(cols.length, 6, `行应为 6 列: ${line}`);
    assert.strictEqual(cols[1], "SKIPPED_PRECOMMIT", `第 2 列应为 kind: ${cols[1]}`);
    assert.ok(!Number.isNaN(Date.parse(cols[0] ?? "")), `首列应为 ISO 时间: ${cols[0]}`);
  }
  assert.match(lines[0]!, / SKIPPED_PRECOMMIT aaaaaaaaaa11 YSM_SKIP_BIOME_LINES SKIP SKIP\/SKIP$/);
  assert.match(lines[1]!, / SKIPPED_PRECOMMIT bbbbbbbbbb22 YSM_SKIP_ANDROID SKIP SKIP\/SKIP$/);

  // 5. 长 oid 截断到 12 位
  appendHookAudit(auditFile, { parentOid: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", skipKey: "K" });
  const l3 = fs.readFileSync(auditFile, "utf-8").trim().split("\n");
  assert.match(l3[2]!, / SKIPPED_PRECOMMIT eeeeeeeeeeee K SKIP SKIP\/SKIP$/);

  // 5b. 空 oid → "none" 占位（保持列对齐，6 列不塌）
  appendHookAudit(auditFile, { parentOid: "", skipKey: "K" });
  const l4 = fs.readFileSync(auditFile, "utf-8").trim().split("\n");
  assert.match(l4[3]!, / SKIPPED_PRECOMMIT none K SKIP SKIP\/SKIP$/);

  // 6. fail-open：不可写路径静默不抛
  assert.doesNotThrow(() => appendHookAudit(path.join(dir, "no-such-dir", "x.log"), {
    parentOid: OID_A,
    skipKey: "K",
  }));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("[OK] D2 hook-audit 逃生留痕契约通过");
}

// ============ D3：reconcile 退化降级 ============
{
  const pushEvents: PushEvent[] = [
    { oid: "ffffffffffff", ref: "refs/remotes/origin/main", at: "2026-09-13T00:00:00Z" },
  ];

  // 7a. 审计日志缺失 → 退化
  let v = isReconcileDegraded({ pushEvents, facts: { auditLogExists: false, windowedAuditLines: 5 } });
  assert.strictEqual(v.degraded, true, "日志缺失必须退化");
  assert.strictEqual(v.reason, "audit-log-missing");

  // 7b. 窗口内无行 → 退化
  v = isReconcileDegraded({ pushEvents, facts: { auditLogExists: true, windowedAuditLines: 0 } });
  assert.strictEqual(v.degraded, true, "窗口空必须退化");
  assert.strictEqual(v.reason, "audit-log-empty-window");

  // 7c. reflog 无 push 条目 → 退化（GC / 新 clone）
  v = isReconcileDegraded({ pushEvents: [], facts: { auditLogExists: true, windowedAuditLines: 5 } });
  assert.strictEqual(v.degraded, true, "reflog 无 push 必须退化");
  assert.strictEqual(v.reason, "reflog-gc-or-clone");

  // 8. 全不命中 → 非退化（走正常缺口判定，既有契约不回归）
  v = isReconcileDegraded({ pushEvents, facts: { auditLogExists: true, windowedAuditLines: 3 } });
  assert.strictEqual(v.degraded, false, "数据完整时必须非退化");
  assert.strictEqual(v.reason, "");

  console.log("[OK] D3 audit-degraded 退化降级契约通过");
}

// ============ D3b：reconcile 主流程退化降级接线（gate-audit-reconcile） ============
{
  // 锁 gate-audit-reconcile.ts 的退出码契约：退化时 exit 0（观测工具，数据退化不阻断），
  // 非退化时有缺口 exit 1。用最小可观测事实验证（不触发真 git 子进程）。
  const src = fs.readFileSync(
    path.join(ROOT, "scripts", "gate-audit-reconcile.ts"),
    "utf-8",
  );
  // 退化分支必须存在：degraded 判定 + 退化时 missing 置空 + 退出码受 degraded 控制
  assert.ok(src.includes("isReconcileDegraded"), "reconcile 必须调用 isReconcileDegraded 退化判定");
  assert.ok(src.includes("degradedReason"), "--json 输出必须带 degradedReason 供消费方区分");
  assert.ok(
    /process\.exit\(!degraded\.degraded && missing\.length > 0 \? 1 : 0\)/.test(src),
    "退出码必须受 degraded 控制（退化→0，非退化+缺口→1）",
  );
  assert.ok(
    src.includes("[DEGRADED]"),
    "退化分支必须打 [DEGRADED] 行（可 grep，区别于正常 [OK]/[FAIL]）",
  );
  assert.ok(
    src.includes("SKIPPED_PRECOMMIT"),
    "已审计口径必须含 SKIPPED_PRECOMMIT（ADR-232 D2 逃生留痕纳入对账）",
  );
  console.log("[OK] D3b reconcile 退化降级接线契约通过");
}

console.log("[OK] test_hooks_concurrency.ts 全部断言通过（D1/D2/D3）");
