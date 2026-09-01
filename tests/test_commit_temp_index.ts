#!/usr/bin/env node
/**
 * 契约测试：commit-temp-index.ts 临时索引白名单提交核心（并发隔离，ADR-151）。
 *
 * 覆盖用户拍板的 5 个验收用例 + 白名单判定纯函数：
 *   1. 主 index 有他人 staged 的 other.ts → 提交后 HEAD 不含它，主 index 仍含它（不被吞）
 *   2. pre-commit 钩子 git add 的产物（模拟 gofmt/gen 修复）落进本次提交（临时 index 继承）
 *   3. 提交 docs/knowledge/x.md → gen 产物（docs/index.md）自动随提交
 *   4. --files 提供 paths（主 index 无 staged）→ 仍能成功提交（不再要求先 git add）
 *   5. 成功/失败两路径均清理临时 index（.git 无 index.ymm.* 残留）
 *   6. isHookArtifact 白名单判定（docs/ locales/ completions/ *.test.ts/js）
 *   7. outOfScope 越界检出（钩子 stage 的越界文件被标记）
 *
 * 零依赖（仅 node:assert + node:child_process + node:fs + node:os + node:path）。
 * 运行：node tests/test_commit_temp_index.ts
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { commitWithTempIndex, isHookArtifact } from '../scripts/_lib/commit-temp-index.ts';

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error('✗', name, '-', (e as Error).message);
  }
}

// ── 临时 git 仓库 helper ──
function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env })
    .trim();
}

/** 创建带 base commit 的临时仓库；opts.hook 可选——在 base commit 之后安装钩子
 * （钩子产物只在后续目标提交时新鲜生成，base 保持干净，贴近真实场景）。 */
function makeRepo(t: ReturnType<typeof describe>, opts: { hook?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-ci-'));
  t.cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 't@t'], dir);
  git(['config', 'user.name', 't'], dir);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a1', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'b0', 'utf8');
  fs.writeFileSync(path.join(dir, 'other.ts'), 'other', 'utf8');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'base'], dir);
  if (opts.hook) {
    const hookDir = path.join(dir, 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'pre-commit'), opts.hook, 'utf8');
    git(['config', 'core.hooksPath', 'hooks'], dir);
  }
  return dir;
}

const describe = { cleanups: [] as string[] };
process.on('exit', () => {
  for (const d of describe.cleanups) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

// ── 用例 1：主 index 他人 staged 不被吞 ──
check('用例1: 主 index 他人 staged(other.ts) 不进提交、仍保留在 index', () => {
  const dir = makeRepo(describe);
  // 工作区改 a.ts（未 staged，模拟 --files 场景）
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8');
  // 主 index 有他人 staged 的 other.ts（改 + git add）
  fs.writeFileSync(path.join(dir, 'other.ts'), 'other2', 'utf8');
  git(['add', 'other.ts'], dir);

  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'tmpidx', cwd: dir });
  assert.ok(r.ok, `提交应成功: ${r.error}`);
  assert.ok(r.sha, '应有 sha');

  const committed = git(['show', '--name-only', '--format=', 'HEAD'], dir).split('\n').filter(Boolean);
  assert.ok(committed.includes('a.ts'), '本次提交应含 a.ts');
  assert.ok(!committed.includes('other.ts'), `本次提交不应含 other.ts: ${committed}`);
  // 主 index 仍保留他人 staged
  const mainStaged = git(['diff', '--cached', '--name-only'], dir).split('\n').filter(Boolean);
  assert.ok(mainStaged.includes('other.ts'), `主 index 应仍含 other.ts staged: ${mainStaged}`);
  // 提交内容正确
  assert.equal(git(['show', 'HEAD:a.ts'], dir), 'a2');
  assert.equal(git(['show', 'HEAD:other.ts'], dir), 'other'); // 提交里 other.ts 仍是 base 版本
});

// ── 用例 2：pre-commit 钩子 stage 产物落进本次提交（临时 index 继承）──
check('用例2: 钩子 git add 的 b.ts 修改进本次提交（临时 index 继承）', () => {
  const dir = makeRepo(describe, {
    hook: '#!/bin/sh\necho "// hook" >> b.ts\ngit add b.ts\nexit 0',
  });
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8');

  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'with-hook', cwd: dir });
  assert.ok(r.ok, `提交应成功: ${r.error}`);
  const committed = git(['show', '--name-only', '--format=', 'HEAD'], dir).split('\n').filter(Boolean);
  assert.ok(committed.includes('b.ts'), `钩子 stage 的 b.ts 应进本次提交: ${committed}`);
  const bContent = git(['show', 'HEAD:b.ts'], dir);
  assert.ok(bContent.includes('// hook'), `b.ts 应含钩子追加内容: ${bContent}`);
});

