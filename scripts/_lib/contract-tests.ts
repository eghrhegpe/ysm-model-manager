#!/usr/bin/env node
/**
 * contract-tests.ts — 契约测试并行执行共享层。
 *
 * 解决 doctor.ts / pre-push-gate.ts 各自内联串行循环跑 tests/*.ts 的问题。
 * 此前逐个 execFileSync（总耗时 ~43s），集中到本层后支持 Promise.all 并行（~31s），
 * 同时消除双端重复代码。
 *
 * 使用 spawn + Promise 而非 execFile：Node 24 的 execFile Promise API 返回的
 * stdout/stderr 是对象而非字符串，行为不一致；spawn 稳定可靠。
 *
 * 用法：
 *   import { runContractTestsParallel, collectContractTests } from './_lib/contract-tests.ts';
 *
 * 依赖：node:child_process / node:fs / node:path
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Domain } from "./domain-classify.ts";
import { ROOT } from "./scan-files.ts";

/** 列出 tests/ 目录下所有 .ts 文件（按文件名排序）。 */
export function collectContractTests() {
  const dir = path.join(ROOT, "tests");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .sort();
}


// 映射双表已拆两模块（ADR-234 D3 _lib 400 行硬红线，2026-10-15 拆出）：
// CONTRACT_TEST_DOMAINS → ./contract-test-domains.ts（测试→验证域），CONTRACT_TEST_TARGETS →
// ./contract-test-targets.ts（测试→保护源文件，数组压单行）。本文件 re-export 维持消费方
// import 路径不变，本地 selectContractTests 经 import 使用。
import { CONTRACT_TEST_DOMAINS } from "./contract-test-domains.ts";
import { CONTRACT_TEST_TARGETS } from "./contract-test-targets.ts";
export { CONTRACT_TEST_DOMAINS, CONTRACT_TEST_TARGETS };


/**
 * 按变更域 + 变更文件选择要跑的契约测试子集（#2 按域裁剪 + #3 按文件精确裁剪）。
 * @param changedDomains 变更文件归类后的域集合（classify 返回值去重；'tests' 含 tests/ 与 scripts/）。
 * @param changedFiles   可选，相对仓库根的文件路径数组。提供时 tests 域由「全量回落」改为
 *                       按 CONTRACT_TEST_TARGETS 精确裁剪，使 scripts 工具改动只跑相关测试。
 * @returns 命中测试文件名列表（collectContractTests 子集，保持字母序）。
 * 规则：
 *   - 不传 changedFiles：保持原行为（向后兼容 pre-push / doctor）。
 *       · 变更域含 'tests'（改 tools/scripts/_lib 或 tests 自身）→ 全量（工具改动影响面大）。
 *       · 否则 → 各变更域交集匹配（含 mixed 测试：任一端变更都触发）。
 *   - 传 changedFiles 且含 'tests' 域：tests 域测试按文件精确裁剪（替代全量回落）；
 *     无任一测试命中 → 回落全量（fail-safe，避免零验证漏检）。
 *   - 无变更域或仅有 other → 空（不跑）。
 */
export function selectContractTests(
  changedDomains: ReadonlySet<string> | readonly string[],
  changedFiles?: readonly string[],
): string[] {
  const domains = new Set(changedDomains as Iterable<string>);
  const all = collectContractTests();
  if (domains.size === 0) return [];

  // 按域筛选（含 mixed 跨端契约）—— 既有精确逻辑，非 tests 域直接返回子集
  const byDomain = all.filter((f) => (CONTRACT_TEST_DOMAINS[f] || []).some((d) => domains.has(d)));

  // 未提供 changedFiles：保持原行为（pre-push / doctor 仍全量回落）
  if (!changedFiles || changedFiles.length === 0) {
    if (domains.has("tests")) return all;
    return byDomain;
  }

  // 提供 changedFiles 且变更含 tests 域：用「按文件精确裁剪」替代全量回落
  if (domains.has("tests")) {
    const testsDomain = byDomain.filter((f) => (CONTRACT_TEST_DOMAINS[f] || []).includes("tests"));
    const nonTests = byDomain.filter((f) => !(CONTRACT_TEST_DOMAINS[f] || []).includes("tests"));
    const precise = testsDomain.filter((f) => targetsHit(f, changedFiles));
    // fail-safe：改动未被任何 tests 域测试覆盖 → 回落全量，避免零验证漏检
    if (precise.length === 0) return all;
    return [...new Set([...nonTests, ...precise])].sort();
  }

  return byDomain;
}

