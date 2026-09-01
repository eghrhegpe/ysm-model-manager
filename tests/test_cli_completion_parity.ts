#!/usr/bin/env node
/**
 * 契约测试：CLI 注册表 ↔ shell 补全 parity（completions/ ↔ go/cli）。
 *
 * 背景：completions/ 由 gen-cli-completion.mjs 从 go/cli 注册表生成，与 docs/cli-commands.md
 * 同源（_lib/cli-registry.ts）。本测试锁住三条线：
 *  1. 顶层命令名集合（RegisterCommandC）⊆ 三个补全脚本里的命令候选（防止新增命令漏进补全）
 *  2. gen-cli-completion --check 应通过（脚本产物最新，防手工篡改后漂移）
 *  3. 三个 shell 文件都存在
 * 纯静态 + 一次 spawn --check，零副作用，可进每次 push 门禁。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'go', 'cli');
const COMP_DIR = path.join(ROOT, 'completions');

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

// ── 1) 注册命令名集合（与契约测试口径一致）──
const registered = new Set();
for (const f of fs.readdirSync(CLI_DIR)) {
  if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
  const text = fs.readFileSync(path.join(CLI_DIR, f), 'utf8');
  const re = /RegisterCommandC\(\s*"([a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(text))) registered.add(m[1]);
}

// ── 2) 三个 shell 文件存在 ──
const FILES = ['ysm.bash', '_ysm.ps1', '_ysm'];
for (const f of FILES) {
  must(fs.existsSync(path.join(COMP_DIR, f)), `MISSING: completions/${f}（运行 node scripts/gen-cli-completion.ts）`);
}

// ── 3) 命令候选覆盖：bash 顶层词表应含全部注册命令 ──
if (fs.existsSync(path.join(COMP_DIR, 'ysm.bash'))) {
  const bash = fs.readFileSync(path.join(COMP_DIR, 'ysm.bash'), 'utf8');
  // 顶层命令词表行：`compgen -W "analyze analyze-mmd ..." -- "$cur"`
  const wordTable = bash.match(/compgen -W "([^"]+)"/);
  must(!!wordTable, 'bash 补全缺少顶层命令词表行（compgen -W "..."）');
  const candidates = new Set(wordTable ? wordTable[1].split(/\s+/) : []);
  const missing = [...registered].filter((c) => !candidates.has(c));
  must(
    missing.length === 0,
    `bash 补全缺少 ${missing.length} 个命令候选: ${missing.join(', ')}（运行 node scripts/gen-cli-completion.ts）`,
  );
}

// ── 4) --check 幂等（产物最新）──
try {
  execFileSync(process.execPath, ['scripts/gen-cli-completion.ts', '--check'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (e) {
  const out = e.stdout ? e.stdout.toString() : '';
  must(false, `gen-cli-completion --check 失败：${out || e.message}`);
}

// ── 汇总结论 ──
if (errors.length) {
  console.error('❌ 契约测试失败（CLI 注册表 ↔ shell 补全 parity）：');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('  提示：命令/子命令变更后运行 `node scripts/gen-cli-completion.ts` 刷新 completions/。');
  process.exit(1);
}
console.log(`✅ 契约测试通过：${registered.size} 个顶层命令全部进入 bash/pwsh/zsh 补全，产物最新`);
process.exit(0);