#!/usr/bin/env node
/**
 * 契约测试：CLI 命令注册表 ↔ 文档 parity（docs/cli-commands.md ↔ go/cli）。
 *
 * 背景：CLI 命令一度「已注册但 AGENTS.md 文档停在 18 个」造成入口漂移。
 * 本测试锁住三条线：
 *  1. go/cli 的 RegisterCommandC 注册命令名集合 == docs/cli-commands.md 文档命令名集合（双向相等）
 *  2. AGENTS.md 根文档引用 docs/cli-commands.md（入口指针不漂移）
 *  3. 文档含 GEN 标记且命令数不低于注册表下限（防文档被整节静默删除）
 * 纯静态、读源码 + 生成物、零副作用、零 Go 编译，可进每次 push 门禁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'go', 'cli');
const DOC = path.join(ROOT, 'docs', 'cli-commands.md');
const AGENTS = path.join(ROOT, 'AGENTS.md');

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

/** 读文件，缺失直接记错误并返回空串。 */
function readOrDie(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    errors.push(`MISSING: ${rel}`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

// ── 1) 注册命令名集合（与 gen-cli-doc.mjs 同口径：RegisterCommandC + 排除 _test.go）──
const goFiles = fs
  .readdirSync(CLI_DIR)
  .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
const registered = new Set();
for (const f of goFiles) {
  const text = readOrDie(`go/cli/${f}`);
  const re = /RegisterCommandC\(\s*"([a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(text))) registered.add(m[1]);
}

// ── 2) 文档命令名集合（### `name` 小节标题）──
const docText = readOrDie('docs/cli-commands.md');
const documented = new Set();
{
  const re = /^### `([a-z0-9-]+)`$/gm;
  let m;
  while ((m = re.exec(docText))) documented.add(m[1]);
}

// ── 3) 双向相等 ──
const missingInDoc = [...registered].filter((c) => !documented.has(c));
const extraInDoc = [...documented].filter((c) => !registered.has(c));
must(
  missingInDoc.length === 0,
  `CLI 已注册但 docs/cli-commands.md 缺失 ${missingInDoc.length} 个命令: ${missingInDoc.join(', ')}（运行 node scripts/gen-cli-doc.ts）`,
);
must(
  extraInDoc.length === 0,
  `docs/cli-commands.md 含 ${extraInDoc.length} 个未注册命令: ${extraInDoc.join(', ')}（文档与注册表脱节）`,
);

// ── 4) AGENTS.md 入口指针 ──
const agents = readOrDie('AGENTS.md');
must(
  agents.includes('docs/cli-commands.md'),
  'AGENTS.md 未引用 docs/cli-commands.md（CLI 命令列表入口应指向生成文档）',
);

// ── 5) GEN 标记 + 命令数下限（38 个顶层命令，2026-08 校准）──
must(
  docText.includes('<!-- GEN: cli-commands -->') && docText.includes('<!-- /GEN: cli-commands -->'),
  'docs/cli-commands.md 缺失 GEN 标记区（<!-- GEN: cli-commands -->）',
);
must(registered.size >= 38, `顶层命令数异常（期望 ≥38，实际 ${registered.size}）——注册表被大量删除时需人工确认`);

// ── 汇总结论 ──
if (errors.length) {
  console.error('❌ 契约测试失败（CLI 注册表 ↔ 文档 parity）：');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('  提示：命令/子命令/选项变更后运行 `node scripts/gen-cli-doc.ts` 刷新 docs/cli-commands.md。');
  process.exit(1);
}
console.log(`✅ 契约测试通过：CLI 注册表 ↔ 文档 parity 一致（${registered.size} 个顶层命令全部在册，AGENTS.md 入口指向生成文档）`);
process.exit(0);