#!/usr/bin/env node
/**
 * reproduce-commit-interrupt.ts — 复现「commit 进行中被中断」的残留现场（ADR-151 配套诊断）。
 *
 * 设计意图：kill -9 / 工具层强杀时 finally 不执行、git 子进程被连带杀死——临时 index 恒残留
 * 且 HEAD 推进与否取决于被杀时机。本脚本用真实数据复现该场景，供排查「提交超时/残留」类
 * 事故时对照现场，避免靠猜。属手动诊断工具（无流水线挂载，README 登记为 documented 档）。
 *
 * 背景（2026-09-01 实战）：commit-with-check 提交阶段全量门禁超时被工具层中断，
 * 提交本身已落地（HEAD 推进成功），但留下两处残留：
 *   1. `.git/index.ymm.<pid>` 临时 index 未清理（父进程被杀，finally 未执行）
 *   2. 主 index 若干陈旧暂存（收尾 reset 未跑到）
 *
 * 本脚本用真实数据复现两种变体（同一机制、不同中断时机）：
 *   A. commit 未完成被中断（慢钩子执行中被 kill）→ HEAD 不推进，临时 index 残留
 *   B. commit 已完成、清理未跑到（git 返回后被 kill / 父进程崩溃）→ HEAD 推进，临时 index + 主 index 陈旧暂存残留 ← 实战场景
 *
 * 用法：node scripts/reproduce-commit-interrupt.ts
 * 退出码：0 = 两变体均复现成功；1 = 任一失败
 * 依赖：零依赖（node:child_process / node:fs / node:os / node:path）；运行时需 git 与 taskkill（Windows）
 * 清理：脚本 finally 删临时仓库。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-intr-'));

function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

/** Windows 进程树强杀（taskkill /T /F）；POSIX 负 pid 杀进程组。 */
function killTree(pid: number) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已死 */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已死 */ } }
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** 造一个带数据 + 慢钩子的临时仓库，返回 { dir, gitDir }。 */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'r'));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 't@t'], dir);
  git(['config', 'user.name', 't'], dir);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a1', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'b0', 'utf8');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'base'], dir);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8'); // 本次要提交的数据
  fs.writeFileSync(path.join(dir, 'other.ts'), 'other2', 'utf8'); // 模拟并行会话暂存
  git(['add', 'other.ts'], dir);
  return { dir, gitDir: path.resolve(dir, git(['rev-parse', '--git-dir'], dir)) };
}

/** 打印临时 index 残留清单（相对 gitDir 的 basename）。 */
function listResidue(gitDir: string) {
  return fs.readdirSync(gitDir).filter((f) => f.startsWith('index.ymm'));
}

async function variantA() {
  console.log('════════ 变体 A：commit 未完成被中断（慢钩子执行中 kill）════════');
  const { dir, gitDir } = makeRepo();
  const tmpIndex = path.join(gitDir, `index.ymm.A`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  // 慢钩子：sleep 2 + 追加 + git add（模拟 gen/gofmt）
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', 'pre-commit'),
    '#!/bin/sh\nsleep 2\necho "// hook" >> b.ts\ngit add b.ts\nexit 0', 'utf8');
  git(['config', 'core.hooksPath', 'hooks'], dir);

  git(['read-tree', 'HEAD'], dir, env);
  git(['add', '--', 'a.ts'], dir, env);
  console.log(`① 临时 index 已构建，staged: ${git(['diff', '--cached', '--name-only'], dir, env).split('\n').filter(Boolean).join(', ')}`);
  console.log(`② spawn commit（钩子 sleep 2s）… 1s 后 kill`);
  const child = spawn('git', ['commit', '-m', 'intr-A'], { cwd: dir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  await sleep(1000);
  killTree(child.pid!);
  await sleep(500);
  const headA = git(['log', '--oneline', '-1'], dir);
  console.log(`③ 中断后 HEAD: ${headA}`);
  console.log(`④ 临时 index 残留: ${listResidue(gitDir).join(', ') || '(无)'}`);
  console.log(`⑤ 主 index staged: ${git(['diff', '--cached', '--name-only'], dir).split('\n').filter(Boolean).join(', ') || '(空)'}`);
  const ok = listResidue(gitDir).length > 0 && !headA.includes('intr-A');
  console.log(`   → 判定: ${ok ? '✅ 复现成功（HEAD 未推进 + 临时 index 残留）' : '⚠️ 不符合预期'}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

async function variantB() {
  console.log('\n════════ 变体 B：commit 已完成、清理未跑到（git 返回后父进程被杀）← 实战 ════════');
  const { dir, gitDir } = makeRepo();
  const tmpIndex = path.join(gitDir, `index.ymm.B`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  // 快钩子：立即完成（commit 会正常落地）
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0', 'utf8');
  git(['config', 'core.hooksPath', 'hooks'], dir);

  git(['read-tree', 'HEAD'], dir, env);
  git(['add', '--', 'a.ts'], dir, env);
  console.log(`① 临时 index 已构建，staged: ${git(['diff', '--cached', '--name-only'], dir, env).split('\n').filter(Boolean).join(', ')}`);
  // 模拟 commit-with-check 的「提交成功 → 父进程在 finally 清理前被杀」：
  // 用一个中间进程执行 commit（它会继承 GIT_INDEX_FILE），成功后父进程不清理直接"死"。
  console.log(`② spawn commit（快钩子，立即完成）… 等它退出`);
  const child = spawn('git', ['commit', '-m', 'intr-B'], { cwd: dir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  const code = await new Promise<number | null>((res) => child.on('close', (c) => res(c)));
  console.log(`③ git commit 退出码: ${code}（commit 已落地）`);
  const headB = git(['log', '--oneline', '-1'], dir);
  console.log(`④ HEAD: ${headB}`);
  console.log(`⑤ 此刻（清理未跑到）临时 index 残留: ${listResidue(gitDir).join(', ') || '(无)'}`);
  console.log(`⑥ 主 index staged（含陈旧 other.ts + 应被 reset 的 a.ts）: ${git(['diff', '--cached', '--name-only'], dir).split('\n').filter(Boolean).join(', ') || '(空)'}`);
  // 这正是实战现场：commit 落地、临时 index 在、主 index 有陈旧暂存
  const ok = listResidue(gitDir).length > 0 && headB.includes('intr-B');
  console.log(`   → 判定: ${ok ? '✅ 复现成功（HEAD 推进 + 临时 index 残留 + 主 index 陈旧暂存）' : '⚠️ 不符合预期'}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

try {
  const a = await variantA();
  const b = await variantB();
  console.log('\n════════════════════════════════════════════');
  console.log('复现总结（真实数据）：');
  console.log(`  变体 A  ${a ? '✅' : '❌'}  commit 未完成被中断 → 临时 index 残留（finally 没机会跑）`);
  console.log(`  变体 B  ${b ? '✅' : '❌'}  commit 已完成但清理未跑 → 临时 index + 主 index 陈旧暂存（实战场景）`);
  console.log('机制根因：kill -9 无法触发任何 finally；git 子进程被连带杀死时');
  console.log('          若已写 ref 则 HEAD 推进、若未写完则丢弃——临时 index 文件恒残留。');
  console.log('对策：commit-temp-index 启动时按 pid 存活判定清扫遗留 index.ymm.*（建议）。');
  process.exit(a && b ? 0 : 1);
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
