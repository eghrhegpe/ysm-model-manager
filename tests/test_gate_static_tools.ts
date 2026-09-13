#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-blocks/static-tools.ts 的 runTools / runScopedDocDrift。
 *
 * 背景（ADR-206 阶段 2）：这两段执行器原先内联在 pre-push-gate.ts 的 main 闭包里，
 * 只能靠「整仓 dry-run 人工比对输出」验证——没有可注入的缝，`ctx.sh` 被 main 闭包
 * 直接捕获，测试无法替换成假 shell。搬进本模块后签名统一 `runXxx(ctx, ...)`，
 * `ctx.sh` 成为可替换属性，于是**判定链可以脱离真实子进程被测**。
 *
 * 锁定的语义（全部为行为断言，非源码 grep）：
 *   1. label 形状 = 完整可执行命令（AI 失败时可直接抄）；note 来自 _summary 计数
 *   2. blockPolicy → blocked 的端到端矩阵（hard 阻断 / debt·failClosed 只记录），
 *      且 blockPolicy **必须落进 results**（归因标签事实源，阶段 1 修复的回归锁）
 *   3. check-go-diff-coverage 在文件驱动模式必须带 --staged（否则全库 diff 误报 0%）
 *   4. scopedFiles=true 但变更集为空 → 退回全库 shell 调用（--all/--docs 向后兼容）
 *   5. scopedFiles=true 且变更集非空 → 走数组式 procRun 且 --files **真的送达脚本**：
 *      以「传不存在的文件 → matched=0 → 合法 PASS」为判别式（此刻全库扫描是 301 条
 *      errors，若 --files 丢失则必然 FAIL——该断言具备证伪力，不是恒真式）
 *   6. gen-* 自动继承 autoFix（写盘刷新后重验）；显式 autoFix:false 抑制之；
 *      刷新后仍 FAIL 时 note 必须留痕（不许把「刷过但没好」伪装成普通 FAIL）
 *   7. runScopedDocDrift 在文件集为空时早退（--all/--docs 不跑裁剪版）
 *
 * 依赖：node:assert / 被测模块 / _lib/gate-config（GateTool 形状）。
 * 用法：node tests/test_gate_static_tools.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import { runScopedDocDrift, runTools } from "../scripts/_lib/gate-blocks/static-tools.ts";
import { createGateCtx, type GateCtx } from "../scripts/_lib/gate-ctx.ts";

/** 构造最小 ctx（plan 全 false：本测试只验执行器语义，不触发任何域检查）。 */
function mkCtx(files: string[] = []): GateCtx {
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
    files,
    pushLocalRef: "",
    pushLocalOid: "",
    pushRemoteOid: "",
  });
}

/**
 * 替换 ctx.sh 为假 shell，记录收到的命令。
 * 这是本模块可测的**关键缝**：非 scoped 工具全部经 ctx.sh 执行，故判定链
 * （label / note / tail / blockPolicy → blocked）可在零子进程开销下验证。
 */
function stubSh(ctx: GateCtx, impl: (cmd: string) => { rc: number; out: string }): string[] {
  const calls: string[] = [];
  ctx.sh = (cmd: string) => {
    calls.push(cmd);
    return impl(cmd);
  };
  return calls;
}

const OK_OUT = '{"_summary":{"ok":true,"total":79,"errors":0}}';
const FAIL_OUT = '{"_summary":{"ok":false,"errors":2,"warns_list":["a.ts:1","b.ts:2"]}}';

// ── 1. label 形状 + note 来自 _summary 计数 ──
{
  const ctx = mkCtx();
  const calls = stubSh(ctx, () => ({ rc: 0, out: OK_OUT }));
  runTools(ctx, [{ tool: "check-foo.ts", blockPolicy: "hard" }]);

  assert.equal(ctx.results.length, 1, "一个工具应产生一条结果");
  assert.equal(
    ctx.results[0]!.label,
    "node scripts/check-foo.ts --json",
    "label 必须是可照抄的完整命令（缺 --json 会让 AI 手动复查拿到人读输出）",
  );
  assert.equal(ctx.results[0]!.ok, true, "_summary.ok=true 应判通过");
  assert.equal(ctx.results[0]!.note, "total=79 errors=0", "note 应携带 _summary 计数");
  assert.equal(ctx.results[0]!.time >= 0, true, "time 应为非负数");
  assert.ok(calls[0]!.includes("node scripts/check-foo.ts --json"), "应经 ctx.sh 执行");
}