// ── 用例 3：gen 产物自动随提交 ──
check('用例3: 钩子生成的 docs/index.md 随提交（gen 产物白名单）', () => {
  // 注意：钩子用 echo 而非 heredoc——Git for Windows 的 sh 处理 heredoc+CRLF 不稳定
  // （heredoc 写法会让 docs/index.md 创建失败 → 提交缺 gen 产物，误判核心机制坏）
  const dir = makeRepo(describe, {
    hook: '#!/bin/sh\nmkdir -p docs\necho "# auto index" > docs/index.md\ngit add docs/index.md\nexit 0',
  });
  // 提交一个 docs/knowledge/x.md
  const kdir = path.join(dir, 'docs', 'knowledge');
  fs.mkdirSync(kdir, { recursive: true });
  fs.writeFileSync(path.join(kdir, 'x.md'), '# x', 'utf8');

  const r = commitWithTempIndex({ paths: ['docs/knowledge/x.md'], message: 'doc', cwd: dir });
  assert.ok(r.ok, `提交应成功: ${r.error}`);
  const committed = git(['show', '--name-only', '--format=', 'HEAD'], dir).split('\n').filter(Boolean);
  assert.ok(committed.includes('docs/knowledge/x.md'), '应含 x.md');
  assert.ok(committed.includes('docs/index.md'), `gen 产物 docs/index.md 应随提交: ${committed}`);
  assert.ok(r.outOfScope.length === 0, `不应有越界文件: ${r.outOfScope}`);
});

// ── 用例 4：--files 提供 paths（主 index 无 staged）仍成功 ──
check('用例4: 主 index 无 staged 也能提交（paths 直接来自 --files）', () => {
  const dir = makeRepo(describe);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8'); // 未 git add

  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'nofiles', cwd: dir });
  assert.ok(r.ok, `提交应成功: ${r.error}`);
  assert.equal(git(['show', 'HEAD:a.ts'], dir), 'a2');
});

// ── 用例 5：临时 index 清理（成功 + 失败路径）──
check('用例5a: 成功路径清理临时 index', () => {
  const dir = makeRepo(describe);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8');
  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'cleanup', cwd: dir });
  assert.ok(r.ok);
  const leftovers = fs.readdirSync(path.join(dir, '.git')).filter((f) => f.startsWith('index.ymm'));
  assert.deepEqual(leftovers, [], `成功路径不应残留临时 index: ${leftovers}`);
});

check('用例5b: 失败路径（无变更）清理临时 index', () => {
  const dir = makeRepo(describe);
  // a.ts 未改动 → 临时 index 无变更 → 应失败且清理
  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'nop', cwd: dir });
  assert.ok(!r.ok, '无变更应失败');
  assert.ok(r.error && r.error.includes('无变更'), `错误应说明无变更: ${r.error}`);
  const leftovers = fs.readdirSync(path.join(dir, '.git')).filter((f) => f.startsWith('index.ymm'));
  assert.deepEqual(leftovers, [], `失败路径不应残留临时 index: ${leftovers}`);
  // 主 index 未被污染
  const mainStaged = git(['diff', '--cached', '--name-only'], dir).split('\n').filter(Boolean);
  assert.deepEqual(mainStaged, []);
});

// ── 用例 6：isHookArtifact 白名单纯函数 ──
check('用例6: isHookArtifact 白名单判定', () => {
  assert.equal(isHookArtifact('docs/index.md'), true, 'docs/ 前缀');
  assert.equal(isHookArtifact('docs/knowledge/x.md'), true, 'docs 深层');
  assert.equal(isHookArtifact('frontend/public/locales/zh.json'), true, 'locales');
  assert.equal(isHookArtifact('completions/ysm.bash'), true, 'completions');
  assert.equal(isHookArtifact('a.test.ts'), true, '测试文件');
  assert.equal(isHookArtifact('a.spec.js'), true, 'spec 文件');
  assert.equal(isHookArtifact('go/conc/pool.go'), false, '普通源码非白名单');
  assert.equal(isHookArtifact('scripts/x.ts'), false, 'scripts 非白名单');
});

// ── 用例 7：outOfScope 越界检出 ──
check('用例7: 钩子 stage 越界文件被 outOfScope 检出', () => {
  const dir = makeRepo(describe, {
    hook: '#!/bin/sh\nmkdir -p scripts\necho "// leak\nexport const leak = 1;" > scripts/leak.ts\ngit add scripts/leak.ts\nexit 0',
  });
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8');
  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'leak', cwd: dir });
  assert.ok(r.ok, `提交应成功: ${r.error}`);
  assert.ok(r.outOfScope.includes('scripts/leak.ts'), `越界文件应被检出: ${r.outOfScope}`);
});

// ── 用例 8：interleaved 检测（正常单提交为 false）──
check('用例8: 单提交场景 interleaved=false', () => {
  const dir = makeRepo(describe);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2', 'utf8');
  const r = commitWithTempIndex({ paths: ['a.ts'], message: 'il', cwd: dir });
  assert.ok(r.ok);
  assert.equal(r.interleaved, false, '无并发插队时 interleaved 应为 false');
});

if (fails.length) {
  console.error(`\n${fails.length} 个用例失败:`);
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('\n全部通过 ✅');
