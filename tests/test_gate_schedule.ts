/**
 * gate-blocks/schedule.ts 行为契约（ADR-206 阶段 5）。
 *
 * 零子进程设计：ctx.sh / ctx.shAsync 为可替换属性（gate-ctx 的接口特征），
 * 换成内存桩即可验证调度判定链，不真跑 tsc / 契约测试。
 *
 * 运行：node tests/test_gate_schedule.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { Plan } from "../scripts/_lib/domain-classify.ts";
import {
  CI_INDEPENDENT_TOOLS,
  runContractTestsBlock,
  runScriptsTypecheck,
  runStaticToolsDispatch,
} from "../scripts/_lib/gate-blocks/schedule.ts";
import { createGateCtx, type GateCtx } from "../scripts/_lib/gate-ctx.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";

const NO_PLAN: Plan = {
  go: false,
  frontend: false,
  docs: false,
  adr: false,
  data: false,
  scripts: false,
  redlines: false,
};
const base = {
  plan: { ...NO_PLAN },
  files: [],
  byDomain: {} as Record<string, string[]>,
  pushLocalRef: "",
  pushLocalOid: "",
  pushRemoteOid: "",
};

function makeCtx(plan: Partial<Plan>, shAsyncImpl?: GateCtx["shAsync"]) {
  const ctx = createGateCtx({ ...base, plan: { ...NO_PLAN, ...plan } });
  if (shAsyncImpl) ctx.shAsync = shAsyncImpl;
  return ctx;
}

/** 注入缝桩：脱离环境（本地根装 / CI frontend 装）确定性地「假装 tsc 存在」。 */
const STUB_TSC = () => "/stub/node_modules/.bin/tsc";

// ── 1. runScriptsTypecheck：自守卫（模式不匹配 = no-op）──
{
  const ctx = makeCtx({});
  await runScriptsTypecheck(ctx, { allMode: false, docsMode: false });
  assert.equal(ctx.results.length, 0, "非 all/docs 模式不应跑 scripts typecheck");
  console.log("  ✓ runScriptsTypecheck 自守卫：非 all/docs 模式 no-op");
}

// ── 2. runScriptsTypecheck：rc=0 通过 ──
{
  const ctx = makeCtx({}, async () => ({ rc: 0, out: "" }));
  await runScriptsTypecheck(ctx, { allMode: true, docsMode: false, resolveBin: STUB_TSC });
  assert.equal(ctx.results.length, 1);
  assert.equal(ctx.results[0].ok, true);
  assert.ok(ctx.results[0].label.includes("tsc"), "label 应含 tsc");
  console.log("  ✓ runScriptsTypecheck：rc=0 → PASS");
}

// ── 3. runScriptsTypecheck：rc=2（TS18003 无输入）容忍为通过 ──
{
  const ctx = makeCtx({}, async () => ({ rc: 2, out: "" }));
  await runScriptsTypecheck(ctx, { allMode: false, docsMode: true, resolveBin: STUB_TSC });
  assert.equal(ctx.results[0].ok, true, "rc=2 应容忍为通过");
  assert.ok(ctx.results[0].note.includes("无"), "note 应说明无输入");
  console.log("  ✓ runScriptsTypecheck：rc=2（无输入）容忍为通过");
}

// ── 4. runScriptsTypecheck：rc=1 阻断 ──
{
  const ctx = makeCtx({}, async () => ({ rc: 1, out: "error TS2304: x\n" }));
  await runScriptsTypecheck(ctx, { allMode: true, docsMode: false, resolveBin: STUB_TSC });
  assert.equal(ctx.results[0].ok, false);
  assert.equal(ctx.blocked, true, "tsc 失败应置 blocked");
  console.log("  ✓ runScriptsTypecheck：rc=1 → FAIL + blocked");
}

// ── 4b. runScriptsTypecheck：tsc 缺失 → 如实 FAIL + blocked，且不 spawn（2026-09-15 CI 实证）──
// 回归背景：CI 只在 frontend/ 装依赖，硬编码根 .bin 路径 → cmd「找不到路径」。
// 缺工具必须如实阻断（否则是 fail-open 的「假绿」），并给出可执行处方。
{
  const ctx = makeCtx({}, async () => ({ rc: 0, out: "" }));
  let spawned = 0;
  ctx.shAsync = async () => {
    spawned += 1;
    return { rc: 0, out: "" };
  };
  await runScriptsTypecheck(ctx, { allMode: true, docsMode: false, resolveBin: () => null });
  assert.equal(ctx.results.length, 1);
  assert.equal(ctx.results[0].ok, false, "缺 tsc 不得记为通过（fail-open）");
  assert.equal(ctx.blocked, true, "缺 tsc 应置 blocked");
  assert.ok(ctx.results[0].note.includes("未安装"), "note 应点明工具缺失");
  assert.ok(ctx.results[0].tail.includes("pnpm install"), "tail 应给出可执行处方");
  assert.equal(spawned, 0, "缺工具时不应 spawn 子进程");
  console.log("  ✓ runScriptsTypecheck：tsc 缺失 → FAIL + blocked + 不开子进程（诊断可执行）");
}

// ── 5. runContractTestsBlock：空域 + 非 all 模式 no-op ──
{
  const ctx = makeCtx({});
  await runContractTestsBlock(ctx, { allMode: false, domains: [] });
  assert.equal(ctx.results.length, 0, "无匹配契约测试不应 record");
  console.log("  ✓ runContractTestsBlock：空域 no-op");
}

