#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-ctx.ts 的 record() / blocked / exec 助手语义。
 *
 * 背景（ADR-206 阶段 1）：record() 的 blockPolicy 语义原先只有「对 pre-push-gate.ts
 * 源码做 grep 断言」（test_gate_policy_baseline.ts §6）——它只能证明字符串在，不能证明
 * 行为对；且 record 迁址 gate-ctx.ts 后 grep 断言即失效。本测试把门禁最核心的
 * 三条语义升级为**行为断言**：
 *
 *   1. blockPolicy 阻断矩阵：hard FAIL → 阻断；debt / failClosed FAIL → 只记录不阻断；
 *      任何 OK → 不阻断（含历史踩坑：failClosed 曾被 record 自动阻断，逼调用方绕路）
 *   2. blocked 必须是**活值 getter**——创建时取快照会恒 false → 失败检查静默放行
 *      （fail-open，与「抛错时门禁必须阻断」的 fail-closed 哲学直接冲突）
 *   3. blockPolicy 必须**落进 results 条目**——漏存则 gate-report.policyTag() 读到
 *      undefined，把所有 FAIL（含 debt 存量债）误标「本次引入」，误导 AI 归因
 *      （2026-09-13 实证：check-deadcode-baseline 标 debt 却在 FAIL 明细显示「本次引入」）
 *
 * 另锁两条执行助手契约：
 *   - gofmtCheck([]) 必须早退（裸 `gofmt -l` 无参读 stdin → 门禁挂死到超时）
 *   - shAsync 超时须标记 timedOut 且把原因写进 out（否则超时被当编译错误误报）
 *
 * 零依赖（node:assert，脚本式契约测试，由 _lib/contract-tests.ts spawn 执行）。
 */
import assert from "node:assert";
import { createGateCtx } from "../scripts/_lib/gate-ctx.ts";
// 归属标签渲染链路（record → results → formatFailSummary）是本次修复的核心价值，
// 故本测试同时消费 gate-report 的纯函数——两端一起锁（映射见 contract-tests.ts）。
import { formatFailSummary } from "../scripts/_lib/gate-report.ts";

/** 构造最小可用 ctx（plan 全 false：本测试只验 record/exec 语义，不触发任何域）。 */
function mkCtx() {
  return createGateCtx({
    plan: {
      go: false,
      frontend: false,
      data: false,
      docs: false,
      adr: false,
      contractTests: false,
      redlines: false,
    },
    byDomain: {},
    files: [],
    pushLocalRef: "",
    pushLocalOid: "",
    pushRemoteOid: "",
  });
}

// ── 1. 初始态 ──
{
  const ctx = mkCtx();
  assert.equal(ctx.blocked, false, "新建 ctx 的 blocked 应为 false");
  assert.deepEqual(ctx.results, [], "新建 ctx 的 results 应为空数组");
}

// ── 2. blockPolicy 阻断矩阵 ──
{
  const hard = mkCtx();
  hard.record("hard-fail", false);
  assert.equal(hard.blocked, true, "hard（缺省）FAIL 必须阻断");

  const debt = mkCtx();
  debt.record("debt-fail", false, { blockPolicy: "debt" });
  assert.equal(debt.blocked, false, "debt FAIL 只记录不阻断（存量债）");

  const fc = mkCtx();
  fc.record("fc-fail", false, { blockPolicy: "failClosed" });
  assert.equal(
    fc.blocked,
    false,
    "failClosed FAIL 只记录不阻断——须由调用方在 record 外单独 setBlocked（ADR-206 §2.4）",
  );

  const ok = mkCtx();
  ok.record("ok", true, { blockPolicy: "hard" });
  assert.equal(ok.blocked, false, "OK 无论 blockPolicy 都不阻断");
}

// ── 3. blocked 是活值 getter（防 fail-open 快照退化） ──
{
  const ctx = mkCtx();
  const snapshot = ctx.blocked; // 若实现是值字段，此处拷到 false 且永不更新
  assert.equal(snapshot, false);
  ctx.record("boom", false);
  assert.equal(ctx.blocked, true, "blocked 必须是活值——record 后读取应反映最新阻断态");
}

// ── 4. setBlocked 供 failClosed 特例（redlines scanHealthy=false）置阻断 ──
{
  const ctx = mkCtx();
  ctx.setBlocked(true);
  assert.equal(ctx.blocked, true, "setBlocked(true) 应置阻断");
  ctx.setBlocked(false);
  assert.equal(ctx.blocked, false, "setBlocked(false) 应复位");
}