/** 该测试是否应因 changedFiles 而运行（true = 命中 = 保守保留）。 */
function targetsHit(testFile: string, changedFiles: readonly string[]): boolean {
  const targets = CONTRACT_TEST_TARGETS[testFile];
  if (!targets || targets.length === 0) return true; // 未登记 → 保守保留（不漏检）
  return targets.some((t) => {
    if (t.endsWith("/")) {
      const dir = t.slice(0, -1);
      return changedFiles.some((c) => c === dir || c.startsWith(`${dir}/`));
    }
    return changedFiles.includes(t);
  });
}

/**
 * 运行单个测试文件，返回 { stdout, stderr, status, spawnError? }。
 * 使用 spawn 而非 execFile：execFile Promise API 在 Node 24 上 stdout/stderr
 * 返回对象而非字符串，行为不一致。
 *
 * Windows 高并发下（51 个契约测试全并发 + vitest 8 workers 残留），进程表瞬时
 * 饱和会导致 spawn 抛 ENOENT（进程根本没起来），表现为偶发契约测试红。双层防线：
 *   ① spawn 层：对「进程未启动」有限重试（MAX_SPAWN_RETRY，见下）；
 *   ② 整文件层：runContractTestsParallel 有界并发 8 + 失败串行复跑 1 次
 *      （真回归复跑必二次失败，不掩盖；负载瞬态复跑通过转绿，2026-09-04 加固）。
 */
const MAX_SPAWN_RETRY = 3;
// spawn 失败计数（仅 ENOENT/EMFILE 等进程启动失败，不含测试断言失败）
let spawnFailureCount = 0;
// 有界并发度：51 个测试全量 Promise.all 时 Windows 进程表饱和（测试内再 spawn
// 子进程会持续 ENOENT，内层重试 3 次也救不回 → 整文件 flaky FAIL，2026-09-04 实证）。
// 8 路实测 15.8s vs 51 全并发 15.6s——墙钟由慢测试拖尾决定而非并发度，降并发零成本。
const CONCURRENCY = 8;
// 整文件失败后的串行复跑次数：进程起来了但断言失败，可能是测试内再 spawn 子进程
// 吃了系统瞬时负载（而非真实回归——真回归串行复跑必二次失败）。复跑 1 次区分二者，
// 避免一次 flaky FAIL 触发整轮 push 门禁人工重推（2026-09-04 流程税复盘新增）。
const FILE_FAIL_RETRY = 1;

/** 单次 spawn 结果（含"进程未起来"的 spawnError 分支）。 */
interface SpawnOnceResult {
  stdout: string;
  stderr: string;
  status: number;
  spawnError?: Error;
}

function spawnTestOnce(file: string): Promise<SpawnOnceResult> {
  return new Promise((resolve) => {
    // 注意：spawn 的 SpawnOptions 无 maxBuffer（那是 execFileSync 的选项），
    // 传了会让 TS overload 解析失败返回 never——stdout/stderr 用流式 chunk 累积即可。
    // --import 注入 @/#root 别名运行时解析（tsconfig paths 白名单，alias-resolve.ts
    // 单一事实源）：Node 原生 TS 执行不解析 tsconfig paths，tests 的 import 链一旦
    // 进入含 @/ 别名 import 的 frontend 源码即 ERR_MODULE_NOT_FOUND（首例 a1e76940b
    // cube-mesh.ts → @/preview-3d/model/*，阻断 pre-push）。相对路径说明符（./、../）
    // 与裸包名经 resolver 原样透传，零行为变更。护栏：test_contract_alias_runtime.ts。
    // 走 node CLI flag（非 spawn options.execArgv——@types/node 26 的 SpawnOptions 重载
    // 不收该字段，CLI 形态零类型摩擦）。
    const proc = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(ROOT, "scripts", "_lib", "ts-alias-register.ts")).href,
        path.join("tests", file),
      ],
      {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // 分离 stdout / stderr 两个流（缺陷#1，ADR-234）：此前两路 chunk 汇入同一
    // chunks 数组、close 时合并为单一 stdout 且 stderr 清空——测试把失败断言细节写进
    // stderr（多个契约测试经 process.stderr / console.error 输出诊断）时，runOne 失败态
    // 取 `stdout || stderr`，若 stdout 非空（哪怕只有一行 [OK]）就会把 stderr 的诊断吞掉。
    // 现在分桶累积，close 时原样各自返回，由 runOne 在失败态拼接消费。
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout?.on("data", (c: Buffer) => outChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("close", (code) => {
      const stdout = Buffer.concat(outChunks).toString("utf8");
      const stderr = Buffer.concat(errChunks).toString("utf8");
      resolve({ stdout, stderr, status: code ?? 1 });
    });
    proc.on("error", (e) => resolve({ stdout: "", stderr: e.message, status: 1, spawnError: e }));
  });
}

