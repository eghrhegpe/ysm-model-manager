#!/usr/bin/env node
/**
 * contract-tests.mjs — 契约测试并行执行共享层。
 *
 * 解决 doctor.mjs / pre-push-gate.mjs 各自内联串行循环跑 tests/*.mjs 的问题。
 * 此前逐个 execFileSync（总耗时 ~43s），集中到本层后支持 Promise.all 并行（~31s），
 * 同时消除双端重复代码。
 *
 * 使用 spawn + Promise 而非 execFile：Node 24 的 execFile Promise API 返回的
 * stdout/stderr 是对象而非字符串，行为不一致；spawn 稳定可靠。
 *
 * 用法：
 *   import { runContractTestsParallel, collectContractTests } from './_lib/contract-tests.mjs';
 *
 * 依赖：node:child_process / node:fs / node:path
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-files.mjs';

/** 列出 tests/ 目录下所有 .mjs 文件（按文件名排序）。 */
export function collectContractTests() {
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
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

function spawnTestOnce(file) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join('tests', file)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => chunks.push(c));
    proc.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ stdout: out, stderr: '', status: code ?? 1 });
    });
    proc.on('error', (e) => resolve({ stdout: '', stderr: e.message, status: 1, spawnError: e }));
  });
}

async function runTest(file) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_SPAWN_RETRY; attempt++) {
    const r = await spawnTestOnce(file);
    // 仅「进程未起来」（spawn 瞬时 ENOENT / EMFILE 等）重试；
    // 进程正常跑完但断言失败 → 立即返回，交上层判失败，不掩盖真实回归。
    if (r.spawnError && /ENOENT|EMFILE|spawn/i.test(r.stderr || r.spawnError.message || '')) {
      last = r;
      continue;
    }
    return r;
  }
  return last;
}

/**
 * 并行执行所有契约测试，返回结果数组。
 * 失败时返回 { name, ok: false, out } 而非抛出，调用方按需聚合。
 */
export async function runContractTestsParallel() {
  const testFiles = collectContractTests();
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
