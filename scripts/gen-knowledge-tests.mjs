#!/usr/bin/env node
/**
 * gen-knowledge-tests.mjs — 知识卡 `tests:` 字段自动登记（适配自 MikuMikuAR）。
 *
 * 扫描前端测试文件（本项目散落于 frontend/src/**，非隔壁集中 __tests__），
 * 按卡名/source_files basename 匹配，为「tests 为空但实际有测试文件」的
 * architecture 卡补登测试路径。
 *
 * 背景：内容层审计发现 architecture 卡 tests 为空，但前端存在对应测试文件
 * （登记缺口，非"无测试"）。本脚本按名匹配自动补登，消除「有测试却不进
 * 验证入口」的断链。
 *
 * 用法：
 *   node scripts/gen-knowledge-tests.mjs            # 补登并写入
 *   node scripts/gen-knowledge-tests.mjs --check    # 只校验不写入（CI）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 退出码：1（失败）
 * 设计意图：知识卡测试生成器
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './_lib/frontmatter.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');
const FRONTEND_JS_DIR = path.join(ROOT, 'frontend', 'src');

/** 非知识卡文件（与 check-knowledge-drift / gen-knowledge-h1/adr 保持一致；含本项目 AGENTS.md） */
const NON_CARDS = new Set([
  'README.md', 'index.md', 'routes.md', 'AGENTS.md', 'menu-map.md', 'graph.md', 'tier-review.md',
]);

/** 递归收集前端测试文件相对仓库路径（.test/.spec + .ts/.js）。 */
function collectTestFiles() {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, relPath);
      else if (/\.(test|spec)\.(ts|js)$/.test(e.name)) out.push(relPath);
    }
  };
  if (fs.existsSync(FRONTEND_JS_DIR)) walk(FRONTEND_JS_DIR, 'frontend/src');
  return out;
}

/** 提取 frontmatter 块。 */
function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** 测试文件 basename（去 .test/.spec + 扩展名后缀）。 */
function testBase(rel) {
  return path.basename(rel).replace(/\.(test|spec)\.(ts|js)$/, '');
}

/** 卡与测试的匹配判定：测试 basename 含卡名，或卡 source_files basename 含测试 basename 前缀。 */
function matchTests(cardName, sourceBases, testFiles) {
  const hit = [];
  for (const tf of testFiles) {
    const tb = testBase(tf);
    const rel = tf;
    if (tb === cardName) { hit.push(rel); continue; }
    // source_files basename 前缀匹配（支持点分隔与破折号分隔：data → data.test / display → display.test）
    for (const sb of sourceBases) {
      if (tb === sb || tb.startsWith(sb + '.') || tb.startsWith(sb + '-')) {
        hit.push(rel);
        break;
      }
    }
  }
  return [...new Set(hit)].sort();
}

/** 把 tests 列表写入 frontmatter：移除旧 tests 块（无论空/非空）→ 与已有条目合并去重 → 在 source_files 后插入。 */
function writeTests(text, tests) {
  const fm = fmBlock(text);
  if (!fm) return text;
  // 解析已有 tests 块内的条目（仅 tests: 字段，排除 source_files 等其它列表）
  // 注意：块边界用 `\n\s*$`（空行/文件尾）而非 `\s*$`——后者在 m 模式下匹配任意行尾，会把块截断在首行
  const testsBlock = fm.match(/^tests:\s*\n([\s\S]*?)(?=^[a-z_]+:|\n\s*$)/m);
  const existing = testsBlock
    ? [...testsBlock[1].matchAll(/^\s*-\s*(frontend\/\S+\.(ts|js))\s*$/gm)].map((m) => m[1])
    : [];
  const merged = [...new Set([...existing, ...tests])].sort();
  const lines = merged.map((t) => `  - ${t}`).join('\n');

  // 移除旧 tests 字段（覆盖 `tests: []` / `tests:` 空块 / 非空列表 / 完全无字段四种情况）
  let newFm = fm.replace(/^tests:[\s\S]*?(?=^[a-z_]+:|\n\s*$)/m, '').replace(/\n{3,}/g, '\n\n');

  // 在 source_files 块结束后插入新的 tests 块
  const sfEnd = newFm.match(/^(source_files:[\s\S]*?)(?=^[a-z_]+:|\n\s*$)/m);
  if (sfEnd) {
    newFm = newFm.replace(sfEnd[1], `${sfEnd[1]}tests:\n${lines}\n`);
  } else {
    // 无 source_files（罕见）→ 在 tier 行后插入
    newFm = newFm.replace(/^(tier:.*)$/m, `$1\ntests:\n${lines}`);
  }
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFm}\n---`);
}

function main() {
  const { check: isCheck } = parseArgs(process.argv.slice(2), { bools: ['check'] });

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }
  const testFiles = collectTestFiles();
  console.error(`📄 frontend/src 下测试文件 ${testFiles.length} 个`);

  // 收集「architecture 卡 + tests 为空」
  const targets = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    const fmTxt = fmBlock(text);
    if (!fmTxt) continue;
    const tier = (fmTxt.match(/^tier\s*:\s*(.+)$/m) || [])[1]?.trim();
    if (tier !== 'architecture') continue;
    const testsEmpty = /^tests:\s*\[\]$/m.test(fmTxt) || !fmTxt.includes('tests');
    // tests 非空但含重复条目（历史重复登记）也需清理
    const testsBlock = fmTxt.match(/^tests:\s*\n([\s\S]*?)(?=^[a-z_]+:)/m);
    const existingTests = testsBlock
      ? [...testsBlock[1].matchAll(/^\s*-\s*(frontend\/\S+\.(ts|js))\s*$/gm)].map((m) => m[1])
      : [];
    const testsHasDup = existingTests.length !== new Set(existingTests).size;
    if (!testsEmpty && !testsHasDup) continue;
    const cardName = f.replace(/\.md$/, '');
    const sources = [...fmTxt.matchAll(/^\s*-\s*(frontend\/\S+\.(ts|js))\s*$/gm)].map((m) => m[1]);
    const sourceBases = sources.map((s) => path.basename(s).replace(/\.(ts|js)$/, ''));
    const tests = matchTests(cardName, sourceBases, testFiles);
    if (tests.length) targets.push({ file: f, text, tests });
  }

  if (isCheck) {
    if (targets.length) {
      console.error(`❌ ${targets.length} 张卡 tests 未登记（存在对应测试文件），请运行：node scripts/gen-knowledge-tests.mjs`);
      for (const t of targets.slice(0, 10)) console.error(`   - ${t.file} → ${t.tests.join(', ')}`);
      process.exit(1);
    }
    console.log('✅ 所有有测试文件的卡均已登记 tests');
    return;
  }

  let written = 0;
  for (const t of targets) {
    const newText = writeTests(t.text, t.tests);
    if (newText === t.text) continue;
    fs.writeFileSync(path.join(KNOW_DIR, t.file), newText, 'utf8');
    written++;
    console.log(`✍️  ${t.file} → ${t.tests.length} 个测试`);
  }
  console.log(written ? `✅ 已登记 ${written} 张卡的 tests` : '✅ 无需登记');
}

main();