// ── 2. blockPolicy → blocked 端到端矩阵，且 blockPolicy 必须落库 ──
{
  const matrix = [
    ["hard", true],
    ["debt", false],
    ["failClosed", false],
  ] as const;
  for (const [policy, expectBlocked] of matrix) {
    const ctx = mkCtx();
    stubSh(ctx, () => ({ rc: 0, out: FAIL_OUT }));
    runTools(ctx, [{ tool: "check-foo.ts", blockPolicy: policy }]);

    const r = ctx.results[0]!;
    assert.equal(r.ok, false, `${policy}: _summary.ok=false 应判失败`);
    assert.equal(
      r.blockPolicy,
      policy,
      `${policy}: blockPolicy 必须落进 results——漏存会让 gate-report 把所有 FAIL 标成「本次引入」`,
    );
    assert.equal(
      ctx.blocked,
      expectBlocked,
      `${policy}: FAIL 的阻断语义（hard 阻断 / debt·failClosed 只记录）`,
    );
    // warns_list 契约：FAIL 时 tail 优先取结构化 warns_list 摘要
    assert.ok(
      r.tail.includes("warns_list:"),
      `${policy}: FAIL 的 tail 应优先取 _summary.warns_list 摘要`,
    );
  }
}

// ── 3. check-go-diff-coverage 在文件驱动模式必须带 --staged ──
// 不带 --staged 会回退 base=origin/main 全库 diff，把并行会话的未推改动算进本次覆盖门禁，
// 纯签名重构被误报 0% 阻断（ADR-145 实证）。
{
  const ctx = mkCtx(["go/types/x.go"]);
  const calls = stubSh(ctx, () => ({ rc: 0, out: OK_OUT }));
  runTools(ctx, [{ tool: "check-go-diff-coverage.ts", blockPolicy: "hard" }]);

  assert.ok(calls[0]!.includes("--staged"), "文件驱动模式应加 --staged");
  assert.equal(
    ctx.results[0]!.label,
    "node scripts/check-go-diff-coverage.ts --json --staged",
    "label 须含 --staged（与实际执行一致）",
  );

  // push 模式（files 为空）不加 --staged：推送时本就该查全部待推改动
  const ctx2 = mkCtx([]);
  const calls2 = stubSh(ctx2, () => ({ rc: 0, out: OK_OUT }));
  runTools(ctx2, [{ tool: "check-go-diff-coverage.ts", blockPolicy: "hard" }]);
  assert.ok(!calls2[0]!.includes("--staged"), "files 为空（push 模式）不应加 --staged");
}

// ── 4. scopedFiles=true 但变更集为空 → 退回全库 shell 调用 ──
// --all / --docs 模式 files 为空，向后兼容必须保持全库扫描（不得传 --files）。
{
  const ctx = mkCtx([]);
  const calls = stubSh(ctx, () => ({ rc: 0, out: OK_OUT }));
  runTools(ctx, [{ tool: "check-complexity.ts", blockPolicy: "debt", scopedFiles: true }]);

  assert.equal(ctx.results.length, 1, "空文件集也应正常执行（退回全库）");
  assert.ok(!calls[0]!.includes("--files"), "--all/--docs 模式不得传 --files");
  assert.ok(
    !ctx.results[0]!.note.includes("--files 裁剪"),
    "未裁剪时 note 不得标注裁剪范围（否则误导 AI 以为已按变更集收窄）",
  );
}

// ── 5. scopedFiles + 非空变更集 → 数组式 procRun，且 --files 真的送达脚本 ──
// 判别式：check-complexity 全库扫描此刻是 301 条 errors（ok=false），
// 传「不存在的文件」→ matched=0 → errors=0（ok=true）。
// 若 --files 未被脚本识别/未送达，本断言必红——它不是恒真式，具备证伪力。
{
  const ctx = mkCtx(["docs/__no_such_file__.md"]);
  const calls = stubSh(ctx, () => {
    throw new Error("scoped 路径必须走数组式 procRun，不得回落 ctx.sh（shell 拼串会撞 cmd 8K 墙）");
  });
  runTools(ctx, [{ tool: "check-complexity.ts", blockPolicy: "debt", scopedFiles: true }]);

  assert.equal(calls.length, 0, "scoped 工具不得经 ctx.sh 执行");
  assert.equal(ctx.results.length, 1, "scoped 工具应产生一条结果");
  assert.equal(
    ctx.results[0]!.ok,
    true,
    "传不存在文件应为 matched=0 的合法 PASS（全库扫描此刻 301 errors；此断言可证伪 --files 丢失）",
  );
  assert.ok(
    ctx.results[0]!.note.includes("--files 裁剪"),
    "scoped 执行后 note 必须标注裁剪范围（否则 errors=0 会被误读成全库清零）",
  );
  // label 沿用全扫命令（--files 是门禁内部机制，AI 手动复查直接全扫看完整命中方向）
  assert.equal(
    ctx.results[0]!.label,
    "node scripts/check-complexity.ts --json",
    "scoped 时 label 应为全扫命令",
  );
}

