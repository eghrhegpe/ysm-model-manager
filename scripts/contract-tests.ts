#!/usr/bin/env node
/**
 * contract-tests.ts — 契约测试统一 CLI 入口（CI 与本地共用的唯一执行路径）。
 *
 * 设计意图：消除「CI 与本地 pre-push 各跑一套」的执行路径双轨。CI 曾用 PowerShell 手写
 *   `Get-ChildItem tests/*.ts` 逐个裸跑 `node $f`，而本地 pre-push-gate 走
 *   _lib/contract-tests.ts 的 runContractTestsParallel —— 后者 spawn 时以
 *   `--import scripts/_lib/ts-alias-register.ts` 注入 `@/` 别名运行时解析，前者没有。
 *   Node 原生 TS 执行不解析 tsconfig paths，于是任何 import 链进入含 `@/<dir>/*` 别名的
 *   frontend 源码的契约测试都会「本地绿、CI 红」（首例 a1e76940b 抽离 preview-3d/model/
 *   → cube-mesh.ts → @/preview-3d/model/*；护栏 test_contract_alias_runtime.ts）。
 *   本脚本把 CI 接到与本地完全相同的实现上：收集 / 域裁剪 / 别名注入 / 并发 / 失败复跑
 *   全部复用 _lib 单点实现，workflow 侧不再手写循环。
 *
 * 依赖：仅 node 内置 + scripts/_lib（零 node_modules —— CI 可在安装前端依赖前执行）。
 *
 * 用法：
 *   node scripts/contract-tests.ts                     # 全量（CI 口径）
 *   node scripts/contract-tests.ts --domain frontend   # 按域裁剪（本地自查，可逗号分隔多域）
 *   node scripts/contract-tests.ts --json              # JSON 输出（CI / 子代理消费）
 *   node scripts/contract-tests.ts --quiet             # 仅输失败详情 + 汇总
 *
 * 退出码：有失败 → 1；否则 0。参数非法 → 1。
 */
import {
  collectContractTests,
  runContractTestsParallel,
  selectContractTests,
} from "./_lib/contract-tests.ts";
import { parseArgs } from "./_lib/parse-args.ts";

const USAGE = `契约测试统一入口（CI 与本地同源）

用法：
  node scripts/contract-tests.ts [--domain <d[,d]>] [--json] [--quiet]

选项：
  --domain <d>   按验证域裁剪（go / frontend / data / docs / tests），可逗号分隔；缺省全量
  --json         JSON 输出（_summary + tests，供 CI / 子代理消费）
  --quiet        仅输出失败详情与汇总
  --help         显示本帮助
`;

const args = parseArgs(process.argv.slice(2), {
  bools: ["json", "quiet"],
  arrays: ["domain"],
});

if (args.help) {
  console.log(USAGE);
  process.exitCode = 0;
} else if (args.unknown.length > 0) {
  console.error(`❌ 未知参数: ${args.unknown.join(", ")}\n\n${USAGE}`);
  process.exitCode = 1;
} else {
  const json = Boolean(args.json);
  const quiet = Boolean(args.quiet);
  const domains = (args.domain as string[])
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // 未知域 fail-closed（code_review d9f821d11 P2）：拼错的 --domain（如
  // fronetnd / Frontend 大小写）会让 selectContractTests 返回空集 → 走下方
  // 「无命中跳过」exit 0，本地自查绿但实际零测试执行——门禁 fail-open。
  // 先对 USAGE 枚举的合法域做白名单校验，未知域直接报错退出 1。
  const KNOWN_DOMAINS = new Set(["go", "frontend", "data", "docs", "tests"]);
  const unknown = domains.filter((d) => !KNOWN_DOMAINS.has(d));
  if (unknown.length > 0) {
    console.error(
      `[contract-tests] 未知验证域: ${unknown.join(", ")}（合法域: ${[...KNOWN_DOMAINS].join(" / ")}）`,
    );
    // 脚本主体在模块顶层（无函数包裹），不能用 return——顶层 return 经
    // Node type-stripping 直接 ERR_INVALID_TYPESCRIPT_SYNTAX
    process.exit(1);
  }

  // 域裁剪：selectContractTests 对「无域 / 仅 other」返回空。空数组不能透传给
  // runContractTestsParallel —— 其 `files.length > 0` 判断会把空集退化成全量。
  const all = collectContractTests();
  const files = domains.length > 0 ? selectContractTests(domains) : all;

  if (files.length === 0) {
    if (json) {
      console.log(
        JSON.stringify(
          { _summary: { total: 0, passed: 0, failed: 0, durationMs: 0, domains }, tests: [] },
          null,
          2,
        ),
      );
    } else {
      console.log(`[contract-tests] 域 ${domains.join(",")} 无命中的契约测试，跳过`);
    }
    process.exitCode = 0;
  } else {
    const t0 = Date.now();
    const results = await runContractTestsParallel(files);
    const durationMs = Date.now() - t0;
    const failed = results.filter((r) => !r.ok);
    const passed = results.length - failed.length;

    if (json) {
      console.log(
        JSON.stringify(
          {
            _summary: { total: results.length, passed, failed: failed.length, durationMs, domains },
            tests: results.map((r) => ({ name: r.name, ok: r.ok, out: r.out })),
          },
          null,
          2,
        ),
      );
    } else {
      if (!quiet) for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name}`);
      for (const r of failed) console.error(`\n❌ ${r.name}\n${r.out}`);
      const summary = `[contract-tests] ${passed}/${results.length} 通过${
        failed.length > 0 ? `，${failed.length} 失败` : ""
      }（${(durationMs / 1000).toFixed(1)}s）`;
      if (failed.length > 0) console.error(summary);
      else console.log(summary);
    }
    process.exitCode = failed.length > 0 ? 1 : 0;
  }
}
