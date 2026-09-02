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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-files.ts';
import type { Domain } from './domain-classify.ts';

/** 列出 tests/ 目录下所有 .ts 文件（按文件名排序）。 */
export function collectContractTests() {
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('_')).sort();
}

/**
 * 契约测试 → 敏感验证域映射（#2 按域裁剪的事实来源）。
 * 域定义与 domain-classify.ts 的 Domain 一致：go / frontend / data / docs / tests / other。
 * 语义：该测试验证的对象属于哪些域——变更域命中其一即应触发该测试。
 * mixed（数组含多域）表示跨端契约，任一端变更都触发。
 * 数据来源：docs/contract-tests-audit.md（45 个测试逐一通读头部后人工核定）。
 * 说明：域 `scripts` 不在 Domain 词表内（classify 把 tests/ 与 scripts/ 统一归为 'tests'），
 * 因此"验证 scripts 工具自身"的测试同样标 `tests`——工具改动即命中 'tests' → 全量。
 */
export const CONTRACT_TEST_DOMAINS: Record<string, Domain[]> = {
  // —— docs ——
  'check-knowledge-drift-affected.ts': ['docs'],
  'check-knowledge-hook.ts': ['docs'],
  'check-knowledge-perf-tags.ts': ['docs'],
  'test_check_readme_index.ts': ['docs', 'tests'],
  'test_sidebar_gen.ts': ['docs', 'tests'],
  'verify-adr-042.ts': ['docs'],
  // —— data ——
  'test_creators_schema.ts': ['data'],
  'test_resource_schema.ts': ['data'],
  'test_workshop_schema.ts': ['data'],
  // —— go ——
  'test_cli_completion_parity.ts': ['go'],
  'test_cli_doc_parity.ts': ['go', 'docs'],
  'test_config_defaults.ts': ['go'],
  'test_rust_bridge_tags.ts': ['go'],
  // —— frontend ——
  'test_bus_contract.ts': ['frontend'],
  'test_check_ctx_menu_i18n.ts': ['frontend'],
  'test_check_layering.ts': ['frontend'],
  'test_check_menu_health.ts': ['frontend'],
  'test_e2e_location_contract.ts': ['frontend'],
  'test_html_integrity.ts': ['frontend'],
  'test_i18n_key_naming.ts': ['frontend'],
  'test_mock_contract.ts': ['frontend', 'go'],
  'test_private_access_contract.ts': ['frontend'],
  'test_testid_contract.ts': ['frontend'],
  // —— mixed（跨端契约，任一端变更都触发）——
  'test_android_bridge_contract.ts': ['frontend', 'go'],
  'test_cli_gui_flow_contract.ts': ['go', 'frontend'],
  'test_config_syntax.ts': ['go', 'frontend'],
  'test_cube_uv_quad_vertex.ts': ['go', 'frontend'],
  // —— tests（验证 scripts 工具 / _lib 共享层自身，工具改动 → 全量）——
  'coverage-suggest-hint.ts': ['tests'],
  'go-coverage-hint.ts': ['tests'],
  'test_alias-resolve.ts': ['tests'],
  'test_api_break.ts': ['tests'],
  'test_auto_import.ts': ['tests'],
  'test_check_diff_coverage.ts': ['tests'],
  'test_check_go_diff_coverage_skip.ts': ['tests'],
  'test_check_go_diff_coverage.ts': ['tests'],
  'test_codemod_guards.ts': ['tests'],
  'test_collect_scripts_lib.ts': ['tests'],
  'test_commit_temp_index.ts': ['tests'],
  'test_contract_domain_select.ts': ['tests'],
  'test_deadcode_attrib.ts': ['tests'],
  'test_domain_classify.ts': ['tests'],
  'test_gen_stage.ts': ['tests'],
  'test_gate_iife_correctness.ts': ['tests'],
  'test_jscpd_pairs.ts': ['tests'],
  'test_redlines_changed_files.ts': ['tests'],
  'test_scripts_json.ts': ['tests'],
  'test_scripts_lib.ts': ['tests'],
};

