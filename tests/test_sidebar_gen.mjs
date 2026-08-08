#!/usr/bin/env node
/**
 * 契约测试：gen-vitepress-sidebar 递归分组与隐藏文件排除。
 *
 * 覆盖（code_review P2-3/P2-2 回归锁定）：
 *   1. novel/appendix/ 二级子目录内容必须出现在生成产物中
 *      （Go后端 / 安全横切 / 跨模块重构 此前因只扫一级目录完全漏扫）
 *   2. 隐藏文件（.doc-next-steps.md 诊断产物）不得进入侧边栏导航
 *   3. 生成产物为合法 ESM（export const autoSidebar = ...）
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_sidebar_gen.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', '.vitepress', 'sidebar.gen.mjs');

const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error('✗', name, '-', e.message);
  }
}

// 运行生成器（真实 docs 目录树）
const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-vitepress-sidebar.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});
check('生成器运行成功（exit 0）', () => {
  if (res.status !== 0) throw new Error(`exit=${res.status} stderr=${res.stderr.slice(0, 200)}`);
});

const gen = fs.readFileSync(OUT, 'utf8');

check('产物为合法 ESM（export const autoSidebar = ...）', () => {
  if (!/export const autoSidebar = /.test(gen)) throw new Error('缺 autoSidebar 导出');
});

check('novel/appendix 二级子目录内容入列（递归分支生效）', () => {
  // appendix/Go后端、安全横切、跨模块重构 应出现在侧边栏（此前完全漏扫）
  for (const key of ['appendix/Go后端', 'appendix/安全横切', 'appendix/跨模块重构']) {
    if (!gen.includes(key)) throw new Error(`侧边栏缺 ${key}`);
  }
});

check('隐藏文件 .doc-next-steps.md 被排除（不进导航）', () => {
  if (gen.includes('.doc-next-steps')) throw new Error('.doc-next-steps 不应出现在侧边栏');
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✅ 全部用例通过');
