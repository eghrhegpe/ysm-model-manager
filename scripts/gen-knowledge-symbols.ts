#!/usr/bin/env node
/**
 * gen-knowledge-symbols.ts — 知识卡 `symbols:` 字段自动生成器（适配自 MikuMikuAR）。
 *
 * 从卡片 `source_files` 指向的源码提取导出符号，与 frontmatter 的 `symbols:`
 * 列表做集合比对并同步（gen 写 / --check 校验）。
 *
 * YSM 双栈适配：JS/TS 用 export 关键字提取，Go 用首字母大写顶层声明
 * （getExportedSymbolsAny 分发，见 _lib/source-graph.ts）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *   node scripts/gen-knowledge-symbols.ts          # 同步写入（原地修改漂移的卡）
 *   node scripts/gen-knowledge-symbols.ts --check  # 只校验不写，有漂移则退出码 1
 *
 * 比对语义：集合相等（顺序无关）。仅当符号真实增删（改名/移除/新增）时才重写该卡，
 * 纯顺序差异不动 —— 避免首次运行无谓触碰全部卡片。
 *
 * 范围：仅处理已声明 `symbols:` 字段的卡；未声明的卡不自动发明（避免无差别改写）。
 * 不处理：use_when / category / tier / 正文 prose（属人类判断，不自动生成）。
 * 设计意图：知识卡符号生成器
 * 用法：
 *   node scripts/gen-knowledge-symbols.ts                 # 默认行为
 *   node scripts/gen-knowledge-symbols.ts --check # 启用 check
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, parseSourceFiles } from './_lib/frontmatter.ts';
import { parseArgs } from './_lib/parse-args.ts';
import { getExportedSymbolsAny, EXCLUDE_DIRS } from './_lib/source-graph.ts';
import { ROOT } from './_lib/scan-files.ts';

const KNOWLEDGE_DIR = path.join(ROOT, 'docs', 'knowledge');

// ---------- symbols 字段解析 ----------

// 解析 symbols: 块（块列表），无该字段返回 null
function parseSymbols(fm) {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^symbols\s*:/.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // 下一个顶格 key
    if (line.trim() === '') break; // 空行（块结束）
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) out.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

// 用新符号列表替换 frontmatter 中的 symbols: 块；本无该字段返回 null。
function withUpdatedSymbols(fm, newSymbols) {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^symbols\s*:/.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^\S/.test(line) || line.trim() === '') break;
    end++;
  }
  const block = ['symbols:'];
  for (const s of newSymbols) block.push('  - ' + s);
  return [...lines.slice(0, idx), ...block, ...lines.slice(end)].join('\n');
}

// ---------- 符号收集 ----------

/**
 * 收集 source_files 指向源码的导出符号。
 * source_files 可为目录（递归收 .ts/.tsx/.js/.jsx/.go）或单个文件。
 */
function collectSymbols(sourceFiles) {
  const set = new Set<any>();
  for (const src of sourceFiles) {
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) continue;
    let targets = [abs];
    if (fs.statSync(abs).isDirectory()) {
      targets = walkDir(abs);
    }
    for (const t of targets) {
      let syms: any[] = [];
      try {
        syms = getExportedSymbolsAny(t, undefined as any);
      } catch {
        continue;
      }
      syms.forEach((s) => set.add(s));
    }
  }
  return [...set].sort();
}

/** 递归收集目录下源文件（.ts/.tsx/.js/.jsx/.go，跳过隐藏/测试/生成物）。 */
function walkDir(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    // 复用共享层 EXCLUDE_DIRS（__tests__/__mocks__/node_modules/wailsjs/bindings/dist）：
    // 自研递归此前不排除生成物目录，source_files 指向整包目录时会深入 bindings/dist（code_review P2-2）
    if (e.isDirectory() && EXCLUDE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(p, out);
    } else if (e.isFile() && /\.(ts|tsx|js|jsx|go)$/.test(e.name) && !/(\.test\.|\.spec\.|_test\.go$|\.d\.ts$)/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// 集合相等（顺序无关）
function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

// ---------- 主流程 ----------

function main() {
  const parsed = parseArgs(process.argv.slice(2), { bools: ['check'] });
  // ADR-043 陷阱 #12：未知 flag 显式拒绝（--checkk 拼错不得静默当写模式执行）
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(', ')}（支持 --check）`);
    process.exit(1);
  }
  const { check: checkMode } = parsed;
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.log('知识卡目录不存在：' + KNOWLEDGE_DIR);
    process.exit(0);
  }
  const cards = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'index.md');

  let updated = 0;
  let drift = 0;
  let skippedNoField = 0;

  for (const cf of cards) {
    const file = path.join(KNOWLEDGE_DIR, cf);
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const sources = parseSourceFiles(fm);
    if (sources.length === 0) continue;

    const existing = parseSymbols(fm);
    if (existing === null) {
      skippedNoField++;
      continue; // 未声明 symbols: 不自动发明
    }

    const target = collectSymbols(sources);
    if (setsEqual(existing, target)) continue; // 集合一致（顺序无关）→ 不碰

    if (checkMode) {
      drift++;
      const added = target.filter((s) => !existing.includes(s));
      const removed = existing.filter((s) => !target.includes(s));
      const parts: string[] = [];
      if (added.length) parts.push('+[' + added.join(', ') + ']');
      if (removed.length) parts.push('-[' + removed.join(', ') + ']');
      console.log(`⚠ ${cf} symbols 漂移 ${parts.join(' ')}`);
    } else {
      const newFm = withUpdatedSymbols(fm, target);
      if (newFm === null) continue;
      const newText = text.replace(
        /^---\r?\n[\s\S]*?\r?\n---/,
        '---\n' + newFm + '\n---'
      );
      fs.writeFileSync(file, newText);
      updated++;
    }
  }

  if (checkMode) {
    if (drift === 0) {
      console.log(
        `✅ 知识卡 symbols: 与源码导出符号一致（扫描 ${cards.length} 张卡，跳过无字段 ${skippedNoField} 张）`
      );
      process.exit(0);
    }
    console.log(
      `❌ ${drift} 张卡 symbols 漂移，请运行：node scripts/gen-knowledge-symbols.ts 同步`
    );
    process.exit(1);
  }

  console.log(
    updated === 0
      ? `✅ 知识卡 symbols: 已是最新，无需修改（扫描 ${cards.length} 张卡）`
      : `✅ 已同步 ${updated} 张卡的 symbols: 字段`
  );
  process.exit(0);
}

main();
