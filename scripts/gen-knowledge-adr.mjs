#!/usr/bin/env node
/**
 * gen-knowledge-adr.mjs — 知识卡 `adr:` 关联自动补全（适配自 MikuMikuAR）。
 *
 * 从卡片 source_files 指向的源码扫描 `[doc:adr-NNN]` 显式标记，
 * 同步进 frontmatter 的 `adr:` 列表（仅补全当前无 adr 关联的 architecture 卡）。
 *
 * 背景：architecture 卡 frontmatter 无 `adr:` 关联，导致 ADR 反查表 / 关联图
 * / 路由「其次阅读」推导缺数据。源码中 `[doc:adr-NNN]` 是作者手写的权威关联标注，
 * 扫描 source_files 即可可靠补全（裸 `ADR-NNN` 提及不采信，避免噪音）。
 *
 * YSM 双栈适配：source_files 支持 `go/` 与 `frontend/` 双前缀
 * （隔壁仅 frontend/，本项目 Go + 前端并存）。
 *
 * 用法：
 *   node scripts/gen-knowledge-adr.mjs            # 补全并写入
 *   node scripts/gen-knowledge-adr.mjs --check    # 只校验不写入（CI）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 设计意图：知识卡 ADR 关联生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, getScalar } from './_lib/frontmatter.ts';
import { parseArgs } from './_lib/parse-args.ts';
import { ROOT } from './_lib/scan-files.ts';
// [ADR-114 §被补充] 常量共享层
import { KNOWLEDGE_NON_CARDS as NON_CARDS, KNOW_DIR } from './_lib/knowledge-cards.ts';

/** 提取 frontmatter 块。 */
function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** 提取 frontmatter 列表字段全部项。 */
function fmList(text, key) {
  const lines = fmBlock(text).split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/** 扫描 source_files 源码里的 `[doc:adr-NNN]` 显式标记，返回升序 ADR-NNN 列表。 */
function scanDocAdrMarkers(sourceFiles) {
  const found = new Set();
  for (const sf of sourceFiles) {
    const abs = path.join(ROOT, sf);
    if (!fs.existsSync(abs)) continue;
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/\[doc:adr-(\d+)\]/g)) found.add(parseInt(m[1], 10));
  }
  return [...found]
    .sort((a, b) => a - b)
    .map((n) => `ADR-${String(n).padStart(3, '0')}`);
}

/** 把 adr 列表写入 frontmatter：移除旧的空 `adr:` 键（`adr: []` 行内空列表 / `adr:` 空块），再在 `tier:` 行后插入 `adr:` 块。 */
function writeAdrBlock(text, adrList) {
  const fm = fmBlock(text);
  if (!fm) return text;
  // 移除旧的空 adr 键（两种形态：`adr: []` 行内 / `adr:` 后无内容的空块），
  // 避免 frontmatter 出现两处 adr: 键（VitePress 解析失败，code_review P2-2）。
  // 注意：只删「空」键——有内容的块（手写 adr 列表）由 main() 的 existing 守卫跳过，
  // 这里不得用 `(\n\s*-[^\n]*)*` 吞掉非空列表（code_review P3 契约矛盾）
  const fmNoEmptyAdr = fm
    .replace(/^adr\s*:\s*\[\]\s*$/m, '')
    .replace(/^adr\s*:\s*$/m, '')
    .replace(/\n{2,}/g, '\n');
  const adrBlock = adrList.map((a) => `  - ${a}`).join('\n');
  const newFm = fmNoEmptyAdr.replace(
    /^(tier:\s*.+)$/m,
    `$1\nadr:\n${adrBlock}`
  );
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFm}\n---`);
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

  // 收集：architecture 卡且 frontmatter 无 adr 关联
  const targets = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    const fmTxt = fmBlock(text);
    if (!fmTxt) continue;
    const tier = getScalar(fmTxt, 'tier');
    if (tier !== 'architecture') continue;
    const existing = fmList(text, 'adr').filter((a) => a !== '[]');
    if (existing.length) continue; // 已有手写关联，不动
    // YSM 双栈：source_files 支持 go/、frontend/、internal/ 三前缀（P2-1：此前漏 internal/，
    // 指向 internal/ 包的卡无法补全 adr 关联，--check 假绿）
    const sources = [...fmTxt.matchAll(/^\s*-\s*((?:go|frontend|internal)\/\S+)\s*$/gm)].map((m) => m[1]);
    const adrs = scanDocAdrMarkers(sources);
    if (adrs.length) targets.push({ file: f, text, adrs });
  }

  if (isCheck) {
    if (targets.length) {
      console.error(`❌ ${targets.length} 张 architecture 卡缺 adr 关联（源码有 [doc:adr-] 标记），请运行：node scripts/gen-knowledge-adr.mjs`);
      for (const t of targets) console.error(`   - ${t.file} → ${t.adrs.join(', ')}`);
      process.exit(1);
    }
    console.log('✅ 所有 architecture 卡均已登记 adr 关联');
    return;
  }

  let written = 0;
  for (const t of targets) {
    const newText = writeAdrBlock(t.text, t.adrs);
    if (newText === t.text) continue;
    fs.writeFileSync(path.join(KNOW_DIR, t.file), newText, 'utf8');
    written++;
    console.log(`✍️  ${t.file} → ${t.adrs.join(', ')}`);
  }
  console.log(written ? `✅ 已补全 ${written} 张卡的 adr 关联` : '✅ 无需补全');
}

main();
