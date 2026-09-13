#!/usr/bin/env node
/**
 * 契约测试：gate-blocks/data-docs-domain.ts 与 gate-blocks/redlines.ts（ADR-206 阶段 3-4）。
 *
 * 这两组执行器的判定链彼此不同，且**都是显式特例**（ADR-206 §2.4 明确不塞进
 * parseToolOutput 通用契约），所以更需要行为断言把人肉记忆变成机器约束：
 *
 *   · 数据域 type-consistency：只认 `_summary.issues===0`；缺失/解析失败必须 fail-closed
 *   · 文档域 link-checker：退出码恒 0（工具特性），只认 `links_broken===0`
 *   · ADR / 发版说明 / 索引守护：天然 rc 判定，FAIL tail 尾 N 行
 *   · 红线三态：健康+零新增 → OK；健康+有新增 → **债务不阻断**；
 *     扫描不可用（scanHealthy=false）或解析失败 → **必须阻断**（failClosed 由
 *     `ctx.setBlocked` 在 record 外单独置位——这是全门禁唯一的绕路）
 *
 * 另锁两条搬移边界：
 *   · 自守卫：plan 关闭时执行器必须零副作用（不 record、不执行）
 *   · 红线的数组式传参：`--files` 必须在 args 数组里按整串传入（不得经 shell 拼串，
 *     否则撞 cmd.exe 8K 墙 → 进程起不来 → 被误判「输出解析失败」而误阻断，ADR-129 实证）
 *
 * 零依赖（node:assert，脚本式契约测试，由 _lib/contract-tests.ts spawn 执行）。
 */
import assert from "node:assert";
import type { Plan } from "../scripts/_lib/domain-classify.ts";
import {
  runAdrDomain,
  runDataDomain,
  runDocsDomain,
  runDocsIndexGuard,
} from "../scripts/_lib/gate-blocks/data-docs-domain.ts";
import { runRedlines } from "../scripts/_lib/gate-blocks/redlines.ts";
import { createGateCtx, type GateCtx } from "../scripts/_lib/gate-ctx.ts";

const NO_PLAN: Plan = {
  go: false,
  frontend: false,
  data: false,
  docs: false,
  adr: false,
  contractTests: false,
  redlines: false,
};

/** 构造 ctx：plan / files 按需覆写，其余保持最小。 */
function mkCtx({
  files = [],
  plan = {},
}: {
  files?: string[];
  plan?: Partial<Plan>;
} = {}): GateCtx {
  return createGateCtx({
    plan: { ...NO_PLAN, ...plan },
    byDomain: {},
    files,
    pushLocalRef: "",
    pushLocalOid: "",
    pushRemoteOid: "",
  });
}

/** 替换 ctx.sh 为假 shell（记录命令 → 固定/派发响应）。 */
function stubSh(ctx: GateCtx, impl: (cmd: string) => { rc: number; out: string }): string[] {
  const calls: string[] = [];
  ctx.sh = (cmd: string) => {
    calls.push(cmd);
    return impl(cmd);
  };
  return calls;
}

/** 合成红线注入器：记录收到的 args，返回预置输出。 */
function stubRedlinesRunner(out: string, rc = 0) {
  const seen: string[][] = [];
  const procRun = ((_bin: string, args: string[]) => {
    seen.push(args);
    return { ok: rc === 0, rc, out };
  }) as unknown as NonNullable<Parameters<typeof runRedlines>[1]["procRun"]>;
  return { procRun, seen };
}

