#!/usr/bin/env node
/**
 * gen-knowledge-autogen.ts — 知识卡 `auto_fields:` 字段自动生成器（解法 B：机器推导字段）。
 *
 * 从卡片 `source_files` 指向的源码提取导出符号及其行号，写入 frontmatter 的
 * `auto_fields.symbols_with_lines:` 块列表。
 *
 * 解法 B 核心：知识卡字段分两类——
 *   「机器推导」（行号、函数签名、source_files/symbols/tests）由本脚本自动生成；
 *   「人工策展」（use_when、pitfalls、design_intent、正文 prose）继续手写，
 *   check-knowledge-drift 只对人工策展字段报 WARN（不阻断）。
 *
 * 用法：
 *   node scripts/gen-knowledge-autogen.ts            # 扫描并补写缺失 auto_fields
 *   node scripts/gen-knowledge-autogen.ts --check    # 只校验不写入（CI）
 *   node scripts/gen-knowledge-autogen.ts --full     # 重写全部卡片的 auto_fields（含已有）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：知识卡机器推导字段生成器（解法 B）
 * 退出码：1（check 模式发现漂移）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, getList } from './_lib/frontmatter.ts';
import { parseArgs } from './_lib/parse-args.ts';
import { ROOT } from './_lib/scan-files.ts';
import { KNOWLEDGE_NON_CARDS as NON_CARDS, KNOW_DIR } from './_lib/knowledge-cards.ts';

// ---------- auto_fields 字段解析 ----------

// 解析 auto_fields: 块（嵌套映射），无该字段返回 null
// 格式示例：
//   auto_fields:
//     symbols_with_lines:
//       - SymbolName:42
function parseAutoFields(fm: string) {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^auto_fields\s*:/.test(lines[i]!)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const out: Record<string, string[]> = {};
  let currentKey = '';
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // 无缩进（顶格）→ 新键或结束
    if (/^\S/.test(line)) {
      // 检查是否是新键（如 "tests:"）
      const keyMatch = line.match(/^(\w+)\s*:/);
      if (keyMatch && keyMatch[1] !== 'auto_fields') {
        // 遇到下一个顶层键 → 结束 auto_fields 块
        break;
      }
      continue;
    }
    if (line.trim() === '') continue;
    // 有缩进 → 可能是子键或列表项
    // 子键格式：`  symbols_with_lines:`（2 空格缩进）；宽松匹配任意缩进以兼容 tab
    const subKeyMatch = line.match(/^\s+(\w+)\s*:/);
    if (subKeyMatch) {
      currentKey = subKeyMatch[1]!;
      if (!out[currentKey]) out[currentKey] = [];
      continue;
    }
    // 列表项格式：`    - SymbolName:42`（4 空格缩进）；宽松匹配任意缩进 + 可选空格
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (item && currentKey) {
      out[currentKey]!.push(item[1]!.trim());
    }
  }
  return out;
}

// 用新 auto_fields 替换 frontmatter 中的 auto_fields: 块；若原本无该字段则插入到 source_files 后
function withUpdatedAutoFields(fm: string, newFields: Record<string, string[]>): string | null {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^auto_fields\s*:/.test(lines[i]!)) {
      idx = i;
      break;
    }
  }
  // 无现有 auto_fields 块 → 在 source_files 块结束后插入
  if (idx === -1) {
    let sfIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^source_files\s*:/.test(lines[i]!)) { sfIdx = i; break; }
    }
    if (sfIdx === -1) {
      // 无 source_files（罕见）→ 在 tier 行后插入
      for (let i = 0; i < lines.length; i++) {
        if (/^tier\s*:/.test(lines[i]!)) { sfIdx = i; break; }
      }
    }
    if (sfIdx === -1) return null; // 无法定位插入点
    // 找到 source_files 块的结束位置
    let end = sfIdx + 1;
    while (end < lines.length) {
      const line = lines[end]!;
      if (/^\S/.test(line) || line.trim() === '') break;
      end++;
    }
    const block: string[] = ['auto_fields:'];
    for (const [key, values] of Object.entries(newFields)) {
      if (values.length === 0) {
        block.push(`  ${key}: []`);
      } else {
        block.push(`  ${key}:`);
        for (const v of values) block.push(`    - ${v}`);
      }
    }
    return [...lines.slice(0, end), ...block, ...lines.slice(end)].join('\n');
  }
  // 有现有 auto_fields 块 → 替换
  let end = idx + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (/^\S/.test(line) || line.trim() === '') break;
    end++;
  }
  const block: string[] = ['auto_fields:'];
  for (const [key, values] of Object.entries(newFields)) {
    if (values.length === 0) {
      block.push(`  ${key}: []`);
    } else {
      block.push(`  ${key}:`);
      for (const v of values) block.push(`    - ${v}`);
    }
  }
  return [...lines.slice(0, idx), ...block, ...lines.slice(end)].join('\n');
}

// ---------- 符号+行号提取 ----------

/**
 * 从源码文件提取导出符号及其起始行号。
 * 返回 { symbol, line } 列表，按 symbol 排序。
 */
