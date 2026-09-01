#!/usr/bin/env node
/**
 * bug-chronicle 搜索。按关键词查找相关 bug，输出结构化摘要。
 * 由 scripts/bug-search.py 迁移（2026-08-03），逻辑逐点保真。
 * bug-search.ts — Bug 搜索工具
 * 设计意图：Bug 搜索工具
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/bug-search.ts                 # 默认行为
 *   node scripts/bug-search.ts --json # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { parseArgs } from './_lib/parse-args.ts';

const BUG_FILE = path.join(ROOT, 'docs/archive/bug-chronicle.md');

function loadBugs() {
  /** 将 bug-chronicle 解析为 bug 列表。 */
  const text = fs.readFileSync(BUG_FILE, 'utf-8');
  const bugs: any[] = [];
  let current: any = null;
  let currentSection = '';

  for (const line of text.split('\n')) {
    const m = line.match(/^## (\d+\.\s*.+)$/);
    if (m) {
      if (current) bugs.push(current);
      current = { title: m[1], sections: {} };
      currentSection = '';
      continue;
    }

    const m2 = line.match(/^### (.+)$/);
    if (m2 && current) {
      currentSection = m2[1]!;
      current.sections[currentSection] = '';
      continue;
    }

    if (current && currentSection) {
      current.sections[currentSection] += line + '\n';
    }
  }

  if (current) bugs.push(current);
  return bugs;
}

function search(keyword: string, bugs: any[]) {
  /** 在 bug 列表中搜索关键词，返回匹配的 bug 子集。 */
  const kw = keyword.toLowerCase();
  const results: any[] = [];
  for (const b of bugs) {
    const fullText = JSON.stringify(b).toLowerCase();
    if (fullText.includes(kw)) results.push(b);
  }
  return results;
}

const args = parseArgs(process.argv.slice(2), { bools: ['json'] });
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
const jsonMode = args.json;
const keywordArg = args._[0] ?? null;

const bugs = loadBugs();
const results = keywordArg ? search(keywordArg, bugs) : bugs;
const summary = { total_bugs: bugs.length, matched: results.length };

if (jsonMode) {
  const out = { _summary: summary, bugs: results };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  if (!keywordArg) {
    console.log(`共 ${bugs.length} 条 bug 记录`);
  } else {
    console.log(`关键词 '${keywordArg}' 匹配 ${results.length} 条:\n`);
    for (const b of results) {
      console.log(`  ## ${b.title}`);
      for (const [sec, text] of Object.entries(b.sections as Record<string, any>)) {
        const trimmed = text.trim();
        const firstLine = trimmed ? trimmed.split('\n')[0].slice(0, 80) : '';
        console.log(`    ${sec}: ${firstLine}`);
      }
    }
  }
}