async function runTest(file: string): Promise<SpawnOnceResult> {
  let last: SpawnOnceResult | null = null;
  for (let attempt = 1; attempt <= MAX_SPAWN_RETRY; attempt++) {
    const r = await spawnTestOnce(file);
    // 仅「进程未起来」（spawn 瞬时 ENOENT / EMFILE 等）重试；
    // 进程正常跑完但断言失败 → 立即返回，交上层判失败，不掩盖真实回归。
    if (r.spawnError && /ENOENT|EMFILE|spawn/i.test(r.stderr || r.spawnError.message || "")) {
      spawnFailureCount++;
      if (spawnFailureCount > 5) {
        console.warn("[contract-tests] 进程表饱和频繁（累计 5+ 次），考虑降低并发或检查系统负载");
      }
      last = r;
      continue;
    }
    return r;
  }
  // 循环要么 return r 要么 continue（last 被赋值）；耗尽仍无 last = 逻辑不可达。
  if (!last) throw new Error("[contract-tests] spawn 重试循环退出却无结果（不可达路径防御）");
  return last;
}

/**
 * 并行执行契约测试，返回结果数组。
 * @param files 可选：只跑指定测试文件（selectContractTests 裁剪结果）；缺省全量 collectContractTests。
 * 失败时返回 { name, ok: false, out } 而非抛出，调用方按需聚合。
 */
export async function runContractTestsParallel(files?: string[]) {
  const testFiles = files && files.length > 0 ? [...files].sort() : collectContractTests();
  if (testFiles.length === 0) return [];
  const results: { name: string; ok: boolean; out: string }[] = new Array(testFiles.length);
  const runOne = async (f: string) => {
    const { stdout, stderr, status } = await runTest(f);
    // 失败态拼接 stdout + stderr（缺陷#1，ADR-234）：断言细节多经 stderr（process.stderr /
    // console.error）输出；旧版 `stdout || stderr` 在 stdout 非空时整段丢 stderr。拼接保留两路，
    // 行尾再按 slice(-40) 截断——「保留尾部」纪律不变（成功态仍为空，不膨胀）。
    const combined = [stdout, stderr]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
    const outStr = status !== 0 ? combined : "";
    return { name: f, ok: status === 0, out: outStr.split("\n").slice(-40).join("\n") };
  };
  // 有界并发 worker 池（见 CONCURRENCY 注释：51 全并发 Windows spawn 饱和 flaky，
  // 8 路实测耗时持平——慢测试拖尾决定墙钟，降并发零成本）。
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, testFiles.length) }, async () => {
    while (cursor < testFiles.length) {
      const i = cursor++;
      const f = testFiles[i];
      if (f === undefined) break; // cursor < length 前置保证 i 有效，此处仅为 TS 收窄
      results[i] = await runOne(f);
    }
  });
  await Promise.all(workers);
  // 失败整文件串行复跑（FILE_FAIL_RETRY 次）：真回归 → 串行复跑仍败 → 保留 FAIL
  // （不掩盖）；系统瞬时负载（测试内再 spawn 吃进程表饱和）→ 复跑通过 → 转绿并审计提示。
  const retried: string[] = [];
  for (const r of results) {
    if (r.ok) continue;
    for (let attempt = 0; attempt < FILE_FAIL_RETRY; attempt++) {
      const again = await runOne(r.name); // 串行复跑，不再吃并发负载
      if (again.ok) {
        retried.push(r.name);
        r.ok = true;
        r.out = "";
        break;
      }
      r.out = again.out; // 复跑仍败 → 以复跑输出为准（更贴近当前状态）
    }
  }
  if (retried.length) {
    console.warn(
      `[contract-tests] ${retried.length} 个测试首跑失败、串行复跑通过（疑系统瞬时负载）: ${retried.join(", ")}`,
    );
  }
  return results;
}