function extractSymbolsWithLines(filePath: string): Array<{ symbol: string; line: number }> {
  const text = fs.readFileSync(filePath, 'utf8');
  const result: Array<{ symbol: string; line: number }> = [];

  // 剥离块注释（保持行数不变）
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '));
  const srcLines = src.split(/\r?\n/);

  if (filePath.toLowerCase().endsWith('.go')) {
    // Go: func / type / const / var（首字母大写）
    const reFunc = /^[ \t]*func\s+(?:\(([^)]*)\)\s+)?([A-Za-z0-9_]+)\s*\(/;
    const reDecl = /^[ \t]*(?:type|const|var)\s+([A-Za-z0-9_]+)/;
    const reGroupHead = /^[ \t]*(?:const|var|type)\s*\(/;
    const reGroupBody = /^[ \t]*([A-Za-z0-9_]+)(?:[ \t]+[A-Za-z0-9_[\].*]+)?[ \t]*(?:=|[{]|$|,)/;

    for (let i = 0; i < srcLines.length; i++) {
      const line = srcLines[i]!;
      const mFunc = line.match(reFunc);
      if (mFunc) {
        const name = mFunc[2]!;
        if (/^[A-Z]/.test(name)) {
          let sym = name;
          if (mFunc[1]) {
            const tm = mFunc[1].match(/([A-Za-z0-9_]+)(?:\s*\[[^\]]*\])?\s*$/);
            const t = tm ? tm[1] : '';
            if (t && /^[A-Z]/.test(t)) sym = `${t}.${name}`;
          }
          result.push({ symbol: sym, line: i + 1 });
        }
        continue;
      }
      const mDecl = line.match(reDecl);
      if (mDecl && /^[A-Z]/.test(mDecl[1]!)) {
        result.push({ symbol: mDecl[1]!, line: i + 1 });
        continue;
      }
      // 分组声明
      const mGroup = line.match(reGroupHead);
      if (mGroup) {
        for (let j = i + 1; j < srcLines.length; j++) {
          const gline = srcLines[j]!;
          if (/^[ \t]*\)/.test(gline)) { i = j; break; }
          const gm = gline.match(reGroupBody);
          if (gm && /^[A-Z]/.test(gm[1]!)) {
            result.push({ symbol: gm[1]!, line: j + 1 });
          }
        }
        continue;
      }
    }
  } else {
    // TS/JS: export function/class/interface/type/enum/const/let/var + export { a, b as c }
    const reDecl = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/;
    const reVal = /^export\s+(?:declare\s+)?(?:const|let|var)\s+(?:enum\s+)?([A-Za-z0-9_$]+)/;
    const reDestr = /^export\s+(?:const|let|var)\s*\{([^}]+)\}/;
    const reRe = /^export\s*(?:type\s*)?\{([^}]+)\}/;
    const reDefault = /^export\s+default\s+([A-Za-z0-9_$]+)\s*;?\s*$/;

    for (let i = 0; i < srcLines.length; i++) {
      const line = srcLines[i]!;
      const m = line.match(reDecl);
      if (m) { result.push({ symbol: m[1]!, line: i + 1 }); continue; }
      const mv = line.match(reVal);
      if (mv) { result.push({ symbol: mv[1]!, line: i + 1 }); continue; }
      const md = line.match(reDestr);
      if (md) {
        for (const part of md[1]!.split(',')) {
          const name = part.trim().split(/\s*[:=]\s*/)[0]!.trim();
          if (/^[A-Za-z0-9_$]+$/.test(name)) result.push({ symbol: name, line: i + 1 });
        }
        continue;
      }
      const mr = line.match(reRe);
      if (mr) {
        for (const part of mr[1]!.split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()!.trim();
          if (/^[A-Za-z0-9_$]+$/.test(name)) result.push({ symbol: name, line: i + 1 });
        }
        continue;
      }
      const mdef = line.match(reDefault);
      if (mdef) { result.push({ symbol: mdef[1]!, line: i + 1 }); }
    }
  }

  return result.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** 收集 source_files 指向源码的导出符号及行号。 */
function collectSymbolsWithLines(sourceFiles: string[]): Array<{ symbol: string; line: number }> {
  const map = new Map<string, number>(); // symbol -> earliest line
  for (const src of sourceFiles) {
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) continue;
    let targets = [abs];
    if (fs.statSync(abs).isDirectory()) {
      // 递归收集目录下源文件
      function walkDir(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walkDir(p);
          else if (e.isFile() && /\.(ts|tsx|js|jsx|go)$/.test(e.name)
            && !/(\.test\.|\.spec\.|_test\.go$|\.d\.ts$)/.test(e.name)) {
            targets.push(p);
          }
        }
      }
      walkDir(abs);
    }
    for (const t of targets) {
      try {
        const syms = extractSymbolsWithLines(t);
        for (const s of syms) {
          const existing = map.get(s.symbol);
          if (existing === undefined || s.line < existing) {
            map.set(s.symbol, s.line);
          }
        }
      } catch {
        continue;
      }
    }
  }
  return [...map.entries()].map(([symbol, line]) => ({ symbol, line })).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---------- 主流程 ----------