// ── A. 数据域（type-consistency，只认 issues===0 的 fail-closed） ──
{
  // A1. 自守卫：plan.data=false → 零副作用
  const off = mkCtx();
  const callsOff = stubSh(off, () => ({ rc: 0, out: "{}" }));
  runDataDomain(off);
  assert.equal(off.results.length, 0, "plan.data=false 时不得产生记录");
  assert.equal(callsOff.length, 0, "plan.data=false 时不得执行子进程");

  // A2. issues===0 → 通过
  const ok = mkCtx({ plan: { data: true } });
  stubSh(ok, () => ({ rc: 0, out: '{"_summary":{"issues":0}}' }));
  runDataDomain(ok);
  assert.equal(ok.results[0]!.ok, true);
  assert.equal(ok.results[0]!.label, "node scripts/type-consistency.ts --json");
  assert.ok(ok.results[0]!.note.includes("派生链路完好"), "note 应说明派生链路状态");
  assert.equal(ok.blocked, false);

  // A3. issues>0 → FAIL 且阻断（硬错误，非债务）
  const bad = mkCtx({ plan: { data: true } });
  stubSh(bad, () => ({ rc: 0, out: '{"_summary":{"issues":3}}' }));
  runDataDomain(bad);
  assert.equal(bad.results[0]!.ok, false);
  assert.equal(bad.results[0]!.note, "3 个不一致");
  assert.equal(bad.blocked, true, "派生链路不一致必须阻断推送");

  // A4. 非 JSON 输出 → issues 为 null → fail-closed 阻断（不静默放行）
  const broken = mkCtx({ plan: { data: true } });
  stubSh(broken, () => ({ rc: 0, out: "这不是 JSON" }));
  runDataDomain(broken);
  assert.equal(broken.results[0]!.ok, false, "解析失败必须判 FAIL（fail-closed）");
  assert.ok(broken.results[0]!.note.includes("输出解析失败"), "note 须明示解析失败");
  assert.equal(broken.blocked, true, "解析失败必须阻断——扫描没跑成不等于债务");
}

// ── B. 文档域（link-checker 恒 rc 0 → 只认 links_broken；release-notes 走 rc） ──
{
  // B1. 自守卫
  const off = mkCtx();
  const callsOff = stubSh(off, () => ({ rc: 0, out: "{}" }));
  runDocsDomain(off);
  assert.equal(off.results.length, 0, "plan.docs=false 时不得产生记录");
  assert.equal(callsOff.length, 0, "plan.docs=false 时不得执行子进程");

  // B2. 全绿：两条记录、label 正确
  const ok = mkCtx({ plan: { docs: true } });
  stubSh(ok, (cmd) =>
    cmd.includes("link-checker")
      ? { rc: 0, out: '{"_summary":{"links_broken":0}}' }
      : { rc: 0, out: "releases ok" },
  );
  runDocsDomain(ok);
  assert.equal(ok.results.length, 2, "文档域应产生 2 条记录（断链 + 发版说明）");
  assert.equal(ok.results[0]!.label, "node scripts/link-checker.ts --json");
  assert.equal(ok.results[0]!.note, "全部链接有效");
  assert.equal(ok.results[1]!.label, "node scripts/release-notes-gen.ts --check");
  assert.equal(ok.blocked, false);

  // B3. 断链 > 0 → FAIL + 阻断
  const bad = mkCtx({ plan: { docs: true } });
  stubSh(bad, (cmd) =>
    cmd.includes("link-checker")
      ? { rc: 0, out: '{"_summary":{"links_broken":4}}' }
      : { rc: 0, out: "" },
  );
  runDocsDomain(bad);
  assert.equal(bad.results[0]!.ok, false);
  assert.equal(bad.results[0]!.note, "4 条断链");
  assert.equal(bad.blocked, true);

  // B4. 发版说明 FAIL → tail 取末 14 行（补写命令在尾部，必须落在阅读窗口内）
  const rn = mkCtx({ plan: { docs: true } });
  const lines20 = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  stubSh(rn, (cmd) =>
    cmd.includes("link-checker")
      ? { rc: 0, out: '{"_summary":{"links_broken":0}}' }
      : { rc: 1, out: lines20.join("\n") },
  );
  runDocsDomain(rn);
  const rnTail = rn.results[1]!.tail;
  assert.equal(rnTail.split("\n").length, 14, "FAIL tail 应取末 14 行");
  assert.ok(rnTail.startsWith("line7"), "tail 应为末尾 14 行（line7…line20）");
  assert.ok(rnTail.endsWith("line20"));
  assert.equal(rn.blocked, true);
}

