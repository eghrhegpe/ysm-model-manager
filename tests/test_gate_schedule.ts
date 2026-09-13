/**
 * gate-blocks/schedule.ts 行为契约（ADR-206 阶段 5）。
 *
 * 零子进程设计：ctx.sh / ctx.shAsync 为可替换属性（gate-ctx 的接口特征），
 * 换成内存桩即可验证调度判定链，不真跑 tsc / 契约测试。
 *
 * 运行：node tests/test_gate_schedule.ts
 */
import assert from "node:assert";
import type { Plan } from "../scripts/_lib/domain-classify.ts";
import {
  runContractTestsBlock,
  runScriptsTypecheck,
  runStaticToolsDispatch,
} from "../scripts/_lib/gate-blocks/schedule.ts";
import { createGateCtx, type GateCtx } from "../scripts/_lib/gate-ctx.ts";

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
  await runScriptsTypecheck(ctx, { allMode: true, docsMode: false });
  assert.equal(ctx.results.length, 1);
  assert.equal(ctx.results[0].ok, true);
  assert.ok(ctx.results[0].label.includes("tsc"), "label 应含 tsc");
  console.log("  ✓ runScriptsTypecheck：rc=0 → PASS");
}

// ── 3. runScriptsTypecheck：rc=2（TS18003 无输入）容忍为通过 ──
{
  const ctx = makeCtx({}, async () => ({ rc: 2, out: "" }));
  await runScriptsTypecheck(ctx, { allMode: false, docsMode: true });
  assert.equal(ctx.results[0].ok, true, "rc=2 应容忍为通过");
  assert.ok(ctx.results[0].note.includes("无"), "note 应说明无输入");
  console.log("  ✓ runScriptsTypecheck：rc=2（无输入）容忍为通过");
}

// ── 4. runScriptsTypecheck：rc=1 阻断 ──
{
  const ctx = makeCtx({}, async () => ({ rc: 1, out: "error TS2304: x\n" }));
  await runScriptsTypecheck(ctx, { allMode: true, docsMode: false });
  assert.equal(ctx.results[0].ok, false);
  assert.equal(ctx.blocked, true, "tsc 失败应置 blocked");
  console.log("  ✓ runScriptsTypecheck：rc=1 → FAIL + blocked");
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

console.log("\nOK: gate-blocks/schedule 契约（自守卫 / tsc 三态 rc / 契约测试空域 no-op）");