function main() {
  const parsed = parseArgs(process.argv.slice(2), { bools: ['check', 'full', 'json'] });
  if (parsed.unknown.length) {
    console.error(`❌ 未知参数: ${parsed.unknown.join(', ')}（支持 --check --full --json）`);
    process.exit(1);
  }
  const { check: isCheck, full: isFull, json: wantJson } = parsed;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  const cards = fs.readdirSync(KNOW_DIR)
    .filter((f) => f.endsWith('.md') && !NON_CARDS.has(f.toLowerCase()));

  let updated = 0;
  let skippedNoSources = 0;
  const drifts: Array<{ file: string; added: string[]; removed: string[] }> = [];

  for (const cf of cards) {
    const file = path.join(KNOW_DIR, cf);
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;

    const sources = getList(fm, 'source_files');
    if (sources.length === 0) {
      skippedNoSources++;
      continue;
    }

    const target = collectSymbolsWithLines(sources);
    // 格式化为 "SymbolName:line" 字符串列表
    const targetSymbols = target.map((s) => `${s.symbol}:${s.line}`);

    // 解析现有 auto_fields
    const existing = parseAutoFields(fm);
    const existingSymbols = existing?.['symbols_with_lines'] ?? [];

    // 全量比较（Symbol:line 整串）——行号移动也是漂移，必须触发更新。
    // 旧逻辑按符号名比较（s.split(':')[0]），createBus:12 → createBus:15 不报漂移，
    // 导致 --check 假绿、write 模式不刷新，auto_fields 行号永久 stale。
    const existingSet = new Set(existingSymbols);
    const targetSet = new Set(targetSymbols);

    const added = targetSymbols.filter((s) => !existingSet.has(s));
    const removed = existingSymbols.filter((s) => !targetSet.has(s));

    // 区分「行号漂移」(moved) 与「符号增删」(added/removed)：
    // added 和 removed 的 symbol 部分相同但 line 不同 → moved
    const addedSyms = new Set(added.map((s) => s.split(':')[0]));
    const moved = removed.filter((s) => addedSyms.has(s.split(':')[0]));
    const pureAdded = added.filter((s) => !moved.some((m) => m.split(':')[0] === s.split(':')[0]));
    const pureRemoved = removed.filter((s) => !moved.some((m) => m.split(':')[0] === s.split(':')[0]));

    if (added.length === 0 && removed.length === 0 && !isFull) continue; // 一致且非 full 模式 → 跳过

    if (isCheck) {
      if (added.length || removed.length) {
        drifts.push({ file: cf, added: pureAdded, removed: pureRemoved, moved });
      }
      continue;
    }

    // 构建新的 auto_fields
    const newFields: Record<string, string[]> = { symbols_with_lines: targetSymbols };
    // 保留已有其他子字段
    if (existing) {
      for (const [k, v] of Object.entries(existing)) {
        if (k !== 'symbols_with_lines') newFields[k] = v;
      }
    }

    const newFm = withUpdatedAutoFields(fm, newFields);
    if (newFm === null) continue;
    const newText = text.replace(
      /^---\r?\n[\s\S]*?\r?\n---/,
      '---\n' + newFm + '\n---'
    );
    fs.writeFileSync(file, newText);
    updated++;
    console.log(`✍️  ${cf} → auto_fields.symbols_with_lines (${targetSymbols.length} 个符号)`);
  }

  if (isCheck) {
    if (drifts.length) {
      if (wantJson) {
        console.log(JSON.stringify({ _summary: { ok: false, drifts: drifts.length, scanned: cards.length } }));
      } else {
        console.error(`❌ ${drifts.length} 张卡 auto_fields 漂移，请运行：node scripts/gen-knowledge-autogen.ts`);
        for (const d of drifts) {
          const parts: string[] = [];
          if (d.added.length) parts.push('+[' + d.added.slice(0, 5).join(', ') + (d.added.length > 5 ? '…' : '') + ']');
          if (d.removed.length) parts.push('-[' + d.removed.slice(0, 5).join(', ') + (d.removed.length > 5 ? '…' : '') + ']');
          console.error(`   - ${d.file} 漂移: ${parts.join(' ')}`);
        }
      }
      process.exit(1);
    }
    if (wantJson) {
      console.log(JSON.stringify({ _summary: { ok: true, scanned: cards.length, skipped: skippedNoSources } }));
    } else {
      console.log(`✅ 知识卡 auto_fields: 与源码导出符号一致（扫描 ${cards.length} 张卡，跳过无 source_files ${skippedNoSources} 张）`);
    }
    process.exit(0);
  }

  if (wantJson) {
    console.log(JSON.stringify({ _summary: { ok: true, updated, scanned: cards.length } }));
  } else {
    console.log(
      updated === 0
        ? `✅ 知识卡 auto_fields: 已是最新，无需修改（扫描 ${cards.length} 张卡）`
        : `✅ 已更新 ${updated} 张卡的 auto_fields: 字段`
    );
  }
  process.exit(0);
}

main();
