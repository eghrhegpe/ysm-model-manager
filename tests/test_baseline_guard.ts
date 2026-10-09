#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/baseline-guard.ts —— 「基线是否有意义」的单一判据。
 *
 * 背景（2026-10-09 审核体系锐评 · 第二刀）：
 *   假绿的第一大成因不是判据写错，而是**判据的输入为空却与真通过同形**。最典型实例：
 *   CI 在 push 之后跑，`origin/main` 与 `HEAD` 同一提交 ⇒ diff 为空 ⇒ 门禁输出「本次无改动
 *   源码。通过。」exit 0（run 37806261054，前后端两个 diff-coverage 门禁同时中招）。
 *   修补后那段 27 行守卫被**逐字复制成两份**——本测试的第一职责就是钉死「只有一份实现」：
 *
 *     1. 判据矩阵（纯函数）：filesMode 跳过 / HEAD 不可解析 / 基线不可达 /
 *        同一 oid（假绿高危）/ staged·uncommitted 豁免同一性 / 正常基线放行；
 *     2. wiring 反向锚：两个 diff-coverage 门禁必须 import 并调用本守卫，
 *        且**不得再出现内联的判据文案**——重新内联 = 又出现第二份实现 = 本测试先红。
 *
 * 依赖：node:assert / node:fs / node:path / 被测模块 / _lib/scan-files。
 * 用法：node tests/test_baseline_guard.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（check + finish 汇总裁决）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { checkBaselineMeaningful, CHANGED_NULL_REASON } from "../scripts/_lib/baseline-guard.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check, finish } from "./_lib.mts";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

/** 便捷构造：默认「非 staged、非 uncommitted、非 files 模式」的常规门禁调用。 */
const call = (over: Partial<Parameters<typeof checkBaselineMeaningful>[0]> = {}) =>
  checkBaselineMeaningful({
    headOid: HEAD,
    baseOid: BASE,
    base: "origin/main",
    staged: false,
    uncommitted: false,
    ...over,
  });

check("放行：正常基线（oid 不同）→ ok", () => {
  assert.deepStrictEqual(call(), { ok: true });
});

check("放行：--files 模式无 git 上下文 → ok（不得误伤）", () => {
  assert.deepStrictEqual(call({ filesMode: true, headOid: null, baseOid: null }), { ok: true });
});

check("放行：--staged 与基线同 oid 属合法（比的是索引）", () => {
  assert.deepStrictEqual(call({ staged: true, baseOid: null, headOid: HEAD, base: "HEAD" }), {
    ok: true,
  });
});

check("放行：--uncommitted 与基线同 oid 属合法（比的是工作区）+ 基线可达性仍查", () => {
  // 同一性判据对 --uncommitted 豁免：比较对象是工作区，基线同 oid 不代表变更集为空。
  assert.deepStrictEqual(call({ uncommitted: true, baseOid: HEAD, headOid: HEAD }), { ok: true });
  // 但可达性判据**不**豁免（刻意保留既有语义）：--uncommitted 仍会用 base 做 rename 配对
  // （detectRenames(base, head, staged)），基线不可达则配对失真 → 仍需报错。
  const v = call({ uncommitted: true, baseOid: null, base: "origin/main" });
  assert.strictEqual(v.ok, false);
  assert.match((v as { reason: string }).reason, /基准分支不可达/);
  // 反向锚：只有 --staged 才是「完全不需要基线」的形态
  assert.deepStrictEqual(call({ staged: true, baseOid: null }), { ok: true });
});

check("拒绝：HEAD 不可解析 → 报「无法解析 HEAD」（最根因优先）", () => {
  const v = call({ headOid: null });
  assert.strictEqual(v.ok, false);
  assert.match((v as { reason: string }).reason, /无法解析 HEAD/);
  // 根因优先：HEAD 缺失时不应改报基线问题（否则 AI 会去 fetch 一个无辜的远端）
  assert.doesNotMatch((v as { reason: string }).reason, /基准分支不可达|基线无意义/);
});

check("拒绝：基线不可达 → 报「基准分支不可达」+ fetch/--base 指引", () => {
  const v = call({ baseOid: null, base: "origin/main" });
  assert.strictEqual(v.ok, false);
  const reason = (v as { reason: string }).reason;
  assert.match(reason, /基准分支不可达/);
  assert.match(reason, /origin\/main/);
  assert.match(reason, /git fetch|--base/);
});

check("拒绝：基线 == HEAD（假绿高危）→ 报文必须点明成因与出路", () => {
  const v = call({ baseOid: HEAD, base: "origin/main" });
  assert.strictEqual(v.ok, false);
  const reason = (v as { reason: string }).reason;
  assert.match(reason, /基线无意义/, "既有契约测试锚定的文案不得漂移");
  assert.match(reason, /与 HEAD 是同一提交/);
  assert.match(reason, /变更集必为空/);
  assert.match(reason, new RegExp(HEAD.slice(0, 12)), "必须给出同 oid 的短哈希（可核证）");
  assert.match(reason, /--uncommitted|--staged|changes/, "必须给出出路，不能只说『错了』");
});

check("拒绝：--base HEAD 但 oid 比对而非字符串比对（origin/main 与 HEAD 字面不同、同 oid 照样拦）", () => {
  const v = call({ baseOid: HEAD, base: "origin/main" });
  assert.strictEqual(v.ok, false, "字面不同不是放行理由——判据必须落在 commit oid 上");
  // 反向：字面相同但 oid 不同（如远端已前进）必须放行，不能靠字面匹配误伤
  assert.deepStrictEqual(call({ base: "HEAD", baseOid: BASE }), { ok: true });
});

check("文案单一事实源：CHANGED_NULL_REASON 点明「拒绝空跑放行」", () => {
  assert.match(CHANGED_NULL_REASON, /git diff 执行失败/);
  assert.match(CHANGED_NULL_REASON, /拒绝空跑放行/);
});

// ── wiring 反向锚（本测试的核心职责：防「第二份实现」回流）────────────────────
check("wiring：两个 diff-coverage 门禁都 import 并调用共享守卫，且无内联判据文案", () => {
  const consumers = ["scripts/check-diff-coverage.ts", "scripts/check-go-diff-coverage.ts"];
  for (const rel of consumers) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(
      src,
      /from "\.\/_lib\/baseline-guard\.ts"/,
      `${rel}: 必须 import 共享守卫（只修一处 = 假绿回流）`,
    );
    assert.match(src, /checkBaselineMeaningful\(/, `${rel}: 必须真的调用共享守卫`);
    assert.match(
      src,
      /CHANGED_NULL_REASON/,
      `${rel}: git diff 失败文案也必须共源（否则同一语义两份措辞）`,
    );
    // 内联判据文案 = 又抄了一份实现；见到即红（守卫本体在 _lib 里不在脚本里）
    assert.doesNotMatch(
      src,
      /基线无意义：--base/,
      `${rel}: 检测到内联的判据文案——判据必须只有 _lib/baseline-guard.ts 一份实现`,
    );
    assert.doesNotMatch(
      src,
      /与 HEAD 是同一提交/,
      `${rel}: 检测到内联的判据文案——同上`,
    );
  }
  console.log(`  ✓ wiring：${consumers.length} 个门禁均走共享守卫且无内联副本`);
});

finish("test_baseline_guard.ts 全部断言通过");