// ── 5. blockPolicy 必须落进 results（gate-report.policyTag 的事实源） ──
{
  const ctx = mkCtx();
  ctx.record("a", false, { blockPolicy: "debt" });
  ctx.record("b", false, { blockPolicy: "failClosed" });
  ctx.record("c", false, { blockPolicy: "hard" });
  assert.equal(
    ctx.results[0]!.blockPolicy,
    "debt",
    "debt 条目必须在 results 里保留 blockPolicy（否则 FAIL 明细误标「本次引入」）",
  );
  assert.equal(ctx.results[1]!.blockPolicy, "failClosed", "failClosed 条目须保留 blockPolicy");
  assert.equal(ctx.results[2]!.blockPolicy, "hard", "hard 条目须保留 blockPolicy");
}

// ── 6. raw cap：>64KB 只留尾部且以省略号标注 ──
{
  const ctx = mkCtx();
  const big = "x".repeat(70_000) + "TAIL";
  ctx.record("big", false, { raw: big });
  const raw = ctx.results[0]!.raw ?? "";
  assert.ok(raw.startsWith("\u2026"), "raw 超 64KB 应保留尾部并以 … 前缀标注截断");
  assert.ok(raw.endsWith("TAIL"), "raw cap 必须保尾部（错误详情在末尾）");
  assert.equal(raw.length, 1 + 65_536, "raw cap 长度应为 1（…）+ 65536");

  const small = mkCtx();
  small.record("small", false, { raw: "abc" });
  assert.equal(small.results[0]!.raw, "abc", "未超限的 raw 原样保留");
}

// ── 7. gofmtCheck([]) 必须早退（裸 gofmt -l 会读 stdin 挂死门禁） ──
{
  const ctx = mkCtx();
  const t0 = Date.now();
  assert.deepEqual(ctx.gofmtCheck([]), [], "空文件列表应返回空数组");
  assert.ok(Date.now() - t0 < 1000, "gofmtCheck([]) 必须早退而非 spawn gofmt");
}

// ── 8. shAsync 超时语义：标记 timedOut + 原因写入 out ──
{
  const ctx = mkCtx();
  // 跨平台长命令：node 自身 sleep 4s，gate 侧 300ms 超时必触发。
  // 引号经 shell:true → Windows cmd.exe / POSIX sh 均可解析。
  const longCmd = `"${process.execPath}" -e "setTimeout(()=>{}, 4000)"`;
  const r = await ctx.shAsync(longCmd, { timeout: 300 });
  assert.equal(r.timedOut, true, "超时应标记 timedOut=true（否则与编译失败不可区分）");
  assert.notEqual(r.rc, 0, "被超时终止的进程退出码不应为 0");
  assert.ok(
    r.out.includes("超时"),
    "超时原因须写入 out（tail 呈现给 AI），实际: " + JSON.stringify(r.out),
  );

  // 正常短命令不应被标记超时
  const quick = await ctx.shAsync(`"${process.execPath}" -e "process.exit(0)"`, {
    timeout: 30_000,
  });
  assert.equal(quick.timedOut, false, "正常完成的命令 timedOut 应为 false");
  assert.equal(quick.rc, 0, "正常退出命令 rc 应为 0");
}

// ── 9. 归属标签端到端链路：record → results → formatFailSummary ──
// 这是第 5 组（blockPolicy 落库）的**因果终点**：落库的意义就在于让 FAIL 明细的归属标签
// 正确。2026-09-13 修复前，debt 存量债在此渲染为「本次引入」——AI 读 FAIL 块会把自己的
// 改动当成回归元凶，去修一个本就不属于自己的存量问题。
{
  const debt = mkCtx();
  debt.record("node scripts/check-deadcode-baseline.ts --json", false, { blockPolicy: "debt" });
  const debtLine = formatFailSummary(debt.results[0]!, 0, 1, true);
  assert.ok(
    debtLine.includes("[存量债]"),
    `debt FAIL 应标「存量债」，实际渲染: ${debtLine.split("\n")[0]}`,
  );
  assert.ok(
    !debtLine.includes("[本次引入]"),
    "debt FAIL 不得被标成本次引入（存量债冒充本次引入会误导 AI 归因）",
  );

  const fc = mkCtx();
  fc.record("node scripts/check-redlines.ts --json --baseline", false, {
    blockPolicy: "failClosed",
  });
  assert.ok(
    formatFailSummary(fc.results[0]!, 0, 1, true).includes("[失守]"),
    "failClosed FAIL 应标「失守」（扫描不可用，非代码问题）",
  );

  const hard = mkCtx();
  hard.record("cd frontend && npx vite build", false);
  assert.ok(
    formatFailSummary(hard.results[0]!, 0, 1, true).includes("[本次引入]"),
    "hard FAIL 在可归因模式（push/files）应标「本次引入」",
  );
  assert.ok(
    formatFailSummary(hard.results[0]!, 0, 1, false).includes("[待归因]"),
    "hard FAIL 在全扫模式（--all/--docs）应标「待归因」——不冒充本次引入",
  );
}

console.log(
  "OK: gate-ctx record/blocked/blockPolicy 落库 + 归属标签链路 + exec 助手契约（10 组断言）",
);