// ── 6. autoFix：gen-* 自动继承 + 显式覆盖 + 刷新无效时留痕 ──
{
  // 6a. gen-* 首轮 --check FAIL → 自动写盘刷新 → 重验通过
  const ctx = mkCtx();
  let checkNo = 0;
  stubSh(ctx, (cmd) => {
    if (cmd.includes("--check")) {
      checkNo++;
      return checkNo === 1 ? { rc: 1, out: FAIL_OUT } : { rc: 0, out: OK_OUT };
    }
    return { rc: 0, out: OK_OUT }; // 写盘版（无 --check）
  });
  runTools(ctx, [{ tool: "gen-foo.ts", args: ["--check"], blockPolicy: "hard" }]);
  assert.equal(ctx.results[0]!.ok, true, "gen-* 自动继承 autoFix：刷新后重验通过应记 OK");
  assert.ok(ctx.results[0]!.note.includes("autoFix"), "note 应标明 autoFix 已刷新");
  assert.equal(ctx.blocked, false, "autoFix 成功后不应阻断");

  // 6b. 刷新后仍 FAIL：note 必须留痕（不许把「刷过但没好」伪装成普通 FAIL）
  const ctx2 = mkCtx();
  stubSh(ctx2, (cmd) =>
    cmd.includes("--check") ? { rc: 1, out: FAIL_OUT } : { rc: 0, out: OK_OUT },
  );
  runTools(ctx2, [{ tool: "gen-bar.ts", args: ["--check"], blockPolicy: "hard" }]);
  assert.equal(ctx2.results[0]!.ok, false, "重验仍失败应记 FAIL");
  assert.ok(
    ctx2.results[0]!.note.includes("autoFix 已尝试但仍 FAIL"),
    "刷新无效时必须在 note 留痕",
  );
  assert.equal(ctx2.blocked, true, "hard FAIL 仍应阻断");

  // 6c. 显式 autoFix:false 抑制 gen-* 命名约定
  const ctx3 = mkCtx();
  const calls3 = stubSh(ctx3, () => ({ rc: 1, out: FAIL_OUT }));
  runTools(ctx3, [{ tool: "gen-baz.ts", args: ["--check"], autoFix: false, blockPolicy: "debt" }]);
  assert.equal(calls3.length, 1, "autoFix:false 应抑制自动写盘重验（只跑首轮）");
}

// ── 7. runScopedDocDrift：空文件集早退 ──
{
  const ctx = mkCtx([]);
  runScopedDocDrift(ctx);
  assert.equal(ctx.results.length, 0, "files 为空应早退（--all/--docs 不跑裁剪版漂移检查）");
}

// ── 8. runScopedDocDrift：非空文件集 → 两条裁剪记录（真实脚本集成） ──
// 传不存在文件 → matched=0 → 两个漂移检查均应 PASS；若 --files 未送达（未知参数 → exit≠0）
// 则必红。label 不含 --files（AI 手动复查直接全扫）。
{
  const ctx = mkCtx(["docs/knowledge/__no_such_card__.md"]);
  runScopedDocDrift(ctx);
  assert.equal(ctx.results.length, 2, "应依次跑 doc-drift 与 knowledge-drift");
  assert.deepEqual(
    ctx.results.map((r) => r.label).sort(),
    ["node scripts/check-doc-drift.ts --json", "node scripts/check-knowledge-drift.ts --json"],
    "label 应为可照抄的全扫命令（--files 属内部裁剪机制，不上 label）",
  );
  assert.ok(
    ctx.results.every((r) => r.ok),
    "传不存在文件应为 matched=0 的合法 PASS（可证伪 --files 未送达）",
  );
}

console.log(
  "OK: static-tools runTools/runScopedDocDrift 契约（8 组断言：label/note 形状、\n" +
    "    blockPolicy→blocked 矩阵与落库、--staged、scoped 退化与送达判别、autoFix 三态、早退）",
);