// ── C. ADR 域（rc 判定，FAIL tail 尾 4 行） ──
{
  const off = mkCtx();
  const callsOff = stubSh(off, () => ({ rc: 0, out: "" }));
  runAdrDomain(off);
  assert.equal(off.results.length, 0, "plan.adr=false 时不得产生记录");
  assert.equal(callsOff.length, 0);

  const ok = mkCtx({ plan: { adr: true } });
  stubSh(ok, () => ({ rc: 0, out: "adr ok" }));
  runAdrDomain(ok);
  assert.equal(ok.results[0]!.ok, true);
  assert.equal(ok.results[0]!.label, "node scripts/adr-check.ts");
  assert.equal(ok.blocked, false);

  const bad = mkCtx({ plan: { adr: true } });
  stubSh(bad, () => ({ rc: 1, out: "l1\nl2\nl3\nl4\nl5\nl6" }));
  runAdrDomain(bad);
  assert.equal(bad.results[0]!.ok, false);
  assert.equal(bad.results[0]!.tail, "l3\nl4\nl5\nl6", "adr FAIL tail 应取末 4 行");
  assert.equal(bad.blocked, true);
}

// ── D. 索引守护（docs 或 adr 任一变更即跑） ──
{
  const off = mkCtx();
  const callsOff = stubSh(off, () => ({ rc: 0, out: "" }));
  runDocsIndexGuard(off);
  assert.equal(off.results.length, 0, "docs 与 adr 均关闭时不得产生记录");
  assert.equal(callsOff.length, 0);

  for (const plan of [{ docs: true }, { adr: true }] as Partial<Plan>[]) {
    const ctx = mkCtx({ plan });
    stubSh(ctx, () => ({ rc: 0, out: "index ok" }));
    runDocsIndexGuard(ctx);
    assert.equal(ctx.results.length, 1, `plan=${JSON.stringify(plan)} 应触发索引守护`);
    assert.equal(ctx.results[0]!.label, "node scripts/gen-docs-index.ts --check");
    assert.equal(ctx.results[0]!.ok, true);
  }

  const stale = mkCtx({ plan: { docs: true } });
  stubSh(stale, () => ({ rc: 1, out: "index stale" }));
  runDocsIndexGuard(stale);
  assert.equal(stale.results[0]!.ok, false);
  assert.equal(stale.blocked, true, "索引产物过期应阻断（pre-commit 生成物未提交）");
}

