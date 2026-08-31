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
import { parseFrontmatter, getScalar } from './_lib/frontmatter.ts';
import { parseArgs } from './_lib/parse-args.ts';
// [ADR-114 §被补充] 常量共享层
import { KNOWLEDGE_NON_CARDS as NON_CARDS, KNOW_DIR } from './_lib/knowledge-cards.ts';

/** 解析 frontmatter：返回 { name, body, h1Exists }。 */
function parseCard(text) {
  const fm = parseFrontmatter(text);
  if (!fm) return null;
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // P2：name 解析改走共享 getScalar（与 check-knowledge-drift 同口径，支持行内注释剥离；
  // 注：getScalar 仅处理列 0 键 + 单行标量，引号/多行值不在其能力内，与旧正则一致）
  const name = getScalar(fm, 'name');
  const h1Exists = /^#\s+.+$/m.test(body);
  return { name: name ? name.trim() : null, body, h1Exists };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2), { bools: ['check'] });
  // ADR-043 陷阱 #12：未知 flag 显式拒绝（--checkk 拼错不得静默当写模式执行）
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(', ')}（支持 --check）`);
    process.exit(1);
  }
  const { check: isCheck } = parsed;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  const missing = [];
  const noName = [];
  const failures = []; // 读/写失败计数：CI 模式下不可静默通过（code_review P2）
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f.toLowerCase())) continue; // P3-8：大小写不敏感，与 check-knowledge-drift 一致
    const filePath = path.join(KNOW_DIR, f);
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      failures.push(f); // 记录而非仅 warn——check 模式须以非零退出暴露未校验卡
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
    // P2：读取失败同样使 check 失败——有卡未校验不得绿灯
    if (failures.length) {
      console.error(`❌ ${failures.length} 张卡读取失败（未校验），请检查文件权限/损坏: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`);
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