// ── 6. runStaticToolsDispatch：push 模式按 plan 补挂（docs/adr 过滤 doc-drift）──
// 此处只验证「不炸 + 空文件时不产生 FAIL」的调度语义：runTools 内部会 spawn node，
// 为避免真实子进程，传 plan 全 false → 所有分支不触发，no-op。
{
  const ctx = makeCtx({});
  runStaticToolsDispatch(ctx, { allMode: false, docsMode: false });
  assert.equal(ctx.results.length, 0, "plan 全 false 的 push 模式应 no-op");
  console.log("  ✓ runStaticToolsDispatch：plan 全 false no-op（自守卫）");
}

// ── 7. runStaticToolsDispatch：--static 模式清单（2026-09-14 锐评 P0 CI 接线）──
// 断言合并语义：ALL + DOC_EXTRA + FRONTEND 非 scoped 全量送达 ctx.sh；三档 scoped
// 扫描器（complexity/params/type-safety）必须排除（需 --files 上下文，全库跑 = 301 条
// debt 刷屏 + check-params 59.4s）；FRONTEND 档位优先（event-graph → --strict）。
{
  const ctx = makeCtx({});
  const calls: string[] = [];
  ctx.sh = (cmd: string) => {
    calls.push(cmd);
    return { rc: 0, out: '{"_summary":{"ok":true,"errors":0}}' };
  };
  runStaticToolsDispatch(ctx, { allMode: false, docsMode: false, staticMode: true });
  const all = calls.join("\n");
  for (const must of [
    "check-file-lines.ts",
    "check-biome.ts",
    "css-layer-check.ts",
    "i18n-check.ts",
    "check-script-hygiene.ts",
    "check-adr-health.ts",
    "check-knowledge-drift.ts",
    "check-doc-drift.ts",
    "check-android-unavailable.ts",
  ]) {
    assert.ok(all.includes(must), `--static 应包含 ${must}（远端兜底关键项）`);
  }
  for (const forbid of ["check-complexity.ts", "check-params.ts", "check-type-safety.ts"]) {
    assert.ok(!all.includes(forbid), `--static 应排除 ${forbid}（scopedFiles 三档）`);
  }
  assert.ok(
    /event-graph\.ts --json +--strict/.test(all),
    "FRONTEND 档位应优先（event-graph --strict 覆盖 ALL 的 --check；stagedArg 空留双空格，用正则匹配）",
  );
  assert.ok(
    ctx.results.length >= 20,
    `--static 应产生完整清单（≥20 项，实测 ${ctx.results.length}）`,
  );
  console.log(
    `  ✓ runStaticToolsDispatch：--static 清单 ${ctx.results.length} 项，关键 hard 在列、三档排除`,
  );
}

// ── 8. --static 去重：CI 已独立承担的工具不得出现在清单里（2026-10-08 锐评）──
// 病根：check-deadcode-baseline 在 test.yml frontend job 有独立步骤，--static 清单又跑一遍，
// 第二遍拿不到归属 base → 退严格模式把一切新增按阻断，与同 job 刚判过的独立步骤矛盾（假红）。
// 此处用内存桩断言「剔除真的生效」（而非只断言常量存在）。
{
  const ctx = makeCtx({});
  const calls: string[] = [];
  ctx.sh = (cmd: string) => {
    calls.push(cmd);
    return { rc: 0, out: '{"_summary":{"ok":true,"errors":0}}' };
  };
  runStaticToolsDispatch(ctx, { allMode: false, docsMode: false, staticMode: true });
  const all = calls.join("\n");
  for (const dup of CI_INDEPENDENT_TOOLS) {
    assert.ok(!all.includes(dup), `--static 不应再跑 ${dup}（CI 有独立步骤，重复执行 = 假红 + 空烧机时）`);
  }
  console.log(`  ✓ --static 去重：${CI_INDEPENDENT_TOOLS.length} 项 CI 独立工具已剔除`);
}

// ── 9. 去重清单的真实性：每个条目必须在 test.yml 里真有独立步骤（防「剔了就没人查」）──
// 反向护栏：CI_INDEPENDENT_TOOLS 是「换个地方查」的声明，不是「CI 不查」——
// 若 test.yml 的独立步骤被删/改名而本表未同步，就是纯覆盖损失（静默失守）。
{
  const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "test.yml"), "utf8");
  for (const tool of CI_INDEPENDENT_TOOLS) {
    assert.ok(
      wf.includes(`scripts/${tool}`),
      `CI_INDEPENDENT_TOOLS 登记了 ${tool}，但 test.yml 中找不到其独立步骤调用——` +
        `要么补回独立步骤，要么把它放回 --static 清单（否则 CI 完全不查这项）`,
    );
  }
  // 去重项必须真的来自静态工具清单（否则登记了一个根本不会被跑的项 = 幻影）
  const all = makeCtx({});
  const calls: string[] = [];
  all.sh = (cmd: string) => {
    calls.push(cmd);
    return { rc: 0, out: '{"_summary":{"ok":true,"errors":0}}' };
  };
  runStaticToolsDispatch(all, { allMode: true, docsMode: false });
  const allModeCalls = calls.join("\n");
  for (const tool of CI_INDEPENDENT_TOOLS) {
    assert.ok(
      allModeCalls.includes(tool),
      `${tool} 应仍在 --all/push 清单里（本地没有 CI 独立步骤，剔了就是真覆盖损失）`,
    );
  }
  console.log("  ✓ 去重口径：CI 档剔除 / --all 与 push 档保留，且每项在 test.yml 有独立步骤");
}

console.log(
  "\nOK: gate-blocks/schedule 契约（自守卫 / tsc 三态 rc + 缺失阻断 / 契约测试空域 no-op / --static 清单 / CI 去重口径）",
);