/**
 * 按变更域选择要跑的契约测试子集（#2 按域裁剪核心规则）。
 * @param changedDomains 变更文件归类后的域集合（classify 返回值去重；'tests' 含 tests/ 与 scripts/）。
 * @returns 命中测试文件名列表（collectContractTests 子集，保持字母序）。
 * 规则：
 *   - 变更域含 'tests'（改 tools/scripts/_lib 或 tests 自身）→ 全量（工具改动影响面大，不可裁剪）。
 *   - 否则 → 各变更域交集匹配（含 mixed 测试：任一端变更都触发）。
 *   - 无变更域或仅有 other → 空（不跑）。
 */
export function selectContractTests(changedDomains: ReadonlySet<string> | readonly string[]): string[] {
  const domains = new Set(changedDomains as Iterable<string>);
  const all = collectContractTests();
  if (domains.size === 0) return [];
  if (domains.has('tests')) return all;
  return all.filter((f) => (CONTRACT_TEST_DOMAINS[f] || []).some((d) => domains.has(d)));
}

/**
 * 运行单个测试文件，返回 { stdout, stderr, status, spawnError? }。
 * 使用 spawn 而非 execFile：execFile Promise API 在 Node 24 上 stdout/stderr
 * 返回对象而非字符串，行为不一致。
 *
 * Windows 高并发下（全量门禁同时跑 ~20 个静态工具 + 39 个契约测试 + git 操作），
 * 进程表瞬时饱和会导致 spawn 直接抛 ENOENT（进程根本没起来），表现为偶发契约测试
 * 红——与测试逻辑无关、重试即可恢复。故对「进程未启动」做有限重试，
 * 但「进程正常跑完却断言失败」绝不重试，避免掩盖真实回归（2026-08-31 审计加固）。
 */
const MAX_SPAWN_RETRY = 3;
// spawn 失败计数（仅 ENOENT/EMFILE 等进程启动失败，不含测试断言失败）
let spawnFailureCount = 0;

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
    const proc = spawn(process.execPath, [path.join('tests', file)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr!.on('data', (c: Buffer) => chunks.push(c));
    proc.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ stdout: out, stderr: '', status: code ?? 1 });
    });
    proc.on('error', (e) => resolve({ stdout: '', stderr: e.message, status: 1, spawnError: e }));
  });
}

async function runTest(file: string): Promise<SpawnOnceResult> {
  let last: SpawnOnceResult | null = null;
  for (let attempt = 1; attempt <= MAX_SPAWN_RETRY; attempt++) {
    const r = await spawnTestOnce(file);
    // 仅「进程未起来」（spawn 瞬时 ENOENT / EMFILE 等）重试；
    // 进程正常跑完但断言失败 → 立即返回，交上层判失败，不掩盖真实回归。
    if (r.spawnError && /ENOENT|EMFILE|spawn/i.test(r.stderr || r.spawnError.message || '')) {
      spawnFailureCount++;
      if (spawnFailureCount > 5) {
        console.warn('[contract-tests] 进程表饱和频繁（累计 5+ 次），考虑降低并发或检查系统负载');
      }
      last = r;
      continue;
    }
    return r;
  }
  return last!;
}

/**
 * 并行执行契约测试，返回结果数组。
 * @param files 可选：只跑指定测试文件（selectContractTests 裁剪结果）；缺省全量 collectContractTests。
 * 失败时返回 { name, ok: false, out } 而非抛出，调用方按需聚合。
 */
export async function runContractTestsParallel(files?: string[]) {
  const testFiles = files && files.length > 0 ? [...files].sort() : collectContractTests();
  if (testFiles.length === 0) return [];
  const results = await Promise.all(
    testFiles.map(async (f) => {
      const { stdout, stderr, status } = await runTest(f);
      const outStr = status !== 0 ? stdout || stderr : '';
      return {
        name: f,
        ok: status === 0,
        out: outStr.trim().split('\n').slice(-4).join('\n'),
      };
    }),
  );
  return results;
}