// ── E. 红线三态 + 数组式传参 ──
{
  // E1. 自守卫
  const off = mkCtx();
  const offRunner = stubRedlinesRunner("{}");
  runRedlines(off, { procRun: offRunner.procRun });
  assert.equal(off.results.length, 0, "plan.redlines=false 时不得产生记录");
  assert.equal(offRunner.seen.length, 0, "plan.redlines=false 时不得执行子进程");

  // E2. 健康 + 零新增 → OK，blockPolicy 落库为 failClosed
  const ok = mkCtx({ plan: { redlines: true } });
  const okRunner = stubRedlinesRunner(
    JSON.stringify({
      _summary: { ok: true, newViolations: 0, baselineViolations: 12, scanHealthy: true },
    }),
  );
  runRedlines(ok, { procRun: okRunner.procRun });
  assert.equal(ok.results[0]!.ok, true);
  assert.equal(ok.results[0]!.label, "node scripts/check-redlines.ts --json --baseline");
  assert.equal(ok.results[0]!.note, "红线零新增（基线 12 条）");
  assert.equal(
    ok.results[0]!.blockPolicy,
    "failClosed",
    "红线须声明 failClosed（否则「扫描不可用」会被 record 自己置成 hard 阻断 / 或债务误放行）",
  );
  assert.equal(ok.blocked, false);

  // E3. 健康 + 有新增 → **债务不阻断**（推送后修，发布前 doctor 兜底）
  const debt = mkCtx({ plan: { redlines: true } });
  const debtRunner = stubRedlinesRunner(
    JSON.stringify({
      _summary: { ok: false, newViolations: 2, baselineViolations: 12, scanHealthy: true },
      results: [
        { rule_id: "R1", name: "反桶", count: 2, violations: [{ file: "f.ts", line: 3 }] },
        { rule_id: "R2", name: "无关", count: 0, violations: [] },
      ],
    }),
  );
  runRedlines(debt, { procRun: debtRunner.procRun });
  assert.equal(debt.results[0]!.ok, false);
  assert.ok(debt.results[0]!.note.includes("2 条新增红线违规"));
  assert.ok(
    debt.results[0]!.tail.includes("[R1 反桶] f.ts:3"),
    "tail 应列出违规详情供 AI 定位方向，实际: " + JSON.stringify(debt.results[0]!.tail),
  );
  assert.ok(
    !debt.results[0]!.tail.includes("无关"),
    "count=0 的规则不应进 tail（避免噪声挤占 25 行阅读窗口）",
  );
  assert.equal(
    debt.blocked,
    false,
    "红线新增属债务：只报告不阻断（otherwise 每次推送必被存量债刷红，门禁即废）",
  );

  // E4. 扫描不可用（scanHealthy=false）→ 必须阻断（唯一绕过 record 的 setBlocked 路径）
  const dead = mkCtx({ plan: { redlines: true } });
  const deadRunner = stubRedlinesRunner(
    JSON.stringify({
      _summary: { ok: false, newViolations: 3, baselineViolations: 12, scanHealthy: false },
    }),
  );
  runRedlines(dead, { procRun: deadRunner.procRun });
  assert.ok(
    dead.results[0]!.note.includes("扫描不可用"),
    "note 须明示扫描不可用（此时 newViolations 非 null，不是解析失败）",
  );
  assert.equal(dead.blocked, true, "扫描没跑成 ≠ 债务：必须 fail-closed 阻断");

  // E5. 非 JSON 输出 → 解析失败同样 fail-closed
  const unparsable = mkCtx({ plan: { redlines: true } });
  const unparsableRunner = stubRedlinesRunner("rg: command not found");
  runRedlines(unparsable, { procRun: unparsableRunner.procRun });
  assert.ok(
    unparsable.results[0]!.note.includes("输出解析失败"),
    "解析失败的 note 必须先于 scanHealthy 判定（newV===null 是唯一标识）",
  );
  assert.equal(unparsable.blocked, true);

  // E6. 数组式传参：--files 与文件列表必须整体落在 args 数组里（不经 shell 拼串）
  const withFiles = mkCtx({ plan: { redlines: true }, files: ["a.ts", "b.ts"] });
  const withFilesRunner = stubRedlinesRunner(
    JSON.stringify({
      _summary: { ok: true, newViolations: 0, baselineViolations: 0, scanHealthy: true },
    }),
  );
  runRedlines(withFiles, { procRun: withFilesRunner.procRun });
  const args = withFilesRunner.seen[0]!;
  assert.equal(args[0], "scripts/check-redlines.ts");
  assert.ok(args.includes("--json") && args.includes("--baseline"));
  const idx = args.indexOf("--files");
  assert.ok(idx >= 0, "变更集非空时必须传 --files（否则全库比对，被存量债淹没）");
  assert.equal(
    args[idx + 1],
    "a.ts\nb.ts",
    "--files 的换行列表须作为**单个 argv 元素**传入（数组式 → 绕开 cmd.exe 8K 墙）",
  );

  const noFiles = mkCtx({ plan: { redlines: true }, files: [] });
  const noFilesRunner = stubRedlinesRunner(
    JSON.stringify({
      _summary: { ok: true, newViolations: 0, baselineViolations: 0, scanHealthy: true },
    }),
  );
  runRedlines(noFiles, { procRun: noFilesRunner.procRun });
  assert.ok(
    !noFilesRunner.seen[0]!.includes("--files"),
    "files 为空（--all/--docs）不得传 --files → 保持全库基线比对",
  );
}

console.log(
  "OK: data-docs-domain + redlines 契约（数据 fail-closed / 文档双检 / ADR rc /\n" +
    "    索引守护 / 红线三态与 setBlocked 绕路 / --files 数组式传参 / 自守卫）",
);
