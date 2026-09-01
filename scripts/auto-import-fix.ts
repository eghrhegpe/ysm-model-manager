#!/usr/bin/env node
/**
 * auto-import-fix.ts — auto-import 修复写入 + 输出格式化（--fix / 文本 / JSON）。
 *
 * 设计意图：从 auto-import.ts 拆出的修复与输出层（2026-08-31 大脚本拆分基线 ADR）——
 * applyFixes 把缺失 import 建议幂等写入文件（聚合/CRLF 保留/插入点定位），
 * fmtText/fmtJson 产出人类与 CI 可消费的报告。领域专属（非通用共享层，故不入 _lib/）。
 *
 * 依赖：node:fs / node:path + _lib/scan-files.ts（readText / relPosix）
 *
 * 用法：被 auto-import.ts 主入口引用，非独立 CLI 入口。
 *   import { applyFixes, fmtText, fmtJson } from './auto-import-fix.ts';
 *
 * 退出码：非独立入口（无 CLI）。
 */
import fs from 'node:fs';
import { readText, relPosix } from './_lib/scan-files.ts';

// ── --fix 自动写入 ───────────────────────────────────

/**
 * 将缺失 import 建议写入文件（幂等：写入后重跑不再报告）。
 * 规则：
 *   - 歧义符号（多候选模块）跳过，不猜测来源；
 *   - 同一模块的多个符号聚合为一行（值/类型分开）；
 *   - 插入位置：文件头部注释块之后、第一个 import（或代码）之前。
 * @param {Array<{file:string,missing:Array}>} suggestions run() 输出
 * @returns {{ fixed: number, skipped: number }}
 */
export function applyFixes(suggestions: Array<{ file: string; missing: any[] }>) {
  let fixed = 0;
  let skipped = 0;
  for (const s of suggestions) {
    // 按模块路径聚合（值/类型分组）
    const groups = new Map(); // path -> { values:Set, types:Set }
    let fileSkipped = 0;
    for (const m of s.missing) {
      if (m.candidates.length > 1) {
        fileSkipped++;
        continue;
      }
      const p = m.candidates[0];
      if (!groups.has(p)) groups.set(p, { values: new Set(), types: new Set() });
      const g = groups.get(p);
      (m.typeOnly ? g.types : g.values).add(m.symbol);
    }
    if (groups.size === 0) {
      skipped += fileSkipped;
      continue;
    }
    // 生成 import 行（符号按字典序）
    const newLines: string[] = [];
    for (const [p, g] of groups) {
      if (g.values.size) newLines.push(`import { ${[...g.values].sort().join(', ')} } from "${p}"`);
      if (g.types.size) newLines.push(`import type { ${[...g.types].sort().join(', ')} } from "${p}"`);
    }
    // 定位插入点：跳过文件头注释块（// 或 /* 开头的行）与空行
    const raw = fs.readFileSync(s.file, 'utf-8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'; // 保留原行尾风格（CRLF 文件不被改写为 LF）
    const text = readText(s.file);
    const fileLines = text.split('\n');
    let insertAt = 0;
    while (insertAt < fileLines.length) {
      const t = fileLines[insertAt].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
        insertAt++;
        continue;
      }
      break;
    }
    // 插入：import 块后保留一个空行分隔（若插入点前一行为空则避免双重空行，
    // 移除的是 tail 末尾的空行，而非首个 import 行）
    const tail = [...newLines, ''];
    if (insertAt > 0 && fileLines[insertAt - 1].trim() === '') {
      tail.pop();
    }
    fileLines.splice(insertAt, 0, ...tail);
    const tmp = s.file + '.autoimport.tmp';
    fs.writeFileSync(tmp, fileLines.join(eol));
    fs.renameSync(tmp, s.file);
    fixed += newLines.length;
    skipped += fileSkipped;
  }
  return { fixed, skipped };
}

// ── 输出 ─────────────────────────────────────────────

export function fmtText({ files, suggestions, totals }: { files: string[]; suggestions: Array<{ file: string; missing: any[] }>; totals: { totalMissing: number; typeOnly: number; ambiguous: number } }, srcDir: string) {
  const lines = [
    `扫描 ${files.length} 个文件（${relPosix(srcDir)}），缺失 import 建议 ${totals.totalMissing} 条`
    + `（类型 ${totals.typeOnly}，歧义 ${totals.ambiguous}）。`,
    '',
  ];
  for (const s of suggestions) {
    lines.push(`== ${relPosix(s.file)} ==`);
    for (const m of s.missing) {
      const kind = m.typeOnly ? ' [type]' : '';
      const tag = m.candidates.length > 1 ? ` ⚠️ 歧义(${m.candidates.length})` : '';
      const head = m.candidates.length === 1
        ? `import ${m.typeOnly ? 'type ' : ''}{ ${m.symbol} } from "${m.candidates[0]}"`
        : `import ${m.typeOnly ? 'type ' : ''}{ ${m.symbol} } from "<候选之一>"`;
      lines.push(`  L${m.line}  ${m.symbol.padEnd(18)}→ ${head}${kind}${tag}`);
      if (m.candidates.length > 1) {
        for (const c of m.candidates) lines.push(`            候选: ${c}`);
      }
    }
    lines.push('');
  }
  if (totals.totalMissing === 0) {
    lines.push('✅ 未发现缺失 import。');
  } else {
    lines.push('（只读提示，未修改任何文件；加 --fix 可自动写入）');
  }
  return lines.join('\n');
}

export function fmtJson({ files, suggestions, totals }: { files: string[]; suggestions: Array<{ file: string; missing: any[] }>; totals: { totalMissing: number; typeOnly: number; ambiguous: number } }) {
  return JSON.stringify(
    {
      _summary: { scanned: files.length, missing: totals.totalMissing },
      scanned: files.length,
      totals,
      files: suggestions.map((s) => ({
        file: relPosix(s.file),
        missing: s.missing.map((m) => ({
          symbol: m.symbol,
          line: m.line,
          typeOnly: m.typeOnly,
          candidates: m.candidates,
        })),
      })),
    },
    null,
    2
  );
}
