#!/usr/bin/env node
/**
 * gen-knowledge-h1.mjs — 知识卡正文补 `# 标题`（h1）（适配自 MikuMikuAR）。
 *
 * 从 frontmatter `name` 生成 h1，消除「内容无标题」：VitePress 页面顶部
 * 因此无标题，浏览器标签与大纲层级也缺一级。已存在 h1 的卡跳过。
 *
 * 用法：
 *   node scripts/gen-knowledge-h1.mjs            # 扫描并补写缺失 h1
 *   node scripts/gen-knowledge-h1.mjs --check    # 只校验不写入（CI）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：知识卡 H1 标题生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, getScalar } from './_lib/frontmatter.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');

/** 非知识卡文件（与 check-knowledge-drift / gen-docs-index 保持一致；含本项目 AGENTS.md） */
const NON_CARDS = new Set([
  'README.md', 'index.md', 'AGENTS.md', 'menu-map.md', 'graph.md', 'tier-review.md',
]);

/** 解析 frontmatter：返回 { name, body, h1Exists }。 */
function parseCard(text) {
  const fm = parseFrontmatter(text);
  if (!fm) return null;
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // P2：name 解析改走共享 getScalar（处理缩进键/引号/行内注释/多行值），
  // 不再用列 0 手写正则（code_review P2）
  const name = getScalar(fm, 'name');
  const h1Exists = /^#\s+.+$/m.test(body);
  return { name: name ? name.trim() : null, body, h1Exists };
}

function main() {
  const { check: isCheck } = parseArgs(process.argv.slice(2), { bools: ['check'] });

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  const missing = [];
  const noName = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f.toLowerCase())) continue; // P3-8：大小写不敏感，与 check-knowledge-drift 一致
    const filePath = path.join(KNOW_DIR, f);
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.warn(`⚠️ 读取失败（跳过）: ${f} — ${e.message}`);
      continue; // P3-5：单文件不可读不中断整轮
    }
    const card = parseCard(text);
    if (!card) continue; // 无 frontmatter（非卡）
    if (!card.name) {
      noName.push(f);
      continue;
    }
    if (!card.h1Exists) missing.push({ file: f, name: card.name, text, filePath });
  }

  if (noName.length) {
    console.warn(`⚠️  ${noName.length} 张卡缺 name 字段（跳过）: ${noName.slice(0, 5).join(', ')}${noName.length > 5 ? '…' : ''}`);
  }

  if (isCheck) {
    if (missing.length) {
      console.error(`❌ ${missing.length} 张知识卡正文缺 # 标题，请运行：node scripts/gen-knowledge-h1.mjs`);
      for (const t of missing.slice(0, 20)) console.error(`   - ${t.file}（name: ${t.name}）`);
      process.exit(1);
    }
    // P3-7：缺 name 的卡无法补 H1，check 模式应失败（此前仅 warn 可绿灯）
    if (noName.length) {
      console.error(`❌ ${noName.length} 张卡缺 name 字段（无法补 H1），请先修复 frontmatter`);
      process.exit(1);
    }
    console.log('✅ 所有知识卡正文均有 # 标题');
    return;
  }

  let written = 0;
  for (const t of missing) {
    // 在 frontmatter 结束的 --- 后补 `# name` + 空行；正文原有内容保持不变
    const newText = t.text.replace(
      /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/,
      `$1\n\n# ${t.name}\n`
    );
    if (newText === t.text) continue;
    try {
      fs.writeFileSync(t.filePath, newText, 'utf8');
    } catch (e) {
      console.error(`❌ 写入失败: ${t.file} — ${e.message}`);
      continue; // P3-5：写失败不中断整轮
    }
    written++;
    console.log(`✍️  ${t.file} → # ${t.name}`);
  }
  console.log(written ? `✅ 已补齐 ${written} 张知识卡的 # 标题` : '✅ 无需补齐');
}

main();
